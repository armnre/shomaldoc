import Link from "next/link";
import { Badge, Breadcrumb, Card, EmptyState, PageHeader, Timeline } from "@/components/ui";
import { WorkflowEditor } from "@/components/features/workflow-editor";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { getDefinitionDetail, listDefinitions } from "@/server/services/workflow-admin";
import { PERMISSIONS } from "@/server/rbac/catalog";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";

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
  const publishedDefinition = selected
    ? definitions.find((definition) => definition.code === selected.code && definition.isPublished && definition.isActive)
    : null;
  const publishedDetail = publishedDefinition && publishedDefinition.id !== selected?.id
    ? await getDefinitionDetail(publishedDefinition.id)
    : detail?.definition.isPublished ? detail : null;
  const canManage = can(viewer, "workflow.manage");
  const mapDetail = (value: NonNullable<typeof detail>) => ({
    definition: { ...value.definition, openInstances: definitions.find((definition) => definition.id === value.definition.id)?.openInstances ?? 0 },
    steps: value.steps,
    transitions: value.transitions,
    issues: value.issues,
  });

  return (
    <>
      <Breadcrumb items={[{ label: dict.nav.dashboard, href: "/dashboard" }, { label: dict.nav.groupAdmin }, { label: dict.workflow.title }]} />
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
                  <Badge tone={d.isPublished && d.isActive ? "success" : d.isPublished ? "neutral" : "warning"}>
                    {d.isPublished ? (d.isActive ? dict.workflow.published : dict.workflow.archived) : dict.workflow.draft}
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

      {selected ? (
        <Card className="mb-6 p-5">
          <h2 className="mb-4 font-semibold">{dict.workflow.versionsTimeline}</h2>
          <Timeline
            emptyText={dict.workflow.noDefinitions}
            items={definitions.filter((definition) => definition.code === selected.code).map((definition) => ({
              id: definition.id,
              title: `${dict.workflow.version} ${formatNumber(definition.version, locale)} — ${definition.isPublished ? (definition.isActive ? dict.workflow.published : dict.workflow.archived) : dict.workflow.draft}`,
              description: definition.titleFa,
              time: formatDateTime(definition.updatedAt, locale),
              tone: definition.isPublished && definition.isActive ? "success" : definition.isPublished ? "neutral" : "warning",
            }))}
          />
        </Card>
      ) : null}

      {detail ? (
        <WorkflowEditor
          key={detail.definition.id}
          dict={dict}
          canManage={canManage}
          permissionOptions={PERMISSIONS.map((permission) => permission.key)}
          detail={mapDetail(detail)}
          publishedDetail={publishedDetail ? mapDetail(publishedDetail) : null}
        />
      ) : null}
    </>
  );
}
