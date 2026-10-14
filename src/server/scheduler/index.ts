import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  academicTerms,
  roles,
  schedulerRuns,
  studentProfiles,
  thesisCases,
  userRoles,
  users,
  workflowTasks,
} from "@/db/schema";
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
 *
 * Two invariants are enforced here and covered by tests:
 *  1. A reminder never reaches an unrelated user: with no assignee, recipients are
 *     only active holders of the task's own role, restricted to the case's
 *     department/group scope.
 *  2. A reminder is never duplicated: every generated notification carries a
 *     `dedupeKey` and the database enforces uniqueness on (user_id, dedupe_key).
 * All thresholds (days and target roles) come from Settings / `workflow_transitions`.
 */

const ADVISORY_LOCK_KEY = 8675309;

export interface JobResult {
  jobKey: string;
  processed: number;
  created: number;
  escalated: number;
  /** Set when the job could not run at all; recorded verbatim in `scheduler_runs`. */
  skippedReason: string | null;
}

function emptyResult(jobKey: string, skippedReason: string | null = null): JobResult {
  return { jobKey, processed: 0, created: 0, escalated: 0, skippedReason };
}

const DAY_MS = 86_400_000;

/**
 * Recipients of a task notification.
 *
 * - an explicitly assigned user always wins (one precise recipient);
 * - otherwise, only active users holding the task's `roleKey`, filtered to the
 *   case's group/department scope;
 * - a task without a role and without an assignee has no recipients at all — a
 *   responsible person is never invented.
 */
export async function resolveTaskRecipients(task: {
  assigneeUserId: string | null;
  roleKey: string | null;
  caseId: string;
}): Promise<string[]> {
  if (task.assigneeUserId) return [task.assigneeUserId];
  if (!task.roleKey) return [];

  const [caseRow] = await db
    .select({ departmentId: thesisCases.departmentId, department: thesisCases.department })
    .from(thesisCases)
    .where(eq(thesisCases.id, task.caseId))
    .limit(1);

  const scope = caseRow?.departmentId != null
    ? eq(users.departmentId, caseRow.departmentId)
    : caseRow?.department
      ? eq(users.department, caseRow.department)
      : undefined;

  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, task.roleKey), eq(users.isActive, true), scope))
    .limit(200);

  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Recipients of a role-scoped notification (escalation, term control).
 * `caseId` restricts the search to the case's department/group when the case is
 * scoped, so a role holder from another group is never notified about it.
 */
async function roleRecipients(roleKey: string, caseId?: string): Promise<string[]> {
  let scope: ReturnType<typeof eq> | undefined;
  if (caseId) {
    const [caseRow] = await db
      .select({ departmentId: thesisCases.departmentId, department: thesisCases.department })
      .from(thesisCases)
      .where(eq(thesisCases.id, caseId))
      .limit(1);
    scope = caseRow?.departmentId != null
      ? eq(users.departmentId, caseRow.departmentId)
      : caseRow?.department
        ? eq(users.department, caseRow.department)
        : undefined;
  }
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, roleKey), eq(users.isActive, true), scope))
    .limit(200);
  return [...new Set(rows.map((r) => r.userId))];
}

/** Reminders for tasks whose due date has passed the configured thresholds. */
export async function runReminderJob(now = new Date()): Promise<JobResult> {
  const [day1On, day3On, day1After, day3After] = await Promise.all([
    getSettingValue("notify.reminderDay1"),
    getSettingValue("notify.reminderDay3"),
    getSettingValue("notify.reminderDay1AfterDays"),
    getSettingValue("notify.reminderDay3AfterDays"),
  ]);
  const result = emptyResult("reminders");
  if (!day1On && !day3On) return result;

  const thresholds = [
    ...(day1On ? [{ key: `day${day1After}`, kind: "task.reminder.day1", afterDays: day1After }] : []),
    ...(day3On ? [{ key: `day${day3After}`, kind: "task.reminder.day3", afterDays: day3After }] : []),
  ].sort((a, b) => b.afterDays - a.afterDays);
  if (thresholds.length === 0) return result;

  const oldest = new Date(now.getTime() - thresholds[thresholds.length - 1].afterDays * DAY_MS);
  const overdue = await db
    .select({
      id: workflowTasks.id,
      caseId: workflowTasks.caseId,
      titleFa: workflowTasks.titleFa,
      roleKey: workflowTasks.roleKey,
      assigneeUserId: workflowTasks.assigneeUserId,
      dueDate: workflowTasks.dueDate,
      caseNumber: thesisCases.caseNumber,
    })
    .from(workflowTasks)
    .innerJoin(thesisCases, eq(thesisCases.id, workflowTasks.caseId))
    .where(and(eq(workflowTasks.status, "pending"), lt(workflowTasks.dueDate, oldest)))
    .limit(500);

  for (const row of overdue) {
    const dueDate = row.dueDate;
    if (!dueDate) continue;
    result.processed++;
    const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
    // Highest matching threshold only, so an old task does not blast every level at once.
    const threshold = thresholds.find((t) => daysOverdue >= t.afterDays);
    if (!threshold) continue;

    const recipients = await resolveTaskRecipients({
      assigneeUserId: row.assigneeUserId,
      roleKey: row.roleKey,
      caseId: row.caseId,
    });

    for (const userId of recipients) {
      const id = await notify({
        userId,
        kind: threshold.kind,
        titleFa: `یادآوری: ${row.titleFa}`,
        bodyFa: `پروندهٔ ${row.caseNumber} — ${daysOverdue} روز از سررسید این اقدام گذشته است.`,
        caseId: row.caseId,
        taskId: row.id,
        link: `/cases/${row.caseId}`,
        dedupeKey: `task:${row.id}:${threshold.key}`,
      });
      if (id) result.created++;
    }
  }
  return result;
}

/** Escalates overdue tasks to the transition's escalation role (Settings fallback). */
export async function runEscalationJob(now = new Date()): Promise<JobResult> {
  const [enabled, afterDays, fallbackRole] = await Promise.all([
    getSettingValue("notify.escalationDay5"),
    getSettingValue("notify.escalationAfterDays"),
    getSettingValue("notify.escalationRole"),
  ]);
  const result = emptyResult("escalation");
  if (!enabled) return result;

  const threshold = new Date(now.getTime() - afterDays * DAY_MS);
  const tasks = await db
    .select({
      id: workflowTasks.id,
      caseId: workflowTasks.caseId,
      titleFa: workflowTasks.titleFa,
      escalatedToRole: workflowTasks.escalatedToRole,
      caseNumber: thesisCases.caseNumber,
      dueDate: workflowTasks.dueDate,
    })
    .from(workflowTasks)
    .innerJoin(thesisCases, eq(thesisCases.id, workflowTasks.caseId))
    .where(
      and(
        eq(workflowTasks.status, "pending"),
        isNull(workflowTasks.escalatedAt),
        lt(workflowTasks.dueDate, threshold),
      ),
    )
    .limit(500);

  for (const row of tasks) {
    result.processed++;
    // Destination role: the transition's own escalation role, else the configured one.
    const targetRole = row.escalatedToRole ?? fallbackRole;
    if (!row.dueDate) continue;
    const daysOverdue = Math.floor((now.getTime() - row.dueDate.getTime()) / DAY_MS);

    const recipients = await roleRecipients(targetRole, row.caseId);
    let created = 0;
    for (const userId of recipients) {
      const id = await notify({
        userId,
        kind: "task.escalated",
        titleFa: `ارتقای اقدام: ${row.titleFa}`,
        bodyFa: `پروندهٔ ${row.caseNumber} بیش از ${afterDays} روز از سررسید گذشته (${daysOverdue} روز) و به نقش «${targetRole}» ارتقا یافت.`,
        caseId: row.caseId,
        taskId: row.id,
        link: `/cases/${row.caseId}`,
        dedupeKey: `escalation:${row.id}`,
      });
      if (id) created++;
    }

    // The marker is only written when someone was actually told; a task with no
    // holder of the target role stays visible for the next tick instead of being
    // silently marked as escalated.
    if (created > 0) {
      await db
        .update(workflowTasks)
        .set({ escalatedAt: now, escalatedToRole: targetRole })
        .where(and(eq(workflowTasks.id, row.id), isNull(workflowTasks.escalatedAt)));
      result.escalated++;
      result.created += created;
    }
  }
  return result;
}

/**
 * Term control on real `academic_terms` data.
 *
 * The elapsed term count is the distance between the case's start term and the
 * current term (ordered by `start_date`, then `code`) — never "months ÷ 4". When
 * the current term is not defined the job skips explicitly and the reason is
 * written to `scheduler_runs`.
 */
export async function runTermControlJob(): Promise<JobResult> {
  const [maxTerms, targetRole] = await Promise.all([
    getSettingValue("terms.maxAllowed"),
    getSettingValue("notify.termControlRole"),
  ]);
  const result = emptyResult("term-control");

  const terms = await db
    .select({ id: academicTerms.id, code: academicTerms.code, isCurrent: academicTerms.isCurrent })
    .from(academicTerms)
    .where(eq(academicTerms.isActive, true))
    .orderBy(sql`${academicTerms.startDate} ASC NULLS LAST`, asc(academicTerms.code));

  const currentIndex = terms.findIndex((t) => t.isCurrent);
  if (currentIndex < 0) {
    const reason = "ترم جاری در academic_terms تعریف نشده است؛ کنترل ترم اجرا نشد.";
    logger.info("scheduler.term_control_skipped", { reason });
    return { ...result, skippedReason: reason };
  }
  const current = terms[currentIndex];
  const indexById = new Map(terms.map((t, i) => [t.id, i]));

  const active = await db
    .select({
      id: thesisCases.id,
      caseNumber: thesisCases.caseNumber,
      startTermId: thesisCases.startTermId,
      studentUserId: thesisCases.studentUserId,
    })
    .from(thesisCases)
    .where(eq(thesisCases.currentStatus, "THESIS_ACTIVE"))
    .limit(500);

  for (const tc of active) {
    result.processed++;
    let startTermId = tc.startTermId;
    if (startTermId == null && tc.studentUserId) {
      const [profile] = await db
        .select({ entryTermId: studentProfiles.entryTermId })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, tc.studentUserId))
        .limit(1);
      startTermId = profile?.entryTermId ?? null;
    }
    const startIndex = startTermId != null ? indexById.get(startTermId) : undefined;
    if (startIndex === undefined) {
      // No start term on record: skipping is explicit and logged, never guessed.
      logger.info("scheduler.term_control_case_skipped", { caseId: tc.id, reason: "ترم شروع پرونده ثبت نشده است." });
      continue;
    }
    const termsElapsed = currentIndex - startIndex + 1;
    if (termsElapsed <= maxTerms) continue;

    const recipients = await roleRecipients(targetRole, tc.id);
    for (const userId of recipients) {
      const id = await notify({
        userId,
        kind: "term.control",
        titleFa: `کنترل ترم: پروندهٔ ${tc.caseNumber}`,
        bodyFa: `پرونده در ترم «${current.code}» وارد ${termsElapsed}امین ترم شده و از سقف مجاز (${maxTerms}) گذشته است.`,
        caseId: tc.id,
        link: `/cases/${tc.id}`,
        dedupeKey: `term:${tc.id}:${current.id}`,
      });
      if (id) result.created++;
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
    const [run] = await db.insert(schedulerRuns).values({ jobKey: "all", startedAt: now }).returning({ id: schedulerRuns.id });
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
    const notes = jobs.map((j) => j.skippedReason).filter((n): n is string => !!n);
    await db
      .update(schedulerRuns)
      .set({
        finishedAt: new Date(),
        status: error ? "failed" : notes.length === jobs.length ? "skipped" : "ok",
        processed: jobs.reduce((a, j) => a + j.processed, 0),
        created: jobs.reduce((a, j) => a + j.created, 0),
        escalated: jobs.reduce((a, j) => a + j.escalated, 0),
        note: notes.length ? notes.join(" | ") : null,
        error,
      })
      .where(eq(schedulerRuns.id, run.id));
    return { ran: true, jobs };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    client.release();
  }
}

/** Latest scheduler run (by start time), plus the last *successful* run. */
export async function lastSchedulerRun() {
  const [row] = await db.select().from(schedulerRuns).orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id)).limit(1);
  return row ?? null;
}

export async function lastSuccessfulSchedulerRun() {
  const [row] = await db
    .select()
    .from(schedulerRuns)
    .where(or(eq(schedulerRuns.status, "ok"), eq(schedulerRuns.status, "skipped")))
    .orderBy(desc(schedulerRuns.startedAt), desc(schedulerRuns.id))
    .limit(1);
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
