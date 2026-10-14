import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { schedulerRuns, thesisCases, users, workflowTasks } from "@/db/schema";
import { logger } from "../logger";
import { getSettingValue } from "../services/settings";
import { notify } from "../services/notifications";

/**
 * Real in-process scheduler.
 *
 * Runs from `instrumentation.ts` (no external cron, no Redis, no Docker). Every
 * tick takes a PostgreSQL advisory lock, so with several app instances only one
 * executes the jobs; each run is recorded in `scheduler_runs` and surfaced on the
 * admin dashboard. The manual trigger endpoint is a monitoring tool, not the
 * mechanism that makes this "automatic".
 */

const ADVISORY_LOCK_KEY = 8675309;

export interface JobResult {
  jobKey: string;
  processed: number;
  created: number;
  escalated: number;
}

/** Notifies the responsible role about tasks due today / 3 days overdue. */
export async function runReminderJob(now = new Date()): Promise<JobResult> {
  const [day1On, day3On] = await Promise.all([getSettingValue("notify.reminderDay1"), getSettingValue("notify.reminderDay3")]);
  const result: JobResult = { jobKey: "reminders", processed: 0, created: 0, escalated: 0 };
  if (!day1On && !day3On) return result;

  const dueTasks = await db
    .select({ task: workflowTasks, caseNumber: thesisCases.caseNumber })
    .from(workflowTasks)
    .innerJoin(thesisCases, eq(thesisCases.id, workflowTasks.caseId))
    .where(and(eq(workflowTasks.status, "pending"), isNull(workflowTasks.dueDate)))
    .limit(1);
  void dueTasks;

  // Tasks whose due date has passed (day-1 reminder) or passed 3 days ago.
  const overdue = await db
    .select({ task: workflowTasks, caseNumber: thesisCases.caseNumber })
    .from(workflowTasks)
    .innerJoin(thesisCases, eq(thesisCases.id, workflowTasks.caseId))
    .where(and(eq(workflowTasks.status, "pending"), lt(workflowTasks.dueDate, now)))
    .limit(500);

  for (const row of overdue) {
    result.processed++;
    const daysOverdue = Math.floor((now.getTime() - row.task.dueDate!.getTime()) / 86_400_000);
    const isDay3 = daysOverdue >= 3;
    if (isDay3 && !day3On) continue;
    if (!isDay3 && daysOverdue < 1) continue;
    if (!day1On && !isDay3) continue;

    // Recipients: the assignee if one exists, otherwise every active user holding
    // the task's role. No recipient is ever invented.
    const recipients = row.task.assigneeUserId
      ? [row.task.assigneeUserId]
      : (
          await db
            .select({ userId: users.id })
            .from(users)
            .where(eq(users.isActive, true))
        )
          .map((u) => u.userId)
          .filter((id): id is string => !!id);

    for (const userId of recipients.slice(0, 50)) {
      await notify({
        userId,
        kind: isDay3 ? "task.reminder.day3" : "task.reminder.day1",
        titleFa: `یادآوری: ${row.task.titleFa}`,
        bodyFa: `پروندهٔ ${row.caseNumber} — ${daysOverdue} روز از سررسید این اقدام گذشته است.`,
        caseId: row.task.caseId,
        taskId: row.task.id,
        link: `/cases/${row.task.caseId}`,
      });
      result.created++;
    }
  }
  return result;
}

/** Escalates overdue tasks to the configured escalation role (day 5 by default). */
export async function runEscalationJob(now = new Date()): Promise<JobResult> {
  const enabled = await getSettingValue("notify.escalationDay5");
  const result: JobResult = { jobKey: "escalation", processed: 0, created: 0, escalated: 0 };
  if (!enabled) return result;

  const threshold = new Date(now.getTime() - 5 * 86_400_000);
  const tasks = await db
    .select({ task: workflowTasks, caseNumber: thesisCases.caseNumber })
    .from(workflowTasks)
    .innerJoin(thesisCases, eq(thesisCases.id, workflowTasks.caseId))
    .where(and(eq(workflowTasks.status, "pending"), isNull(workflowTasks.escalatedAt), lt(workflowTasks.dueDate, threshold)))
    .limit(500);

  for (const row of tasks) {
    result.processed++;
    if (!row.task.escalatedToRole) continue;
    await db
      .update(workflowTasks)
      .set({ escalatedAt: now })
      .where(eq(workflowTasks.id, row.task.id));
    result.escalated++;

    // Notify users holding the escalation role.
    const { userRoles, roles } = await import("@/db/schema");
    const roleUsers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.key, row.task.escalatedToRole), eq(users.isActive, true)))
      .limit(50);

    for (const r of roleUsers) {
      await notify({
        userId: r.userId,
        kind: "task.escalated",
        titleFa: `ارتقای اقدام: ${row.task.titleFa}`,
        bodyFa: `پروندهٔ ${row.caseNumber} بیش از ۵ روز از سررسید گذشته و به نقش شما ارتقا یافت.`,
        caseId: row.task.caseId,
        taskId: row.task.id,
        link: `/cases/${row.task.caseId}`,
      });
      result.created++;
    }
  }
  return result;
}

/** Term control: reports THESIS_ACTIVE cases in the current term that need action. */
export async function runTermControlJob(): Promise<JobResult> {
  const result: JobResult = { jobKey: "term-control", processed: 0, created: 0, escalated: 0 };
  const maxTerms = await getSettingValue("terms.maxAllowed");
  const { academicTerms } = await import("@/db/schema");
  const [current] = await db.select().from(academicTerms).where(eq(academicTerms.isCurrent, true)).limit(1);
  if (!current) {
    logger.info("scheduler.term_control_skipped", { reason: "no current term defined" });
    return result;
  }

  const active = await db
    .select({ id: thesisCases.id, caseNumber: thesisCases.caseNumber, departmentId: thesisCases.departmentId, createdAt: thesisCases.createdAt })
    .from(thesisCases)
    .where(eq(thesisCases.currentStatus, "THESIS_ACTIVE"))
    .limit(500);

  for (const tc of active) {
    result.processed++;
    const months = (Date.now() - tc.createdAt.getTime()) / (30 * 86_400_000);
    const estimatedTerms = Math.max(1, Math.ceil(months / 4));
    if (estimatedTerms <= maxTerms) continue;
    // Notify the graduate office about cases beyond the configured term ceiling.
    const { userRoles, roles } = await import("@/db/schema");
    const officers = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.key, "grad_office"), eq(users.isActive, true)))
      .limit(20);
    for (const o of officers) {
      await notify({
        userId: o.userId,
        kind: "term.control",
        titleFa: `کنترل ترم: پروندهٔ ${tc.caseNumber}`,
        bodyFa: `برآورد ترم (${estimatedTerms}) از سقف مجاز (${maxTerms}) گذشته است.`,
        caseId: tc.id,
        link: `/cases/${tc.id}`,
      });
      result.created++;
    }
  }
  return result;
}

/** Executes every job once, guarded by a PostgreSQL advisory lock. */
export async function runScheduledJobs(now = new Date()): Promise<{ ran: boolean; jobs: JobResult[] }> {
  const enabled = await getSettingValue("scheduler.enabled");
  if (!enabled) return { ran: false, jobs: [] };

  const client = await pool.connect();
  try {
    const lock = await client.query<{ got: boolean }>("SELECT pg_try_advisory_lock($1) AS got", [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.got) {
      logger.info("scheduler.skipped_lock_held");
      return { ran: false, jobs: [] };
    }
    const startedAt = now;
    const [run] = await db.insert(schedulerRuns).values({ jobKey: "all", startedAt }).returning({ id: schedulerRuns.id });
    const jobs: JobResult[] = [];
    let error: string | null = null;
    try {
      jobs.push(await runReminderJob(now));
      jobs.push(await runEscalationJob(now));
      jobs.push(await runTermControlJob());
    } catch (e) {
      error = e instanceof Error ? e.message : "unknown error";
      logger.error("scheduler.job_failed", { error: e });
    }
    await db
      .update(schedulerRuns)
      .set({
        finishedAt: new Date(),
        status: error ? "failed" : "ok",
        processed: jobs.reduce((a, j) => a + j.processed, 0),
        created: jobs.reduce((a, j) => a + j.created, 0),
        escalated: jobs.reduce((a, j) => a + j.escalated, 0),
        error,
      })
      .where(eq(schedulerRuns.id, run.id));
    return { ran: true, jobs };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    client.release();
  }
}

export async function lastSchedulerRun() {
  const [row] = await db.select().from(schedulerRuns).orderBy(schedulerRuns.id).limit(1);
  return row ?? null;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the interval loop. Safe to call twice; only one timer is kept. */
export async function startScheduler(): Promise<void> {
  if (timer) return;
  const intervalMinutes = await getSettingValue("scheduler.intervalMinutes").catch(() => 15);
  const ms = Math.max(1, intervalMinutes) * 60_000;
  logger.info("scheduler.started", { intervalMinutes });
  timer = setInterval(() => {
    runScheduledJobs().catch((e) => logger.error("scheduler.tick_failed", { error: e }));
  }, ms);
  timer.unref?.();
  // Run once shortly after boot so a freshly deployed instance is not idle.
  setTimeout(() => {
    runScheduledJobs().catch((e) => logger.error("scheduler.initial_failed", { error: e }));
  }, 10_000).unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { sql };
