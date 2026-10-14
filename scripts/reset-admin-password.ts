/**
 * Administrator password reset. Requires explicit confirmation:
 *   CONFIRM=RESET_ADMIN_PASSWORD ADMIN_USERNAME=<name> NEW_PASSWORD_FILE=<600-mode file>
 * Revokes all sessions of that user and writes an audit record.
 */
import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { auditLogs, sessions, users } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { passwordSchema, usernameSchema } from "../src/validations/schemas";

async function main() {
  if (process.env.CONFIRM !== "RESET_ADMIN_PASSWORD") {
    throw new Error("refusing to run: set CONFIRM=RESET_ADMIN_PASSWORD");
  }
  const username = usernameSchema.parse(process.env.ADMIN_USERNAME ?? "");
  const file = process.env.NEW_PASSWORD_FILE ?? "";
  if (!file) throw new Error("NEW_PASSWORD_FILE is required");
  if (statSync(file).mode & 0o077) throw new Error("password file must have permission 600");
  const password = readFileSync(file, "utf8").trim();
  if (password.length < 16) throw new Error("new password must be at least 16 characters");
  passwordSchema.parse(password);

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user) throw new Error("user not found");
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, mustChangePassword: true, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id));
    await tx.insert(auditLogs).values({
      actorUserId: user.id,
      action: "auth.password_changed",
      entityType: "user",
      entityId: user.id,
      after: { via: "cli-reset", sessionsRevoked: true },
      reason: "administrator password reset (CLI)",
    });
  });
  console.log(JSON.stringify({ ok: true, step: "reset-admin-password", username }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "reset-admin-password", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
