import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbLike, type DbTx } from "@/db";
import {
  irandocRecords,
  proposals,
  roles,
  thesisCaseEvents,
  thesisCases,
  userRoles,
  users,
  workflowInstances,
} from "@/db/schema";
import { AppError } from "@/server/http";
import { applyTransition, getAvailableTransitionsFrom, type EngineActor } from "@/server/workflows";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { gateCase } from "./topic";

/**
 * M6 — internal IranDoc registration workflow.
 *
 * This module records and reviews the university's *internal* IranDoc paperwork
 * (tracking code, receipt, approval). It is deliberately NOT a connection to any
 * external IranDoc service: nothing here calls out to a remote API, and the schema
 * comment on `irandoc_records` says the same. Everything is server-authoritative:
 * the student may only submit for a case whose proposal is already approved, the
 * graduate office alone may approve/reject, and a rejection always needs a reason.
 */

export type IrandocStatus = "submitted" | "approved" | "rejected";

async function gradOfficeHolders(
  caseRow: { departmentId: number | null; department: string | null },
  tx: DbLike,
): Promise<string[]> {
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
    .where(and(eq(roles.key, "grad_office"), eq(users.isActive, true), scope))
    .limit(50);
  return rows.map((r) => r.userId);
}

/** Ordered list of a case's IranDoc records, newest first, with actor names. */
export async function listIrandocRecords(caseId: string) {
  const rows = await db
    .select({ record: irandocRecords, submittedByName: users.fullName })
    .from(irandocRecords)
    .leftJoin(users, eq(users.id, irandocRecords.submittedBy))
    .where(eq(irandocRecords.caseId, caseId))
    .orderBy(desc(irandocRecords.createdAt));
  const reviewerIds = [...new Set(rows.map((r) => r.record.reviewedBy).filter((id): id is string => Boolean(id)))];
  const reviewers = reviewerIds.length
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, reviewerIds))
    : [];
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.fullName]));
  return rows.map((r) => ({
    ...r.record,
    submittedByName: r.submittedByName,
    reviewedByName: r.record.reviewedBy ? reviewerName.get(r.record.reviewedBy) ?? null : null,
  }));
}

/** Walks the workflow steps that exist in `workflow_transitions` (no hard-coded graph). */
async function advanceIrandocWorkflow(
  tx: DbTx,
  caseId: string,
  targetSteps: string[],
  actor: EngineActor,
  reason: string | null,
): Promise<string | null> {
  const [tc] = await tx.select({ instanceId: thesisCases.currentInstanceId }).from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc?.instanceId) return null;
  let lastStep: string | null = null;
  for (const target of targetSteps) {
    const [instance] = await tx
      .select({ definitionId: workflowInstances.definitionId, currentStep: workflowInstances.currentStep })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, tc.instanceId))
      .limit(1);
    if (!instance) return lastStep;
    const available = await getAvailableTransitionsFrom(instance.definitionId, instance.currentStep, tx);
    const transition = available.find((t) => t.toStep === target && actor.permissions.has(t.requiredPermission));
    if (!transition) return lastStep;
    const applied = await applyTransition(tx, { caseId, actor, action: transition.action, reason: reason ?? undefined, now: new Date() });
    lastStep = applied.toStep;
  }
  return lastStep;
}

/** Pending IranDoc registrations for the graduate-office review queue. */
export async function listIrandocReviewQueue(limit = 50) {
  return db
    .select({
      id: irandocRecords.id,
      caseId: irandocRecords.caseId,
      caseNumber: thesisCases.caseNumber,
      trackingCode: irandocRecords.trackingCode,
      registeredAt: irandocRecords.registeredAt,
      createdAt: irandocRecords.createdAt,
      receiptFileId: irandocRecords.receiptFileId,
      studentName: users.fullName,
    })
    .from(irandocRecords)
    .innerJoin(thesisCases, eq(thesisCases.id, irandocRecords.caseId))
    .leftJoin(users, eq(users.id, thesisCases.studentUserId))
    .where(and(eq(irandocRecords.status, "submitted"), sql`${thesisCases.archivedAt} is null`))
    .orderBy(irandocRecords.createdAt)
    .limit(limit);
}

export interface IrandocSubmissionInput {
  trackingCode: string;
  registeredAt?: string | null;
  receiptFileId?: string | null;
  certificateFileId?: string | null;
}

export async function submitIrandocRecord(
  caseId: string,
  actor: Actor,
  input: IrandocSubmissionInput,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.isOwner && !gate.access.permissions.has("cases.submit_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت اطلاعات ایرانداک برای شما در این پرونده مجاز نیست.");
  }

  return db.transaction(async (tx) => {
    // The proposal must be approved first: the journey is never bypassable by a raw request.
    const [approvedProposal] = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.caseId, caseId), eq(proposals.status, "approved"), eq(proposals.isActive, true)))
      .limit(1);
    if (!approvedProposal) {
      throw new AppError(409, "PROPOSAL_NOT_APPROVED", "تا زمان تصویب پروپوزال، ثبت اطلاعات ایرانداک ممکن نیست.");
    }
    const [approvedRecord] = await tx
      .select({ id: irandocRecords.id })
      .from(irandocRecords)
      .where(and(eq(irandocRecords.caseId, caseId), eq(irandocRecords.status, "approved")))
      .limit(1);
    if (approvedRecord) {
      throw new AppError(409, "IRANDOC_ALREADY_APPROVED", "ثبت ایرانداک این پرونده قبلاً تأیید شده است.");
    }

    const registeredAt = input.registeredAt ? new Date(input.registeredAt) : null;
    if (registeredAt && Number.isNaN(registeredAt.getTime())) {
      throw new AppError(400, "INVALID_DATE", "تاریخ ثبت معتبر نیست.");
    }

    const [created] = await tx
      .insert(irandocRecords)
      .values({
        caseId,
        trackingCode: input.trackingCode.trim(),
        registeredAt,
        receiptFileId: input.receiptFileId ?? null,
        certificateFileId: input.certificateFileId ?? null,
        status: "submitted",
        submittedBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "irandoc_submitted",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `ثبت اطلاعات ایرانداک با کد پیگیری ${created.trackingCode}`,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "irandoc.submitted",
        entityType: "irandoc_record",
        entityId: created.id,
        after: { caseId, trackingCode: created.trackingCode, registeredAt: created.registeredAt, receiptFileId: created.receiptFileId, status: created.status },
      },
      ctx,
      tx,
    );

    await advanceIrandocWorkflow(tx, caseId, ["IRANDOC_REVIEW"], { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys }, null);

    for (const userId of await gradOfficeHolders(gate.caseRow, tx)) {
      if (userId === actor.id) continue;
      await notify(
        {
          userId,
          kind: "irandoc.submitted",
          titleFa: "ثبت ایرانداک در انتظار بررسی",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: کد پیگیری ${created.trackingCode} برای بررسی ثبت شد.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }

    return created;
  });
}

export async function decideIrandocRecord(
  caseId: string,
  recordId: string,
  actor: Actor,
  decision: "approve" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "بررسی ثبت ایرانداک برای نقش شما مجاز نیست.");
  }
  if (decision === "reject" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای رد الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(irandocRecords)
      .where(and(eq(irandocRecords.id, recordId), eq(irandocRecords.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!record) throw new AppError(404, "IRANDOC_NOT_FOUND", "رکورد ایرانداک یافت نشد.");
    if (record.status !== "submitted") throw new AppError(409, "INVALID_STATUS", "این رکورد در وضعیت قابل بررسی نیست.");

    const now = new Date();
    const status: IrandocStatus = decision === "approve" ? "approved" : "rejected";
    const [updated] = await tx
      .update(irandocRecords)
      .set({ status, reviewedBy: actor.id, reviewedAt: now, rejectionReason: decision === "reject" ? reason?.trim() ?? null : null })
      .where(eq(irandocRecords.id, recordId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `irandoc_${status}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `ایرانداک — ${status === "approved" ? "تأیید" : "رد"} ثبت کد ${record.trackingCode}`,
      reason: reason?.trim() ?? null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: `irandoc.${status}`,
        entityType: "irandoc_record",
        entityId: recordId,
        before: { status: record.status, rejectionReason: record.rejectionReason },
        after: { status, reviewedBy: actor.id },
        reason: reason?.trim() ?? null,
      },
      ctx,
      tx,
    );

    await advanceIrandocWorkflow(
      tx,
      caseId,
      decision === "approve" ? ["IRANDOC_APPROVED"] : ["IRANDOC_PENDING"],
      { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
      reason?.trim() ?? null,
    );

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: `irandoc.${status}`,
          titleFa: `ایرانداک — ${status === "approved" ? "تأیید شد" : "رد شد"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: کد ${record.trackingCode}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }

    return updated;
  });
}
