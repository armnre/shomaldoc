import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { auditLogs, irandocRecords, notifications, proposals, roles, thesisCaseEvents, thesisCases, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase } from "@/server/services/case";
import { decideIrandocRecord, listIrandocRecords, listIrandocReviewQueue, submitIrandocRecord } from "@/server/services/irandoc";

/**
 * M6 regression suite — internal IranDoc registration.
 * Success, rejection (mandatory reason) and unauthorised paths, plus the journey
 * guard: a case whose proposal is not approved cannot register IranDoc at all.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.14.15.16", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
let admin: { id: string; fullName: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let student: { id: string; fullName: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function makeUser(roleKeys: string[]) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m6-${suffix}-${uniq}`,
      email: `m6-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M6 ${uniq}`,
      passwordHash: await hashPassword("Test-M6-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  for (const key of roleKeys) {
    const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  }
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, row.id);
  return { id: row.id, fullName: `کاربر M6 ${uniq}`, permissions: access.permissions, roles: access.roles };
}

async function makeCase(withApprovedProposal: boolean) {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(admin, { studentFullName: `دانشجوی M6 ${uniq}`, studentUserId: student.id, department: `گروه آزمون M6 ${uniq}` }, ctx);
  createdCaseIds.push(tc.id);
  if (withApprovedProposal) {
    await db.insert(proposals).values({ caseId: tc.id, version: 1, isActive: true, status: "approved", titleFa: "پروپوزال مصوب آزمون ایرانداک", createdBy: student.id, approvedBy: admin.id, approvedAt: new Date() });
  }
  return tc;
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(irandocRecords).where(inArray(irandocRecords.caseId, createdCaseIds));
    await db.delete(notifications).where(inArray(notifications.caseId, createdCaseIds));
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(proposals).where(inArray(proposals.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("internal irandoc workflow", () => {
  it("registers a tracking code and the graduate office approves it", async () => {
    const tc = await makeCase(true);
    const created = await submitIrandocRecord(tc.id, student, { trackingCode: "IR-1402-000123", registeredAt: "2026-01-20" }, ctx);
    expect(created.status).toBe("submitted");
    expect(created.submittedBy).toBe(student.id);

    const approved = await decideIrandocRecord(tc.id, created.id, admin, "approve", null, ctx);
    expect(approved.status).toBe("approved");
    expect(approved.reviewedBy).toBe(admin.id);
    expect(approved.reviewedAt).toBeInstanceOf(Date);

    const records = await listIrandocRecords(tc.id);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("approved");
    expect(records[0].reviewedByName).toBe(admin.fullName);

    // The student is told the outcome, and the case timeline carries the event.
    const notes = await db.select().from(notifications).where(eq(notifications.caseId, tc.id));
    expect(notes.some((n) => n.kind === "irandoc.approved" && n.userId === student.id)).toBe(true);
    const events = await db.select().from(thesisCaseEvents).where(eq(thesisCaseEvents.caseId, tc.id));
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["irandoc_submitted", "irandoc_approved"]));

    // A second approval of the same record is impossible.
    await expect(decideIrandocRecord(tc.id, created.id, admin, "approve", null, ctx)).rejects.toThrow(AppError);
  });

  it("demands a reason for a rejection and stores it", async () => {
    const tc = await makeCase(true);
    const created = await submitIrandocRecord(tc.id, student, { trackingCode: "IR-1402-000124", registeredAt: null }, ctx);

    await expect(decideIrandocRecord(tc.id, created.id, admin, "reject", "کم", ctx)).rejects.toThrow(AppError);
    const rejected = await decideIrandocRecord(tc.id, created.id, admin, "reject", "کد پیگیری با رسید بارگذاری‌شده مطابقت ندارد.", ctx);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toContain("مطابقت ندارد");

    // The record is kept (never deleted) so the history stays auditable.
    expect(await listIrandocRecords(tc.id)).toHaveLength(1);
  });

  it("denies the review to a user without the review permission", async () => {
    const tc = await makeCase(true);
    const created = await submitIrandocRecord(tc.id, student, { trackingCode: "IR-1402-000125", registeredAt: null }, ctx);
    await expect(decideIrandocRecord(tc.id, created.id, student, "approve", null, ctx)).rejects.toThrow(AppError);
  });

  it("shows only pending registrations in the reviewer queue", async () => {
    const tc = await makeCase(true);
    const other = await makeCase(true);
    const pending = await submitIrandocRecord(tc.id, student, { trackingCode: "IR-1402-000127", registeredAt: null }, ctx);
    const toApprove = await submitIrandocRecord(other.id, student, { trackingCode: "IR-1402-000128", registeredAt: null }, ctx);
    await decideIrandocRecord(other.id, toApprove.id, admin, "approve", null, ctx);

    const queue = await listIrandocReviewQueue(200);
    const mine = queue.filter((row) => row.caseId === tc.id || row.caseId === other.id);
    expect(mine.map((row) => row.trackingCode)).toEqual(["IR-1402-000127"]);
    expect(mine[0].caseNumber).toBe(tc.caseNumber);
    expect(mine[0].studentName).toBe(student.fullName);
    expect(queue.every((row) => row.id !== toApprove.id)).toBe(true);
    expect(pending.status).toBe("submitted");
  });

  it("refuses registration before the proposal is approved", async () => {
    const tc = await makeCase(false);
    await expect(submitIrandocRecord(tc.id, student, { trackingCode: "IR-1402-000126", registeredAt: null }, ctx)).rejects.toThrow(AppError);
    expect(await listIrandocRecords(tc.id)).toHaveLength(0);
  });
});
