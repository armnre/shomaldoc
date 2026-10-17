import Link from "next/link";
import { Building2, FileClock, FileText, Settings, ShieldCheck, Users, Workflow } from "lucide-react";
import { Breadcrumb, Card, PageHeader } from "@/components/ui";
import { can, requireUser } from "@/server/auth/current-user";
import { getServerI18n } from "@/i18n/server";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AdminCenterPage() {
  const user = await requireUser();
  const { dict } = await getServerI18n();
  const env = getEnv();
  const groups = [
    {
      title: dict.nav.groupAdmin,
      items: [
        { href: "/admin/organization", label: dict.nav.organization, permission: "org.view", icon: Building2 },
        { href: "/admin/workflows", label: dict.nav.workflows, permission: "workflow.view", icon: Workflow },
        { href: "/admin/forms", label: dict.nav.forms, permission: "forms.view", icon: FileText },
      ],
    },
    {
      title: dict.roles.groups.users,
      items: [
        { href: "/admin/users", label: dict.nav.users, permission: "users.view", icon: Users },
        { href: "/admin/roles", label: dict.nav.roles, permission: "roles.view", icon: ShieldCheck },
      ],
    },
    {
      title: dict.roles.groups.system,
      items: [
        { href: "/admin/settings", label: dict.nav.settings, permission: "settings.view", icon: Settings },
        { href: "/admin/audit", label: dict.nav.audit, permission: "audit.view", icon: FileClock },
        ...(env.APP_ENV !== "production" ? [{ href: "/design", label: dict.nav.design, permission: "system.design", icon: FileText }] : []),
      ],
    },
  ];

  return <>
    <Breadcrumb items={[{ label: dict.nav.dashboard, href: "/dashboard" }, { label: dict.nav.adminCenter }]} />
    <PageHeader title={dict.nav.adminCenter} subtitle={dict.nav.adminCenterSubtitle} />
    <div className="grid gap-6">
      {groups.map((group) => {
        const items = group.items.filter((item) => can(user, item.permission));
        if (items.length === 0) return null;
        return <section key={group.title}>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">{group.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className="group rounded-xl focus-visible:outline-none">
                <Card className="flex h-full items-center gap-4 p-5 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-lift">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></span>
                  <span className="font-semibold">{item.label}</span>
                </Card>
              </Link>;
            })}
          </div>
        </section>;
      })}
    </div>
  </>;
}
