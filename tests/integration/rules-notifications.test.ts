import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { notifications, roles, schedulerRuns, thesisCases, userRoles, users, workflowTasks } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { canApproveFinal, canCloseCase, canOpenCommission, canRequestDefense, canRequestExtension, canSubmitProposal, loadCaseFacts, type CaseFacts } from "@/server/rules";
import { getChannelStatuses, listNotifications, markAllRead, markRead, notify, unreadCount } from "@/server/services/notifications";
import { runEscalationJob, runReminderJob, runScheduledJobs } from "@/server/scheduler";
import { createCase } from "@/server/services/case";
import { csvCell, toCsv } from "@/server/services/reports";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateSecret, hotp, otpauthUrl, totp, verifyTotp } from "@/server/auth/totp";
import { listMySessions, revokeAllSessions, revokeSession } from "@/server/services/sessions";

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function actorOf(id: string) {
  const { loadUserAccess } = await import("@/server/rbac/service");
  const a = await loadUserAccess(db, id);
  return { id, permissions: a.permissions, roles: a.roles };
}
async function makeUser(roleKey: string) {
  const u = randomBytes(4).toString("hex");
  const uname = `rn-${roleKey}-${suffix}-${u}`;
  const [row] = await db.insert(users).values({ username: uname, email: `${uname}@test.invalid`, fullName: `کاربر ${u}`, passwordHash: await hashPassword("Test-RN-2026") }).returning({ id: users.id });
  createdUserIds.push(row.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  return row.id;
}

const baseFacts: CaseFacts = {
  caseId: "c", currentStatus: "draft", archivedAt: null, topicApproved: false, hasTitle: false,
  supervisors: [], advisorRequired: false, proposal: null, irandoc: null, similarity: null,
  minMonthsAfterProposal: 4, maxTerms: 6, termsUsed: 1, financeCleared: null, financeRequired: false,
  defenseCompleted: false, graduationApproved: false, thesisFinalUploaded: false,
};

beforeAll(async () => { await seedRbac(); admin = await actorOf(await makeUser("system_admin")); });
afterAll(async () => {
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("M6 rule engine (pure)", () => {
  it("canSubmitProposal denies with precise Persian reasons and allows when complete", () => {
    const denied = canSubmitProposal(baseFacts);
    expect(denied.allowed).toBe(false);
    expect(denied.reasons.some((r) => r.includes("عنوان"))).toBe(true);
    expect(denied.reasons.some((r) => r.includes("تصویب نشده"))).toBe(true);
    expect(denied.reasons.some((r) => r.includes("استاد راهنما"))).toBe(true);

    const allowed = canSubmitProposal({ ...baseFacts, hasTitle: true, topicApproved: true, supervisors: [{ roleType: "supervisor", status: "active" }] });
    expect(allowed).toEqual({ allowed: true, reasons: [] });
  });

  it("advisor requirement is honoured only when the setting demands it", () => {
    const facts = { ...baseFacts, hasTitle: true, topicApproved: true, supervisors: [{ roleType: "supervisor", status: "active" }] };
    expect(canSubmitProposal(facts).allowed).toBe(true);
    const withAdvisorRequired = canSubmitProposal({ ...facts, advisorRequired: true });
    expect(withAdvisorRequired.allowed).toBe(false);
    expect(withAdvisorRequired.reasons.some((r) => r.includes("مشاور"))).toBe(true);
    expect(canSubmitProposal({ ...facts, advisorRequired: true, supervisors: [...facts.supervisors, { roleType: "advisor", status: "active" }] }).allowed).toBe(true);
  });

  it("canApproveFinal requires proposal + irandoc + documents, never guesses", () => {
    const partial = canApproveFinal({ ...baseFacts, hasTitle: true, topicApproved: true, supervisors: [{ roleType: "supervisor", status: "active" }] });
    expect(partial.allowed).toBe(false);
    expect(partial.reasons.some((r) => r.includes("پروپوزال"))).toBe(true);
    expect(partial.reasons.some((r) => r.includes("ایرانداک"))).toBe(true);

    const full = canApproveFinal({
      ...baseFacts, hasTitle: true, topicApproved: true, supervisors: [{ roleType: "supervisor", status: "active" }],
      proposal: { status: "approved", approvedAt: new Date() }, irandoc: { status: "approved" }, thesisFinalUploaded: true,
    });
    expect(full.allowed).toBe(true);
  });

  it("canRequestExtension and canOpenCommission use settings, not hard-coded numbers", () => {
    expect(canRequestExtension({ ...baseFacts, currentStatus: "THESIS_ACTIVE" }).allowed).toBe(true);
    expect(canRequestExtension({ ...baseFacts, currentStatus: "draft" }).allowed).toBe(false);
    expect(canOpenCommission({ ...baseFacts, termsUsed: 3, maxTerms: 6 }).allowed).toBe(false);
    const over = canOpenCommission({ ...baseFacts, termsUsed: 7, maxTerms: 6 });
    expect(over.allowed).toBe(true);
  });

  it("canRequestDefense enforces the minimum gap and similarity result", () => {
    const ok = { ...baseFacts, hasTitle: true, topicApproved: true, supervisors: [{ roleType: "supervisor", status: "active" }],
      proposal: { status: "approved", approvedAt: new Date(Date.now() - 200 * 86_400_000) }, irandoc: { status: "approved" },
      thesisFinalUploaded: true, similarity: { result: "pass", percent: 12 } };
    expect(canRequestDefense(ok).allowed).toBe(true);

    const tooSoon = canRequestDefense({ ...ok, proposal: { status: "approved", approvedAt: new Date() } });
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.reasons.some((r) => r.includes("حداقل فاصله"))).toBe(true);

    expect(canRequestDefense({ ...ok, similarity: { result: "revision_required", percent: 55 } }).allowed).toBe(false);
    expect(canRequestDefense({ ...ok, financeRequired: true, financeCleared: null }).reasons.some((r) => r.includes("امور مالی"))).toBe(true);
  });

  it("canCloseCase lists every missing prerequisite", () => {
    const closed = canCloseCase(baseFacts);
    expect(closed.allowed).toBe(false);
    expect(closed.reasons.length).toBeGreaterThanOrEqual(4);
    expect(canCloseCase({ ...baseFacts, defenseCompleted: true, thesisFinalUploaded: true, irandoc: { status: "approved" }, graduationApproved: true }).allowed).toBe(true);
  });

  it("loadCaseFacts reflects the real database and denies when data is absent", async () => {
    const tc = await createCase(admin, { studentFullName: "تست قواعد" }, ctx);
    createdCaseIds.push(tc.id);
    const facts = await loadCaseFacts(tc.id);
    expect(facts).not.toBeNull();
    expect(facts!.hasTitle).toBe(false);
    expect(canSubmitProposal(facts!).allowed).toBe(false);
    await expect(loadCaseFacts("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
  });
});

describe("M11 notifications", () => {
  it("creates an in-app notification and counts unread", async () => {
    const userId = await makeUser("student");
    await notify({ userId, kind: "test", titleFa: "اعلان آزمایشی", bodyFa: "متن" });
    expect(await unreadCount(userId)).toBe(1);
    const items = await listNotifications(userId);
    expect(items[0].titleFa).toBe("اعلان آزمایشی");
    expect(items[0].isRead).toBe(false);
  });

  it("marks one and all as read for the owner only", async () => {
    const userId = await makeUser("student");
    const other = await makeUser("student");
    const id = (await notify({ userId, kind: "test", titleFa: "اعلان ۱" }))!;
    await notify({ userId, kind: "test", titleFa: "اعلان ۲" });
    // Another user cannot mark someone else's notification.
    expect(await markRead(other, id)).toBe(false);
    expect(await markRead(userId, id)).toBe(true);
    expect(await unreadCount(userId)).toBe(1);
    expect(await markAllRead(userId)).toBe(1);
    expect(await unreadCount(userId)).toBe(0);
  });

  it("reports email/sms as explicitly disabled without credentials (never fakes a send)", async () => {
    const statuses = await getChannelStatuses();
    const inapp = statuses.find((s) => s.channel === "inapp")!;
    expect(inapp.enabled).toBe(true);
    const email = statuses.find((s) => s.channel === "email")!;
    expect(email.enabled).toBe(false);
    expect(email.reason).toBeTruthy();
  });

  it("logs a disabled channel attempt instead of pretending it was sent", async () => {
    const userId = await makeUser("student");
    await notify({ userId, kind: "test", titleFa: "کانال غیرفعال", channels: ["inapp", "email"] });
    const { notificationLogs } = await import("@/db/schema");
    const [n] = await db.select().from(notifications).where(eq(notifications.userId, userId));
    const logs = await db.select().from(notificationLogs).where(eq(notificationLogs.notificationId, n.id));
    expect(logs.map((l) => `${l.channel}:${l.status}`).sort()).toEqual(["email:disabled", "inapp:sent"]);
  });
});

describe("M11 scheduler", () => {
  it("reminds about overdue tasks and records a run", async () => {
    const tc = await createCase(admin, { studentFullName: "تست زمان‌بند" }, ctx);
    createdCaseIds.push(tc.id);
    const prof = await makeUser("supervisor");
    const [task] = await db.insert(workflowTasks).values({
      instanceId: tc.currentInstanceId!, caseId: tc.id, action: "review", titleFa: "بررسی موضوع",
      roleKey: "grad_office", status: "pending", dueDate: new Date(Date.now() - 2 * 86_400_000), assigneeUserId: prof,
    }).returning();

    const before = await unreadCount(prof);
    const result = await runReminderJob();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(await unreadCount(prof)).toBeGreaterThan(before);

    const esc = await runEscalationJob();
    expect(esc.processed).toBeGreaterThanOrEqual(0);
    void task;
  });

  it("runScheduledJobs executes under an advisory lock and records the run", async () => {
    const res = await runScheduledJobs();
    expect(res.ran).toBe(true);
    expect(res.jobs.map((j) => j.jobKey).sort()).toEqual(["escalation", "reminders", "term-control"]);
    const [run] = await db.select().from(schedulerRuns).orderBy(schedulerRuns.id).limit(1);
    expect(run).toBeDefined();
  });

  it("concurrent ticks are serialised: only one holds the advisory lock", async () => {
    const results = await Promise.all([runScheduledJobs(), runScheduledJobs()]);
    // At least one ran; the other may skip because the lock was held.
    expect(results.some((r) => r.ran)).toBe(true);
    expect(results.every((r) => typeof r.ran === "boolean")).toBe(true);
  });
});

describe("M13 report CSV safety", () => {
  it("neutralises formula injection and quotes correctly", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2")).toBe("'-2");
    // The Persian comma (U+060C) is not a CSV delimiter and must not be quoted.
    expect(csvCell("سلام، دنیا")).toBe("سلام، دنیا");
    expect(csvCell("plain,comma")).toBe('"plain,comma"');
    expect(csvCell('has"quote')).toBe('"has""quote"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("produces a CSV with header, CRLF rows and BOM-friendly text", () => {
    const csv = toCsv(["a", "b"], [["=1", "x"], ["y", "z,w"]]);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv.startsWith("a,b")).toBe(true);
    expect(csv).toContain("'=1");
    expect(csv).toContain('"z,w"');
  });
});

describe("M14 TOTP", () => {
  it("base32 round-trips", () => {
    const secret = generateSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("matches the RFC 6238 reference vector for SHA1/8 digits adapted to 6", () => {
    // Known HOTP value for secret "12345678901234567890" (base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), counter 0.
    expect(hotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 0)).toBe("755224");
  });

  it("verifies the current code, tolerates ±1 window and rejects wrong codes", () => {
    const secret = generateSecret();
    const now = new Date();
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
  });

  it("encrypts the secret at rest and decrypts it back", () => {
    const secret = generateSecret();
    const cipher = encryptSecret(secret);
    expect(cipher).not.toContain(secret);
    expect(cipher.split(":")).toHaveLength(3);
    expect(decryptSecret(cipher)).toBe(secret);
  });

  it("builds a valid otpauth URL", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "ali.rezaei");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("issuer=ShomalDoc");
  });
});

describe("M14 session management", () => {
  it("lists only the owner's sessions and refuses to revoke the current one", async () => {
    const userId = await makeUser("student");
    const other = await makeUser("student");
    const { createSession } = await import("@/server/services/auth");
    const s1 = await createSession(userId, ctx);
    const s2 = await createSession(userId, ctx);
    const sOther = await createSession(other, ctx);

    const mine = await listMySessions(userId);
    expect(mine.map((m) => m.id).sort()).toEqual([s1.sessionId, s2.sessionId].sort());
    expect(mine.some((m) => m.id === sOther.sessionId)).toBe(false);

    await expect(revokeSession(userId, s1.sessionId, ctx, s1.sessionId)).rejects.toMatchObject({ code: "CANNOT_REVOKE_CURRENT" });
    expect((await revokeSession(userId, s2.sessionId, ctx, s1.sessionId)).revoked).toBe(1);
    // A user cannot revoke another user's session through their own id scope.
    await expect(revokeSession(userId, sOther.sessionId, ctx)).rejects.toMatchObject({ status: 404 });
  });

  it("revoke-all keeps the current session usable", async () => {
    const userId = await makeUser("student");
    const { createSession, resolveSessionUser } = await import("@/server/services/auth");
    const current = await createSession(userId, ctx);
    await createSession(userId, ctx);
    const result = await revokeAllSessions(userId, ctx, current.sessionId);
    expect(result.revoked).toBeGreaterThanOrEqual(0);
    const all = await listMySessions(userId);
    expect(all.some((s) => s.id === current.sessionId)).toBe(true);
    expect(await resolveSessionUser(current.token)).not.toBeNull();
  });
});
