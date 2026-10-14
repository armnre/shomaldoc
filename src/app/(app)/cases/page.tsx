import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText, Search } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current-user";
import { listCases, getVisibleCaseIds } from "@/server/services/case";
import { STATUS_MAP } from "@/server/workflows";
import { casesQuerySchema } from "@/validations/schemas";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { interpolate } from "@/i18n/dictionaries";
import { Button } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requireUser();
  const { dict, locale } = await getServerI18n();
  const raw = await searchParams;
  const query = casesQuerySchema.parse({ q: raw.q, status: raw.status, page: raw.page ?? 1 });

  const result = await listCases(user, { ...query, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const from = result.total === 0 ? 0 : (query.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(result.total, query.page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title={dict.cases.title}
        subtitle={dict.cases.subtitle}
        actions={
          user.permissions.includes("cases.create") ? (
            <Link href="/cases/new"><Button>{dict.cases.newCase}</Button></Link>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <form action="/cases" className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              placeholder={dict.cases.searchPlaceholder}
              aria-label={dict.common.search}
              className="h-10 w-full rounded-md border border-border-strong bg-surface ps-9 pe-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20"
            />
          </div>
          <select name="status" defaultValue={query.status ?? ""} className="h-10 min-w-40 rounded-md border border-border-strong bg-surface px-3 text-sm">
            <option value="">{dict.common.all}</option>
            {Object.entries(STATUS_MAP).map(([key, s]) => (
              <option key={key} value={key}>{s.fa}</option>
            ))}
          </select>
          <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            {dict.common.search}
          </button>
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={<FileText className="size-7" aria-hidden />} title={dict.cases.emptyTitle} text={dict.cases.emptyText} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colCaseNumber}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colStudent}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colTitle}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colStatus}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colUpdatedAt}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.cases.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((tc) => {
                  const statusInfo = STATUS_MAP[tc.currentStatus as keyof typeof STATUS_MAP];
                  const toneMap: Record<string, "success" | "info" | "warning" | "danger" | "primary" | "neutral"> = {
                    draft: "neutral",
                    submitted: "info",
                    under_review: "primary",
                    revision_required: "warning",
                    approved: "success",
                    rejected: "danger",
                    archived: "neutral",
                  };
                  return (
                    <tr key={tc.id} className="border-t border-border transition-colors hover:bg-surface-2/60">
                      <td className="p-3 font-mono text-xs" dir="ltr">{tc.caseNumber}</td>
                      <td className="p-3 font-medium text-fg">{tc.studentFullName}</td>
                      <td className="max-w-xs truncate p-3">{tc.titleFa ?? dict.cases.noTitle}</td>
                      <td className="p-3">
                        <Badge tone={toneMap[tc.currentStatus] ?? "neutral"}>
                          {statusInfo?.fa ?? tc.currentStatus}
                        </Badge>
                      </td>
                      <td className="tabular p-3 text-fg-muted">{formatDateTime(tc.updatedAt, locale)}</td>
                      <td className="p-3">
                        <Link href={`/cases/${tc.id}`} className="font-medium text-primary hover:underline">{dict.users.view}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <nav aria-label={dict.common.page} className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-sm text-fg-muted">
          <span className="tabular">{interpolate(dict.cases.pageInfo, { from: formatNumber(from, locale), to: formatNumber(to, locale), total: formatNumber(result.total, locale) })}</span>
          <div className="flex items-center gap-2">
            {query.page > 1 ? (
              <Link href={`/cases?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.status ? { status: query.status } : {}), page: String(query.page - 1) })}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />{dict.common.previous}
              </Link>
            ) : null}
            <span className="tabular px-2">{formatNumber(query.page, locale)} / {formatNumber(totalPages, locale)}</span>
            {query.page < totalPages ? (
              <Link href={`/cases?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.status ? { status: query.status } : {}), page: String(query.page + 1) })}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                {dict.common.next}<ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
              </Link>
            ) : null}
          </div>
        </nav>
      </Card>
    </>
  );
}