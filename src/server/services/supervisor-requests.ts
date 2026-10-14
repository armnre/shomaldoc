import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { professorProfiles, supervisorRequests, thesisCases, thesisSupervisors, users } from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type RequestContext } from "./audit";
import { getSettingValue } from "./settings";
import { getProfessorCapacity } from "./capacity";
import { addSupervisor, addSupervisorWith, canViewCase, getVisibleCaseIds, type CaseActor } from "./case";

/**
 * Student → professor supervisor/advisor request flow.
 *
 * Rules enforced on the server (never trusted from the client):
 *  - the requester must own the case (studentUserId) or hold staff permission;
 *  - the target must be an active account with a professor profile in the same
 *    department/field as the case and `acceptsStudents = true`;
 *  - capacity is re-checked at accept time, so two students racing for the last
 *    slot cannot both succeed;
 *  - rejection always requires a reason;
 *  - after `supervisor.maxAttempts` rejected attempts the request queue moves to
 *    the department head, who assigns a supervisor directly.
 */

export interface RequestActor extends CaseActor {}

async function resolveActor(actor: RequestActor) {
  if (actor.permissions) {
    return {
      permissions: new Set(actor.permissions),
      roleKeys: new Set((actor.roles ?? []).map((r) => (typeof r === "string" ? r : r.key))),
    };
  }
  const { loadUserAccess } = await import("../rbac/service");
  const access = await loadUserAccess(db, actor.id);
  return { permissions: new Set(access.permissions), roleKeys: new Set(access.roles.map((r) => r.key)) };
}

function requirePerm(access: { permissions: Set<string> }, permission: string) {
  if (!access.permissions.has(permission)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای این عملیات را ندارید.", { permission });
  }
}

async function loadOwnedCase(caseId: string, actor: RequestActor, access: { permissions: Set<string>; roleKeys: Set<string> }) {
  const [tc] = await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  if (!(await canViewCase(access, actor.id, tc))) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
  }
  return tc;
}

export interface CreateRequestInput {
  caseId: string;
  professorUserId: string;
  roleType: "supervisor" | "advisor";
  message?: string | null;
}

export async function createSupervisorRequest(actor: RequestActor, input: CreateRequestInput, ctx: RequestContext) {
  const access = await resolveActor(actor);

  const tc = await loadOwnedCase(input.caseId, actor, access);
  // Requesting a supervisor is the student's own action on their own case;
  // staff may do it on the student's behalf with the assignment permission.
  const isOwner = tc.studentUserId === actor.id;
  if (!isOwner && !access.permissions.has("cases.assign_supervisors")) {
    throw new AppError(403, "FORBIDDEN", "فقط دانشجوی صاحب پرونده یا کارکنان مجاز می‌توانند درخواست استاد ثبت کنند.");
  }
  if (tc.currentStatus === "archived") throw new AppError(409, "ARCHIVED", "پرونده بایگانی‌شده قابل تغییر نیست.");

  const [prof] = await db
    .select({ user: users, profile: professorProfiles })
    .from(users)
    .leftJoin(professorProfiles, eq(professorProfiles.userId, users.id))
    .where(eq(users.id, input.professorUserId))
    .limit(1);
  if (!prof || !prof.user.isActive) throw new AppError(400, "INVALID_PROFESSOR", "حساب استاد معتبر نیست.");
  if (!prof.profile) throw new AppError(400, "NO_PROFESSOR_PROFILE", "برای این حساب پروفایل استاد ثبت نشده است.");
  if (!prof.profile.acceptsStudents) {
    throw new AppError(409, "NOT_ACCEPTING_STUDENTS", "این استاد در حال حاضر پذیرش دانشجو ندارد.");
  }

  // Organisational match: the professor must belong to the case's department/field.
  if (tc.departmentId != null && prof.profile.departmentId != null && prof.profile.departmentId !== tc.departmentId) {
    throw new AppError(403, "ORG_MISMATCH", "استاد انتخاب‌شده به گروه این پرونده تعلق ندارد.");
  }
  // One primary supervisor at a time.
  const maxSupervisors = await getSettingValue("supervisor.maxSupervisors");
  const [existingLinks] = await db
    .select({ value: sql<number>`count(*)` })
    .from(thesisSupervisors)
    .where(and(eq(thesisSupervisors.caseId, tc.id), eq(thesisSupervisors.status, "active"), inArray(thesisSupervisors.roleType, ["supervisor", "co_supervisor"])));
  if (input.roleType !== "advisor" && Number(existingLinks?.value ?? 0) >= maxSupervisors) {
    throw new AppError(409, "SUPERVISOR_LIMIT", `حداکثر تعداد استاد راهنما (${maxSupervisors}) تکمیل شده است.`);
  }

  const [duplicate] = await db
    .select({ id: supervisorRequests.id })
    .from(supervisorRequests)
    .where(
      and(
        eq(supervisorRequests.caseId, tc.id),
        eq(supervisorRequests.professorUserId, input.professorUserId),
        eq(supervisorRequests.roleType, input.roleType),
        eq(supervisorRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (duplicate) throw new AppError(409, "DUPLICATE_REQUEST", "درخواست در انتظار برای همین استاد وجود دارد.");

  // Attempt number = rejected attempts for this case + 1.
  const [rejected] = await db
    .select({ value: sql<number>`count(*)` })
    .from(supervisorRequests)
    .where(and(eq(supervisorRequests.caseId, tc.id), eq(supervisorRequests.status, "rejected")));

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supervisorRequests)
      .values({
        caseId: tc.id,
        studentUserId: tc.studentUserId ?? actor.id,
        professorUserId: input.professorUserId,
        roleType: input.roleType,
        status: "pending",
        attemptNumber: Number(rejected?.value ?? 0) + 1,
        message: input.message ?? null,
      })
      .returning();

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "supervisor.request_created",
        entityType: "supervisor_request",
        entityId: row.id,
        after: { caseId: tc.id, professorUserId: input.professorUserId, roleType: input.roleType, attemptNumber: row.attemptNumber },
      },
      ctx,
      tx,
    );
    return row;
  });
}

/** Requests addressed to a professor (their own queue). */
export async function listProfessorRequests(professorUserId: string, status?: string) {
  const where = status ? and(eq(supervisorRequests.professorUserId, professorUserId), eq(supervisorRequests.status, status)) : eq(supervisorRequests.professorUserId, professorUserId);
  return db
    .select({
      request: supervisorRequests,
      caseNumber: thesisCases.caseNumber,
      studentFullName: thesisCases.studentFullName,
      titleFa: thesisCases.titleFa,
      studentName: users.fullName,
    })
    .from(supervisorRequests)
    .innerJoin(thesisCases, eq(thesisCases.id, supervisorRequests.caseId))
    .leftJoin(users, eq(users.id, supervisorRequests.studentUserId))
    .where(where)
    .orderBy(desc(supervisorRequests.createdAt));
}

/** Requests created for a given case (student/staff view). */
export async function listCaseRequests(caseId: string, actor: RequestActor) {
  const access = await resolveActor(actor);
  await loadOwnedCase(caseId, actor, access);
  return db
    .select({
      request: supervisorRequests,
      professorName: users.fullName,
      academicRank: professorProfiles.academicRank,
    })
    .from(supervisorRequests)
    .leftJoin(users, eq(users.id, supervisorRequests.professorUserId))
    .leftJoin(professorProfiles, eq(professorProfiles.userId, supervisorRequests.professorUserId))
    .where(eq(supervisorRequests.caseId, caseId))
    .orderBy(desc(supervisorRequests.createdAt));
}

/** Department-head queue: cases whose attempts exceeded the configured limit. */
export async function listDeptHeadQueue(actor: RequestActor) {
  const access = await resolveActor(actor);
  requirePerm(access, "cases.assign_supervisors");
  const maxAttempts = await getSettingValue("supervisor.maxAttempts");
  const visibleIds = await getVisibleCaseIds(actor);
  const rows = await db
    .select({
      caseId: thesisCases.id,
      caseNumber: thesisCases.caseNumber,
      studentFullName: thesisCases.studentFullName,
      departmentId: thesisCases.departmentId,
      attempts: sql<number>`count(*) filter (where ${supervisorRequests.status} = 'rejected')`,
    })
    .from(thesisCases)
    .leftJoin(supervisorRequests, eq(supervisorRequests.caseId, thesisCases.id))
    .where(inArray(thesisCases.currentStatus, ["draft", "submitted", "under_review", "revision_required", "approved"]))
    .groupBy(thesisCases.id)
    .having(sql`count(*) filter (where ${supervisorRequests.status} = 'rejected') >= ${maxAttempts}`);
  return visibleIds === null ? rows : rows.filter((r) => visibleIds.includes(r.caseId));
}

export interface RespondInput {
  requestId: string;
  accept: boolean;
  reason?: string;
}

/**
 * Professor accepts or rejects a request. Acceptance re-checks capacity inside a
 * transaction with the case row locked, so concurrent accepts for the last free
 * slot cannot both succeed.
 */
export async function respondToRequest(actor: RequestActor, input: RespondInput, ctx: RequestContext) {
  const access = await resolveActor(actor);
  if (!input.accept && (!input.reason || input.reason.trim().length < 3)) {
    throw new AppError(400, "REASON_REQUIRED", "رد درخواست بدون دلیل معتبر ممکن نیست (حداقل ۳ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(supervisorRequests).where(eq(supervisorRequests.id, input.requestId)).for("update").limit(1);
    if (!req) throw new AppError(404, "REQUEST_NOT_FOUND", "درخواست یافت نشد.");
    if (req.status !== "pending") throw new AppError(409, "ALREADY_RESPONDED", "این درخواست پیش‌تر پاسخ داده شده است.");
    // Being the addressee IS the authorisation; staff may act on their behalf.
    if (req.professorUserId !== actor.id && !access.permissions.has("cases.assign_supervisors")) {
      throw new AppError(403, "FORBIDDEN", "فقط استاد مخاطب یا کارکنان مجاز می‌توانند به این درخواست پاسخ دهند.");
    }

    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, req.caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");

    if (input.accept) {
      // Serialise concurrent accepts for the same professor: locking their
      // profile row makes the second request wait until the first commits, so
      // the capacity check below always sees committed usage. Without this lock
      // two students could both pass a "1 slot remaining" check.
      await tx
        .select({ userId: professorProfiles.userId })
        .from(professorProfiles)
        .where(eq(professorProfiles.userId, req.professorUserId))
        .for("update");

      const capacity = await getProfessorCapacity(req.professorUserId);
      if (!capacity) throw new AppError(400, "INVALID_PROFESSOR", "پروفایل استاد یافت نشد.");
      if (!capacity.acceptsStudents) throw new AppError(409, "NOT_ACCEPTING_STUDENTS", "استاد پذیرش دانشجو ندارد.");
      if (capacity.remaining <= 0) {
        throw new AppError(409, "CAPACITY_FULL", "ظرفیت این استاد تکمیل شده است.");
      }

      await tx
        .update(supervisorRequests)
        .set({ status: "accepted", respondedAt: new Date(), respondedBy: actor.id, rejectionReason: null })
        .where(eq(supervisorRequests.id, req.id));

      // Convert the accepted request into a real supervisor link, reusing this
      // transaction so the row locks we already hold cannot deadlock.
      await addSupervisorWith(
        tx,
        req.caseId,
        { id: actor.id },
        access,
        { userId: req.professorUserId, supervisorName: "", roleType: req.roleType as "supervisor" | "co_supervisor" | "advisor" },
        ctx,
        // Permission and case access were both established above: the pending
        // request is addressed to this professor and the case was loaded.
        { requirePermission: false, skipCaseAccess: true },
      );
    } else {
      await tx
        .update(supervisorRequests)
        .set({ status: "rejected", respondedAt: new Date(), respondedBy: actor.id, rejectionReason: input.reason!.trim() })
        .where(eq(supervisorRequests.id, req.id));

      // Escalate to the department head once the attempt limit is reached.
      const maxAttempts = await getSettingValue("supervisor.maxAttempts");
      const [counted] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(supervisorRequests)
        .where(and(eq(supervisorRequests.caseId, req.caseId), eq(supervisorRequests.status, "rejected")));
      if (Number(counted?.value ?? 0) >= maxAttempts) {
        await tx
          .update(supervisorRequests)
          .set({ escalatedToDeptHead: true, escalatedAt: new Date() })
          .where(eq(supervisorRequests.id, req.id));
      }
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        action: input.accept ? "supervisor.request_accepted" : "supervisor.request_rejected",
        entityType: "supervisor_request",
        entityId: req.id,
        before: { status: "pending" },
        after: { status: input.accept ? "accepted" : "rejected", caseId: req.caseId },
        reason: input.reason,
      },
      ctx,
      tx,
    );

    const [fresh] = await tx.select().from(supervisorRequests).where(eq(supervisorRequests.id, req.id)).limit(1);
    return fresh;
  });
}

/** Department head assigns a supervisor directly (bypassing the request queue). */
export async function assignByDeptHead(actor: RequestActor, caseId: string, professorUserId: string, roleType: "supervisor" | "advisor", reason: string, ctx: RequestContext) {
  const access = await resolveActor(actor);
  requirePerm(access, "cases.assign_supervisors");
  if (!reason || reason.trim().length < 3) throw new AppError(400, "REASON_REQUIRED", "دلیل تخصیص الزامی است.");
  const tc = await loadOwnedCase(caseId, actor, access);

  const capacity = await getProfessorCapacity(professorUserId);
  if (!capacity) throw new AppError(400, "INVALID_PROFESSOR", "پروفایل استاد یافت نشد.");
  if (capacity.remaining <= 0) throw new AppError(409, "CAPACITY_FULL", "ظرفیت این استاد تکمیل شده است.");

  const link = await addSupervisor(
    tc.id,
    { id: actor.id, permissions: [...access.permissions], roles: [...access.roleKeys].map((key) => ({ key })) },
    { userId: professorUserId, supervisorName: "", roleType },
    ctx,
  );
  await recordAudit(
    {
      actorUserId: actor.id,
      action: "supervisor.assigned_by_dept_head",
      entityType: "thesis_case",
      entityId: tc.id,
      after: { professorUserId, roleType, supervisorName: link.supervisorName },
      reason,
    },
    ctx,
  );
  return link;
}
