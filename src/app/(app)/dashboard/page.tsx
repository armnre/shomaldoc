import Link from "next/link";
import { Users, UserCheck, KeyRound, ScrollText, ShieldCheck, Users2, FileText } from "lucide-react";
import { Alert, Badge, Card, EmptyState, PageHeader, StatCard, Timeline } from "@/components/ui";
import { requireUser, can } from "@/server/auth/current-user";
import { getDashboardStats } from "@/server/services/dashboard";
import { getCaseStats, getVisibleCaseIds } from "@/server/services/case";
import { getServerI18n } from "@/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/format";
import { SchedulerPanel } from "@/components/features/scheduler-panel";
import { lastSchedulerRun, lastSuccessfulSchedulerRun } from "@/server/scheduler";
import { getSettingValue } from "@/server/services/settings";
import { pendingAdminCounts } from "@/server/services/thesis-admin";
import { pendingGraduationCount } from "@/server/services/graduation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const { dict, locale } = await getServerI18n();
  const canSeeAdmin = can(user, "users.view") && can(user, "audit.view");
  const canSeeSettings = can(user, "settings.view");
  const stats = canSeeAdmin ? await getDashboardStats() : null;
  // Scheduler health belongs to operators: last run, last success, live settings.
  const [latestRun, latestSuccess, schedulerEnabled] = canSeeSettings
    ? await Promise.all([lastSchedulerRun(), lastSuccessfulSchedulerRun(), getSettingValue("scheduler.enabled")])
    : [null, null, false];

  // Case stats use exactly the same visibility rules as the case list.
  const visibleCaseIds = await getVisibleCaseIds(user);
  const caseStats = visibleCaseIds !== null && visibleCaseIds.length === 0
    ? { total: 0, pending: 0, needsRevision: 0 }
    : await getCaseStats(visibleCaseIds);

  // Role dashboard: the queues the current user is actually responsible for.
  const isReviewer = can(user, "cases.review_topic");
  const [adminPending, graduationPending] = isReviewer
    ? await Promise.all([pendingAdminCounts(), pendingGraduationCount()])
    : [{ extensions: 0, meetings: 0, finances: 0 }, { pending: 0, hasPending: false }];

  return (
    <>
      <PageHeader
        title={canSeeAdmin ? dict.dashboard.title : `${dict.dashboard.welcome}، ${user.fullName}`}
        subtitle={canSeeAdmin ? dict.dashboard.subtitle : dict.dashboard.welcomeText}
      />

      {isReviewer ? (
        <section aria-label={dict.dashboardExtra.myQueues} className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={dict.dashboardExtra.queueExtensions} value={formatNumber(adminPending.extensions, locale)} hint={dict.dashboardExtra.queueHint} icon={<FileText className="size-5" aria-hidden />} tone="accent" />
          <StatCard label={dict.dashboardExtra.queueMeetings} value={formatNumber(adminPending.meetings, locale)} hint={dict.dashboardExtra.queueHint} icon={<FileText className="size-5" aria-hidden />} tone="teal" />
          <StatCard label={dict.dashboardExtra.queueFinances} value={formatNumber(adminPending.finances, locale)} hint={dict.dashboardExtra.queueHint} icon={<FileText className="size-5" aria-hidden />} tone="info" />
          <StatCard label={dict.dashboardExtra.queueGraduation} value={formatNumber(graduationPending.pending, locale)} hint={dict.dashboardExtra.queueHint} icon={<FileText className="size-5" aria-hidden />} tone="primary" />
        </section>
      ) : null}

      {caseStats.total > 0 || canSeeAdmin ? (
        <section aria-label={dict.dashboardExtra.statCases} className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label={dict.dashboardExtra.statCases} value={formatNumber(caseStats.total, locale)} hint={dict.dashboardExtra.statCasesHint} icon={<FileText className="size-5" aria-hidden />} tone="teal" />
          <StatCard label={dict.dashboardExtra.statPendingCases} value={formatNumber(caseStats.pending, locale)} hint={dict.dashboardExtra.statPendingCasesHint} icon={<FileText className="size-5" aria-hidden />} tone="accent" />
          <StatCard label={dict.dashboardExtra.statRevision} value={formatNumber(caseStats.needsRevision, locale)} hint={dict.dashboardExtra.statRevisionHint} icon={<FileText className="size-5" aria-hidden />} tone="info" />
        </section>
      ) : null}

      {stats ? (
        <>
          <section aria-label={dict.dashboard.title} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={dict.dashboard.statUsers} value={formatNumber(stats.totalUsers, locale)} hint={dict.dashboard.statUsersHint} icon={<Users className="size-5" aria-hidden />} tone="primary" />
            <StatCard label={dict.dashboard.statActiveUsers} value={formatNumber(stats.activeUsers, locale)} hint={dict.dashboard.statActiveUsersHint} icon={<UserCheck className="size-5" aria-hidden />} tone="teal" />
            <StatCard label={dict.dashboard.statSessions} value={formatNumber(stats.activeSessions, locale)} hint={dict.dashboard.statSessionsHint} icon={<KeyRound className="size-5" aria-hidden />} tone="info" />
            <StatCard label={dict.dashboard.statAudit} value={formatNumber(stats.auditLast24h, locale)} hint={dict.dashboard.statAuditHint} icon={<ScrollText className="size-5" aria-hidden />} tone="accent" />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="p-6 lg:col-span-2">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{dict.dashboard.recentActivity}</h2>
                  <p className="text-sm text-fg-muted">{dict.dashboard.recentActivityText}</p>
                </div>
                <Link href="/admin/audit" className="text-sm font-medium text-primary hover:underline">{dict.dashboard.viewAll}</Link>
              </div>
              <Timeline
                emptyText={dict.dashboard.noActivity}
                items={stats.recentActivity.map((row) => ({
                  id: row.id,
                  title: (dict.auditActions as Record<string, string>)[row.action] ?? row.action,
                  description: `${row.actorFullName ?? dict.common.system} · ${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""}`,
                  time: formatDateTime(row.createdAt, locale),
                  tone: row.action.includes("failed") ? "danger" : row.action.includes("changed") || row.action.includes("updated") ? "warning" : "success",
                }))}
              />
            </Card>

            <Card className="grid content-start gap-4 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="size-5 text-teal-600" aria-hidden />{dict.dashboard.quickActions}</h2>
              <div className="grid gap-2">
                <Link href="/admin/users" className="rounded-md border border-border px-4 py-3 text-sm font-medium hover:bg-surface-2">{dict.nav.users}</Link>
                <Link href="/admin/roles" className="rounded-md border border-border px-4 py-3 text-sm font-medium hover:bg-surface-2">{dict.nav.roles}</Link>
                <Link href="/admin/settings" className="rounded-md border border-border px-4 py-3 text-sm font-medium hover:bg-surface-2">{dict.nav.settings}</Link>
              </div>
              <Users2 className="mt-2 size-10 self-center text-primary/30" aria-hidden />
            </Card>
          </div>

          {canSeeSettings ? (
            <SchedulerPanel
              lastRun={latestRun ? { ...latestRun, startedAt: latestRun.startedAt.toISOString(), finishedAt: latestRun.finishedAt ? latestRun.finishedAt.toISOString() : null } : null}
              lastSuccess={
                latestSuccess ? { ...latestSuccess, startedAt: latestSuccess.startedAt.toISOString(), finishedAt: latestSuccess.finishedAt ? latestSuccess.finishedAt.toISOString() : null } : null
              }
              enabled={schedulerEnabled}
              canRun={can(user, "settings.manage")}
              locale={locale}
              labels={dict.scheduler}
            />
          ) : null}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="mb-3 text-lg font-semibold">{dict.dashboard.myRoles}</h2>
            {user.roles.length === 0 ? (
              <EmptyState title={dict.dashboard.noRoles} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {user.roles.map((r) => (
                  <Badge key={r.id} tone="primary">{dict.roleNames[r.key] ?? r.nameFa}</Badge>
                ))}
              </div>
            )}
          </Card>
          <Alert tone="info" title={dict.dashboard.welcome}>{dict.dashboard.welcomeText}</Alert>
        </div>
      )}
    </>
  );
}
