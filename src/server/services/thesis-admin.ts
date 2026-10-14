import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbLike, type DbTx } from "@/db";
import {
  academicTerms,
  committeeMeetings,
  committeeMembers,
  financeRecords,
  roles,
  thesisCaseEvents,
  thesisCases,
  thesisExtensions,
  userRoles,
  users,
  workflowInstances,
} from "@/db/schema";
import { AppError } from "@/server/http";
import { canRequestDefense, loadCaseFacts } from "@/server/rules";
import { applyTransition, getAvailableTransitionsFrom, type EngineActor } from "@/server/workflows";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { getSettingValue } from "./settings";
import { gateCase } from "./topic";

/**
 * M7 — term extension, committee meetings and finance records.
 *
 * Rules enforced here, never only in the UI:
 *  - a request always needs a stated reason, and a rejection needs one too;
 *  - the total number of granted extension terms is capped by the Setting
 *    `extension.maxExtraTerms`, and the denial names the real Persian reason;
 *  - a committee meeting cannot be recorded as held without the minimum number of
 *    members (Setting `committee.minMembers`) and, when
 *    `committee.requireMinutes` is on, without the minutes;
 *  - money rows are never edited: settling writes status/paid-at/receipt and the
 *    history stays visible.
 */

const MEETING_RESULTS = ["passed", "revision_required", "rejected"] as const;

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

async function roleHolders(roleKey: string, caseRow: { departmentId: number | null; department: string | null }, tx: DbLike) {
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

/** Walks the workflow steps that exist in `workflow_transitions` (no hard-coded graph). */
async function advanceAdminWorkflow(
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

async function caseRowOf(caseId: string, tx: DbLike) {
  const [row] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!row) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  return row;
}

// ---------------------------------------------------------------------------
// Term extension
// ---------------------------------------------------------------------------

export async function listExtensions(caseId: string) {
  const rows = await db
    .select({ extension: thesisExtensions, termTitle: academicTerms.titleFa, requestedByName: users.fullName })
    .from(thesisExtensions)
    .leftJoin(academicTerms, eq(academicTerms.id, thesisExtensions.termId))
    .leftJoin(users, eq(users.id, thesisExtensions.requestedBy))
    .where(eq(thesisExtensions.caseId, caseId))
    .orderBy(desc(thesisExtensions.createdAt));
  const deciders = [...new Set(rows.map((r) => r.extension.decidedBy).filter((id): id is string => Boolean(id)))];
  const names = deciders.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, deciders)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
  return rows.map((r) => ({
    ...r.extension,
    termTitle: r.termTitle,
    requestedByName: r.requestedByName,
    decidedByName: r.extension.decidedBy ? nameOf.get(r.extension.decidedBy) ?? null : null,
  }));
}

export interface ExtensionInput {
  termId?: number | null;
  requestedTerms: number;
  reason: string;
  fileId?: string | null;
}

export async function requestExtension(caseId: string, actor: Actor, input: ExtensionInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.isOwner && !gate.access.permissions.has("cases.submit_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت درخواست تمدید برای شما در این پرونده مجاز نیست.");
  }
  const reason = input.reason.trim();
  if (reason.length < 5) throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل درخواست تمدید الزامی است (حداقل ۵ نویسه).");
  if (input.requestedTerms < 1) throw new AppError(400, "INVALID_TERMS", "تعداد ترم درخواستی باید حداقل ۱ باشد.");
  const requiresFile = await getSettingValue("extension.requiresFile");
  if (requiresFile && !input.fileId) throw new AppError(400, "FILE_REQUIRED", "بارگذاری فایل برای درخواست تمدید الزامی است.");

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: thesisExtensions.id })
      .from(thesisExtensions)
      .where(and(eq(thesisExtensions.caseId, caseId), eq(thesisExtensions.status, "pending")))
      .limit(1);
    if (pending) throw new AppError(409, "REQUEST_PENDING", "یک درخواست تمدید در انتظار بررسی وجود دارد.");

    const [created] = await tx
      .insert(thesisExtensions)
      .values({
        caseId,
        termId: input.termId ?? null,
        requestedTerms: input.requestedTerms,
        reason,
        status: "pending",
        fileId: input.fileId ?? null,
        requestedBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "extension_requested",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `درخواست تمدید ${created.requestedTerms} ترم`,
      reason,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "extension.requested",
        entityType: "thesis_extension",
        entityId: created.id,
        after: { caseId, requestedTerms: created.requestedTerms, termId: created.termId, fileId: created.fileId, status: created.status },
        reason,
      },
      ctx,
      tx,
    );

    for (const userId of await roleHolders("grad_office", gate.caseRow, tx)) {
      if (userId === actor.id) continue;
      await notify(
        {
          userId,
          kind: "extension.requested",
          titleFa: "درخواست تمدید ترم",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: درخواست تمدید ${created.requestedTerms} ترم در انتظار بررسی است.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return created;
  });
}

export async function decideExtension(
  caseId: string,
  extensionId: string,
  actor: Actor,
  decision: "approve" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "بررسی درخواست تمدید برای نقش شما مجاز نیست.");
  }
  if (decision === "reject" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای رد درخواست تمدید الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(thesisExtensions)
      .where(and(eq(thesisExtensions.id, extensionId), eq(thesisExtensions.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!row) throw new AppError(404, "EXTENSION_NOT_FOUND", "درخواست تمدید یافت نشد.");
    if (row.status !== "pending") throw new AppError(409, "INVALID_STATUS", "این درخواست قبلاً بررسی شده است.");

    let grantedSoFar = 0;
    if (decision === "approve") {
      const [sum] = await tx
        .select({ total: sql<number>`coalesce(sum(${thesisExtensions.requestedTerms}), 0)` })
        .from(thesisExtensions)
        .where(and(eq(thesisExtensions.caseId, caseId), eq(thesisExtensions.status, "approved")));
      grantedSoFar = Number(sum?.total ?? 0);
      const cap = await getSettingValue("extension.maxExtraTerms");
      if (grantedSoFar + row.requestedTerms > cap) {
        throw new AppError(
          409,
          "EXTENSION_LIMIT",
          `سقف ترم تمدید مجاز در کل دوره ${cap} ترم است و تاکنون ${grantedSoFar} ترم تمدید شده است؛ این درخواست قابل تأیید نیست.`,
        );
      }
    }

    const now = new Date();
    const status = decision === "approve" ? "approved" : "rejected";
    const [updated] = await tx
      .update(thesisExtensions)
      .set({ status, decidedBy: actor.id, decidedAt: now, decisionReason: reason?.trim() ?? null })
      .where(eq(thesisExtensions.id, extensionId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `extension_${status}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `درخواست تمدید ${row.requestedTerms} ترم — ${status === "approved" ? "تأیید شد" : "رد شد"}`,
      reason: reason?.trim() ?? null,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `extension.${status}`,
        entityType: "thesis_extension",
        entityId: extensionId,
        before: { status: row.status },
        after: { status, grantedTotal: decision === "approve" ? grantedSoFar + row.requestedTerms : grantedSoFar },
        reason: reason?.trim() ?? null,
      },
      ctx,
      tx,
    );

    await advanceAdminWorkflow(
      tx,
      caseId,
      decision === "approve" ? ["THESIS_ACTIVE"] : ["THESIS_REVISION"],
      { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
      reason?.trim() ?? null,
    );

    const recipients = new Set<string>();
    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) recipients.add(gate.caseRow.studentUserId);
    for (const userId of recipients) {
      await notify(
        {
          userId,
          kind: `extension.${status}`,
          titleFa: `تمدید ترم — ${status === "approved" ? "تأیید شد" : "رد شد"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: درخواست ${row.requestedTerms} ترم${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Committee meetings
// ---------------------------------------------------------------------------

export async function listCommitteeMeetings(caseId: string) {
  const meetings = await db.select().from(committeeMeetings).where(eq(committeeMeetings.caseId, caseId)).orderBy(desc(committeeMeetings.scheduledAt));
  if (meetings.length === 0) return [];
  const members = await db
    .select()
    .from(committeeMembers)
    .where(inArray(committeeMembers.meetingId, meetings.map((m) => m.id)))
    .orderBy(asc(committeeMembers.createdAt));
  return meetings.map((meeting) => ({ ...meeting, members: members.filter((m) => m.meetingId === meeting.id) }));
}

export interface CommitteeMemberInput {
  userId?: string | null;
  fullName?: string | null;
  roleType?: string;
  isPresent?: boolean;
  note?: string | null;
}

export interface CommitteeInput {
  meetingType: string;
  scheduledAt: string;
  location?: string | null;
  members: CommitteeMemberInput[];
}

export async function createCommitteeMeeting(caseId: string, actor: Actor, input: CommitteeInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "تشکیل جلسهٔ کمیسیون برای نقش شما مجاز نیست.");
  }
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new AppError(400, "INVALID_DATE", "تاریخ جلسه معتبر نیست.");
  // A final-defense session is a gated step: the rule engine decides, and its exact
  // Persian reasons are shown to the operator (never a silent refusal).
  if (input.meetingType === "final_defense") {
    const facts = await loadCaseFacts(caseId);
    if (!facts) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    const verdict = canRequestDefense(facts);
    if (!verdict.allowed) throw new AppError(409, "RULE_DENIED", verdict.reasons.join(" "));
  }
  const members = input.members ?? [];
  const minMembers = await getSettingValue("committee.minMembers");
  if (members.length < minMembers) {
    throw new AppError(400, "MEMBERS_REQUIRED", `حداقل ${minMembers} عضو برای جلسه لازم است.`);
  }
  for (const member of members) {
    if (!member.userId && !member.fullName?.trim()) {
      throw new AppError(400, "MEMBER_INVALID", "هر عضو باید کاربر سامانه یا نام مشخص داشته باشد.");
    }
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(committeeMeetings)
      .values({
        caseId,
        meetingType: input.meetingType,
        scheduledAt,
        location: input.location?.trim() || null,
        status: "scheduled",
        createdBy: actor.id,
      })
      .returning();

    const userIds = members.map((m) => m.userId).filter((id): id is string => Boolean(id));
    const named = userIds.length ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds)) : [];
    const nameOf = new Map(named.map((n) => [n.id, n.fullName]));

    await tx.insert(committeeMembers).values(
      members.map((member) => ({
        meetingId: created.id,
        userId: member.userId ?? null,
        fullName: (member.userId ? nameOf.get(member.userId) ?? member.fullName?.trim() : member.fullName?.trim()) || "عضو کمیسیون",
        roleType: member.roleType ?? "internal",
        isPresent: member.isPresent ?? false,
        note: member.note?.trim() || null,
      })),
    );

    // Read the members back inside the same transaction: the outer reader would not
    // see rows that this transaction has not committed yet.
    const createdMembers = await tx
      .select()
      .from(committeeMembers)
      .where(eq(committeeMembers.meetingId, created.id))
      .orderBy(asc(committeeMembers.createdAt));

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "committee_scheduled",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `تشکیل جلسهٔ ${input.meetingType} با ${members.length} عضو`,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "committee.meeting_created",
        entityType: "committee_meeting",
        entityId: created.id,
        after: { caseId, meetingType: created.meetingType, scheduledAt, location: created.location, memberCount: members.length },
      },
      ctx,
      tx,
    );

    // Everyone on the committee, plus the student, is told about the session.
    const recipients = new Set<string>(userIds);
    if (gate.caseRow.studentUserId) recipients.add(gate.caseRow.studentUserId);
    recipients.delete(actor.id);
    for (const userId of recipients) {
      await notify(
        {
          userId,
          kind: "committee.scheduled",
          titleFa: "جلسهٔ کمیسیون/دفاع",
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: جلسهٔ ${input.meetingType} در تاریخ مقرر تنظیم شد.`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return { ...created, members: createdMembers };
  });
}

export interface CommitteeOutcomeInput {
  status: "held" | "cancelled";
  result?: string | null;
  minutesFa?: string | null;
  fileId?: string | null;
  attendance?: Array<{ memberId: string; isPresent: boolean }>;
  note?: string | null;
}

export async function recordCommitteeOutcome(
  caseId: string,
  meetingId: string,
  actor: Actor,
  input: CommitteeOutcomeInput,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت نتیجهٔ جلسه برای نقش شما مجاز نیست.");
  }
  if (input.status !== "held" && input.status !== "cancelled") {
    throw new AppError(400, "INVALID_STATUS", "وضعیت نتیجهٔ جلسه باید «برگزار شد» یا «لغو شد» باشد.");
  }
  if (input.result && !isOneOf(MEETING_RESULTS, input.result)) {
    throw new AppError(400, "INVALID_RESULT", "نتیجهٔ جلسه معتبر نیست.");
  }

  return db.transaction(async (tx) => {
    const [meeting] = await tx
      .select()
      .from(committeeMeetings)
      .where(and(eq(committeeMeetings.id, meetingId), eq(committeeMeetings.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!meeting) throw new AppError(404, "MEETING_NOT_FOUND", "جلسه یافت نشد.");
    if (meeting.status !== "scheduled") throw new AppError(409, "INVALID_STATUS", "نتیجهٔ این جلسه قبلاً ثبت شده است.");

    const rows = await tx.select().from(committeeMembers).where(eq(committeeMembers.meetingId, meetingId));
    if (input.status === "held") {
      const minMembers = await getSettingValue("committee.minMembers");
      if (rows.length < minMembers) throw new AppError(400, "MEMBERS_REQUIRED", `حداقل ${minMembers} عضو برای ثبت جلسه لازم است.`);
      if (!input.result) throw new AppError(400, "RESULT_REQUIRED", "ثبت نتیجهٔ جلسه الزامی است.");
      const requireMinutes = await getSettingValue("committee.requireMinutes");
      if (requireMinutes && (input.minutesFa?.trim().length ?? 0) < 10) {
        throw new AppError(400, "MINUTES_REQUIRED", "ثبت صورت‌جلسه (حداقل ۱۰ نویسه) برای جلسهٔ برگزارشده الزامی است.");
      }
      const present = input.attendance?.filter((a) => a.isPresent).length ?? rows.filter((r) => r.isPresent).length;
      if (present < minMembers) {
        throw new AppError(400, "QUORUM_NOT_MET", `حد نصاب جلسه رعایت نشده است؛ حداقل ${minMembers} عضو حاضر لازم است.`);
      }
    }

    const now = new Date();
    if (input.attendance?.length) {
      for (const entry of input.attendance) {
        await tx
          .update(committeeMembers)
          .set({ isPresent: entry.isPresent })
          .where(and(eq(committeeMembers.id, entry.memberId), eq(committeeMembers.meetingId, meetingId)));
      }
    }

    const [updated] = await tx
      .update(committeeMeetings)
      .set({
        status: input.status,
        heldAt: input.status === "held" ? now : null,
        result: input.status === "held" ? input.result ?? null : null,
        minutesFa: input.minutesFa?.trim() || null,
        fileId: input.fileId ?? meeting.fileId ?? null,
        updatedAt: now,
      })
      .where(eq(committeeMeetings.id, meetingId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: input.status === "held" ? "committee_held" : "committee_cancelled",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description:
        input.status === "held"
          ? `جلسهٔ ${meeting.meetingType} برگزار شد — نتیجه: ${input.result}`
          : `جلسهٔ ${meeting.meetingType} لغو شد`,
      reason: input.note?.trim() || null,
    });
    // A held final defense drives the workflow: passed ⇒ defense completed,
    // any revision verdict ⇒ back to an active thesis (§M9).
    if (input.status === "held" && meeting.meetingType === "final_defense") {
      await advanceAdminWorkflow(
        tx,
        caseId,
        input.result === "passed" ? ["DEFENSE_COMPLETED"] : ["DEFENSE_REVISION"],
        { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys },
        input.note?.trim() || null,
      );
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        action: `committee.${input.status}`,
        entityType: "committee_meeting",
        entityId: meetingId,
        before: { status: meeting.status, result: meeting.result },
        after: { status: updated.status, result: updated.result, fileId: updated.fileId },
        reason: input.note?.trim() || null,
      },
      ctx,
      tx,
    );

    const recipients = new Set<string>(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)));
    if (gate.caseRow.studentUserId) recipients.add(gate.caseRow.studentUserId);
    recipients.delete(actor.id);
    for (const userId of recipients) {
      await notify(
        {
          userId,
          kind: `committee.${input.status}`,
          titleFa: `جلسهٔ کمیسیون — ${input.status === "held" ? "برگزار شد" : "لغو شد"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: ${input.status === "held" ? `نتیجه: ${input.result}` : "جلسه لغو شد"}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export async function listFinanceRecords(caseId: string) {
  const rows = await db.select().from(financeRecords).where(eq(financeRecords.caseId, caseId)).orderBy(desc(financeRecords.createdAt));
  const ids = [...new Set(rows.map((r) => r.settledBy).filter((id): id is string => Boolean(id)))];
  const names = ids.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
  return rows.map((r) => ({ ...r, settledByName: r.settledBy ? nameOf.get(r.settledBy) ?? null : null }));
}

export interface FinanceInput {
  kind: string;
  amount: number;
  note?: string | null;
  receiptFileId?: string | null;
}

export async function createFinanceRecord(caseId: string, actor: Actor, input: FinanceInput, ctx: RequestContext) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "ثبت رکورد مالی برای نقش شما مجاز نیست.");
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new AppError(400, "INVALID_AMOUNT", "مبلغ معتبر نیست.");
  const currency = await getSettingValue("finance.currency");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(financeRecords)
      .values({
        caseId,
        kind: input.kind,
        amount: Math.round(input.amount),
        currency,
        status: "pending",
        receiptFileId: input.receiptFileId ?? null,
        note: input.note?.trim() || null,
        createdBy: actor.id,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: "finance_recorded",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `ثبت رکورد مالی (${created.kind}) به مبلغ ${created.amount} ${currency}`,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "finance.recorded",
        entityType: "finance_record",
        entityId: created.id,
        after: { caseId, kind: created.kind, amount: created.amount, currency, status: created.status },
      },
      ctx,
      tx,
    );
    return created;
  });
}

export async function settleFinanceRecord(
  caseId: string,
  recordId: string,
  actor: Actor,
  input: { status: "paid" | "waived"; reason?: string | null; receiptFileId?: string | null },
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.access.permissions.has("cases.review_topic")) {
    throw new AppError(403, "FORBIDDEN", "تسویهٔ رکورد مالی برای نقش شما مجاز نیست.");
  }
  if (input.status !== "paid" && input.status !== "waived") {
    throw new AppError(400, "INVALID_STATUS", "وضعیت تسویه باید «پرداخت شد» یا «معاف شد» باشد.");
  }
  if (input.status === "waived" && (input.reason?.trim().length ?? 0) < 5) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای معافیت مالی الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(financeRecords)
      .where(and(eq(financeRecords.id, recordId), eq(financeRecords.caseId, caseId)))
      .for("update")
      .limit(1);
    if (!row) throw new AppError(404, "FINANCE_NOT_FOUND", "رکورد مالی یافت نشد.");
    if (row.status !== "pending") throw new AppError(409, "INVALID_STATUS", "این رکورد قبلاً تسویه شده است.");
    if (input.status === "paid" && !input.receiptFileId && !row.receiptFileId) {
      throw new AppError(400, "RECEIPT_REQUIRED", "بارگذاری رسید پرداخت الزامی است.");
    }

    const now = new Date();
    const [updated] = await tx
      .update(financeRecords)
      .set({
        status: input.status,
        paidAt: input.status === "paid" ? now : null,
        receiptFileId: input.receiptFileId ?? row.receiptFileId,
        settleReason: input.reason?.trim() || null,
        settledBy: actor.id,
        settledAt: now,
      })
      .where(eq(financeRecords.id, recordId))
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `finance_${input.status}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `رکورد مالی ${row.kind} — ${input.status === "paid" ? "پرداخت شد" : "معاف شد"}`,
      reason: input.reason?.trim() || null,
    });
    await recordAudit(
      {
        actorUserId: actor.id,
        action: `finance.${input.status}`,
        entityType: "finance_record",
        entityId: recordId,
        before: { status: row.status, receiptFileId: row.receiptFileId },
        after: { status: updated.status, receiptFileId: updated.receiptFileId },
        reason: input.reason?.trim() || null,
      },
      ctx,
      tx,
    );

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: `finance.${input.status}`,
          titleFa: `وضعیت مالی — ${input.status === "paid" ? "پرداخت ثبت شد" : "معافیت ثبت شد"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: ${row.kind} به مبلغ ${row.amount} ${row.currency}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

/** Pending counts used by the dashboards and the review queue. */
export async function pendingAdminCounts() {
  const [extensions] = await db.select({ total: sql<number>`count(*)` }).from(thesisExtensions).where(eq(thesisExtensions.status, "pending"));
  const [meetings] = await db.select({ total: sql<number>`count(*)` }).from(committeeMeetings).where(eq(committeeMeetings.status, "scheduled"));
  const [finances] = await db.select({ total: sql<number>`count(*)` }).from(financeRecords).where(eq(financeRecords.status, "pending"));
  return {
    extensions: Number(extensions?.total ?? 0),
    meetings: Number(meetings?.total ?? 0),
    finances: Number(finances?.total ?? 0),
  };
}
