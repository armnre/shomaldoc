import type { ReactNode } from "react";
import { AppShell, type ShellNavItem } from "@/components/app-shell/app-shell";
import { SiteFooter } from "@/components/app-shell/site-footer";
import { CASE_VIEW_PERMISSIONS, can, requireUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/env";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { dict } = await getServerI18n();
  const env = getEnv();

  // `permissions` is an any-of list (see CASE_VIEW_PERMISSIONS); `permission` is exact.
  const items: Array<ShellNavItem & { permission?: string; permissions?: readonly string[] }> = [
    { href: "/dashboard", label: dict.nav.dashboard, icon: "dashboard", group: "main", permission: "dashboard.view" },
    { href: "/cases", label: dict.nav.cases, icon: "cases", group: "main", permissions: CASE_VIEW_PERMISSIONS },
    { href: "/supervisors", label: dict.nav.supervisors, icon: "supervisors", group: "main", permission: "cases.assign_supervisors" },
    { href: "/reports", label: dict.nav.reports, icon: "reports", group: "main", permissions: CASE_VIEW_PERMISSIONS },
    { href: "/review", label: dict.nav.review, icon: "audit", group: "main", permission: "cases.review_topic" },
    { href: "/search", label: dict.nav.search, icon: "audit", group: "main", permissions: CASE_VIEW_PERMISSIONS },
    { href: "/admin/organization", label: dict.nav.organization, icon: "org", group: "admin", permission: "org.view" },
    { href: "/admin/workflows", label: dict.nav.workflows, icon: "workflow", group: "admin", permission: "workflow.view" },
    { href: "/admin/forms", label: dict.nav.forms, icon: "workflow", group: "admin", permission: "forms.view" },
    { href: "/admin/users", label: dict.nav.users, icon: "users", group: "admin", permission: "users.view" },
    { href: "/admin/roles", label: dict.nav.roles, icon: "roles", group: "admin", permission: "roles.view" },
    { href: "/admin/audit", label: dict.nav.audit, icon: "audit", group: "admin", permission: "audit.view" },
    { href: "/admin/settings", label: dict.nav.settings, icon: "settings", group: "admin", permission: "settings.view" },
    { href: "/design", label: dict.nav.design, icon: "design", group: "admin", permission: "system.design" },
    { href: "/account", label: dict.nav.account, icon: "account", group: "account" },
  ];

  const nav: ShellNavItem[] = items
    .filter((item) => {
      if (item.permissions) return item.permissions.some((p) => can(user, p));
      if (!item.permission) return true;
      if (item.href === "/design" && env.APP_ENV !== "production") return true;
      return can(user, item.permission);
    })
    .map(({ permission: _permission, permissions: _permissions, ...rest }) => rest);

  return (
    <AppShell
      user={{ fullName: user.fullName, username: user.username, roles: user.roles.map((r) => dict.roleNames[r.key] ?? r.nameFa) }}
      nav={nav}
      mustChangePassword={user.mustChangePassword}
      footer={<SiteFooter dict={dict} alt={dict.brand.universityLogoAlt} />}
    >
      {children}
    </AppShell>
  );
}
