import { and, count, desc, eq, inArray, isNull, or, ilike, sql } from "drizzle-orm";
import { db, type DbLike, type DbTx } from "@/db";
import {
  academicTerms,
  departments,
  files,
  roles,
  studentProfiles,
  thesisCaseAssignments,
  thesisCaseEvents,
  thesisCaseFiles,
  thesisCases,
  thesisSupervisors,
  userRoles,
  users,
} from "@/db/schema";
import { CORE_DEFINITION_CODE, applyTransition, findTransition, getActiveDefinition, getAvailableTransitions, getAvailableTransitionsFrom as getAvailableTransitionsFromDb, isCaseStatus, startInstance, statusLabelFa } from "@/server/workflows";
import { thesisCases as thesisCasesAlias, workflowInstances, workflowTasks } from "@/db/schema";
void thesisCasesAlias;
import { AppError } from "@/server/http";
import { loadUserAccess } from "@/server/rbac/service";
import { recordAudit, type RequestContext } from "@/server/services/audit";
import { generateCaseNumber } from "./case-number";
import { deleteFromDisk, normalizeOriginalName, storeFile, type UploadInput } from "@/server/storage";
import { isActiveDepartment } from "./organization";

// ---------------------------------------------------------------------------
// Actor & authorization model
// ---------------------------------------------------------------------------

/**
 * Every case operation enforces two independent checks on the server:
 *  1. the actor holds the operation's permission, and
 *  2. the actor is authorised for *this particular case*.
 * A valid session alone never grants access to a case.
 */
export interface CaseActor {
  id: string;
  permissions?: readonly string[];
  roles?: ReadonlyArray<{ key: string } | string>;
}

interface ActorAccess {
  permissions: Set<string>;
  roleKeys: Set<string>;
}

/** Resolves the actor's effective permissions/roles (from the token snapshot or freshly from the DB). */
async function resolveActorAccess(actor: CaseActor): Promise<ActorAccess> {
  if (actor.permissions) {
    return {
      permissions: new Set(actor.permissions),
      roleKeys: new Set((actor.roles ?? []).map((r) => (typeof r === "string" ? r : r.key))),
    };
  }
  const access = await loadUserAccess(db, actor.id);
  return {
    permissions: new Set(access.permissions),
    roleKeys: new Set(access.roles.map((r) => r.key)),
  };
}

function requirePermission(access: ActorAccess, permission: string): void {
  if (!access.permissions.has(permission)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای این عملیات را ندارید.", { permission });
  }
}

type CaseRow = typeof thesisCases.$inferSelect;

/**
 * Case-level visibility, derived only from permissions and verified
 * relationships (never from user-supplied parameters):
 *  - `cases.view_all`        → every case
 *  - `cases.view_own`        → cases whose student account is the actor
 *  - `cases.view_department` → cases in the actor's own department, where the
 *                              department comes from the administrator-managed
 *                              `users.department` field; without it, no access
 *  - `cases.view_assigned`   → cases with an active supervisor link or an
 *                              assignment addressed to the actor
 */
/*** Two parties are in the same department when their department FKs match; when either side
 * still relies on the legacy text value, the (backfilled-consistent) names decide. */
export function departmentMatches(
  a: { departmentId: number | null; department: string | null },
  b: { departmentId: number | null; department: string | null },
): boolean {
  if (a.departmentId != null && b.departmentId != null) return a.departmentId === b.departmentId;
  return !!a.department && !!b.department && a.department === b.department;
}

export async function canViewCase(
  access: ActorAccess,
  actorId: string,
  caseRow: Pick<CaseRow, "id" | "studentUserId" | "department" | "departmentId">,
  executor: DbLike = db,
): Promise<boolean> {
  if (access.permissions.has("cases.view_all")) return true;
  if (access.permissions.has("cases.view_own") && caseRow.studentUserId && caseRow.studentUserId === actorId) {
    return true;
  }
  if (access.permissions.has("cases.view_department") && (caseRow.department || caseRow.departmentId)) {
    const [actor] = await executor
      .select({ department: users.department, departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (actor && departmentMatches(actor, caseRow)) return true;
  }
  if (access.permissions.has("cases.view_assigned")) {
    const [sup] = await executor
      .select({ id: thesisSupervisors.id })
      .from(thesisSupervisors)
      .where(
        and(
          eq(thesisSupervisors.caseId, caseRow.id),
          eq(thesisSupervisors.userId, actorId),
          eq(thesisSupervisors.status, "active"),
        ),
      )
      .limit(1);
    if (sup) return true;
    const [assignment] = await executor
      .select({ id: thesisCaseAssignments.id })
      .from(thesisCaseAssignments)
      .where(and(eq(thesisCaseAssignments.caseId, caseRow.id), eq(thesisCaseAssignments.assignedToUserId, actorId)))
      .limit(1);
    if (assignment) return true;
  }
  return false;
}

/** IDs of all cases visible to the actor, or null when visibility is unrestricted (`cases.view_all`). */
export async function getVisibleCaseIds(actor: CaseActor): Promise<string[] | null> {
  const access = await resolveActorAccess(actor);
  if (access.permissions.has("cases.view_all")) return null;

  const visible = new Set<string>();

  if (access.permissions.has("cases.view_own")) {
    const own = await db
      .select({ id: thesisCases.id })
      .from(thesisCases)
      .where(eq(thesisCases.studentUserId, actor.id));
    for (const row of own) visible.add(row.id);
  }

  if (access.permissions.has("cases.view_department")) {
    const [me] = await db
      .select({ department: users.department, departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);
    if (me && (me.department || me.departmentId)) {
      // FK precedence: a case with department_id set is judged by id only;
      // the legacy text value matches only rows not yet linked.
      const deptWhere = me.departmentId
        ? or(
            eq(thesisCases.departmentId, me.departmentId),
            and(isNull(thesisCases.departmentId), eq(thesisCases.department, me.department ?? "")),
          )
        : eq(thesisCases.department, me.department ?? "");
      const deptCases = await db.select({ id: thesisCases.id }).from(thesisCases).where(deptWhere);
      for (const row of deptCases) visible.add(row.id);
    }
  }

  if (access.permissions.has("cases.view_assigned")) {
    const supervised = await db
      .select({ caseId: thesisSupervisors.caseId })
      .from(thesisSupervisors)
      .where(and(eq(thesisSupervisors.userId, actor.id), eq(thesisSupervisors.status, "active")));
    for (const row of supervised) visible.add(row.caseId);
    const assigned = await db
      .select({ caseId: thesisCaseAssignments.caseId })
      .from(thesisCaseAssignments)
      .where(eq(thesisCaseAssignments.assignedToUserId, actor.id));
    for (const row of assigned) visible.add(row.caseId);
  }

  return [...visible];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateCaseInput {
  studentFullName: string;
  studentNumber?: string | null;
  studentUserId?: string | null;
  department?: string | null;
  /** Preferred organisational link (Phase 3); takes precedence over the legacy text value. */
  departmentId?: number | null;
  degreeLevel?: string;
  fieldOfStudy?: string | null;
  academicYear?: string | null;
  titleFa?: string | null;
  titleEn?: string | null;
}

export async function createCase(actor: CaseActor, input: CreateCaseInput, ctx: RequestContext) {
  if (!input.studentFullName || input.studentFullName.trim().length < 2) {
    throw new AppError(400, "INVALID_INPUT", "نام دانشجو الزامی است.");
  }
  const access = await resolveActorAccess(actor);
  requirePermission(access, "cases.create");

  // A student creating a case is always linked to their own account; a
  // requested student link is honoured only after verifying that the target
  // account exists and actually holds the student role.
  let studentUserId: string | null = null;
  const isStudentActor = access.roleKeys.has("student") && !access.permissions.has("cases.view_all");
  if (isStudentActor) {
    studentUserId = actor.id;
  } else if (input.studentUserId) {
    const [target] = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, input.studentUserId))
      .limit(1);
    if (!target || !target.isActive) {
      throw new AppError(400, "INVALID_STUDENT_USER", "حساب دانشجوی انتخاب‌شده معتبر نیست.");
    }
    const targetAccess = await loadUserAccess(db, target.id);
    if (!targetAccess.roles.some((r) => r.key === "student")) {
      throw new AppError(400, "INVALID_STUDENT_USER", "حساب انتخاب‌شده نقش دانشجو ندارد.");
    }
    studentUserId = target.id;
  }

  // An organisational link must point at a real, active department.
  let departmentId: number | null = null;
  let departmentText = input.department ?? null;
  if (input.departmentId) {
    if (!(await isActiveDepartment(input.departmentId))) {
      throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
    }
    departmentId = input.departmentId;
    const [{ nameFa }] = await db
      .select({ nameFa: departments.nameFa })
      .from(departments)
      .where(eq(departments.id, input.departmentId))
      .limit(1);
    if (nameFa) departmentText = nameFa;
  }

  return db.transaction(async (tx) => {
    const caseNumber = await generateCaseNumber(tx);
    // Start term: the student's entry term when known, otherwise the term marked
    // current. Never guessed from a timestamp — term control depends on this value.
    let startTermId: number | null = null;
    if (studentUserId) {
      const [profile] = await tx
        .select({ entryTermId: studentProfiles.entryTermId })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, studentUserId))
        .limit(1);
      startTermId = profile?.entryTermId ?? null;
    }
    if (startTermId === null) {
      const [current] = await tx
        .select({ id: academicTerms.id })
        .from(academicTerms)
        .where(eq(academicTerms.isCurrent, true))
        .limit(1);
      startTermId = current?.id ?? null;
    }
    const [newCase] = await tx
      .insert(thesisCases)
      .values({
        caseNumber,
        studentFullName: input.studentFullName.trim(),
        studentNumber: input.studentNumber ?? null,
        studentUserId,
        department: departmentText,
        departmentId,
        startTermId,
        degreeLevel: input.degreeLevel ?? "کارشناسی ارشد",
        fieldOfStudy: input.fieldOfStudy ?? null,
        academicYear: input.academicYear ?? null,
        titleFa: input.titleFa ?? null,
        titleEn: input.titleEn ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();

    // Start the data-driven workflow instance so the case always has a
    // current_instance (separate concept from current_status).
    const coreDef = await getActiveDefinition(CORE_DEFINITION_CODE, tx);
    if (coreDef) {
      await startInstance(tx, { caseId: newCase.id, definitionId: coreDef.id, actorId: actor.id });
    }

    await tx.insert(thesisCaseEvents).values({
      caseId: newCase.id,
      eventType: "case_created",
      newStatus: "draft",
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      description: "ایجاد پرونده جدید",
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.created",
        entityType: "thesis_case",
        entityId: newCase.id,
        after: { caseNumber, studentFullName: newCase.studentFullName },
      },
      ctx,
      tx,
    );

    // Re-read so the returned row carries the started instance pointer.
    const [created] = await tx.select().from(thesisCases).where(eq(thesisCases.id, newCase.id)).limit(1);
    return created;
  });
}

// ---------------------------------------------------------------------------
// Read single case (with case-level access enforcement)
// ---------------------------------------------------------------------------

export async function getCaseById(caseId: string, actor: CaseActor) {
  const [tc] = await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc) return null;
  const access = await resolveActorAccess(actor);
  if (!(await canViewCase(access, actor.id, tc))) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
  }
  return tc;
}

// ---------------------------------------------------------------------------
// List + search + pagination (always visibility-scoped)
// ---------------------------------------------------------------------------

export interface CaseListQuery {
  q?: string;
  status?: string;
  page: number;
  pageSize: number;
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listCases(actor: CaseActor, query: CaseListQuery) {
  const visibleIds = await getVisibleCaseIds(actor);
  const whereClauses = [];

  if (visibleIds !== null) {
    if (visibleIds.length === 0) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    whereClauses.push(inArray(thesisCases.id, visibleIds));
  }

  if (query.q?.trim()) {
    const term = query.q.trim();
    whereClauses.push(
      or(
        ilike(thesisCases.caseNumber, `%${escapeLike(term)}%`),
        ilike(thesisCases.studentFullName, `%${escapeLike(term)}%`),
        ilike(thesisCases.studentNumber, `%${escapeLike(term)}%`),
        ilike(thesisCases.titleFa, `%${escapeLike(term)}%`),
      )!,
    );
  }

  if (query.status) {
    whereClauses.push(eq(thesisCases.currentStatus, query.status));
  }

  const where = whereClauses.length ? and(...whereClauses) : undefined;
  const pageSize = Math.min(Math.max(query.pageSize, 1), 100);

  const [{ value: total }] = await db.select({ value: count() }).from(thesisCases).where(where);
  const rows = await db
    .select()
    .from(thesisCases)
    .where(where)
    .orderBy(desc(thesisCases.updatedAt), desc(thesisCases.id))
    .limit(pageSize)
    .offset((query.page - 1) * pageSize);

  return { items: rows, total: Number(total), page: query.page, pageSize };
}

// ---------------------------------------------------------------------------
// Update metadata — field-level policy
// ---------------------------------------------------------------------------

export interface UpdateCaseInput {
  studentFullName?: string;
  studentNumber?: string | null;
  department?: string | null;
  /** Preferred organisational link (Phase 3); requires `cases.edit_metadata`. */
  departmentId?: number | null;
  degreeLevel?: string;
  fieldOfStudy?: string | null;
  academicYear?: string | null;
  titleFa?: string | null;
  titleEn?: string | null;
  abstractFa?: string | null;
  abstractEn?: string | null;
  keywords?: string | null;
  reason?: string;
}

/** Identity fields may only be changed by holders of `cases.edit_metadata`. */
const IDENTITY_FIELDS = ["studentFullName", "studentNumber"] as const;
const ACADEMIC_FIELDS = ["department", "degreeLevel", "fieldOfStudy", "academicYear"] as const;
const TOPIC_FIELDS = ["titleFa", "titleEn", "abstractFa", "abstractEn", "keywords"] as const;
const EDITABLE_FIELDS = [...IDENTITY_FIELDS, ...ACADEMIC_FIELDS, ...TOPIC_FIELDS] as readonly string[];

export async function updateCase(caseId: string, actor: CaseActor, input: UpdateCaseInput, ctx: RequestContext) {
  const access = await resolveActorAccess(actor);
  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (!(await canViewCase(access, actor.id, tc, tx))) {
      throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
    }
    if (tc.currentStatus === "archived") throw new AppError(409, "ARCHIVED", "پرونده بایگانی‌شده قابل ویرایش نیست.");
    if (tc.currentStatus === "rejected") throw new AppError(409, "REJECTED", "پرونده ردشده قابل ویرایش نیست.");

    // An organisational link must point at a real, active department and may
    // only be changed by holders of the metadata permission.
    if (input.departmentId !== undefined && input.departmentId !== null) {
      if (!access.permissions.has("cases.edit_metadata")) {
        throw new AppError(403, "FIELD_FORBIDDEN", "تغییر گروه سازمانی نیازمند مجوز ویرایش اطلاعات اصلی است.", { field: "departmentId" });
      }
      if (!(await isActiveDepartment(input.departmentId))) {
        throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
      }
    }

    // Field-level policy: who may change what.
    const hasEditMetadata = access.permissions.has("cases.edit_metadata");
    const hasUpdateAssigned = access.permissions.has("cases.update_assigned");
    const isOwnerDraft =
      access.permissions.has("cases.update_own_draft") &&
      tc.studentUserId === actor.id &&
      (tc.currentStatus === "draft" || tc.currentStatus === "revision_required");
    const canEditBody = hasEditMetadata || hasUpdateAssigned || isOwnerDraft;
    if (!canEditBody) {
      throw new AppError(403, "FORBIDDEN", "مجوز ویرایش این پرونده را ندارید.");
    }

    const provided = EDITABLE_FIELDS.filter((f) => (input as Record<string, unknown>)[f] !== undefined);
    if (provided.length === 0) {
      throw new AppError(400, "NOTHING_TO_UPDATE", "تغییری برای ذخیره وجود ندارد.");
    }
    for (const field of provided) {
      if ((IDENTITY_FIELDS as readonly string[]).includes(field) && !hasEditMetadata) {
        throw new AppError(403, "FIELD_FORBIDDEN", "تغییر فیلدهای هویتی دانشجو نیازمند مجوز ویرایش اطلاعات اصلی است.", { field });
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor.id };
    for (const field of provided) {
      updateData[field] = (input as Record<string, unknown>)[field];
    }
    // Keep the legacy display value in sync with the linked entity.
    if (input.departmentId) {
      const [{ nameFa }] = await tx
        .select({ nameFa: departments.nameFa })
        .from(departments)
        .where(eq(departments.id, input.departmentId))
        .limit(1);
      if (nameFa) {
        updateData.department = nameFa;
        updateData.departmentId = input.departmentId;
      }
    } else if (input.departmentId === null) {
      updateData.departmentId = null;
    }

    await tx.update(thesisCases).set(updateData).where(eq(thesisCases.id, caseId));

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "case_updated",
      previousStatus: tc.currentStatus,
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      description: "ویرایش اطلاعات پرونده",
      reason: input.reason ?? null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.updated",
        entityType: "thesis_case",
        entityId: caseId,
        before: { fields: provided },
        after: { fields: provided },
        reason: input.reason,
      },
      ctx,
      tx,
    );

    const [updated] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Topic submission
// ---------------------------------------------------------------------------

export interface TopicSubmissionInput {
  titleFa: string;
  titleEn?: string | null;
  description?: string | null;
  keywords?: string | null;
  submitForReview?: boolean;
}

export async function submitTopic(caseId: string, actor: CaseActor, input: TopicSubmissionInput, ctx: RequestContext) {
  const access = await resolveActorAccess(actor);
  requirePermission(access, "cases.submit_topic");
  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (!(await canViewCase(access, actor.id, tc, tx))) {
      throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
    }
    // Topic may be submitted by the owning student, or by staff holding the
    // metadata-editing permission / unrestricted visibility. A generic
    // submit permission alone is never enough for someone else's case.
    const isOwner = tc.studentUserId === actor.id;
    const isPrivilegedStaff = access.permissions.has("cases.edit_metadata") || access.permissions.has("cases.view_all");
    if (!isOwner && !isPrivilegedStaff) {
      throw new AppError(403, "FORBIDDEN", "ثبت موضوع فقط برای دانشجوی صاحب پرونده یا کاربران مجاز ستادی ممکن است.");
    }
    if (tc.currentStatus !== "draft" && tc.currentStatus !== "revision_required") {
      throw new AppError(409, "INVALID_STATUS", "ثبت موضوع فقط در وضعیت پیش‌نویس یا نیازمند اصلاح مجاز است.");
    }

    const beforeStatus = tc.currentStatus;
    const updateData: Record<string, unknown> = {
      titleFa: input.titleFa,
      titleEn: input.titleEn ?? null,
      keywords: input.keywords ?? null,
      updatedAt: new Date(),
      updatedBy: actor.id,
    };

    await tx.update(thesisCases).set(updateData).where(eq(thesisCases.id, caseId));

    // Submission goes through the engine so the instance advances too; writing
    // current_status directly would desynchronise status and instance.
    if (input.submitForReview) {
      await applyTransition(tx, {
        caseId,
        actor: { id: actor.id, permissions: access.permissions, roleKeys: access.roleKeys },
        to: "submitted",
        reason: input.description ?? undefined,
      });
    }

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: input.submitForReview ? "topic_submitted" : "topic_saved_draft",
      previousStatus: beforeStatus,
      newStatus: input.submitForReview ? "submitted" : beforeStatus,
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      description: input.description ?? (input.submitForReview ? "ثبت و ارسال موضوع" : "ذخیره پیش‌نویس موضوع"),
    });

    if (input.submitForReview) {
      await ensureReviewAssignment(tx, tc);
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.topic_submitted",
        entityType: "thesis_case",
        entityId: caseId,
        before: { titleFa: tc.titleFa },
        after: { titleFa: input.titleFa, submitted: !!input.submitForReview },
      },
      ctx,
      tx,
    );

    const [updated] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Review-assignment bookkeeping (unassigned queue; never invents a reviewer)
// ---------------------------------------------------------------------------

async function ensureReviewAssignment(tx: DbTx, tc: Pick<CaseRow, "id" | "caseNumber">): Promise<void> {
  const [existing] = await tx
    .select({ id: thesisCaseAssignments.id })
    .from(thesisCaseAssignments)
    .where(
      and(
        eq(thesisCaseAssignments.caseId, tc.id),
        eq(thesisCaseAssignments.actionType, "review_topic"),
        eq(thesisCaseAssignments.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) return;
  await tx.insert(thesisCaseAssignments).values({
    caseId: tc.id,
    actionType: "review_topic",
    status: "pending",
    description: `بررسی موضوع پایان‌نامه — پرونده ${tc.caseNumber}`,
  });
}

async function completeReviewAssignments(tx: DbTx, caseId: string): Promise<void> {
  await tx
    .update(thesisCaseAssignments)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(thesisCaseAssignments.caseId, caseId),
        eq(thesisCaseAssignments.actionType, "review_topic"),
        eq(thesisCaseAssignments.status, "pending"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Status transition — transition-specific permission enforced here
// ---------------------------------------------------------------------------

export interface TransitionInput {
  to: string;
  reason?: string;
}

export async function transitionStatus(caseId: string, actor: CaseActor, input: TransitionInput, ctx: RequestContext) {
  const access = await resolveActorAccess(actor);
  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (!(await canViewCase(access, actor.id, tc, tx))) {
      throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
    }

    if (!isCaseStatus(input.to)) {
      throw new AppError(400, "INVALID_STATUS", `وضعیت مقصد «${input.to}» معتبر نیست.`);
    }

    // The database is the decision source: valid moves, the exact required
    // permission, reason requirements and task creation all come from
    // workflow_transitions — never from a hard-coded array.
    const engineActor = { id: actor.id, permissions: access.permissions, roleKeys: access.roleKeys };
    const applied = await applyTransition(tx, {
      caseId,
      actor: engineActor,
      to: input.to,
      reason: input.reason,
    });
    const prevStatus = applied.fromStep;

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "status_transition",
      previousStatus: prevStatus,
      newStatus: applied.toStep,
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      reason: input.reason ?? null,
      description: `تغییر وضعیت از «${statusLabelFa(prevStatus)}» به «${statusLabelFa(applied.toStep)}»`,
    });

    // Legacy case-level responsibility record: still the anchor for the
    // `cases.view_assigned` visibility rule, so it is kept in sync.
    if (applied.toStep === "submitted") {
      await ensureReviewAssignment(tx, tc);
    }
    if (["approved", "rejected", "revision_required", "archived"].includes(applied.toStep)) {
      await completeReviewAssignments(tx, caseId);
    }
    if (applied.toStep === "archived") {
      await tx.update(thesisCases).set({ archivedAt: new Date() }).where(eq(thesisCases.id, caseId));
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.status_changed",
        entityType: "thesis_case",
        entityId: caseId,
        before: { status: prevStatus },
        after: { status: applied.toStep, action: applied.transition.action, taskId: applied.taskId },
        reason: input.reason,
      },
      ctx,
      tx,
    );

    const [updated] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
    return updated;
  });
}

/** Transitions the actor may perform right now, read from the database. */
export async function getCaseAvailableActions(caseId: string, actor: CaseActor) {
  const access = await resolveActorAccess(actor);
  const [tc] = await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc) return [];
  if (!(await canViewCase(access, actor.id, tc))) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
  }
  if (!tc.currentInstanceId) return [];
  const [instance] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId)).limit(1);
  if (!instance) return [];
  const rows = await getAvailableTransitionsFromDb(instance.definitionId, instance.currentStep);
  return rows
    .filter((t) => access.permissions.has(t.requiredPermission))
    .map((t) => ({
      action: t.action,
      to: t.toStep,
      label: t.actionLabelFa,
      reasonRequired: t.reasonRequired,
      requiredPermission: t.requiredPermission,
      toLabelFa: statusLabelFa(t.toStep),
    }));
}

/** Pending tasks ("who must act next") for a case. */
export async function getCaseTasks(caseId: string) {
  return db
    .select({
      id: workflowTasks.id,
      action: workflowTasks.action,
      titleFa: workflowTasks.titleFa,
      roleKey: workflowTasks.roleKey,
      status: workflowTasks.status,
      dueDate: workflowTasks.dueDate,
      assigneeUserId: workflowTasks.assigneeUserId,
      assigneeName: users.fullName,
      createdAt: workflowTasks.createdAt,
      actedAt: workflowTasks.actedAt,
      reason: workflowTasks.reason,
    })
    .from(workflowTasks)
    .leftJoin(users, eq(users.id, workflowTasks.assigneeUserId))
    .where(eq(workflowTasks.caseId, caseId))
    .orderBy(desc(workflowTasks.createdAt));
}

// ---------------------------------------------------------------------------
// Events (case history timeline)
// ---------------------------------------------------------------------------

export async function getCaseEvents(caseId: string) {
  return db
    .select({
      id: thesisCaseEvents.id,
      eventType: thesisCaseEvents.eventType,
      previousStatus: thesisCaseEvents.previousStatus,
      newStatus: thesisCaseEvents.newStatus,
      actorUserId: thesisCaseEvents.actorUserId,
      actorRole: thesisCaseEvents.actorRole,
      description: thesisCaseEvents.description,
      reason: thesisCaseEvents.reason,
      createdAt: thesisCaseEvents.createdAt,
      actorFullName: users.fullName,
    })
    .from(thesisCaseEvents)
    .leftJoin(users, eq(users.id, thesisCaseEvents.actorUserId))
    .where(eq(thesisCaseEvents.caseId, caseId))
    .orderBy(desc(thesisCaseEvents.createdAt));
}

// ---------------------------------------------------------------------------
// Supervisors
// ---------------------------------------------------------------------------

export async function getCaseSupervisors(caseId: string) {
  return db
    .select({
      id: thesisSupervisors.id,
      userId: thesisSupervisors.userId,
      supervisorName: thesisSupervisors.supervisorName,
      roleType: thesisSupervisors.roleType,
      sortOrder: thesisSupervisors.sortOrder,
      status: thesisSupervisors.status,
      assignedAt: thesisSupervisors.assignedAt,
    })
    .from(thesisSupervisors)
    .where(and(eq(thesisSupervisors.caseId, caseId), eq(thesisSupervisors.status, "active")))
    .orderBy(thesisSupervisors.sortOrder);
}

export interface AddSupervisorInput {
  userId?: string | null;
  supervisorName: string;
  roleType: "supervisor" | "co_supervisor" | "advisor";
}

/** Which account role makes a user eligible for each supervisor responsibility. */
const SUPERVISOR_ROLE_ELIGIBILITY: Record<AddSupervisorInput["roleType"], string> = {
  supervisor: "supervisor",
  co_supervisor: "supervisor",
  advisor: "advisor",
};

/**
 * Core supervisor assignment. Accepts an executor so callers that already hold a
 * transaction (e.g. accepting a supervisor request) can reuse it instead of
 * opening a nested transaction on another pooled connection — which would
 * deadlock against the row locks the caller holds.
 */
export async function addSupervisorWith(
  tx: DbTx,
  caseId: string,
  actor: CaseActor,
  access: { permissions: Set<string>; roleKeys: Set<string> },
  input: AddSupervisorInput,
  ctx: RequestContext,
  options: { requirePermission?: boolean; skipCaseAccess?: boolean } = {},
) {
  if (options.requirePermission !== false) requirePermission(access, "cases.assign_supervisors");
  {
    // Locking the case row serialises supervisor changes and makes the
    // duplicate-primary-supervisor check concurrency-safe.
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    // `skipCaseAccess` is only used by the supervisor-request accept path, where
    // authorisation was already established by proving the pending request is
    // addressed to this professor. A professor has no case link *before*
    // accepting, so the visibility rule cannot be the basis there.
    if (!options.skipCaseAccess && !(await canViewCase(access, actor.id, tc, tx))) {
      throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
    }
    if (tc.currentStatus === "archived") throw new AppError(409, "ARCHIVED", "پرونده بایگانی‌شده قابل تغییر نیست.");

    // When an account is supplied, it must exist, be active, and hold the
    // academic role matching the responsibility. The stored name is then a
    // snapshot of the account's real name, not caller-supplied text.
    let supervisorName = input.supervisorName.trim();
    if (input.userId) {
      const [target] = await tx
        .select({ id: users.id, fullName: users.fullName, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target || !target.isActive) {
        throw new AppError(400, "INVALID_SUPERVISOR_ACCOUNT", "حساب استاد انتخاب‌شده معتبر نیست.");
      }
      const targetAccess = await loadUserAccess(tx, target.id);
      const requiredRole = SUPERVISOR_ROLE_ELIGIBILITY[input.roleType];
      if (!targetAccess.roles.some((r) => r.key === requiredRole)) {
        throw new AppError(400, "SUPERVISOR_NOT_ELIGIBLE", "حساب انتخاب‌شده نقش دانشگاهی لازم برای این مسئولیت را ندارد.", {
          requiredRole,
        });
      }
      supervisorName = target.fullName;
    }
    if (supervisorName.length < 2) {
      throw new AppError(400, "INVALID_INPUT", "نام استاد الزامی است.");
    }

    if (input.roleType === "supervisor") {
      const [existing] = await tx
        .select({ id: thesisSupervisors.id })
        .from(thesisSupervisors)
        .where(
          and(
            eq(thesisSupervisors.caseId, caseId),
            eq(thesisSupervisors.roleType, "supervisor"),
            eq(thesisSupervisors.status, "active"),
          ),
        )
        .limit(1);
      if (existing) throw new AppError(409, "DUPLICATE_SUPERVISOR", "استاد راهنمای اصلی قبلاً تعیین شده است.");
    }

    const [{ value: maxOrder }] = await tx
      .select({ value: sql<number>`coalesce(max(${thesisSupervisors.sortOrder}), 0)` })
      .from(thesisSupervisors)
      .where(eq(thesisSupervisors.caseId, caseId));

    const [supervisor] = await tx
      .insert(thesisSupervisors)
      .values({
        caseId,
        userId: input.userId ?? null,
        supervisorName,
        roleType: input.roleType,
        sortOrder: Number(maxOrder) + 1,
        assignedBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "supervisor_added",
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      description: `انتساب ${supervisorName} به عنوان ${
        input.roleType === "supervisor" ? "استاد راهنمای اصلی" : input.roleType === "co_supervisor" ? "استاد راهنمای مشترک" : "استاد مشاور"
      }`,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.supervisor_added",
        entityType: "thesis_case",
        entityId: caseId,
        after: { supervisorName, roleType: input.roleType, linkedAccount: !!input.userId },
      },
      ctx,
      tx,
    );

    return supervisor;
  }
}

export async function addSupervisor(caseId: string, actor: CaseActor, input: AddSupervisorInput, ctx: RequestContext) {
  const access = await resolveActorAccess(actor);
  return db.transaction((tx) => addSupervisorWith(tx, caseId, actor, access, input, ctx));
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Soft-deletes a case file: the physical file is kept, `files.status` flips to
 * `deleted` and the download route stops serving it. No hard delete, so the
 * audit trail and the document remain recoverable.
 */
export async function deleteCaseFile(
  caseId: string,
  fileId: string,
  actor: CaseActor,
  reason: string,
  ctx: RequestContext,
) {
  const access = await resolveActorAccess(actor);
  requirePermission(access, "cases.files.upload");
  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (!(await canViewCase(access, actor.id, tc, tx))) {
      throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
    }
    if (tc.currentStatus === "archived") throw new AppError(409, "ARCHIVED", "پرونده بایگانی‌شده قابل تغییر نیست.");

    const [link] = await tx
      .select({ fileId: thesisCaseFiles.fileId })
      .from(thesisCaseFiles)
      .where(and(eq(thesisCaseFiles.caseId, caseId), eq(thesisCaseFiles.fileId, fileId)))
      .limit(1);
    if (!link) throw new AppError(404, "FILE_NOT_FOUND", "فایل یافت نشد.");

    const [fileRow] = await tx.select().from(files).where(eq(files.id, fileId)).for("update").limit(1);
    if (!fileRow) throw new AppError(404, "FILE_NOT_FOUND", "فایل یافت نشد.");
    if (fileRow.status !== "active") throw new AppError(409, "ALREADY_DELETED", "این فایل پیش‌تر حذف شده است.");

    await tx
      .update(files)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(files.id, fileId));

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "file_deleted",
      actorUserId: actor.id,
      actorRole: [...access.roleKeys][0] ?? null,
      description: `حذف فایل: ${fileRow.originalName}`,
      reason,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.file_deleted",
        entityType: "thesis_case",
        entityId: caseId,
        after: { fileName: fileRow.originalName, fileId, reason },
      },
      ctx,
      tx,
    );

    return { fileId, originalName: fileRow.originalName };
  });
}

/** Purposes accepted by the case-file upload endpoint. */
export const CASE_FILE_PURPOSES = ["general", "topic", "supporting"] as const;
export type CaseFilePurpose = (typeof CASE_FILE_PURPOSES)[number];

export async function uploadCaseFile(
  caseId: string,
  actor: CaseActor,
  input: UploadInput,
  purpose: string,
  ctx: RequestContext,
) {
  const access = await resolveActorAccess(actor);
  requirePermission(access, "cases.files.upload");

  const [tc] = await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  if (!(await canViewCase(access, actor.id, tc))) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
  }
  if (tc.currentStatus === "archived") throw new AppError(409, "ARCHIVED", "پرونده بایگانی‌شده قابل تغییر نیست.");

  const safePurpose = (CASE_FILE_PURPOSES as readonly string[]).includes(purpose) ? purpose : "general";
  const originalName = normalizeOriginalName(input.originalName);

  // 1) Write the physical file first. If this fails, no database rows exist.
  const stored = await storeFile({ data: input.data, originalName });

  // 2) Register in the database. If this fails, remove the physical file so
  //    no untracked orphan remains (filesystem and DB are not one transaction).
  try {
    return await db.transaction(async (tx) => {
      const [fileRow] = await tx
        .insert(files)
        .values({
          ownerUserId: actor.id,
          purpose: safePurpose,
          originalName,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        })
        .returning();

      const [caseFile] = await tx
        .insert(thesisCaseFiles)
        .values({ caseId, fileId: fileRow.id, purpose: safePurpose, uploadedBy: actor.id })
        .returning();

      await tx.insert(thesisCaseEvents).values({
        caseId,
        eventType: "file_uploaded",
        actorUserId: actor.id,
        actorRole: [...access.roleKeys][0] ?? null,
        description: `بارگذاری فایل: ${originalName}`,
      });

      await recordAudit(
        {
          actorUserId: actor.id,
          action: "case.file_uploaded",
          entityType: "thesis_case",
          entityId: caseId,
          after: { fileName: originalName, purpose: safePurpose, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes },
        },
        ctx,
        tx,
      );

      return { caseFile, file: { ...fileRow, storageKey: undefined } };
    });
  } catch (err) {
    deleteFromDisk(stored.storageKey);
    throw err;
  }
}

export async function getCaseFiles(caseId: string) {
  return db
    .select({
      id: thesisCaseFiles.id,
      caseId: thesisCaseFiles.caseId,
      fileId: thesisCaseFiles.fileId,
      purpose: thesisCaseFiles.purpose,
      createdAt: thesisCaseFiles.createdAt,
      uploadedBy: thesisCaseFiles.uploadedBy,
      originalName: files.originalName,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      fileStatus: files.status,
    })
    .from(thesisCaseFiles)
    .innerJoin(files, eq(files.id, thesisCaseFiles.fileId))
    .where(eq(thesisCaseFiles.caseId, caseId))
    .orderBy(desc(thesisCaseFiles.createdAt));
}

// ---------------------------------------------------------------------------
// Dashboard statistics (same visibility rules as the case list)
// ---------------------------------------------------------------------------

export async function getCaseStats(visibleIds: string[] | null) {
  const access = visibleIds !== null ? inArray(thesisCases.id, visibleIds) : undefined;

  const [totalRow] = await db.select({ value: count() }).from(thesisCases).where(access);
  const pendingWhere = access
    ? and(eq(thesisCases.currentStatus, "submitted"), access)
    : eq(thesisCases.currentStatus, "submitted");
  const [pendingRow] = await db.select({ value: count() }).from(thesisCases).where(pendingWhere);
  const revisionWhere = access
    ? and(eq(thesisCases.currentStatus, "revision_required"), access)
    : eq(thesisCases.currentStatus, "revision_required");
  const [needsRevisionRow] = await db.select({ value: count() }).from(thesisCases).where(revisionWhere);

  return {
    total: Number(totalRow?.value ?? 0),
    pending: Number(pendingRow?.value ?? 0),
    needsRevision: Number(needsRevisionRow?.value ?? 0),
  };
}

// Re-exported for route handlers that need the raw row type.
export { roles, userRoles };
