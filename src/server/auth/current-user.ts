import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "../http";
import { logger } from "../logger";
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
  if (!user) {
    // A page request without a usable session. Logging it (path + whether a cookie
    // was present at all) is what makes "login succeeded but I keep landing on the
    // login page" diagnosable from the server side. No token or value is recorded.
    const headerList = await headers();
    logger.info("auth.session_required", {
      path: headerList.get("x-pathname") ?? "(unknown)",
      sessionPresent: (await cookies()).has(SESSION_COOKIE),
      forwardedProto: headerList.get("x-forwarded-proto")?.split(",")[0].trim() ?? "direct",
      host: headerList.get("host"),
      ip: headerList.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown",
      userAgent: headerList.get("user-agent"),
    });
    redirect("/login");
  }
  // First-login mandate: while the password has never been changed by the account
  // holder, every page except the account page itself redirects there. The check is
  // server-side, so it cannot be skipped by navigating with a different URL.
  if (user.mustChangePassword) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !pathname.startsWith("/account")) redirect("/account");
  }
  return user;
}

/**
 * Any of these grants visibility of at least one case scope. Service-layer
 * scoping (`getVisibleCaseIds`) decides *which* cases are visible, so pages and
 * endpoints that list or search cases must accept every view scope — gating them
 * on `cases.view_own` would lock out supervisors and department heads whose
 * visibility comes from `view_assigned` / `view_department`.
 */
export const CASE_VIEW_PERMISSIONS = [
  "cases.view_own",
  "cases.view_assigned",
  "cases.view_department",
  "cases.view_all",
] as const;

export function canViewCases(user: Pick<CurrentUser, "permissions"> | null | undefined): boolean {
  return CASE_VIEW_PERMISSIONS.some((permission) => can(user, permission));
}

export async function requireCaseViewPage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canViewCases(user)) redirect("/forbidden");
  return user;
}

export async function requirePagePermission(permission: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/forbidden");
  return user;
}

/** Backend guard for case-scoped route handlers (any view scope is accepted). */
export async function requireCaseViewApiUser(): Promise<CurrentUser> {
  const user = await requireApiUser();
  if (!canViewCases(user)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای دیدن پرونده‌ها را ندارید.", {
      permission: "cases.view_own",
    });
  }
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
