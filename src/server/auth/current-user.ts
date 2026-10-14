import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../http";
import { resolveSessionUser, type CurrentUser } from "../services/auth";

export const SESSION_COOKIE = "shomaldoc_session";

export type { CurrentUser };

/** Per-request memoised lookup of the session user (safe to call from layouts and pages). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20) return null;
  return resolveSessionUser(token);
});

export function can(user: Pick<CurrentUser, "permissions"> | null | undefined, permission: string): boolean {
  return !!user && user.permissions.includes(permission);
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePagePermission(permission: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/forbidden");
  return user;
}

/** Backend guard for route handlers. Permissions are always re-checked on the server. */
export async function requireApiUser(permission?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "ابتدا وارد سامانه شوید.");
  if (permission && !can(user, permission)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای این عملیات را ندارید.", { permission });
  }
  return user;
}
