import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card, KeyValue, PageHeader, Breadcrumb } from "@/components/ui";
import { UserEditForm } from "@/components/features/admin-forms";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { getUserDetail } from "@/server/services/users";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePagePermission("users.view");
  const { dict, locale } = await getServerI18n();
  const { id } = await params;
  const detail = await getUserDetail(id).catch(() => null);
  if (!detail) notFound();

  const { user, roles, allRoles, activeSessions } = detail;
  const canManage = can(viewer, "users.manage");

  return (
    <>
      <Breadcrumb items={[{ label: dict.nav.users, href: "/admin/users" }, { label: user.fullName }]} />
      <PageHeader title={dict.users.detailTitle} subtitle={user.fullName} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="grid content-start gap-5 p-6 lg:col-span-1">
          <div className="flex items-center gap-4">
            <Avatar name={user.fullName} className="size-14 text-lg" />
            <div>
              <p className="text-lg font-semibold">{user.fullName}</p>
              <p className="text-sm text-fg-muted" dir="ltr">{user.username}</p>
            </div>
          </div>
          <KeyValue
            items={[
              { label: dict.users.email, value: <span dir="ltr">{user.email}</span> },
              { label: dict.cases.form.department, value: user.department ?? "—" },
              { label: dict.users.createdAt, value: formatDateTime(user.createdAt, locale) },
              { label: dict.users.colLastLogin, value: user.lastLoginAt ? formatDateTime(user.lastLoginAt, locale) : dict.common.never },
              { label: dict.dashboard.statSessions, value: formatNumber(activeSessions, locale) },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <Badge key={r.id} tone="primary">{dict.roleNames[r.key] ?? r.nameFa}</Badge>
            ))}
            {user.mustChangePassword ? <Badge tone="warning">{dict.users.mustChange}</Badge> : null}
          </div>
          <Link href="/admin/users" className="text-sm font-medium text-primary hover:underline">{dict.common.back}</Link>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-1 text-lg font-semibold">{dict.users.rolesTitle}</h2>
          <p className="mb-6 text-sm text-fg-muted">{dict.users.rolesText}</p>
          <UserEditForm
            userId={user.id}
            isActive={user.isActive}
            isSelf={viewer.id === user.id}
            allRoles={allRoles}
            currentRoleIds={roles.map((r) => r.id)}
            canManage={canManage}
            department={user.department}
          />
        </Card>
      </div>
    </>
  );
}
