import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, User, Users, Upload, ArrowRight } from "lucide-react";
import { Badge, Breadcrumb, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current-user";
import { getCaseById, getCaseEvents, getCaseFiles, getCaseSupervisors, getCaseWorkflowProgress } from "@/server/services/case";
import { STATUS_MAP, getAvailableTransitions } from "@/server/workflows";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { maskStudentNumber, maySeePersonalData } from "@/lib/personal-data";
import { CaseTransitionForm, TopicForm, AddSupervisorForm, CaseEditForm, CaseFileUpload } from "@/components/features/case-forms";
import { CaseRulesPanel } from "@/components/features/case-rules";
import { listDepartmentOptions } from "@/server/services/organization";
import { listTopicVersions } from "@/server/services/topic";
import { LiteraturePanel, TopicVersionsPanel } from "@/components/features/case-m4";
import { ProposalPanel } from "@/components/features/proposal-form";
import { IrandocPanel } from "@/components/features/irandoc-panel";
import { CommitteePanel, ExtensionPanel, FinancePanel } from "@/components/features/thesis-admin-panel";
import { SimilarityPanel, ThesisVersionPanel } from "@/components/features/thesis-panel";
import { GraduationPanel } from "@/components/features/graduation-panel";
import { CaseTimeline } from "@/components/features/case-timeline";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { dict, locale } = await getServerI18n();
  const { id } = await params;
  const tc = await getCaseById(id, user).catch(() => null);
  if (!tc) notFound();

  const [events, supervisors, caseFiles, departments, topicVersionRows, workflowProgress] = await Promise.all([
    getCaseEvents(id),
    getCaseSupervisors(id),
    getCaseFiles(id),
    listDepartmentOptions(),
    // Version history is only read when the viewer may see this case at all.
    user.permissions.includes("cases.submit_topic") || user.permissions.includes("cases.review_topic") || user.permissions.includes("cases.view_all") || tc.studentUserId === user.id
      ? listTopicVersions(id)
      : Promise.resolve([]),
    getCaseWorkflowProgress(id),
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
  // Identifiers stay masked unless the viewer owns the case or holds an operator grant.
  const maskedStudentNumber = maySeePersonalData({ isOwner, permissions: user.permissions })
    ? tc.studentNumber
    : maskStudentNumber(tc.studentNumber);
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneMap[tc.currentStatus] ?? "neutral"}>
              {statusInfo?.fa ?? tc.currentStatus}
            </Badge>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-surface-2"
              href={`/api/cases/${tc.id}/pdf`}
            >
              <FileText className="size-4" aria-hidden />
              {dict.cases.downloadPdf}
            </a>
          </div>
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
              <div>
                <p className="text-xs text-fg-muted">{dict.cases.form.studentNumber}</p>
                {/* Personal identifiers are masked for everyone except the owner and operators. */}
                <p className="font-mono text-sm" dir="ltr">{maskedStudentNumber ?? "—"}</p>
              </div>
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

          {/* M4: versioned topic history with the reviewer panel */}
          <TopicVersionsPanel
            caseId={tc.id}
            dict={dict}
            permissions={user.permissions}
            canSubmit={
              (user.permissions.includes("cases.submit_topic") &&
                (isOwner || user.permissions.includes("cases.edit_metadata") || user.permissions.includes("cases.view_all"))) ||
              false
            }
          />

          {/* M4: literature review rounds and versions */}
          <LiteraturePanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          {/* M5: proposal rendered from the published dynamic form definition */}
          <ProposalPanel
            caseId={tc.id}
            dict={dict}
            canSubmit={isOwner || user.permissions.includes("cases.submit_topic")}
            canReview={user.permissions.includes("cases.review_topic")}
          />

          <IrandocPanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <ExtensionPanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <CommitteePanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <FinancePanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <ThesisVersionPanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <SimilarityPanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          <GraduationPanel caseId={tc.id} dict={dict} permissions={user.permissions} />

          {/* Workflow stepper and filterable activity feed */}
          <CaseTimeline
            dict={dict}
            locale={locale}
            progress={workflowProgress ? {
              currentStep: workflowProgress.currentStep,
              steps: workflowProgress.steps.map((step) => ({
                ...step,
                startedAt: step.startedAt?.toISOString() ?? null,
                endedAt: step.endedAt?.toISOString() ?? null,
                dueDate: step.dueDate?.toISOString() ?? null,
              })),
            } : null}
            events={events.map((event) => ({
              id: event.id,
              eventType: event.eventType,
              description: event.description,
              actorFullName: event.actorFullName,
              actorRole: event.actorRole,
              reason: event.reason,
              createdAt: event.createdAt.toISOString(),
            }))}
          />

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