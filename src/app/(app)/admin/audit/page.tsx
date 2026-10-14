import { ScrollText } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/current-user";
import { listAuditLogs, listDistinctAuditActions } from "@/server/services/audit";
import { auditQuerySchema } from "@/validations/schemas";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { AuditDetails } from "./audit-details";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requirePagePermission("audit.view");
  const { dict, locale } = await getServerI18n();
  const raw = await searchParams;
  const query = auditQuerySchema.parse({ action: raw.action, page: raw.page ?? 1 });
  const [result, actions] = await Promise.all([
    listAuditLogs({ action: query.action || undefined, page: query.page, pageSize: 25 }),
    listDistinctAuditActions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const label = (action: string) => (dict.auditActions as Record<string, string>)[action] ?? action;

  return (
    <>
      <PageHeader title={dict.audit.title} subtitle={dict.audit.subtitle} />
      <Card className="overflow-hidden">
        <form action="/admin/audit" className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {dict.audit.filterAction}
            <select name="action" defaultValue={query.action ?? ""} className="h-10 min-w-60 rounded-md border border-border-strong bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/20">
              <option value="">{dict.audit.filterAll}</option>
              {actions.map((a) => (
                <option key={a} value={a}>{label(a)} ({a})</option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">{dict.common.search}</button>
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-7" aria-hidden />} title={dict.audit.emptyTitle} text={dict.audit.emptyText} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colTime}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colActor}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colAction}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colEntity}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colIp}</th>
                  <th scope="col" className="p-3 text-start font-semibold">{dict.audit.colDetails}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top hover:bg-surface-2/60">
                    <td className="tabular whitespace-nowrap p-3 text-fg-muted">{formatDateTime(row.createdAt, locale)}</td>
                    <td className="p-3">{row.actorFullName ?? dict.common.system}</td>
                    <td className="p-3"><Badge tone="primary">{label(row.action)}</Badge></td>
                    <td className="p-3 text-xs" dir="ltr">{row.entityType}{row.entityId ? `: ${row.entityId}` : ""}</td>
                    <td className="p-3 font-mono text-xs" dir="ltr">{row.ip ?? "—"}</td>
                    <td className="max-w-md p-3">
                      <AuditDetails
                        before={row.before}
                        after={row.after}
                        reason={row.reason}
                        labels={{ show: dict.audit.showDetails, hide: dict.audit.hideDetails, before: dict.audit.before, after: dict.audit.after, reason: dict.audit.reason }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border p-4 text-sm text-fg-muted">
          <span className="tabular">{dict.common.total}: {formatNumber(result.total, locale)}</span>
          <span className="tabular">{formatNumber(query.page, locale)} / {formatNumber(totalPages, locale)}</span>
        </div>
      </Card>
    </>
  );
}
