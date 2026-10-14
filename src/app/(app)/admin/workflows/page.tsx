import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { WorkflowEditor } from "@/components/features/workflow-editor";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { getDefinitionDetail, listDefinitions } from "@/server/services/workflow-admin";
import { PERMISSIONS } from "@/server/rbac/catalog";
import { getServerI18n } from "@/i18n/server";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const viewer = await requirePagePermission("workflow.view");
  const { dict, locale } = await getServerI18n();
  const params = await searchParams;
  const definitions = await listDefinitions();
  const requestedId = params.id ? Number(params.id) : NaN;
  const selected =
    definitions.find((d) => d.id === requestedId) ??
    definitions.find((d) => d.isPublished && d.isActive) ??
    definitions[0] ??
    null;
  const detail = selected ? await getDefinitionDetail(selected.id) : null;
  const canManage = can(viewer, "workflow.manage");

  return (
    <>
      <PageHeader title={dict.workflow.title} subtitle={dict.workflow.subtitle} />

      <Card className="mb-6 overflow-hidden">
        <h2 className="border-b border-border bg-surface-2 p-4 text-base font-semibold">{dict.workflow.definitions}</h2>
        {definitions.length === 0 ? (
          <EmptyState title={dict.workflow.noDefinitions} />
        ) : (
          <ul className="divide-y divide-border">
            {definitions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium">{d.titleFa}</p>
                  <p className="text-xs text-fg-muted" dir="ltr">
                    {d.code} · v{formatNumber(d.version, locale)} · {dict.workflow.openInstances}: {formatNumber(d.openInstances, locale)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.isPublished && d.isActive ? "success" : "neutral"}>
                    {d.isPublished ? (d.isActive ? dict.workflow.published : dict.workflow.draft) : dict.workflow.draft}
                  </Badge>
                  {d.pendingUniversityApproval ? <Badge tone="warning">{dict.workflow.pendingApproval}</Badge> : null}
                  <Link
                    href={`/admin/workflows?id=${d.id}`}
                    className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
                  >
                    {dict.workflow.view}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail ? (
        <WorkflowEditor
          dict={dict}
          canManage={canManage}
          permissionOptions={PERMISSIONS.map((p) => p.key)}
          detail={{
            definition: { ...detail.definition, openInstances: definitions.find((d) => d.id === detail.definition.id)?.openInstances ?? 0 },
            steps: detail.steps,
            transitions: detail.transitions,
            issues: detail.issues,
          }}
        />
      ) : null}
    </>
  );
}
