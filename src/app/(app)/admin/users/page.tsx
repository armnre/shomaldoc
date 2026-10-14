import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { UserCreateDialog } from "@/components/features/admin-forms";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { listAllRoles, listUsers } from "@/server/services/users";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { interpolate } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePagePermission("users.view");
  const { dict, locale } = await getServerI18n();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const canManage = can(user, "users.manage");
  const [result, roles] = await Promise.all([listUsers({ q, page, pageSize: PAGE_SIZE }), listAllRoles()]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const from = result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(result.total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title={dict.users.title}
        subtitle={dict.users.subtitle}
        actions={canManage ? <UserCreateDialog roles={roles} /> : undefined}
      />

      <Card className="overflow-hidden">
        <form action="/admin/users" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder={dict.users.searchPlaceholder}
              aria-label={dict.common.search}
              className="h-10 w-full rounded-md border border-border-strong bg-surface ps-9 pe-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20"
            />
          </div>
          <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            {dict.common.search}
          </button>
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={<Users className="size-7" aria-hidden />} title={dict.users.emptyTitle} text={dict.users.emptyText} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colName}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colUsername}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colRoles}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colStatus}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colLastLogin}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.users.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((u) => (
                  <tr key={u.id} className="border-t border-border transition-colors hover:bg-surface-2/60">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.fullName} />
                        <div>
                          <p className="font-medium text-fg">{u.fullName}</p>
                          <p className="text-xs text-fg-muted" dir="ltr">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-xs" dir="ltr">{u.username}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? <span className="text-fg-muted">{dict.users.noRoles}</span> : null}
                        {u.roles.map((r) => (
                          <Badge key={r.id} tone="primary">{dict.roleNames[r.key] ?? r.nameFa}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge tone={u.isActive ? "success" : "neutral"}>{u.isActive ? dict.common.active : dict.common.inactive}</Badge>
                    </td>
                    <td className="tabular p-3 text-fg-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : dict.common.never}</td>
                    <td className="p-3">
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-primary hover:underline">{dict.users.view}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <nav aria-label={dict.common.page} className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-sm text-fg-muted">
          <span className="tabular">{interpolate(dict.users.pageInfo, { from: formatNumber(from, locale), to: formatNumber(to, locale), total: formatNumber(result.total, locale) })}</span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />{dict.common.previous}
              </Link>
            ) : null}
            <span className="tabular px-2">{formatNumber(page, locale)} / {formatNumber(totalPages, locale)}</span>
            {page < totalPages ? (
              <Link href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                {dict.common.next}<ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            ) : null}
          </div>
        </nav>
      </Card>
    </>
  );
}
