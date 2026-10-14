import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  auditLogs,
  committeeMeetings,
  committeeMembers,
  financeRecords,
  notifications,
  roles,
  thesisCaseEvents,
  thesisCases,
  thesisExtensions,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase } from "@/server/services/case";
import {
  createCommitteeMeeting,
  createFinanceRecord,
  decideExtension,
  listCommitteeMeetings,
  listExtensions,
  listFinanceRecords,
  recordCommitteeOutcome,
  requestExtension,
  settleFinanceRecord,
} from "@/server/services/thesis-admin";
import { updateSetting } from "@/server/services/settings";

/**
 * M7 regression suite — extension, committee and finance.
 * Each block covers success, rejection (mandatory reason / quorum / cap) and the
 * unauthorised path, plus the audit trail.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.20.30.40", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];

async function makeUser(roleKeys: string[]) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m7-${suffix}-${uniq}`,
      email: `m7-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M7 ${uniq}`,
      passwordHash: await hashPassword("Test-M7-2026"),
    })
    .returning({ id: users.id, fullName: users.fullName });
  createdUserIds.push(row.id);
  for (const key of roleKeys) {
    const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  }
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, row.id);
  return { id: row.id, fullName: row.fullName, permissions: access.permissions, roles: access.roles };
}

let admin: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;

async function makeCase() {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(admin, { studentFullName: `دانشجوی M7 ${uniq}`, studentUserId: student.id, department: `گروه آزمون M7 ${uniq}` }, ctx);
  createdCaseIds.push(tc.id);
  return tc;
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(committeeMembers).where(
      inArray(
        committeeMembers.meetingId,
        db.select({ id: committeeMeetings.id }).from(committeeMeetings).where(inArray(committeeMeetings.caseId, createdCaseIds)),
      ),
    );
    await db.delete(committeeMeetings).where(inArray(committeeMeetings.caseId, createdCaseIds));
    await db.delete(financeRecords).where(inArray(financeRecords.caseId, createdCaseIds));
    await db.delete(thesisExtensions).where(inArray(thesisExtensions.caseId, createdCaseIds));
    await db.delete(notifications).where(inArray(notifications.caseId, createdCaseIds));
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("term extension", () => {
  it("accepts a reasoned request and lets the graduate office approve it", async () => {
    const tc = await makeCase();
    const created = await requestExtension(tc.id, student, { requestedTerms: 1, reason: "تأخیر در گردآوری داده‌های میدانی پژوهش." }, ctx);
    expect(created.status).toBe("pending");

    const approved = await decideExtension(tc.id, created.id, admin, "approve", null, ctx);
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe(admin.id);

    const rows = await listExtensions(tc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].decidedByName).toBe(admin.fullName);

    const audits = await db.select().from(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["extension.requested", "extension.approved"]));

    // A decided request can never be decided twice.
    await expect(decideExtension(tc.id, created.id, admin, "reject", "دلیل آزمون رد دوباره", ctx)).rejects.toThrow(AppError);
  });

  it("requires a reason for the request and for a rejection", async () => {
    const tc = await makeCase();
    await expect(requestExtension(tc.id, student, { requestedTerms: 1, reason: "کم" }, ctx)).rejects.toThrow(AppError);

    const created = await requestExtension(tc.id, student, { requestedTerms: 2, reason: "نیاز به دو ترم اضافه برای دفاع." }, ctx);
    await expect(decideExtension(tc.id, created.id, admin, "reject", "کم", ctx)).rejects.toThrow(AppError);
    const rejected = await decideExtension(tc.id, created.id, admin, "reject", "پیشرفت پژوهشی کافی نیست و نیاز به بازنگری دارد.", ctx);
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionReason).toContain("پیشرفت");
  });

  it("denies the decision to a user without the review permission", async () => {
    const tc = await makeCase();
    const created = await requestExtension(tc.id, student, { requestedTerms: 1, reason: "درخواست تمدید برای آزمون دسترسی." }, ctx);
    await expect(decideExtension(tc.id, created.id, student, "approve", null, ctx)).rejects.toThrow(AppError);
  });

  it("enforces the configured cap on granted extension terms", async () => {
    const tc = await makeCase();
    const first = await requestExtension(tc.id, student, { requestedTerms: 2, reason: "درخواست تمدید دو ترم برای تکمیل آزمایش‌ها." }, ctx);
    await decideExtension(tc.id, first.id, admin, "approve", null, ctx);

    const second = await requestExtension(tc.id, student, { requestedTerms: 2, reason: "درخواست تمدید بیشتر برای نگارش نهایی." }, ctx);
    await expect(decideExtension(tc.id, second.id, admin, "approve", null, ctx)).rejects.toThrow(AppError);
    // The denial message names the real configured cap.
    const cap = (await import("@/server/services/settings")).SETTING_DEFS["extension.maxExtraTerms"].defaultValue;
    const denial = await decideExtension(tc.id, second.id, admin, "approve", null, ctx).catch((err: unknown) => err);
    expect(denial).toBeInstanceOf(AppError);
    expect((denial as Error).message).toContain(String(cap));

    // Raising the setting through the audited settings service unblocks it — no code change.
    await updateSetting(admin, "extension.maxExtraTerms", 6, "افزایش سقف تمدید برای آزمون", ctx);
    const granted = await decideExtension(tc.id, second.id, admin, "approve", null, ctx);
    expect(granted.status).toBe("approved");
    await updateSetting(admin, "extension.maxExtraTerms", 2, "بازگرداندن سقف تمدید به مقدار پیش‌فرض", ctx);
  });
});

describe("committee meetings", () => {
  it("schedules a session, records the minutes and notifies the committee", async () => {
    const tc = await makeCase();
    const created = await createCommitteeMeeting(
      tc.id,
      admin,
      {
        meetingType: "pre_defense",
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        location: "سالن جلسات دانشکده",
        members: [
          { userId: admin.id, roleType: "chair", isPresent: true },
          { fullName: "استاد داور داخلی آزمون", roleType: "internal", isPresent: true },
          { fullName: "استاد داور خارجی آزمون", roleType: "external", isPresent: true },
        ],
      },
      ctx,
    );
    expect(created.status).toBe("scheduled");
    expect(created.members).toHaveLength(3);

    const outcome = await recordCommitteeOutcome(
      tc.id,
      created.id,
      admin,
      { status: "held", result: "passed", minutesFa: "جلسه با حضور همهٔ اعضا برگزار و دفاع پذیرفته شد." },
      ctx,
    );
    expect(outcome.status).toBe("held");
    expect(outcome.result).toBe("passed");
    expect(outcome.heldAt).toBeInstanceOf(Date);

    const notes = await db.select().from(notifications).where(eq(notifications.caseId, tc.id));
    expect(notes.some((n) => n.kind === "committee.scheduled")).toBe(true);
    expect(notes.some((n) => n.userId === student.id)).toBe(true);
  });

  it("rejects a session below the quorum or without minutes (and without members at all)", async () => {
    const tc = await makeCase();
    await expect(
      createCommitteeMeeting(tc.id, admin, { meetingType: "pre_defense", scheduledAt: new Date().toISOString(), members: [{ fullName: "عضو تنها", roleType: "internal" }] }, ctx),
    ).rejects.toThrow(AppError);

    // A pre-defense session is not gated by the defense rule (that gate belongs to the
    // final defense and is covered by the M9 suite); this test targets quorum and minutes.
    const meeting = await createCommitteeMeeting(
      tc.id,
      admin,
      {
        meetingType: "pre_defense",
        scheduledAt: new Date().toISOString(),
        members: [
          { userId: admin.id, roleType: "chair", isPresent: false },
          { fullName: "داور دوم آزمون", roleType: "internal", isPresent: false },
          { fullName: "داور سوم آزمون", roleType: "external", isPresent: false },
        ],
      },
      ctx,
    );
    // Missing minutes and a result.
    await expect(recordCommitteeOutcome(tc.id, meeting.id, admin, { status: "held", result: "passed" }, ctx)).rejects.toThrow(AppError);
    // Minutes present but nobody attended → quorum not met.
    await expect(
      recordCommitteeOutcome(tc.id, meeting.id, admin, { status: "held", result: "passed", minutesFa: "صورت‌جلسهٔ آزمون با جزئیات کامل جلسه." }, ctx),
    ).rejects.toThrow(AppError);

    const attendance = meeting.members.map((m) => ({ memberId: m.id, isPresent: true }));
    const held = await recordCommitteeOutcome(
      tc.id,
      meeting.id,
      admin,
      { status: "held", result: "revision_required", minutesFa: "صورت‌جلسهٔ آزمون با جزئیات کامل جلسه و اصلاحات لازم.", attendance },
      ctx,
    );
    expect(held.result).toBe("revision_required");
    const listed = await listCommitteeMeetings(tc.id);
    expect(listed[0].members.every((m) => m.isPresent)).toBe(true);
  });

  it("denies scheduling to a user without the review permission", async () => {
    const tc = await makeCase();
    await expect(
      createCommitteeMeeting(tc.id, student, { meetingType: "pre_defense", scheduledAt: new Date().toISOString(), members: [{ fullName: "عضو", roleType: "internal" }] }, ctx),
    ).rejects.toThrow(AppError);
  });
});

describe("finance records", () => {
  it("records a fee, requires a receipt for payment and keeps the history", async () => {
    const tc = await makeCase();
    const created = await createFinanceRecord(tc.id, admin, { kind: "defense_fee", amount: 12_500_000 }, ctx);
    expect(created.status).toBe("pending");
    expect(created.amount).toBe(12_500_000);
    expect(created.currency).toBe("IRR");

    // Paying without any receipt is refused.
    await expect(settleFinanceRecord(tc.id, created.id, admin, { status: "paid" }, ctx)).rejects.toThrow(AppError);

    const paid = await settleFinanceRecord(tc.id, created.id, admin, { status: "paid", receiptFileId: null }, ctx).catch(() => null);
    expect(paid).toBeNull();

    const waived = await settleFinanceRecord(tc.id, created.id, admin, { status: "waived", reason: "معافیت بر اساس مصوبهٔ هیئت رئیسه دانشگاه." }, ctx);
    expect(waived.status).toBe("waived");
    expect(waived.settledBy).toBe(admin.id);

    const rows = await listFinanceRecords(tc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].settledByName).toBe(admin.fullName);
  });

  it("refuses a waiver without a reason and a settlement without permission", async () => {
    const tc = await makeCase();
    const created = await createFinanceRecord(tc.id, admin, { kind: "extension_fee", amount: 3_000_000 }, ctx);
    await expect(settleFinanceRecord(tc.id, created.id, admin, { status: "waived", reason: "کم" }, ctx)).rejects.toThrow(AppError);
    await expect(settleFinanceRecord(tc.id, created.id, student, { status: "waived", reason: "معافیت آزمایشی برای بررسی دسترسی." }, ctx)).rejects.toThrow(AppError);
    await expect(createFinanceRecord(tc.id, student, { kind: "other", amount: 1_000 }, ctx)).rejects.toThrow(AppError);
  });
});
