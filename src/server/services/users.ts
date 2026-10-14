import { and, count, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { roles, sessions, userRoles, users } from "@/db/schema";
import type { CreateUserInput, UpdateUserInput } from "@/validations/schemas";
import { hashPassword } from "../auth/password";
import { AppError } from "../http";
import { loadUserRoles, type RoleRef } from "../rbac/service";
import { isActiveDepartment } from "./organization";
import { recordAudit, type Actor, type RequestContext } from "./audit";

type UserRow = typeof users.$inferSelect;

/** Never expose password hashes outside this module. */
export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    department: user.department,
    departmentId: user.departmentId,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listUsers(params: { q?: string; page: number; pageSize: number }) {
  const term = params.q?.trim();
  const where = term
    ? or(
        ilike(users.username, `%${escapeLike(term)}%`),
        ilike(users.email, `%${escapeLike(term)}%`),
        ilike(users.fullName, `%${escapeLike(term)}%`),
      )
    : undefined;

  const [{ value: total }] = await db.select({ value: count() }).from(users).where(where);
  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  const ids = rows.map((r) => r.id);
  const roleRows =
    ids.length === 0
      ? []
      : await db
          .select({ userId: userRoles.userId, id: roles.id, key: roles.key, nameFa: roles.nameFa })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(inArray(userRoles.userId, ids))
          .orderBy(roles.id);

  const rolesByUser = new Map<string, RoleRef[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push({ id: r.id, key: r.key, nameFa: r.nameFa });
    rolesByUser.set(r.userId, list);
  }

  return {
    items: rows.map((row) => ({ ...toPublicUser(row), roles: rolesByUser.get(row.id) ?? [] })),
    total: Number(total),
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function getUserDetail(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;
  const [roleList, allRoles, [activeSessions]] = await Promise.all([
    loadUserRoles(db, id),
    db.select({ id: roles.id, key: roles.key, nameFa: roles.nameFa, description: roles.description }).from(roles).orderBy(roles.id),
    db
      .select({ value: count() })
      .from(sessions)
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))),
  ]);
  return {
    user: toPublicUser(user),
    roles: roleList,
    allRoles,
    activeSessions: Number(activeSessions?.value ?? 0),
  };
}

async function assertRolesExist(tx: DbTx, roleIds: number[]): Promise<void> {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return;
  const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, unique));
  if (found.length !== unique.length) {
    throw new AppError(400, "UNKNOWN_ROLE", "یک یا چند نقش انتخاب‌شده وجود ندارد.");
  }
}

export async function createUser(actor: Actor, input: CreateUserInput, ctx: RequestContext) {
  const passwordHash = await hashPassword(input.initialPassword);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, input.username), eq(users.email, input.email)))
      .limit(1);
    if (existing) {
      throw new AppError(409, "USER_EXISTS", "نام کاربری یا ایمیل قبلاً ثبت شده است.");
    }
    await assertRolesExist(tx, input.roleIds);

    const [created] = await tx
      .insert(users)
      .values({
        username: input.username,
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        mustChangePassword: input.mustChangePassword,
      })
      .returning();

    const uniqueRoleIds = [...new Set(input.roleIds)];
    if (uniqueRoleIds.length > 0) {
      await tx
        .insert(userRoles)
        .values(uniqueRoleIds.map((roleId) => ({ userId: created.id, roleId, assignedBy: actor.id })));
    }
    const assigned = await loadUserRoles(tx, created.id);
    const publicUser = toPublicUser(created);

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "user.created",
        entityType: "user",
        entityId: created.id,
        after: { ...publicUser, roleKeys: assigned.map((r) => r.key) },
      },
      ctx,
      tx,
    );
    return { ...publicUser, roles: assigned };
  });
}

async function countOtherActiveAdmins(tx: DbTx, adminRoleId: number, excludeUserId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(eq(userRoles.roleId, adminRoleId), eq(users.isActive, true), ne(users.id, excludeUserId)),
    );
  return Number(row?.value ?? 0);
}

/** Applies only the fields present in the input; every change is written to the audit log with before/after. */
export async function updateUser(actor: Actor, userId: string, input: UpdateUserInput, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");

    const beforeRoles = await loadUserRoles(tx, userId);
    const [adminRole] = await tx.select().from(roles).where(eq(roles.key, "system_admin")).limit(1);
    const wasAdmin = !!adminRole && beforeRoles.some((r) => r.id === adminRole.id);

    const deactivating = input.isActive === false && user.isActive;
    if (input.isActive === false && actor.id === userId) {
      throw new AppError(409, "SELF_DEACTIVATE", "نمی‌توانید حساب خودتان را غیرفعال کنید.");
    }

    if (input.roleIds !== undefined) {
      await assertRolesExist(tx, input.roleIds);
    }
    const nextRoleIds = input.roleIds !== undefined ? [...new Set(input.roleIds)] : null;
    const willBeAdmin = !!adminRole && (nextRoleIds ? nextRoleIds.includes(adminRole.id) : wasAdmin);
    const losingAdmin = wasAdmin && user.isActive && (!willBeAdmin || deactivating);

    if (losingAdmin && adminRole) {
      const others = await countOtherActiveAdmins(tx, adminRole.id, userId);
      if (others === 0) {
        throw new AppError(409, "LAST_ADMIN", "این کاربر آخرین مدیر فعال سامانه است و نمی‌توان دسترسی آن را گرفت.");
      }
    }

    if (nextRoleIds) {
      const beforeKeys = beforeRoles.map((r) => r.key).sort();
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      if (nextRoleIds.length > 0) {
        await tx
          .insert(userRoles)
          .values(nextRoleIds.map((roleId) => ({ userId, roleId, assignedBy: actor.id })));
      }
      const afterRoles = await loadUserRoles(tx, userId);
      const afterKeys = afterRoles.map((r) => r.key).sort();
      if (beforeKeys.join(",") !== afterKeys.join(",")) {
        await recordAudit(
          {
            actorUserId: actor.id,
            action: "user.roles_changed",
            entityType: "user",
            entityId: userId,
            before: { roleKeys: beforeKeys },
            after: { roleKeys: afterKeys },
            reason: input.reason,
          },
          ctx,
          tx,
        );
      }
    }

    if (input.isActive !== undefined && input.isActive !== user.isActive) {
      await tx.update(users).set({ isActive: input.isActive, updatedAt: new Date() }).where(eq(users.id, userId));
      let revoked = 0;
      if (!input.isActive) {
        const rows = await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        revoked = rows.length;
      }
      await recordAudit(
        {
          actorUserId: actor.id,
          action: "user.updated",
          entityType: "user",
          entityId: userId,
          before: { isActive: user.isActive },
          after: { isActive: input.isActive, sessionsRevoked: revoked },
          reason: input.reason,
        },
        ctx,
        tx,
      );
    }

    if (input.departmentId !== undefined && input.departmentId !== user.departmentId) {
      const dept = input.departmentId;
      if (dept !== null && !(await isActiveDepartment(dept, tx))) {
        throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
      }
      await tx.update(users).set({ departmentId: dept, updatedAt: new Date() }).where(eq(users.id, userId));
      await recordAudit(
        {
          actorUserId: actor.id,
          action: "user.updated",
          entityType: "user",
          entityId: userId,
          before: { departmentId: user.departmentId },
          after: { departmentId: dept },
          reason: input.reason,
        },
        ctx,
        tx,
      );
    }

    if (input.department !== undefined && input.department !== user.department) {
      const dept = input.department && input.department.trim().length > 0 ? input.department.trim() : null;
      await tx.update(users).set({ department: dept, updatedAt: new Date() }).where(eq(users.id, userId));
      await recordAudit(
        {
          actorUserId: actor.id,
          action: "user.updated",
          entityType: "user",
          entityId: userId,
          before: { department: user.department },
          after: { department: dept },
          reason: input.reason,
        },
        ctx,
        tx,
      );
    }

    const finalRoles = await loadUserRoles(tx, userId);
    const [fresh] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return { ...toPublicUser(fresh), roles: finalRoles };
  });
}

export async function listAllRoles() {
  return db.select({ id: roles.id, key: roles.key, nameFa: roles.nameFa }).from(roles).orderBy(roles.id);
}

