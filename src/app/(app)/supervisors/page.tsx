import { PageHeader } from "@/components/ui";
import { DeptHeadQueue, ProfessorRequestQueue, SupervisorDirectory } from "@/components/features/supervisor-requests";
import { requireUser } from "@/server/auth/current-user";
import { listProfessorCapacities } from "@/server/services/capacity";
import { listProfessorRequests, listDeptHeadQueue } from "@/server/services/supervisor-requests";
import { listDepartmentOptions } from "@/server/services/organization";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function SupervisorsPage({ searchParams }: { searchParams: Promise<{ caseId?: string }> }) {
  const user = await requireUser();
  const { dict } = await getServerI18n();
  const { caseId } = await searchParams;
  const roleKeys = new Set(user.roles.map((r) => r.key));
  const departments = await listDepartmentOptions();

  // A professor sees their own queue; a department head sees the escalated queue.
  const isProfessor = roleKeys.has("supervisor") || roleKeys.has("advisor");
  const isDeptHead = roleKeys.has("dept_head") || user.permissions.includes("cases.view_all");

  const [myRequests, queue, capacities] = await Promise.all([
    isProfessor ? listProfessorRequests(user.id, "pending") : Promise.resolve([]),
    isDeptHead ? listDeptHeadQueue(user) : Promise.resolve([]),
    listProfessorCapacities(),
  ]);

  return (
    <>
      <PageHeader title={dict.supervisor.requestsTitle} subtitle={dict.supervisor.directorySubtitle} />
      <div className="grid gap-6 lg:grid-cols-2">
        {caseId ? (
          <SupervisorDirectory dict={dict} caseId={caseId} capacities={capacities} />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-5 text-sm text-fg-muted">
            {dict.supervisor.directoryTitle}
            <ul className="mt-3 grid gap-1">
              {departments.map((d) => <li key={d.id}>{d.nameFa}</li>)}
            </ul>
          </div>
        )}
        {isProfessor ? (
          <ProfessorRequestQueue
            dict={dict}
            requests={myRequests.map((r) => ({
              id: r.request.id, caseId: r.request.caseId, roleType: r.request.roleType, status: r.request.status,
              attemptNumber: r.request.attemptNumber, message: r.request.message, rejectionReason: r.request.rejectionReason,
              createdAt: r.request.createdAt.toISOString(), caseNumber: r.caseNumber, studentFullName: r.studentFullName, titleFa: r.titleFa,
            }))}
          />
        ) : null}
        {isDeptHead ? (
          <DeptHeadQueue dict={dict} queue={queue} capacities={capacities} />
        ) : null}
      </div>
    </>
  );
}
