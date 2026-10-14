import { randomBytes } from "node:crypto";
import { eq, inArray, and } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { auditLogs, roles, sessions, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { loginWithPassword, resolveSessionUser } from "@/server/services/auth";
import { resetRateLimit } from "@/server/services/rate-limit";
import { recordAudit } from "@/server/services/audit";

const suffix = randomBytes(4).toString("hex");
const username = `auth-test-${suffix}`;
const password = "Login-Test-2026";
const ctx = { ip: `10.9.${suffix.slice(0, 2)}.1`, userAgent: "vitest" };
let userId = "";

async function setup() {
  const [u] = await db
    .insert(users)
    .values({
      username,
      email: `${username}@test.invalid`,
      fullName: "Auth Test",
      passwordHash: await hashPassword(password),
    })
    .returning({ id: users.id });
  userId = u.id;
  const [student] = await db.select().from(roles).where(eq(roles.key, "student"));
  if (student) await db.insert(userRoles).values({ userId, roleId: student.id });
}

afterAll(async () => {
  await resetRateLimit(`login:user:${username}`);
  if (userId) {
    await db.delete(auditLogs).where(eq(auditLogs.actorUserId, userId));
    await db.delete(users).where(inArray(users.id, [userId]));
  }
  await pool.end();
});

describe("login, sessions and audit", () => {
  it("issues a session for valid credentials and records audit", async () => {
    await setup();
    const result = await loginWithPassword({ identifier: username, password }, ctx);
    expect(result.token.length).toBeGreaterThan(30);
    const user = await resolveSessionUser(result.token);
    expect(user?.username).toBe(username);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, userId), eq(auditLogs.action, "auth.login")));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("rejects a wrong password with a generic error", async () => {
    await expect(loginWithPassword({ identifier: username, password: "Nope-Nope-1" }, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("locks the identifier after repeated failures", async () => {
    await resetRateLimit(`login:user:${username}`);
    let lastCode = "";
    for (let i = 0; i < 8; i++) {
      try {
        await loginWithPassword({ identifier: username, password: "Wrong-Pass-99" }, ctx);
      } catch (e) {
        lastCode = (e as AppError).code;
      }
    }
    expect(lastCode).toBe("RATE_LIMITED");
    await resetRateLimit(`login:user:${username}`);
  });

  it("stores audit before/after without password material", async () => {
    await recordAudit(
      { actorUserId: userId, action: "setting.updated", entityType: "setting", entityId: "test", before: { value: 1 }, after: { value: 2 }, reason: "آزمون" },
      ctx,
    );
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, userId), eq(auditLogs.entityId, "test")))
      .limit(1);
    expect(row.before).toEqual({ value: 1 });
    expect(row.after).toEqual({ value: 2 });
    expect(JSON.stringify(row)).not.toContain("passwordHash");
  });

  it("revoked sessions no longer resolve", async () => {
    const result = await loginWithPassword({ identifier: username, password }, ctx);
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    expect(await resolveSessionUser(result.token)).toBeNull();
  });
});
