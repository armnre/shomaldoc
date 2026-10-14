import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { permissions, rolePermissions, roles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { PERMISSIONS, ROLES, isProtectedGrant } from "@/server/rbac/catalog";
import { collectAccess, setRolePermission, unionPermissions } from "@/server/rbac/service";

const suffix = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const createdRoleIds: number[] = [];

async function makeActor() {
  const unique = randomBytes(4).toString("hex");
  const [u] = await db
    .insert(users)
    .values({
      username: `rbac-test-${suffix}-${unique}`,
      email: `rbac-test-${suffix}-${unique}@test.invalid`,
      fullName: "RBAC Test Actor",
      passwordHash: await hashPassword("Test-Actor-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  return { id: u.id };
}

afterAll(async () => {
  if (createdRoleIds.length) await db.delete(roles).where(inArray(roles.id, createdRoleIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pool.end();
});

describe("RBAC pure helpers", () => {
  it("collects roles and a de-duplicated permission set", () => {
    const access = collectAccess([
      { roleId: 1, roleKey: "a", roleName: "A", permissionKey: "x.read" },
      { roleId: 1, roleKey: "a", roleName: "A", permissionKey: "x.read" },
      { roleId: 2, roleKey: "b", roleName: "B", permissionKey: "y.read" },
      { roleId: 2, roleKey: "b", roleName: "B", permissionKey: null },
    ]);
    expect(access.roles.map((r) => r.key)).toEqual(["a", "b"]);
    expect(access.permissions).toEqual(["x.read", "y.read"]);
  });

  it("unions permissions across roles", () => {
    const grants = { a: ["p1", "p2"], b: ["p2", "p3"] };
    expect(unionPermissions(grants, ["a", "b", "missing"])).toEqual(["p1", "p2", "p3"]);
  });

  it("system administrator holds every catalog permission", () => {
    const admin = ROLES.find((r) => r.key === "system_admin");
    expect([...(admin?.defaultPermissions ?? [])].sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
    expect(isProtectedGrant("system_admin", "roles.manage")).toBe(true);
    expect(isProtectedGrant("student", "roles.manage")).toBe(false);
  });
});

describe("revoking one permission touches exactly one row", () => {
  it("removes only the targeted (role, permission) pair", async () => {
    const actor = await makeActor();
    const [role] = await db
      .insert(roles)
      .values({ key: `test-role-${suffix}`, nameFa: "نقش آزمایشی", isSystem: false })
      .returning();
    createdRoleIds.push(role.id);

    const [pDash] = await db.select().from(permissions).where(eq(permissions.key, "dashboard.view"));
    const [pUsers] = await db.select().from(permissions).where(eq(permissions.key, "users.view"));
    await db.insert(rolePermissions).values([
      { roleId: role.id, permissionId: pDash.id },
      { roleId: role.id, permissionId: pUsers.id },
    ]);

    const before = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    expect(before).toHaveLength(2);

    const result = await setRolePermission(
      actor,
      { roleId: role.id, permissionKey: "users.view", granted: false, reason: "آزمون لغو دسترسی" },
      { ip: "127.0.0.1", userAgent: "vitest" },
    );
    expect(result.changed).toBe(true);

    const after = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    expect(after).toHaveLength(1);
    expect(after[0].permissionId).toBe(pDash.id);

    // Revoking an already-absent grant is a no-op.
    const noop = await setRolePermission(
      actor,
      { roleId: role.id, permissionKey: "users.view", granted: false, reason: "آزمون تکراری" },
      { ip: "127.0.0.1", userAgent: "vitest" },
    );
    expect(noop.changed).toBe(false);
    const still = await db
      .select()
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, pDash.id)));
    expect(still).toHaveLength(1);
  });

  it("refuses to revoke a protected grant from system_admin", async () => {
    const actor = await makeActor();
    const [admin] = await db.select().from(roles).where(eq(roles.key, "system_admin"));
    if (!admin) return; // catalog not seeded in this database yet
    await expect(
      setRolePermission(
        actor,
        { roleId: admin.id, permissionKey: "roles.manage", granted: false, reason: "آزمون قفل ایمنی" },
        { ip: "127.0.0.1", userAgent: "vitest" },
      ),
    ).rejects.toThrow(/قفل شدن/);
  });
});
