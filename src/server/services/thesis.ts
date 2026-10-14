import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  files,
  similarityChecks,
  thesisCaseEvents,
  thesisCaseFiles,
  thesisCases,
  thesisVersions,
  users,
  workflowInstances,
} from "@/db/schema";
import { AppError } from "@/server/http";
import { applyTransition, getAvailableTransitionsFrom, type EngineActor } from "@/server/workflows";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { getSettingValue } from "./settings";
import { gateCase } from "./topic";
// Server-side Persian text uses the same digit rendering as the UI, so the reason a
// student sees in the notification is identical to the one on the page.
import { formatNumber } from "@/lib/format";

/**
 * M8 — versioned thesis file and similarity checks.
 *
 * Rules enforced here (server-side, never only in the UI):
 *  - a version is never edited or deleted; a correction creates the next version
 *    and requires a stated reason;
 *  - a version always references a real uploaded file (`files.id`) — the module
 *    refuses to record a version without one, so no claim of a file can be faked;
 *  - exactly one active version per case (partial unique index + transaction);
 *  - the similarity verdict is derived by comparing the reported percentage with
 *    the Setting `similarity.maxPercent`, and the Persian message names the limit
 *    that was in force at the time;
 *  - approval of a passing check moves the workflow to the defense step.
 */

const SIMILARITY_METHODS = ["irandoc", "manual", "external"] as const;

async function advanceThesisWorkflow(
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

/** Computes the verdict from the configured limit; returns the Persian message too. */
export function evaluateSimilarity(percent: number, maxPercent: number) {
  const pass = percent <= maxPercent;
  return {
    result: pass ? ("pass" as const) : ("revision_required" as const),
    maxPercentAtTime: maxPercent,
    messageFa: pass
      ? `درصد همانندجویی ${formatNumber(percent, "fa")}٪ است و از سقف مجاز ${formatNumber(maxPercent, "fa")}٪ فراتر نرفته است.`
      : `درصد همانندجویی ${formatNumber(percent, "fa")}٪ از سقف مجاز ${formatNumber(maxPercent, "fa")}٪ بیشتر است؛ اصلاح نسخهٔ پایان‌نامه و تکرار همانندجویی لازم است.`,
  };
}

export async function listThesisVersions(caseId: string) {
  const rows = await db
    .select({ version: thesisVersions, submittedByName: users.fullName, fileName: files.originalName })
    .from(thesisVersions)
    .leftJoin(users, eq(users.id, thesisVersions.submittedBy))
    .leftJoin(files, eq(files.id, thesisVersions.fileId))
    .where(eq(thesisVersions.caseId, caseId))
    .orderBy(desc(thesisVersions.version));
  return rows.map((r) => ({ ...r.version, submittedByName: r.submittedByName, fileName: r.fileName }));
}

export interface ThesisVersionInput {
  fileId: string;
  titleFa?: string | null;
  changeReason?: string | null;
  submitForReview?: boolean;
}

export async function saveThesisVersion(caseId: string, actor: Actor, input: ThesisVersionInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  const canSubmit = gate.isOwner || gate.access.permissions.has("cases.submit_topic");
  if (!canSubmit) throw new AppError(403, "FORBIDDEN", "ثبت نسخهٔ پایان‌نامه برای شما در این پرونده مجاز نیست.");

  return db.transaction(async (tx) => {
    // The referenced file must exist and must already be attached to this case
    // (case ↔ file relation lives in `thesis_case_files`; a raw file id is not enough).
    const [file] = await tx.select().from(files).where(eq(files.id, input.fileId)).limit(1);
    if (!file || file.status !== "active") throw new AppError(400, "FILE_NOT_FOUND", "فایل ارجاع‌شده یافت نشد؛ ابتدا فایل را بارگذاری کنید.");
    const [link] = await tx
      .select({ id: thesisCaseFiles.id })
      .from(thesisCaseFiles)
      .where(and(eq(thesisCaseFiles.caseId, caseId), eq(thesisCaseFiles.fileId, input.fileId)))
      .limit(1);
    if (!link) throw new AppError(403, "FILE_NOT_IN_CASE", "فایل به این پرونده تعلق ندارد.");

    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${thesisVersions.version}), 0) + 1` })
      .from(thesisVersions)
      .where(eq(thesisVersions.caseId, caseId));
    const versionNumber = Number(nextVersion);
    const changeReason = input.changeReason?.trim() || null;
    if (versionNumber > 1 && (!changeReason || changeReason.length < 5)) {
      throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای نسخهٔ جدید پایان‌نامه الزامی است (حداقل ۵ نویسه).");
    }

    const submit = input.submitForReview !== false;
    const [created] = await tx
      .insert(thesisVersions)
      .values({
        caseId,
        version: versionNumber,
        isActive: false,
        titleFa: input.titleFa?.trim() || null,
        fileId: input.fileId,
        changeReason,
        status: submit ? "submitted" : "draft",
        submittedBy: actor.id,
        submittedAt: submit ? new Date() : null,
      })
      .returning();

    if (submit) {
      await tx.update(thesisVersions).set({ isActive: false }).where(and(eq(thesisVersions.caseId, caseId), eq(thesisVersions.isActive, true)));
      const [activated] = await tx.update(thesisVersions).set({ isActive: true }).where(eq(thesisVersions.id, created.id)).returning();
      created.isActive = activated.isActive;
      created.status = activated.status;
    }

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "thesis_version_submitted",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `ثبت نسخهٔ ${versionNumber} پایان‌نامه`,
      reason: changeReason,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "thesis.version_created",
        entityType: "thesis_version",
        entityId: created.id,
        after: { caseId, version: versionNumber, fileId: input.fileId, status: created.status, isActive: created.isActive },
        reason: changeReason,
      },
      ctx,
      tx,
    );

    if (submit && gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: "thesis.version_submitted",
          titleFa: "نسخهٔ پایان‌نامه ثبت شد",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: نسخهٔ ${versionNumber} در انتظار بررسی است.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return created;
  });
}

export interface SimilarityInput {
  similarityPercent: number;
  reportId?: string | null;
  certificateFileId?: string | null;
  checkedAt?: string | null;
}

/** Registers a similarity report; the verdict comes from the configured limit. */
export async function recordSimilarityCheck(caseId: string, actor: Actor, input: SimilarityInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic") && !gate.access.permissions.has("cases.submit_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت همانندجویی برای نقش شما مجاز نیست.");
  }
  if (!Number.isInteger(input.similarityPercent) || input.similarityPercent < 0 || input.similarityPercent > 100) {
    throw new AppError(400, "INVALID_PERCENT", "درصد همانندجویی باید عددی بین ۰ تا ۱۰۰ باشد.");
  }
  const checkedAt = input.checkedAt ? new Date(input.checkedAt) : new Date();
  if (Number.isNaN(checkedAt.getTime())) throw new AppError(400, "INVALID_DATE", "تاریخ همانندجویی معتبر نیست.");

  return db.transaction(async (tx) => {
    // A check is only meaningful against a version that actually exists.
    const [active] = await tx
      .select({ id: thesisVersions.id, version: thesisVersions.version })
      .from(thesisVersions)
      .where(and(eq(thesisVersions.caseId, caseId), eq(thesisVersions.isActive, true)))
      .limit(1);
    if (!active) throw new AppError(409, "NO_THESIS_VERSION", "پیش از ثبت همانندجویی، باید نسخهٔ پایان‌نامه ثبت شود.");

    const [previous] = await tx
      .select({ id: similarityChecks.id, percent: similarityChecks.similarityPercent, result: similarityChecks.result })
      .from(similarityChecks)
      .where(eq(similarityChecks.caseId, caseId))
      .orderBy(desc(similarityChecks.createdAt))
      .limit(1);
    if (previous && previous.result === "pass") {
      throw new AppError(409, "SIMILARITY_ALREADY_PASSED", "همانندجویی این پرونده قبلاً با نتیجهٔ قبول ثبت شده است.");
    }

    const maxPercent = await getSettingValue("similarity.maxPercent");
    const verdict = evaluateSimilarity(input.similarityPercent, maxPercent);

    const [created] = await tx
      .insert(similarityChecks)
      .values({
        caseId,
        checkedAt,
        similarityPercent: input.similarityPercent,
        reportId: input.reportId?.trim() || null,
        certificateFileId: input.certificateFileId ?? null,
        result: verdict.result,
        maxPercentAtTime: verdict.maxPercentAtTime,
        registeredBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `similarity_${verdict.result}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `همانندجویی نسخهٔ ${active.version}: ${input.similarityPercent}٪ (سقف ${maxPercent}٪) — ${verdict.result === "pass" ? "قبول" : "نیازمند اصلاح"}`,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `similarity.${verdict.result}`,
        entityType: "similarity_check",
        entityId: created.id,
        before: previous ? { percent: previous.percent, result: previous.result } : null,
        after: { percent: input.similarityPercent, result: verdict.result, maxPercentAtTime: maxPercent },
      },
      ctx,
      tx,
    );

    await advanceThesisWorkflow(
      tx,
      caseId,
      verdict.result === "pass" ? ["DEFENSE_SCHEDULED"] : ["THESIS_ACTIVE"],
      { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
      verdict.messageFa,
    );

    const recipients = new Set<string>();
    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) recipients.add(gate.caseRow.studentUserId);
    for (const userId of recipients) {
      await notify(
        {
          userId,
          kind: `similarity.${verdict.result}`,
          titleFa: `همانندجویی — ${verdict.result === "pass" ? "قبول" : "نیازمند اصلاح"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: ${verdict.messageFa}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return { ...created, messageFa: verdict.messageFa };
  });
}

/** Review decision on a submitted thesis version (reason is mandatory for a return). */
export async function decideThesisVersion(
  caseId: string,
  versionId: string,
  actor: Actor,
  decision: "approve" | "request_revision" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.isAssignedSupervisor && !gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "بررسی نسخهٔ پایان‌نامه برای نقش شما مجاز نیست.");
  }
  if (decision !== "approve" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای بازگشت یا رد نسخهٔ پایان‌نامه الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(thesisVersions)
      .where(and(eq(thesisVersions.id, versionId), eq(thesisVersions.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!version) throw new AppError(404, "VERSION_NOT_FOUND", "نسخهٔ پایان‌نامه یافت نشد.");
    if (version.status !== "submitted") throw new AppError(409, "INVALID_STATUS", "این نسخه در وضعیت قابل بررسی نیست.");

    const now = new Date();
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revision_required";
    const [updated] = await tx
      .update(thesisVersions)
      .set({ status, decidedBy: actor.id, decidedAt: now, decisionReason: reason?.trim() || null, updatedAt: now })
      .where(eq(thesisVersions.id, versionId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `thesis_version_${status}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `نسخهٔ ${formatNumber(version.version, "fa")} پایان‌نامه — ${status === "approved" ? "تأیید شد" : status === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
      reason: reason?.trim() || null,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `thesis.version_${status}`,
        entityType: "thesis_version",
        entityId: versionId,
        before: { status: version.status },
        after: { status },
        reason: reason?.trim() || null,
      },
      ctx,
      tx,
    );

    await advanceThesisWorkflow(
      tx,
      caseId,
      decision === "approve" ? ["THESIS_COMPLETED"] : ["THESIS_ACTIVE"],
      { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
      reason?.trim() || null,
    );

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: `thesis.version_${status}`,
          titleFa: `نسخهٔ پایان‌نامه — ${status === "approved" ? "تأیید شد" : status === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: نسخهٔ ${formatNumber(version.version, "fa")}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

export async function listSimilarityChecks(caseId: string) {
  const rows = await db
    .select({ check: similarityChecks, registeredByName: users.fullName })
    .from(similarityChecks)
    .leftJoin(users, eq(users.id, similarityChecks.registeredBy))
    .where(eq(similarityChecks.caseId, caseId))
    .orderBy(desc(similarityChecks.createdAt));
  return rows.map((r) => ({ ...r.check, registeredByName: r.registeredByName }));
}

/** The rule engine's DENY message, exposed so the UI can show the same text. */
export async function similarityGateMessage(caseId: string): Promise<string | null> {
  const rows = await listSimilarityChecks(caseId);
  if (rows.length === 0) return "همانندجویی ثبت نشده است.";
  const latest = rows[0];
  if (latest.result === "pass") return null;
  return `نتیجهٔ همانندجویی «قبول» نیست (${latest.similarityPercent}٪ در برابر سقف ${latest.maxPercentAtTime}٪).`;
}

/** Verifies that a version's file still exists on disk metadata level. */
export async function versionHasFile(versionId: string): Promise<boolean> {
  const [row] = await db
    .select({ fileId: thesisVersions.fileId, stored: files.id })
    .from(thesisVersions)
    .leftJoin(files, eq(files.id, thesisVersions.fileId))
    .where(eq(thesisVersions.id, versionId))
    .limit(1);
  return Boolean(row?.stored);
}

export const SIMILARITY_METHOD_KEYS = SIMILARITY_METHODS;
export async function fileNamesFor(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select({ id: files.id, originalName: files.originalName }).from(files).where(inArray(files.id, ids));
}
