import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbLike } from "@/db";
import { permissions, rolePermissions, roles, userRoles } from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type Actor, type RequestContext } from "../services/audit";
import { PERMISSIONS, ROLES, isProtectedGrant } from "./catalog";

export interface RoleRef {
  id: number;
  key: string;
  nameFa: string;
}

export interface AccessRow {
  roleId: number;
  roleKey: string;
  roleName: string;
  permissionKey: string | null;
}

/** Pure: folds joined role/permission rows into the user's roles and effective permission set. */
export function collectAccess(rows: AccessRow[]): { roles: RoleRef[]; permissions: string[] } {
  const roleMap = new Map<number, RoleRef>();
  const permSet = new Set<string>();
  for (const row of rows) {
    if (!roleMap.has(row.roleId)) {
      roleMap.set(row.roleId, { id: row.roleId, key: row.roleKey, nameFa: row.roleName });
    }
    if (row.permissionKey) permSet.add(row.permissionKey);
  }
  return {
    roles: [...roleMap.values()].sort((a, b) => a.id - b.id),
    permissions: [...permSet].sort(),
  };
}

/** Pure: union of permissions granted by a set of roles (role key → permission keys). */
export function unionPermissions(grants: Record<string, readonly string[]>, roleKeys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const key of roleKeys) {
    for (const perm of grants[key] ?? []) out.add(perm);
  }
  return [...out].sort();
}

export async function loadUserAccess(executor: DbLike, userId: string) {
  const rows = await executor
    .select({
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.nameFa,
      permissionKey: permissions.key,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return collectAccess(rows);
}

export async function loadUserRoles(executor: DbLike, userId: string): Promise<RoleRef[]> {
  return executor
    .select({ id: roles.id, key: roles.key, nameFa: roles.nameFa })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(roles.id));
}

/** Idempotent catalog seed. Safe to run on every deploy. */
export async function seedRbac(): Promise<{ rolesCreated: string[] }> {
  const rolesCreated: string[] = [];
  await db.transaction(async (tx) => {
    for (const perm of PERMISSIONS) {
      await tx
        .insert(permissions)
        .values({ key: perm.key, groupKey: perm.groupKey, description: perm.description })
        .onConflictDoUpdate({
          target: permissions.key,
          set: { groupKey: perm.groupKey, description: perm.description },
        });
    }

    for (const role of ROLES) {
      const inserted = await tx
        .insert(roles)
        .values({ key: role.key, nameFa: role.nameFa, description: role.description, isSystem: true })
        .onConflictDoNothing({ target: roles.key })
        .returning({ id: roles.id });
      const roleId = inserted.length > 0 ? inserted[0].id : (
        await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, role.key)).limit(1)
      )[0]?.id;
      if (!roleId) continue;
      if (inserted.length > 0) rolesCreated.push(role.key);

      // Grant default permissions (idempotent). Existing custom grants are never removed;
      // only missing defaults are added so new permissions reach existing roles on redeploy.
      const permRows = await tx
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, [...role.defaultPermissions]));
      if (permRows.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permRows.map((p) => ({ roleId, permissionId: p.id })))
          .onConflictDoNothing();
      }
    }
  });
  return { rolesCreated };
}

export async function listRolesWithPermissions() {
  const [roleRows, permRows, grantRows] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.id)),
    db.select().from(permissions).orderBy(asc(permissions.groupKey), asc(permissions.key)),
    db
      .select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId })
      .from(rolePermissions),
  ]);
  const granted = new Set(grantRows.map((g) => `${g.roleId}:${g.permissionId}`));
  return {
    roles: roleRows.map((r) => ({
      id: r.id,
      key: r.key,
      nameFa: r.nameFa,
      description: r.description,
    })),
    permissions: permRows.map((p) => ({
      id: p.id,
      key: p.key,
      groupKey: p.groupKey,
      description: p.description,
    })),
    granted: [...granted],
  };
}

/**
 * Grants or revokes exactly one (role, permission) pair. Touches at most one row,
 * which is the invariant covered by the RBAC tests.
 */
export async function setRolePermission(
  actor: Actor,
  input: { roleId: number; permissionKey: string; granted: boolean; reason: string },
  ctx: RequestContext,
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);
    if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "نقش یافت نشد.");
    const [perm] = await tx
      .select()
      .from(permissions)
      .where(eq(permissions.key, input.permissionKey))
      .limit(1);
    if (!perm) throw new AppError(404, "PERMISSION_NOT_FOUND", "دسترسی یافت نشد.");

    if (!input.granted && isProtectedGrant(role.key, perm.key)) {
      throw new AppError(409, "PROTECTED_PERMISSION", "این دسترسی برای جلوگیری از قفل شدن سامانه قابل حذف نیست.");
    }

    const existing = await tx
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, perm.id)))
      .limit(1);
    const wasGranted = existing.length > 0;
    if (wasGranted === input.granted) return { changed: false };

    if (input.granted) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, perm.id)));
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "role.permission_changed",
        entityType: "role",
        entityId: `${role.key}:${perm.key}`,
        before: { granted: wasGranted },
        after: { granted: input.granted },
        reason: input.reason,
      },
      ctx,
      tx,
    );
    return { changed: true };
  });
}
