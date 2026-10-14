import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  caseClosures,
  graduationRecords,
  notifications,
  roles,
  thesisCaseEvents,
  thesisCases,
  thesisVersions,
  userRoles,
  users,
  workflowInstances,
} from "@/db/schema";
import { AppError } from "@/server/http";
import { canApproveFinal, canCloseCase, loadCaseFacts, type RuleResult } from "@/server/rules";
import { applyTransition, getAvailableTransitionsFrom, type EngineActor } from "@/server/workflows";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { gateCase } from "./topic";

/**
 * M10 — graduation approval and case closure.
 *
 * The closure path is guarded by the very same rule engine the UI shows, so a
 * student request that tampers with the body still cannot close a case that misses
 * a final file, a defense result, an approved IranDoc record or a settled finance
 * row. The ALLOW verdict is snapshotted into `case_closures.rule_snapshot`.
 */

async function advanceGraduationWorkflow(
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

function denyError(result: RuleResult): AppError {
  return new AppError(409, "RULE_DENIED", result.reasons.join(" "));
}

export async function listGraduationRecords(caseId: string) {
  const rows = await db
    .select({ record: graduationRecords, requestedByName: users.fullName })
    .from(graduationRecords)
    .leftJoin(users, eq(users.id, graduationRecords.requestedBy))
    .where(eq(graduationRecords.caseId, caseId))
    .orderBy(desc(graduationRecords.createdAt));
  const closures = await db.select().from(caseClosures).where(eq(caseClosures.caseId, caseId)).orderBy(desc(caseClosures.closedAt));
  const deciders = [...new Set(rows.map((r) => r.record.decidedBy).filter((id): id is string => Boolean(id)))];
  const names = deciders.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, deciders)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
  return {
    records: rows.map((r) => ({ ...r.record, requestedByName: r.requestedByName, decidedByName: r.record.decidedBy ? nameOf.get(r.record.decidedBy) ?? null : null })),
    closures,
  };
}

export async function requestGraduation(caseId: string, actor: Actor, input: { thesisVersionId?: string | null; fileId?: string | null; note?: string | null }, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.isOwner && !gate.access.permissions.has("cases.submit_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت درخواست فارغ‌التحصیلی برای شما در این پرونده مجاز نیست.");
  }
  const facts = await loadCaseFacts(caseId);
  if (!facts) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const verdict = canApproveFinal(facts);
  if (!verdict.allowed) throw denyError(verdict);

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: graduationRecords.id })
      .from(graduationRecords)
      .where(and(eq(graduationRecords.caseId, caseId), eq(graduationRecords.status, "requested")))
      .limit(1);
    if (pending) throw new AppError(409, "REQUEST_PENDING", "درخواست فارغ‌التحصیلی در انتظار بررسی وجود دارد.");

    const [activeVersion] = await tx
      .select({ id: thesisVersions.id })
      .from(thesisVersions)
      .where(and(eq(thesisVersions.caseId, caseId), eq(thesisVersions.isActive, true)))
      .limit(1);

    const [created] = await tx
      .insert(graduationRecords)
      .values({
        caseId,
        status: "requested",
        thesisVersionId: input.thesisVersionId ?? activeVersion?.id ?? null,
        fileId: input.fileId ?? null,
        note: input.note?.trim() || null,
        requestedBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "graduation_requested",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: "درخواست فارغ‌التحصیلی",
      reason: input.note?.trim() || null,
    });
    await recordAudit(
      { actorUserId: actor.id, action: "graduation.requested", entityType: "graduation_record", entityId: created.id, after: { caseId, thesisVersionId: created.thesisVersionId }, reason: input.note?.trim() || null },
      ctx,
      tx,
    );

    const holders = await tx
      .select({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.key, "graduation_officer"), eq(users.isActive, true)))
      .limit(50);
    for (const holder of holders) {
      if (holder.userId === actor.id) continue;
      await notify(
        {
          userId: holder.userId,
          kind: "graduation.requested",
          titleFa: "درخواست فارغ‌التحصیلی",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber} در انتظار بررسی فارغ‌التحصیلی است.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return created;
  });
}

export async function decideGraduation(
  caseId: string,
  recordId: string,
  actor: Actor,
  decision: "approve" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.archive") && !gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "بررسی درخواست فارغ‌التحصیلی برای نقش شما مجاز نیست.");
  }
  if (decision === "reject" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای رد درخواست فارغ‌التحصیلی الزامی است (حداقل ۵ نویسه).");
  }
  const facts = await loadCaseFacts(caseId);
  if (!facts) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  if (decision === "approve") {
    const verdict = canApproveFinal(facts);
    if (!verdict.allowed) throw denyError(verdict);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(graduationRecords)
      .where(and(eq(graduationRecords.id, recordId), eq(graduationRecords.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!row) throw new AppError(404, "GRADUATION_NOT_FOUND", "درخواست فارغ‌التحصیلی یافت نشد.");
    if (row.status !== "requested") throw new AppError(409, "INVALID_STATUS", "این درخواست قبلاً بررسی شده است.");

    const now = new Date();
    const status = decision === "approve" ? "approved" : "rejected";
    const [updated] = await tx
      .update(graduationRecords)
      .set({ status, decidedBy: actor.id, decidedAt: now, decisionReason: reason?.trim() || null })
      .where(eq(graduationRecords.id, recordId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `graduation_${status}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `فارغ‌التحصیلی — ${status === "approved" ? "تأیید شد" : "رد شد"}`,
      reason: reason?.trim() || null,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `graduation.${status}`,
        entityType: "graduation_record",
        entityId: recordId,
        before: { status: row.status },
        after: { status },
        reason: reason?.trim() || null,
      },
      ctx,
      tx,
    );

    await advanceGraduationWorkflow(
      tx,
      caseId,
      decision === "approve" ? ["GRADUATION_APPROVED"] : ["THESIS_COMPLETED"],
      { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
      reason?.trim() || null,
    );

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: `graduation.${status}`,
          titleFa: `فارغ‌التحصیلی — ${status === "approved" ? "تأیید شد" : "رد شد"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

/** Closes (archives) a case. Only the rule engine's ALLOW passes. */
export async function closeCase(caseId: string, actor: Actor, reason: string, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.archive")) {
    throw new AppError(403, "FORBIDDEN", "بستن پرونده برای نقش شما مجاز نیست.");
  }
  if (!reason || reason.trim().length < 5) throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای بستن پرونده الزامی است (حداقل ۵ نویسه).");

  const facts = await loadCaseFacts(caseId);
  if (!facts) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const verdict = canCloseCase(facts);
  if (!verdict.allowed) throw denyError(verdict);
  if (facts.archivedAt) throw new AppError(409, "ALREADY_CLOSED", "این پرونده قبلاً بسته شده است.");

  return db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(thesisCases).set({ archivedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(thesisCases.id, caseId));
    const [closure] = await tx
      .insert(caseClosures)
      .values({ caseId, closedBy: actor.id, closedAt: now, reason: reason.trim(), ruleSnapshot: { name: "canCloseCase", allowed: verdict.allowed, reasons: verdict.reasons } })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "case_closed",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: "بستن و بایگانی پرونده پس از تأیید قواعد",
      reason: reason.trim(),
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "case.closed",
        entityType: "thesis_case",
        entityId: caseId,
        before: { archivedAt: null },
        after: { archivedAt: now, closureId: closure.id, rule: "canCloseCase" },
        reason: reason.trim(),
      },
      ctx,
      tx,
    );

    await advanceGraduationWorkflow(tx, caseId, ["ARCHIVED"], { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys }, reason.trim());

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: "case.closed",
          titleFa: "پرونده بسته شد",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber} با تأیید قواعد سامانه بسته و بایگانی شد.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return closure;
  });
}

/** Counts used by the dashboards. */
export async function pendingGraduationCount() {
  const [row] = await db.select({ id: graduationRecords.id }).from(graduationRecords).where(eq(graduationRecords.status, "requested")).limit(1);
  const rows = await db.select({ id: graduationRecords.id }).from(graduationRecords).where(eq(graduationRecords.status, "requested"));
  return { pending: rows.length, hasPending: Boolean(row) };
}

export async function closureFor(caseId: string) {
  const [row] = await db.select().from(caseClosures).where(eq(caseClosures.caseId, caseId)).orderBy(desc(caseClosures.closedAt)).limit(1);
  return row ?? null;
}

export async function unreadClosureNotifications(userId: string) {
  return db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, userId)).limit(1);
}
