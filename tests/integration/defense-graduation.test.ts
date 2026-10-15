import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  auditLogs,
  caseClosures,
  committeeMeetings,
  committeeMembers,
  files,
  graduationRecords,
  irandocRecords,
  notifications,
  proposals,
  roles,
  similarityChecks,
  thesisCaseEvents,
  thesisCaseFiles,
  thesisCases,
  thesisExtensions,
  thesisSupervisors,
  thesisVersions,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase } from "@/server/services/case";
import { closeCase, decideGraduation, listGraduationRecords, requestGraduation } from "@/server/services/graduation";
import { createCommitteeMeeting, recordCommitteeOutcome } from "@/server/services/thesis-admin";
import { recordSimilarityCheck, saveThesisVersion } from "@/server/services/thesis";
import { storeFile } from "@/server/storage/service";

/**
 * M9 + M10 regression suite — defense gating, graduation and closure.
 * The central invariant: a case cannot be closed and no final defense can be
 * scheduled while the rule engine denies, and the denial carries real Persian
 * reasons that the UI displays verbatim.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.60.70.80", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
let admin: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;

async function makeUser(roleKeys: string[]) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m9-${suffix}-${uniq}`,
      email: `m9-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M9 ${uniq}`,
      passwordHash: await hashPassword("Test-M9-2026"),
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

async function attachThesisFile(caseId: string, name: string) {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(`defense ${name}\n`), Buffer.from("%%EOF\n")]);
  const stored = await storeFile({ data: pdf, originalName: name });
  const [row] = await db
    .insert(files)
    .values({
      ownerUserId: student.id,
      purpose: "thesis",
      originalName: name,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      status: "active",
    })
    .returning({ id: files.id });
  await db.insert(thesisCaseFiles).values({ caseId, fileId: row.id, purpose: "thesis", uploadedBy: student.id });
  return row.id;
}

async function makeCase() {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(admin, { studentFullName: `دانشجوی M9 ${uniq}`, studentUserId: student.id, department: `گروه آزمون M9 ${uniq}` }, ctx);
  createdCaseIds.push(tc.id);
  await db.insert(thesisSupervisors).values({ caseId: tc.id, userId: admin.id, supervisorName: "استاد راهنمای M9", roleType: "supervisor", status: "active" });
  await db.update(thesisCases).set({ titleFa: "عنوان پایان‌نامهٔ آزمون M9", currentStatus: "THESIS_ACTIVE" }).where(eq(thesisCases.id, tc.id));
  return tc;
}

/** Brings a case to the state the rule engine considers ready for graduation. */
async function makeReadyCase() {
  const tc = await makeCase();
  await db.insert(proposals).values({ caseId: tc.id, version: 1, isActive: true, status: "approved", titleFa: "پروپوزال مصوب", approvedAt: new Date(Date.now() - 200 * 86_400_000), createdBy: student.id, approvedBy: admin.id });
  await db.insert(irandocRecords).values({ caseId: tc.id, trackingCode: `IR-M9-${randomBytes(3).toString("hex")}`, status: "approved", submittedBy: student.id, reviewedBy: admin.id, reviewedAt: new Date() });
  const fileId = await attachThesisFile(tc.id, "thesis-final.pdf");
  await saveThesisVersion(tc.id, student, { fileId, titleFa: "نسخهٔ نهایی پایان‌نامه" }, ctx);
  // A readiness verdict also requires a passing similarity check (M8).
  await recordSimilarityCheck(tc.id, admin, { similarityPercent: 9, reportId: "SIM-M9-READY" }, ctx);
  return tc;
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(caseClosures).where(inArray(caseClosures.caseId, createdCaseIds));
    await db.delete(graduationRecords).where(inArray(graduationRecords.caseId, createdCaseIds));
    await db.delete(committeeMembers).where(inArray(committeeMembers.meetingId, db.select({ id: committeeMeetings.id }).from(committeeMeetings).where(inArray(committeeMeetings.caseId, createdCaseIds))));
    await db.delete(committeeMeetings).where(inArray(committeeMeetings.caseId, createdCaseIds));
    await db.delete(similarityChecks).where(inArray(similarityChecks.caseId, createdCaseIds));
    await db.delete(thesisExtensions).where(inArray(thesisExtensions.caseId, createdCaseIds));
    await db.delete(notifications).where(inArray(notifications.caseId, createdCaseIds));
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(thesisVersions).where(inArray(thesisVersions.caseId, createdCaseIds));
    const fileIds = await db.select({ id: thesisCaseFiles.fileId }).from(thesisCaseFiles).where(inArray(thesisCaseFiles.caseId, createdCaseIds));
    await db.delete(thesisCaseFiles).where(inArray(thesisCaseFiles.caseId, createdCaseIds));
    await db.delete(proposals).where(inArray(proposals.caseId, createdCaseIds));
    await db.delete(irandocRecords).where(inArray(irandocRecords.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
    if (fileIds.length) await db.delete(files).where(inArray(files.id, fileIds.map((f) => f.id)));
  }
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("defense gate (M9)", () => {
  it("refuses a final defense while the rule engine denies, with real Persian reasons", async () => {
    const tc = await makeCase();
    const denial = await createCommitteeMeeting(
      tc.id,
      admin,
      { meetingType: "final_defense", scheduledAt: new Date().toISOString(), members: [{ fullName: "عضو یک", roleType: "internal" }, { fullName: "عضو دو", roleType: "external" }, { fullName: "عضو سه", roleType: "chair" }] },
      ctx,
    ).catch((err: unknown) => err);
    expect(denial).toBeInstanceOf(AppError);
    const message = (denial as Error).message;
    expect(message).toContain("ایرانداک");
    expect(message.length).toBeGreaterThan(10);
  });

  it("schedules and closes a final defense once the case is ready", async () => {
    const tc = await makeReadyCase();
    const meeting = await createCommitteeMeeting(
      tc.id,
      admin,
      {
        meetingType: "final_defense",
        scheduledAt: new Date().toISOString(),
        location: "سالن دفاع دانشکده",
        members: [
          { userId: admin.id, roleType: "chair", isPresent: true },
          { fullName: "داور داخلی آزمون", roleType: "internal", isPresent: true },
          { fullName: "داور خارجی آزمون", roleType: "external", isPresent: true },
        ],
      },
      ctx,
    );
    const held = await recordCommitteeOutcome(
      tc.id,
      meeting.id,
      admin,
      { status: "held", result: "passed", minutesFa: "جلسهٔ دفاع با حضور اعضا برگزار و پایان‌نامه پذیرفته شد.", attendance: meeting.members.map((m) => ({ memberId: m.id, isPresent: true })) },
      ctx,
    );
    expect(held.result).toBe("passed");
  });
});

describe("graduation and closure (M10)", () => {
  it("refuses the request while the case is incomplete, then accepts it when ready", async () => {
    const incomplete = await makeCase();
    await expect(requestGraduation(incomplete.id, student, {}, ctx)).rejects.toThrow(AppError);

    const ready = await makeReadyCase();
    const created = await requestGraduation(ready.id, student, { note: "تکمیل مراحل پژوهشی و آمادهٔ فارغ‌التحصیلی." }, ctx);
    expect(created.status).toBe("requested");

    // A second request while one is pending is refused.
    await expect(requestGraduation(ready.id, student, {}, ctx)).rejects.toThrow(AppError);

    await expect(decideGraduation(ready.id, created.id, admin, "reject", "کم", ctx)).rejects.toThrow(AppError);
    const approved = await decideGraduation(ready.id, created.id, admin, "approve", "تأیید نهایی فارغ‌التحصیلی بر اساس بررسی پرونده.", ctx);
    expect(approved.status).toBe("approved");

    const listed = await listGraduationRecords(ready.id);
    expect(listed.records[0].decidedByName).toBe(admin.fullName);
  });

  it("closes the case only with a reason and keeps the rule snapshot", async () => {
    const tc = await makeReadyCase();
    // A held, passed final-defense session is part of the readiness facts.
    const meeting = await createCommitteeMeeting(
      tc.id,
      admin,
      {
        meetingType: "final_defense",
        scheduledAt: new Date().toISOString(),
        members: [
          { userId: admin.id, roleType: "chair", isPresent: true },
          { fullName: "داور داخلی آزمون دوم", roleType: "internal", isPresent: true },
          { fullName: "داور خارجی آزمون دوم", roleType: "external", isPresent: true },
        ],
      },
      ctx,
    );
    await recordCommitteeOutcome(
      tc.id,
      meeting.id,
      admin,
      { status: "held", result: "passed", minutesFa: "صورت‌جلسهٔ دفاع نهایی با تأیید همهٔ اعضا ثبت شد.", attendance: meeting.members.map((m) => ({ memberId: m.id, isPresent: true })) },
      ctx,
    );

    const request = await requestGraduation(tc.id, student, {}, ctx);
    await decideGraduation(tc.id, request.id, admin, "approve", "تأیید فارغ‌التحصیلی برای بستن پرونده.", ctx);

    await expect(closeCase(tc.id, admin, "کم", ctx)).rejects.toThrow(AppError);
    const closure = await closeCase(tc.id, admin, "بستن پرونده پس از تأیید کامل فارغ‌التحصیلی.", ctx);
    expect(closure.closedBy).toBe(admin.id);
    expect((closure.ruleSnapshot as { allowed: boolean }).allowed).toBe(true);

    // A closed case can never be closed twice.
    await expect(closeCase(tc.id, admin, "تلاش دوباره برای بستن پرونده.", ctx)).rejects.toThrow(AppError);
  });

  it("refuses closure while a finance row is still pending", async () => {
    const tc = await makeReadyCase();
    const [admin2] = await db.select({ id: users.id }).from(users).where(eq(users.id, admin.id)).limit(1);
    expect(admin2.id).toBe(admin.id);
    const { createFinanceRecord } = await import("@/server/services/thesis-admin");
    await createFinanceRecord(tc.id, admin, { kind: "defense_fee", amount: 5_000_000 }, ctx);
    const request = await requestGraduation(tc.id, student, {}, ctx);
    await decideGraduation(tc.id, request.id, admin, "approve", "تأیید فارغ‌التحصیلی پیش از تسویهٔ مالی برای آزمون.", ctx);
    const denial = await closeCase(tc.id, admin, "تلاش برای بستن با مالی تسویه‌نشده.", ctx).catch((err: unknown) => err);
    expect(denial).toBeInstanceOf(AppError);
    expect((denial as Error).message).toContain("مالی");
    void similarityChecks; // the table stays part of the suite's cleanup contract
  });

  it("refuses graduation decisions to a user without the review permission", async () => {
    const tc = await makeReadyCase();
    const request = await requestGraduation(tc.id, student, {}, ctx);
    await expect(decideGraduation(tc.id, request.id, student, "approve", null, ctx)).rejects.toThrow(AppError);
    await expect(closeCase(tc.id, student, "تلاش دانشجو برای بستن پرونده.", ctx)).rejects.toThrow(AppError);
  });
});
