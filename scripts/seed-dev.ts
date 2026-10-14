/**
 * [DEV] demo accounts for Preview/Development ONLY. Refuses to run when APP_ENV=production.
 *
 * The password is NOT stored in this file (a password must never live in Git, docs or
 * logs). The operator supplies it for the one-off run:
 *
 *   DEV_SEED_PASSWORD='<choose-one>' npm run db:seed-dev
 *
 * The same value is used for every demo account so the preview stays easy to drive.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { roles, userRoles, users } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { seedRbac } from "../src/server/rbac/service";

const DEV_PASSWORD = process.env.DEV_SEED_PASSWORD ?? "";

const DEMO_USERS = [
  { username: "dev.admin", email: "dev.admin@preview.invalid", fullName: "[DEV] مدیر سیستم", roleKey: "system_admin" },
  { username: "dev.depthead", email: "dev.depthead@preview.invalid", fullName: "[DEV] مدیر گروه", roleKey: "dept_head" },
  { username: "dev.supervisor", email: "dev.supervisor@preview.invalid", fullName: "[DEV] استاد راهنما", roleKey: "supervisor" },
  { username: "dev.student", email: "dev.student@preview.invalid", fullName: "[DEV] دانشجوی نمونه", roleKey: "student" },
];

async function main() {
  if (process.env.APP_ENV === "production") {
    throw new Error("seed-dev refuses to run when APP_ENV=production");
  }
  if (DEV_PASSWORD.length < 12) {
    throw new Error("set DEV_SEED_PASSWORD (at least 12 characters) for this preview run; the value is never stored in the repository");
  }
  await seedRbac();
  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const demo of DEMO_USERS) {
    const [role] = await db.select().from(roles).where(eq(roles.key, demo.roleKey)).limit(1);
    const [existing] = await db.select().from(users).where(eq(users.username, demo.username)).limit(1);
    const user =
      existing ??
      (
        await db
          .insert(users)
          .values({ username: demo.username, email: demo.email, fullName: demo.fullName, passwordHash, mustChangePassword: false })
          .returning()
      )[0];
    await db.insert(userRoles).values({ userId: user.id, roleId: role.id }).onConflictDoNothing();
  }
  console.log(JSON.stringify({ ok: true, step: "seed-dev", accounts: DEMO_USERS.map((u) => u.username), note: "preview only" }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "seed-dev", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
