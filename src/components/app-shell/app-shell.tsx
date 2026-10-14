"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Building2,
  FileText,
  Workflow,
  GraduationCap,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand";
import { Avatar, Badge } from "@/components/ui";
import { apiRequest } from "@/components/features/api-client";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { LocaleToggle, ThemeToggle } from "./controls";
import { NotificationCenter } from "@/components/features/notification-center";

export type NavIconName = "dashboard" | "cases" | "users" | "roles" | "org" | "workflow" | "supervisors" | "reports" | "audit" | "settings" | "design" | "account";
export type NavGroup = "main" | "admin" | "account";

export interface ShellNavItem {
  href: string;
  label: string;
  icon: NavIconName;
  group: NavGroup;
}

const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  cases: FileText,
  org: Building2,
  workflow: Workflow,
  supervisors: GraduationCap,
  reports: BarChart3,
  users: Users,
  roles: ShieldCheck,
  audit: ScrollText,
  settings: Settings,
  design: Palette,
  account: UserCog,
};

export interface ShellUser {
  fullName: string;
  username: string;
  roles: string[];
}

export function AppShell({
  children,
  user,
  nav,
  mustChangePassword,
  footer,
}: {
  children: ReactNode;
  user: ShellUser;
  nav: ShellNavItem[];
  mustChangePassword: boolean;
  footer: ReactNode;
}) {
  const { dict } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const groupLabels: Record<NavGroup, string> = {
    main: dict.nav.groupMain,
    admin: dict.nav.groupAdmin,
    account: dict.nav.groupAccount,
  };

  const navContent = (
    <nav aria-label={dict.brand.name} className="flex flex-col gap-6">
      {(["main", "admin", "account"] as NavGroup[]).map((group) => {
        const items = nav.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted">{groupLabels[group]}</p>
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-primary text-primary-fg shadow-soft" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const brandBlock = (
    <div className="flex items-center gap-3 px-3 pb-6 pt-2">
      <BrandMark className="size-9" />
      <div className="leading-tight">
        <p className="font-bold text-primary">{dict.brand.name}</p>
        <p className="text-xs text-fg-muted">{dict.brand.universityOffice}</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-waves-dim">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[var(--z-modal)] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2">
        {dict.common.skipToContent}
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-e border-border bg-surface/80 p-4 backdrop-blur lg:flex">
        {brandBlock}
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-[var(--z-overlay)] lg:hidden">
          <button type="button" aria-label={dict.nav.closeSidebar} onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-navy-900/50 animate-fade-in" />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] animate-in flex-col overflow-y-auto bg-surface p-4 shadow-lift">
            <div className="mb-2 flex items-center justify-between">
              {brandBlock}
              <button type="button" aria-label={dict.nav.closeSidebar} onClick={() => setDrawerOpen(false)} className="grid size-10 place-items-center rounded-md hover:bg-surface-2">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {navContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-bg/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={dict.nav.openSidebar}
              className="grid size-10 place-items-center rounded-md text-fg-muted hover:bg-surface-2 lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>

            <form action="/cases" method="get" role="search" className="relative hidden flex-1 max-w-md md:block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <input
                type="search"
                name="q"
                aria-label={dict.common.search}
                placeholder={dict.common.searchPlaceholder}
                className="h-10 w-full rounded-md border border-border bg-surface ps-9 pe-3 text-sm placeholder:text-fg-muted/70"
              />
            </form>

            <div className="ms-auto flex items-center gap-1">
              <NotificationCenter />
              <LocaleToggle />
              <ThemeToggle />
              <UserMenu user={user} logoutLabel={dict.common.logout} accountLabel={dict.nav.account} />
            </div>
          </div>
        </header>

        {mustChangePassword ? (
          <div className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-center text-sm text-warning sm:px-6">
            {dict.auth.mustChangeNotice}{" "}
            <Link href="/account" className="font-semibold underline underline-offset-4">
              {dict.nav.account}
            </Link>
          </div>
        ) : null}

        <main id="main" className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
        {footer}
      </div>
    </div>
  );
}

function UserMenu({ user, logoutLabel, accountLabel }: { user: ShellUser; logoutLabel: string; accountLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    await apiRequest<{ redirectTo: string }>("/api/auth/logout", "POST", {});
    router.replace("/login");
    router.refresh();
  };
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md p-1.5 ps-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <Avatar name={user.fullName} className="size-8 text-xs" />
        <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{user.fullName}</span>
      </summary>
      <div className="absolute end-0 z-[var(--z-dropdown)] mt-2 w-64 animate-pop rounded-lg border border-border bg-surface p-2 shadow-lift">
        <div className="px-3 py-2">
          <p className="font-semibold">{user.fullName}</p>
          <p className="text-xs text-fg-muted" dir="ltr">{user.username}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {user.roles.map((r) => (
              <Badge key={r} tone="primary">{r}</Badge>
            ))}
          </div>
        </div>
        <hr className="my-1 border-border" />
        <Link href="/account" className="block rounded-md px-3 py-2 text-sm hover:bg-surface-2">
          {accountLabel}
        </Link>
        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm text-danger hover:bg-danger-soft disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden />
          {logoutLabel}
        </button>
      </div>
    </details>
  );
}
