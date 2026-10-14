import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type DbLike, type DbTx } from "@/db";
import {
  workflowInstances,
  literatureReviews,
  literatureReviewVersions,
  thesisCaseEvents,
  thesisCases,
  topicVersions,
  users,
  roles,
  userRoles,
  thesisSupervisors,
} from "@/db/schema";
import { AppError } from "@/server/http";
import { loadUserAccess } from "@/server/rbac/service";
import { getSettingValue } from "./settings";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { applyTransition, getAvailableTransitionsFrom, statusLabelFa, type EngineActor } from "@/server/workflows";

/**
 * M4 — versioned topic and literature review.
 *
 * Rules enforced here (server-side, never only in the UI):
 *  - a version is never edited or deleted; a correction always creates a new row;
 *  - exactly one topic version per case may be active (guarded by a partial unique index);
 *  - changing an already-approved topic requires a reason, and is only allowed while the
 *    case has not moved past `topic.changeAllowedUntil` (a Setting, never hard-coded);
 *  - approval level two (group) can only be performed by a group-level role;
 *  - every state change is written to the case timeline and to the audit log.
 */

export type TopicVersionStatus = "draft" | "pending_supervisor" | "pending_group" | "approved" | "revision_required" | "rejected";

/**
 * Bridges a topic decision into the data-driven workflow engine.
 *
 * The full-cycle definition carries the real topic steps
 * (WAITING_SUPERVISOR → SUPERVISOR_APPROVED → GROUP_REVIEW → TOPIC_APPROVED), and
 * every transition, its required permission and its target step are read from
 * `workflow_transitions` — nothing is hard-coded here. When the case runs on the
 * core 7-status definition (the published one today), no matching step exists and
 * the bridge is an explicit, documented no-op: the version history remains the
 * source of truth for topic content until an administrator publishes the full cycle.
 */
async function advanceTopicWorkflow(
  tx: DbTx,
  caseId: string,
  targetSteps: string[],
  actor: EngineActor,
  reason: string | null,
): Promise<string | null> {
  const [tc] = await tx.select({ instanceId: thesisCases.currentInstanceId }).from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc?.instanceId) return null;
  let lastStep: string | null = null;
  // Each hop is read from `workflow_transitions`; a missing hop simply ends the walk.
  for (const targetStep of targetSteps) {
    const [instance] = await tx
      .select({ definitionId: workflowInstances.definitionId, currentStep: workflowInstances.currentStep })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, tc.instanceId))
      .limit(1);
    if (!instance) return lastStep;
    const available = await getAvailableTransitionsFrom(instance.definitionId, instance.currentStep, tx);
    const transition = available.find((t) => t.toStep === targetStep && actor.permissions.has(t.requiredPermission));
    if (!transition) return lastStep;
    const applied = await applyTransition(tx, { caseId, actor, action: transition.action, reason: reason ?? undefined, now: new Date() });
    lastStep = applied.toStep;
  }
  return lastStep;
}

export interface TopicVersionInput {
  titleFa: string;
  titleEn?: string | null;
  keywords?: string | null;
  description?: string | null;
  fileId?: string | null;
  /** Mandatory when the previous version is already approved (topic change). */
  changeReason?: string | null;
  submitForReview?: boolean;
}

export interface LiteratureVersionInput {
  summaryFa: string;
  objectivesFa?: string | null;
  gapFa?: string | null;
  keywords?: string | null;
  referencesCount?: number | null;
  fileId?: string | null;
}

export interface ActorAccess {
  permissions: Set<string>;
  roleKeys: Set<string>;
}

/** Effective permissions/roles of the actor — fresh from the database, never from the client. */
export async function resolveAccess(actor: Actor, tx: DbLike = db): Promise<ActorAccess> {
  const access = await loadUserAccess(tx, actor.id);
  return { permissions: new Set(access.permissions), roleKeys: new Set(access.roles.map((r) => r.key)) };
}

export interface CaseGate {
  caseRow: typeof thesisCases.$inferSelect;
  access: ActorAccess;
  isOwner: boolean;
  isAssignedSupervisor: boolean;
}

/**
 * Central access gate for M4 operations: the actor must either own the case, be an
 * active supervisor of it, sit in the same department with department visibility, or
 * hold system-wide case visibility. Anything else is a hard 403.
 */
export async function gateCase(actor: Actor, caseId: string, tx: DbLike = db): Promise<CaseGate> {
  const [caseRow] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!caseRow) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const access = await resolveAccess(actor, tx);
  const isOwner = caseRow.studentUserId === actor.id;
  const isAssignedSupervisor = await isAssigned(actor.id, caseId, tx);
  const seesAll = access.permissions.has("cases.view_all");
  const sameDepartment = access.permissions.has("cases.view_department") &&
    (caseRow.departmentId != null || caseRow.department != null) &&
    (await isInSameDepartment(actor.id, caseRow.departmentId, caseRow.department, tx));
  if (!isOwner && !isAssignedSupervisor && !seesAll && !sameDepartment) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این پرونده ندارید.");
  }
  return { caseRow, access, isOwner, isAssignedSupervisor };
}

/** Departments are matched by FK when both sides have one, else by the legacy text value. */
async function isInSameDepartment(userId: string, departmentId: number | null, department: string | null, tx: DbLike): Promise<boolean> {
  const [me] = await tx.select({ departmentId: users.departmentId, department: users.department }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me) return false;
  if (me.departmentId != null && departmentId != null) return me.departmentId === departmentId;
  if (me.department && department) return me.department === department;
  return false;
}

async function isAssigned(userId: string, caseId: string, tx: DbLike): Promise<boolean> {
  const rows = await tx
    .select({ id: thesisSupervisors.id })
    .from(thesisSupervisors)
    .where(and(eq(thesisSupervisors.caseId, caseId), eq(thesisSupervisors.userId, userId), eq(thesisSupervisors.status, "active")))
    .limit(1);
  return rows.length > 0;
}

async function roleHolders(roleKey: string, caseRow: { departmentId: number | null; department: string | null }, tx: DbLike): Promise<string[]> {
  const scope = caseRow.departmentId != null
    ? eq(users.departmentId, caseRow.departmentId)
    : caseRow.department
      ? eq(users.department, caseRow.department)
      : undefined;
  const rows = await tx
    .select({ userId: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.key, roleKey), eq(users.isActive, true), scope))
    .limit(50);
  return rows.map((r) => r.userId);
}

/** Ordered list of a case's topic versions, newest first, with the actor names. */
export async function listTopicVersions(caseId: string) {
  const rows = await db
    .select({
      version: topicVersions,
      submittedByName: users.fullName,
    })
    .from(topicVersions)
    .leftJoin(users, eq(users.id, topicVersions.submittedBy))
    .where(eq(topicVersions.caseId, caseId))
    .orderBy(desc(topicVersions.version));
  return rows.map((r) => ({ ...r.version, submittedByName: r.submittedByName }));
}

export async function getActiveTopicVersion(caseId: string, tx: DbLike = db) {
  const [row] = await tx
    .select()
    .from(topicVersions)
    .where(and(eq(topicVersions.caseId, caseId), eq(topicVersions.isActive, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Creates a new topic version. Submitted for review it becomes `pending_supervisor`;
 * saved without submission it stays a personal draft and never becomes active.
 */
export async function createTopicVersion(caseId: string, actor: Actor, input: TopicVersionInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.submit_topic")) {
    throw new AppError(403, "FORBIDDEN", "دسترسی ثبت موضوع را ندارید.");
  }
  const staffOverride = gate.access.permissions.has("cases.edit_metadata") || gate.access.permissions.has("cases.view_all");
  if (!gate.isOwner && !gate.isAssignedSupervisor && !staffOverride) {
    throw new AppError(403, "FORBIDDEN", "ثبت موضوع فقط برای دانشجوی صاحب پرونده یا کاربران مجاز ستادی ممکن است.");
  }

  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (tc.archivedAt) throw new AppError(409, "CASE_ARCHIVED", "پرونده بایگانی شده و قابل ویرایش نیست.");

    const active = await getActiveTopicVersion(caseId, tx);
    const previous = active ?? (await tx.select().from(topicVersions).where(eq(topicVersions.caseId, caseId)).orderBy(desc(topicVersions.version)).limit(1))[0] ?? null;
    const isChange = !!active;

    if (isChange) {
      // A topic change is allowed only until the stage configured in Settings.
      const allowedUntil = await getSettingValue("topic.changeAllowedUntil");
      if (!isStageAtOrBefore(tc.currentStatus, allowedUntil)) {
        throw new AppError(
          409,
          "TOPIC_CHANGE_NOT_ALLOWED",
          `تغییر موضوع در وضعیت «${statusLabelFa(tc.currentStatus)}» مجاز نیست (آخرین وضعیت مجاز: «${statusLabelFa(allowedUntil)}»).`,
        );
      }
      if (!input.changeReason || input.changeReason.trim().length < 5) {
        throw new AppError(400, "REASON_REQUIRED", "دلیل تغییر موضوع الزامی است (حداقل ۵ نویسه).");
      }
      if ((await getSettingValue("topic.requireFileOnChange")) && !input.fileId) {
        throw new AppError(400, "FILE_REQUIRED", "بارگذاری فایل برای تغییر موضوع الزامی است.");
      }
    }

    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${topicVersions.version}), 0) + 1` })
      .from(topicVersions)
      .where(eq(topicVersions.caseId, caseId));

    const submitForReview = input.submitForReview !== false;
    const [created] = await tx
      .insert(topicVersions)
      .values({
        caseId,
        version: Number(nextVersion),
        titleFa: input.titleFa.trim(),
        titleEn: input.titleEn?.trim() || null,
        keywords: input.keywords?.trim() || null,
        description: input.description?.trim() || null,
        status: submitForReview ? "pending_supervisor" : "draft",
        isActive: false,
        stageAtSubmission: tc.currentStatus,
        changeReason: input.changeReason?.trim() || null,
        fileId: input.fileId ?? null,
        submittedBy: actor.id,
        submittedAt: submitForReview ? new Date() : null,
        reviewStage: submitForReview ? "supervisor" : null,
      })
      .returning();

    // The legacy text columns keep mirroring the newest content so search, reports and
    // PDF never read stale data while the versioned history holds every revision.
    await tx
      .update(thesisCases)
      .set({ titleFa: input.titleFa.trim(), titleEn: input.titleEn?.trim() || null, keywords: input.keywords?.trim() || null, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(thesisCases.id, caseId));

    const before = previous ? { titleFa: previous.titleFa, titleEn: previous.titleEn, version: previous.version } : null;
    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: isChange ? "topic_change_requested" : "topic_version_submitted",
      previousStatus: tc.currentStatus,
      newStatus: tc.currentStatus,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: isChange
        ? `درخواست تغییر موضوع — نسخهٔ ${created.version}`
        : `ثبت نسخهٔ ${created.version} موضوع`,
      reason: input.changeReason?.trim() || null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: isChange ? "topic.change_requested" : "topic.version_created",
        entityType: "topic_version",
        entityId: created.id,
        before,
        after: { caseId, version: created.version, status: created.status, titleFa: created.titleFa, fileId: created.fileId },
        reason: input.changeReason?.trim() || null,
      },
      ctx,
      tx,
    );

    if (submitForReview) await notifyReviewers(tx, caseId, tc, "topic");

    return created;
  });
}

/**
 * Stage ordering used for the "topic may be changed until …" setting.
 * Unknown stages fall back to ordinal 0 so an unrecognised status never widens access.
 */
const STAGE_ORDER: Record<string, number> = {
  draft: 0,
  // Core 7-status definition
  submitted: 1,
  under_review: 2,
  revision_required: 3,
  approved: 4,
  rejected: 5,
  archived: 6,
  // Full-cycle definition (the steps the topic workflow actually visits)
  DRAFT: 0,
  SUBMITTED: 1,
  WAITING_SUPERVISOR: 2,
  SUPERVISOR_APPROVED: 3,
  SUPERVISOR_REJECTED: 3,
  GROUP_REVIEW: 4,
  TOPIC_REVISION: 4,
  TOPIC_APPROVED: 5,
  REJECTED: 5,
  CANCELLED: 6,
  ARCHIVED: 6,
};

export function isStageAtOrBefore(current: string, allowedUntil: string): boolean {
  const currentOrder = STAGE_ORDER[current] ?? 0;
  const allowedOrder = STAGE_ORDER[allowedUntil] ?? STAGE_ORDER.approved;
  return currentOrder <= allowedOrder;
}

/** Supervisor (level 1) or group (level 2) decision on a topic version. */
export async function decideTopicVersion(
  caseId: string,
  versionId: string,
  actor: Actor,
  decision: "approve_supervisor" | "approve_group" | "request_revision" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);

  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(topicVersions)
      .where(and(eq(topicVersions.id, versionId), eq(topicVersions.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!version) throw new AppError(404, "VERSION_NOT_FOUND", "نسخهٔ موضوع یافت نشد.");

    if (version.status === "draft") {
      throw new AppError(409, "INVALID_STATUS", "پیش‌نویس ارسال‌نشده بررسی نمی‌شود.");
    }

    const needsReason = decision === "request_revision" || decision === "reject";
    if (needsReason && (!reason || reason.trim().length < 5)) {
      throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای بازگشت یا رد الزامی است (حداقل ۵ نویسه).");
    }

    const isGroupReviewer = gate.access.permissions.has("cases.approve_topic_group");
    const isStaffReviewer = gate.access.permissions.has("cases.review_topic");
    const canReviewAsSupervisor = gate.isAssignedSupervisor || isStaffReviewer;

    let newStatus: TopicVersionStatus;
    let reviewLevel: "supervisor" | "group";

    if (decision === "approve_group") {
      if (!isGroupReviewer) throw new AppError(403, "FORBIDDEN", "تأیید گروهی موضوع فقط برای مدیر گروه/تحصیلات تکمیلی مجاز است.");
      if (version.status !== "pending_group") throw new AppError(409, "INVALID_STATUS", "این نسخه در انتظار تأیید گروه نیست.");
      newStatus = "approved";
      reviewLevel = "group";
    } else if (decision === "approve_supervisor") {
      if (!canReviewAsSupervisor) {
        throw new AppError(403, "FORBIDDEN", "بررسی موضوع فقط برای استاد راهنمای پرونده یا کاربران مجاز ستادی ممکن است.");
      }
      if (version.status !== "pending_supervisor") throw new AppError(409, "INVALID_STATUS", "این نسخه در انتظار بررسی استاد راهنما نیست.");
      newStatus = "pending_group";
      reviewLevel = "supervisor";
    } else {
      const entitled = version.status === "pending_supervisor" ? canReviewAsSupervisor : isGroupReviewer || isStaffReviewer;
      if (!entitled) throw new AppError(403, "FORBIDDEN", "بازگشت یا رد این نسخه برای نقش شما مجاز نیست.");
      if (version.status !== "pending_supervisor" && version.status !== "pending_group") {
        throw new AppError(409, "INVALID_STATUS", "این نسخه در وضعیت قابل بازگشت یا رد نیست.");
      }
      newStatus = decision === "reject" ? "rejected" : "revision_required";
      reviewLevel = version.status === "pending_supervisor" ? "supervisor" : "group";
    }

    const now = new Date();
    const patch: Record<string, unknown> = { status: newStatus, reviewStage: newStatus === "pending_group" ? "group" : null };
    if (reviewLevel === "supervisor") {
      patch.supervisorDecidedBy = actor.id;
      patch.supervisorDecisionAt = now;
    } else {
      patch.groupDecidedBy = actor.id;
      patch.groupDecisionAt = now;
    }
    if (newStatus === "approved" || newStatus === "rejected" || newStatus === "revision_required") {
      patch.decidedBy = actor.id;
      patch.decidedAt = now;
      patch.decisionReason = reason?.trim() ?? null;
    }
    if (newStatus === "approved") {
      // Exactly one active version: the previous one is deactivated in the same transaction.
      await tx.update(topicVersions).set({ isActive: false }).where(and(eq(topicVersions.caseId, caseId), eq(topicVersions.isActive, true)));
      patch.isActive = true;
    }

    const [updated] = await tx.update(topicVersions).set(patch).where(eq(topicVersions.id, versionId)).returning();

    if (newStatus === "approved") {
      await tx
        .update(thesisCases)
        .set({ titleFa: updated.titleFa, titleEn: updated.titleEn, keywords: updated.keywords, updatedAt: now, updatedBy: actor.id })
        .where(eq(thesisCases.id, caseId));
    }

    // Drive the data-driven workflow when its definition carries the topic steps.
    const workflowTargets: Record<TopicVersionStatus, string[]> = {
      pending_group: ["SUPERVISOR_APPROVED", "GROUP_REVIEW"],
      approved: ["TOPIC_APPROVED"],
      revision_required: ["TOPIC_REVISION"],
      rejected: ["REJECTED"],
      draft: [],
      pending_supervisor: ["WAITING_SUPERVISOR"],
    };
    const targets = workflowTargets[newStatus];
    if (targets.length > 0) {
      await advanceTopicWorkflow(
        tx,
        caseId,
        targets,
        { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
        reason?.trim() ?? null,
      );
    }

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `topic_version_${newStatus}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `نسخهٔ ${version.version} موضوع — ${labelForTopicStatus(newStatus)}`,
      reason: reason?.trim() ?? null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: `topic.version_${newStatus}`,
        entityType: "topic_version",
        entityId: versionId,
        before: { status: version.status, isActive: version.isActive },
        after: { status: newStatus, isActive: newStatus === "approved" },
        reason: reason?.trim() ?? null,
      },
      ctx,
      tx,
    );

    // Notify the next responsible person: the student on a decision, the group when
    // the supervisor moved the version forward. Never a broader audience.
    const recipients = new Set<string>();
    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) recipients.add(gate.caseRow.studentUserId);
    if (newStatus === "pending_group") {
      for (const uid of await roleHolders("dept_head", gate.caseRow, tx)) if (uid !== actor.id) recipients.add(uid);
    }
    for (const userId of recipients) {
      await notify({
        userId,
        kind: `topic.${newStatus}`,
        titleFa: `موضوع پایان‌نامه — ${labelForTopicStatus(newStatus)}`,
        bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: نسخهٔ ${version.version} ${labelForTopicStatus(newStatus)}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
        caseId,
        link: `/cases/${caseId}`,
      }, tx);
    }

    return updated;
  });
}

function labelForTopicStatus(status: TopicVersionStatus): string {
  switch (status) {
    case "approved":
      return "تأیید شد";
    case "pending_group":
      return "در انتظار تأیید گروه";
    case "pending_supervisor":
      return "در انتظار بررسی استاد راهنما";
    case "revision_required":
      return "نیازمند اصلاح";
    case "rejected":
      return "رد شد";
    default:
      return "پیش‌نویس";
  }
}

/** Notifies the people who must review a newly submitted topic/literature item. */
async function notifyReviewers(tx: DbTx, caseId: string, tc: { caseNumber: string; departmentId: number | null; department: string | null }, kind: "topic" | "literature") {
  const supervisors = await tx
    .select({ userId: thesisSupervisors.userId })
    .from(thesisSupervisors)
    .where(and(eq(thesisSupervisors.caseId, caseId), eq(thesisSupervisors.status, "active")));
  const recipients = new Set<string>();
  for (const s of supervisors) if (s.userId) recipients.add(s.userId);
  if (recipients.size === 0) {
    // No supervisor on the case yet: the group queue is responsible, not an invented user.
    for (const uid of await roleHolders("dept_head", tc, tx)) recipients.add(uid);
  }
  for (const userId of recipients) {
    await notify({
      userId,
      kind: `${kind}.submitted`,
      titleFa: kind === "topic" ? "موضوع جدید برای بررسی" : "پیشینه پژوهش جدید برای بررسی",
      bodyFa: `پروندهٔ ${tc.caseNumber} در انتظار بررسی شماست.`,
      caseId,
      link: `/cases/${caseId}`,
    }, tx);
  }
}

// ---------------------------------------------------------------------------
// Literature review (M4, second half)
// ---------------------------------------------------------------------------

export async function getOrCreateActiveLiteratureReview(caseId: string, actorId: string, tx: DbTx) {
  const [existing] = await tx
    .select()
    .from(literatureReviews)
    .where(and(eq(literatureReviews.caseId, caseId), eq(literatureReviews.isActive, true)))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(literatureReviews)
    .values({ caseId, status: "in_review", isActive: true, rounds: 0, openedBy: actorId, openedAt: new Date() })
    .returning();
  return created;
}

export async function listLiteratureReviews(caseId: string) {
  const reviews = await db
    .select()
    .from(literatureReviews)
    .where(eq(literatureReviews.caseId, caseId))
    .orderBy(desc(literatureReviews.createdAt));
  if (reviews.length === 0) return [];
  const versions = await db
    .select()
    .from(literatureReviewVersions)
    .where(eq(literatureReviewVersions.caseId, caseId))
    .orderBy(desc(literatureReviewVersions.version));
  return reviews.map((review) => ({
    ...review,
    versions: versions.filter((v) => v.reviewId === review.id),
  }));
}

export async function submitLiteratureVersion(caseId: string, actor: Actor, input: LiteratureVersionInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  const staffOverride = gate.access.permissions.has("cases.edit_metadata") || gate.access.permissions.has("cases.view_all");
  if (!gate.access.permissions.has("cases.submit_literature") && !gate.isOwner && !staffOverride) {
    throw new AppError(403, "FORBIDDEN", "دسترسی ثبت پیشینه پژوهش را ندارید.");
  }
  const minReferences = await getSettingValue("literature.minReferences");
  if (input.referencesCount != null && input.referencesCount < minReferences) {
    throw new AppError(400, "TOO_FEW_REFERENCES", `حداقل تعداد منابع برای پیشینه پژوهش ${minReferences} است (ثبت‌شده: ${input.referencesCount}).`);
  }

  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (tc.archivedAt) throw new AppError(409, "CASE_ARCHIVED", "پرونده بایگانی شده و قابل ویرایش نیست.");
    const review = await getOrCreateActiveLiteratureReview(caseId, actor.id, tx);

    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${literatureReviewVersions.version}), 0) + 1` })
      .from(literatureReviewVersions)
      .where(eq(literatureReviewVersions.reviewId, review.id));

    const [created] = await tx
      .insert(literatureReviewVersions)
      .values({
        reviewId: review.id,
        caseId,
        version: Number(nextVersion),
        summaryFa: input.summaryFa.trim(),
        objectivesFa: input.objectivesFa?.trim() || null,
        gapFa: input.gapFa?.trim() || null,
        keywords: input.keywords?.trim() || null,
        referencesCount: input.referencesCount ?? null,
        fileId: input.fileId ?? null,
        status: "submitted",
        submittedBy: actor.id,
        submittedAt: new Date(),
      })
      .returning();

    await tx.update(literatureReviews).set({ status: "in_review", rounds: review.rounds + 1, isActive: true }).where(eq(literatureReviews.id, review.id));

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "literature_version_submitted",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `ارسال نسخهٔ ${created.version} پیشینه پژوهش (دور ${review.rounds + 1})`,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "literature.version_submitted",
        entityType: "literature_review_version",
        entityId: created.id,
        after: { caseId, round: review.rounds + 1, version: created.version, referencesCount: created.referencesCount, fileId: created.fileId },
      },
      ctx,
      tx,
    );

    await notifyReviewers(tx, caseId, tc, "literature");
    return created;
  });
}

export async function decideLiteratureVersion(
  caseId: string,
  versionId: string,
  actor: Actor,
  decision: "approve" | "request_revision" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic") && !gate.isAssignedSupervisor) {
    throw new AppError(403, "FORBIDDEN", "بررسی پیشینه پژوهش برای نقش شما مجاز نیست.");
  }
  if (decision !== "approve" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای بازگشت یا رد الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(literatureReviewVersions)
      .where(and(eq(literatureReviewVersions.id, versionId), eq(literatureReviewVersions.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!version) throw new AppError(404, "VERSION_NOT_FOUND", "نسخهٔ پیشینه پژوهش یافت نشد.");
    if (version.status !== "submitted") throw new AppError(409, "INVALID_STATUS", "این نسخه پیش‌تر بررسی شده است.");

    const newStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revision_required";
    const now = new Date();
    const [updated] = await tx
      .update(literatureReviewVersions)
      .set({ status: newStatus, reviewedBy: actor.id, reviewedAt: now, decisionReason: reason?.trim() ?? null })
      .where(eq(literatureReviewVersions.id, versionId))
      .returning();

    // A rejected/approved round closes; a revision request keeps the round open for resubmission.
    await tx
      .update(literatureReviews)
      .set({
        status: newStatus === "approved" ? "approved" : newStatus === "rejected" ? "rejected" : "in_review",
        closedAt: newStatus === "approved" || newStatus === "rejected" ? now : null,
        isActive: newStatus === "revision_required",
      })
      .where(eq(literatureReviews.id, version.reviewId));

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `literature_version_${newStatus}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `نسخهٔ ${version.version} پیشینه پژوهش — ${newStatus === "approved" ? "تأیید شد" : newStatus === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
      reason: reason?.trim() ?? null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: `literature.version_${newStatus}`,
        entityType: "literature_review_version",
        entityId: versionId,
        before: { status: version.status },
        after: { status: newStatus, reason: reason?.trim() ?? null },
        reason: reason?.trim() ?? null,
      },
      ctx,
      tx,
    );

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify({
        userId: gate.caseRow.studentUserId,
        kind: `literature.${newStatus}`,
        titleFa: `پیشینه پژوهش — ${newStatus === "approved" ? "تأیید شد" : newStatus === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
        bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: نسخهٔ ${version.version}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
        caseId,
        link: `/cases/${caseId}`,
      }, tx);
    }
    return updated;
  });
}

/** Pending review queues (topic versions and literature) for reviewers holding the permission. */
export async function listReviewQueue(limit = 50) {
  const topicRows = await db
    .select({
      id: topicVersions.id,
      caseId: topicVersions.caseId,
      caseNumber: thesisCases.caseNumber,
      version: topicVersions.version,
      titleFa: topicVersions.titleFa,
      status: topicVersions.status,
      reviewStage: topicVersions.reviewStage,
      submittedAt: topicVersions.submittedAt,
    })
    .from(topicVersions)
    .innerJoin(thesisCases, eq(thesisCases.id, topicVersions.caseId))
    .where(and(sql`${topicVersions.status} in ('pending_supervisor','pending_group')`, isNull(thesisCases.archivedAt)))
    .orderBy(asc(topicVersions.submittedAt))
    .limit(limit);

  const literatureRows = await db
    .select({
      id: literatureReviewVersions.id,
      caseId: literatureReviewVersions.caseId,
      caseNumber: thesisCases.caseNumber,
      version: literatureReviewVersions.version,
      summaryFa: literatureReviewVersions.summaryFa,
      submittedAt: literatureReviewVersions.submittedAt,
    })
    .from(literatureReviewVersions)
    .innerJoin(thesisCases, eq(thesisCases.id, literatureReviewVersions.caseId))
    .where(and(eq(literatureReviewVersions.status, "submitted"), isNull(thesisCases.archivedAt)))
    .orderBy(asc(literatureReviewVersions.submittedAt))
    .limit(limit);

  return { topic: topicRows, literature: literatureRows };
}
