import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, User, Users, Clock, Upload, ArrowRight } from "lucide-react";
import { Badge, Breadcrumb, Card, EmptyState, PageHeader, Timeline } from "@/components/ui";
import { requireUser } from "@/server/auth/current-user";
import { getCaseById, getCaseEvents, getCaseFiles, getCaseSupervisors, getVisibleCaseIds } from "@/server/services/case";
import { STATUS_MAP, getAvailableTransitions } from "@/server/workflows";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { CaseTransitionForm, TopicForm, AddSupervisorForm, CaseEditForm, CaseFileUpload } from "@/components/features/case-forms";
import { CaseRulesPanel } from "@/components/features/case-rules";
import { listDepartmentOptions } from "@/server/services/organization";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { dict, locale } = await getServerI18n();
  const { id } = await params;
  const tc = await getCaseById(id, user).catch(() => null);
  if (!tc) notFound();

  const [events, supervisors, caseFiles, departments] = await Promise.all([
    getCaseEvents(id),
    getCaseSupervisors(id),
    getCaseFiles(id),
    listDepartmentOptions(),
  ]);

  const statusInfo = STATUS_MAP[tc.currentStatus as keyof typeof STATUS_MAP];
  const toneMap: Record<string, "success" | "info" | "warning" | "danger" | "primary" | "neutral"> = {
    draft: "neutral", submitted: "info", under_review: "primary", revision_required: "warning", approved: "success", rejected: "danger", archived: "neutral",
  };
  // Only transitions whose exact required permission the user holds are shown;
  // the server re-checks the same rule, so this is presentation, not security.
  const available = getAvailableTransitions(tc.currentStatus).filter((t) =>
    user.permissions.includes(t.requiredPermission),
  );
  const canTransition = available.length > 0;
  const canEdit = tc.currentStatus === "draft" || tc.currentStatus === "revision_required";
  const isOwner = tc.studentUserId === user.id;
  const canShowEditForm =
    user.permissions.includes("cases.edit_metadata") ||
    user.permissions.includes("cases.update_assigned") ||
    (isOwner && user.permissions.includes("cases.update_own_draft"));
  const supervisorRoles = supervisors.map((s) => s.roleType === "supervisor" ? dict.cases.form.supervisorRoles.supervisor : s.roleType === "co_supervisor" ? dict.cases.form.supervisorRoles.co_supervisor : dict.cases.form.supervisorRoles.advisor);

  return (
    <>
      <Breadcrumb items={[
        { label: dict.nav.cases, href: "/cases" },
        { label: tc.caseNumber },
      ]} />
      <PageHeader
        title={tc.caseNumber}
        subtitle={tc.titleFa ?? dict.cases.noTitle}
        actions={
          <Badge tone={toneMap[tc.currentStatus] ?? "neutral"}>
            {statusInfo?.fa ?? tc.currentStatus}
          </Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: main content */}
        <div className="grid content-start gap-6 lg:col-span-2">
          {/* Student & Academic Info */}
          <Card className="grid gap-5 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><User className="size-5 text-primary" aria-hidden />{dict.cases.studentInfo}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs text-fg-muted">{dict.cases.form.studentFullName}</p><p className="font-medium">{tc.studentFullName}</p></div>
              <div><p className="text-xs text-fg-muted">{dict.cases.form.studentNumber}</p><p className="font-mono text-sm" dir="ltr">{tc.studentNumber ?? "—"}</p></div>
            </div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="size-5 text-teal-600" aria-hidden />{dict.cases.academicInfo}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs text-fg-muted">{dict.cases.form.department}</p><p>{tc.department ?? "—"}</p></div>
              <div><p className="text-xs text-fg-muted">{dict.cases.form.degreeLevel}</p><p>{tc.degreeLevel}</p></div>
              <div><p className="text-xs text-fg-muted">{dict.cases.form.fieldOfStudy}</p><p>{tc.fieldOfStudy ?? "—"}</p></div>
              <div><p className="text-xs text-fg-muted">{dict.cases.form.academicYear}</p><p>{tc.academicYear ?? "—"}</p></div>
            </div>
          </Card>

          {/* Topic Info */}
          <Card className="grid gap-5 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="size-5 text-accent" aria-hidden />{dict.cases.topicInfo}</h2>
            <div className="grid gap-4">
              <div><p className="text-xs text-fg-muted">{dict.cases.form.titleFa}</p><p className="text-lg font-semibold">{tc.titleFa ?? dict.cases.noTitle}</p></div>
              {tc.titleEn ? <div><p className="text-xs text-fg-muted">{dict.cases.form.titleEn}</p><p dir="ltr">{tc.titleEn}</p></div> : null}
              {tc.abstractFa ? <div><p className="text-xs text-fg-muted">{dict.cases.form.description}</p><p className="text-sm text-fg-muted">{tc.abstractFa}</p></div> : null}
              {tc.keywords ? <div><p className="text-xs text-fg-muted">{dict.cases.form.keywords}</p><p className="text-sm">{tc.keywords}</p></div> : null}
            </div>
            {canEdit && (tc.currentStatus === "draft" || tc.currentStatus === "revision_required") ? (
              <TopicForm caseId={tc.id} dict={dict} existing={{ titleFa: tc.titleFa ?? undefined, titleEn: tc.titleEn ?? undefined, keywords: tc.keywords ?? undefined }} />
            ) : null}
          </Card>

          {/* Timeline */}
          <Card className="p-6">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Clock className="size-5 text-primary" aria-hidden />{dict.cases.caseHistory}</h2>
            <Timeline
              emptyText={dict.cases.noEvents}
              items={events.map((ev) => ({
                id: ev.id,
                title: ev.description ?? ev.eventType,
                description: ev.actorFullName ?? dict.common.system,
                time: formatDateTime(ev.createdAt, locale),
                meta: ev.reason ? `${dict.common.reason}: ${ev.reason}` : undefined,
                tone: ev.eventType === "supervisor_added" || ev.eventType === "topic_saved_draft" ? "success" : ev.eventType === "status_transition" ? "primary" : undefined,
              }))}
            />
          </Card>

          {/* Rule engine verdicts with precise Persian denial reasons */}
          <Card className="p-6">
            <h2 className="mb-2 text-lg font-semibold">{dict.rules.title}</h2>
            <p className="mb-4 text-sm text-fg-muted">{dict.rules.subtitle}</p>
            <CaseRulesPanel caseId={tc.id} />
          </Card>

          {/* Files */}
          <Card className="p-6">
            <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><Upload className="size-5 text-primary" aria-hidden />{dict.cases.files}</h2>
            {caseFiles.length === 0 ? (
              <p className="text-sm text-fg-muted">{dict.cases.noFiles}</p>
            ) : (
              <div className="grid gap-3">
                {caseFiles.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{f.originalName}</p>
                      <p className="text-xs text-fg-muted" dir="ltr">{f.mimeType} · {formatNumber(f.sizeBytes, locale)} B</p>
                    </div>
                    <Link href={`/api/files/${f.fileId}/download`} className="shrink-0 font-medium text-primary hover:underline" target="_blank">
                      <ArrowRight className="inline size-4 rtl:rotate-180" aria-hidden /> دانلود
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {user.permissions.includes("cases.files.upload") ? (
              <CaseFileUpload
                caseId={tc.id}
                dict={dict}
                canDelete={user.permissions.includes("cases.files.upload") && canEdit}
              />
            ) : null}
          </Card>
        </div>

        {/* Right column: actions & sidebar */}
        <div className="grid content-start gap-6">
          {/* Status & Transition */}
          <Card className="grid gap-5 p-6">
            <h2 className="text-lg font-semibold">{dict.cases.transitionStatus}</h2>
            <div className="rounded-lg bg-surface-2 p-4">
              <Badge tone={toneMap[tc.currentStatus] ?? "neutral"}>{statusInfo?.fa ?? tc.currentStatus}</Badge>
              <p className="mt-2 text-xs text-fg-muted">{dict.common.lastUpdated}: {formatDateTime(tc.updatedAt, locale)}</p>
            </div>
            {canTransition ? (
              <CaseTransitionForm caseId={tc.id} currentStatus={tc.currentStatus} transitions={available} dict={dict} />
            ) : (
              <p className="text-sm text-fg-muted">{available.length === 0 ? dict.cases.noEvents : ""}</p>
            )}
          </Card>

          {/* Supervisors */}
          <Card className="grid gap-5 p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5 text-teal-600" aria-hidden />{dict.cases.supervisors}</h2>
            {supervisors.length === 0 ? (
              <p className="text-sm text-fg-muted">{dict.cases.noSupervisor}</p>
            ) : (
              <div className="grid gap-3">
                {supervisors.map((s, i) => (
                  <div key={s.id} className="rounded-lg bg-surface-2 p-4">
                    <p className="font-medium">{s.supervisorName}</p>
                    <p className="text-xs text-fg-muted">{supervisorRoles[i] ?? s.roleType}</p>
                  </div>
                ))}
              </div>
            )}
            {user.permissions.includes("cases.assign_supervisors") ? (
              <AddSupervisorForm caseId={tc.id} dict={dict} />
            ) : null}
          </Card>

          {/* Edit form (only for editable statuses) */}
          {canEdit && canShowEditForm ? (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold">{dict.cases.edit}</h2>
              <CaseEditForm caseId={tc.id} dict={dict} existing={tc} departments={departments} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}