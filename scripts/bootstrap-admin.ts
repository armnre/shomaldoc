/**
 * One-time system administrator bootstrap.
 * Runs only when no active system_admin exists. Reads a 600-mode env file, creates the admin,
 * and deletes the file only after the transaction succeeds. Never prints the password.
 */
import "dotenv/config";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { count, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { auditLogs, roles, userRoles, users } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { seedRbac } from "../src/server/rbac/service";
import { emailSchema, passwordSchema, usernameSchema } from "../src/validations/schemas";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

async function main() {
  const file = process.env.BOOTSTRAP_FILE ?? "/etc/shomaldoc/bootstrap.env";
  if (!existsSync(file)) {
    console.log(JSON.stringify({ ok: true, step: "bootstrap", action: "skipped", reason: "no bootstrap file" }));
    return;
  }
  if (statSync(file).mode & 0o077) throw new Error("bootstrap file must have permission 600");

  const env = parseEnvFile(file);
  const username = usernameSchema.parse(env.ADMIN_USERNAME ?? "");
  const email = emailSchema.parse(env.ADMIN_EMAIL ?? "");
  const fullName = (env.ADMIN_FULL_NAME ?? "").trim();
  if (fullName.length < 3) throw new Error("ADMIN_FULL_NAME is required (min 3 chars)");
  const password = env.ADMIN_PASSWORD ?? "";
  if (password.length < 16) throw new Error("ADMIN_PASSWORD must be at least 16 characters");
  passwordSchema.parse(password);

  await seedRbac();
  const [adminRole] = await db.select().from(roles).where(eq(roles.key, "system_admin")).limit(1);
  if (!adminRole) throw new Error("system_admin role missing after seed");

  const [{ value: existingAdmins }] = await db
    .select({ value: count() })
    .from(userRoles)
    .where(eq(userRoles.roleId, adminRole.id));
  if (Number(existingAdmins) > 0) {
    console.log(JSON.stringify({ ok: true, step: "bootstrap", action: "skipped", reason: "an administrator already exists; file left untouched" }));
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(users)
      .values({ username, email, fullName, passwordHash, mustChangePassword: true })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: admin.id, roleId: adminRole.id, assignedBy: admin.id });
    await tx.insert(auditLogs).values({
      actorUserId: admin.id,
      action: "bootstrap.admin_created",
      entityType: "user",
      entityId: admin.id,
      after: { username, roleKeys: ["system_admin"] },
      reason: "initial bootstrap",
    });
  });

  unlinkSync(file);
  console.log(JSON.stringify({ ok: true, step: "bootstrap", action: "created", username, bootstrapFileRemoved: true }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(JSON.stringify({ ok: false, step: "bootstrap", message }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
