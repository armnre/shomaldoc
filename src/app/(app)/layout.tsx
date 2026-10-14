import type { ReactNode } from "react";
import { AppShell, type ShellNavItem } from "@/components/app-shell/app-shell";
import { SiteFooter } from "@/components/app-shell/site-footer";
import { can, requireUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/env";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { dict } = await getServerI18n();
  const env = getEnv();

  const items: Array<ShellNavItem & { permission?: string }> = [
    { href: "/dashboard", label: dict.nav.dashboard, icon: "dashboard", group: "main", permission: "dashboard.view" },
    { href: "/cases", label: dict.nav.cases, icon: "cases", group: "main", permission: "cases.view_own" },
    { href: "/supervisors", label: dict.nav.supervisors, icon: "supervisors", group: "main", permission: "cases.assign_supervisors" },
    { href: "/reports", label: dict.nav.reports, icon: "reports", group: "main", permission: "cases.view_own" },
    { href: "/admin/organization", label: dict.nav.organization, icon: "org", group: "admin", permission: "org.view" },
    { href: "/admin/workflows", label: dict.nav.workflows, icon: "workflow", group: "admin", permission: "workflow.view" },
    { href: "/admin/users", label: dict.nav.users, icon: "users", group: "admin", permission: "users.view" },
    { href: "/admin/roles", label: dict.nav.roles, icon: "roles", group: "admin", permission: "roles.view" },
    { href: "/admin/audit", label: dict.nav.audit, icon: "audit", group: "admin", permission: "audit.view" },
    { href: "/admin/settings", label: dict.nav.settings, icon: "settings", group: "admin", permission: "settings.view" },
    { href: "/design", label: dict.nav.design, icon: "design", group: "admin", permission: "system.design" },
    { href: "/account", label: dict.nav.account, icon: "account", group: "account" },
  ];

  const nav: ShellNavItem[] = items
    .filter((item) => {
      if (!item.permission) return true;
      if (item.href === "/design" && env.APP_ENV !== "production") return true;
      return can(user, item.permission);
    })
    .map(({ permission: _permission, ...rest }) => rest);

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
