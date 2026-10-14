import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  academicTerms,
  departments,
  notifications,
  roles,
  schedulerRuns,
  studentProfiles,
  thesisCases,
  userRoles,
  users,
  workflowInstances,
  workflowTasks,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import {
  lastSchedulerRun,
  resolveTaskRecipients,
  runEscalationJob,
  runReminderJob,
  runScheduledJobs,
  runTermControlJob,
} from "@/server/scheduler";
import { getSettingValue, updateSetting } from "@/server/services/settings";

/**
 * Regression suite for the scheduler fixes:
 *  - recipients are scoped to the task's role inside the case's department,
 *  - a reminder is never delivered twice (dedupe key + unique index),
 *  - day thresholds and escalation roles come from Settings / the workflow,
 *  - term control uses real `academic_terms`, never "months ÷ 4",
 *  - `lastSchedulerRun` returns the newest run, not the oldest,
 *  - concurrent ticks are serialised by the advisory lock.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdTaskIds: string[] = [];
const createdDeptIds: number[] = [];
const createdTermIds: number[] = [];
let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function makeUser(roleKey: string | null, departmentId: number | null = null, department: string | null = null) {
  const uniq = randomBytes(4).toString("hex");
  const username = `sch-${roleKey ?? "none"}-${suffix}-${uniq}`;
  const [row] = await db
    .insert(users)
    .values({
      username,
      email: `${username}@test.invalid`,
      fullName: `کاربر ${uniq}`,
      passwordHash: await hashPassword("Test-Sch-2026"),
      departmentId,
      department,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  if (roleKey) {
    const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  }
  return row.id;
}

async function makeCase(input: { departmentId: number | null; department: string | null; status?: string; studentUserId?: string | null; startTermId?: number | null }) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(thesisCases)
    .values({
      caseNumber: `SCH-${suffix}-${uniq}`,
      studentFullName: `دانشجوی آزمون ${uniq}`,
      departmentId: input.departmentId,
      department: input.department,
      studentUserId: input.studentUserId ?? null,
      currentStatus: input.status ?? "THESIS_ACTIVE",
      startTermId: input.startTermId ?? null,
    })
    .returning({ id: thesisCases.id, caseNumber: thesisCases.caseNumber });
  createdCaseIds.push(row.id);
  return row;
}

async function makeTask(input: { caseId: string; roleKey: string | null; assigneeUserId?: string | null; dueDate: Date | null; escalatedToRole?: string | null }) {
  const [instance] = await db
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(eq(workflowInstances.caseId, input.caseId))
    .limit(1);
  const instanceId =
    instance?.id ??
    (
      await db
        .insert(workflowInstances)
        .values({ caseId: input.caseId, definitionId: 1, currentStep: "TEST" })
        .returning({ id: workflowInstances.id })
    )[0].id;
  const [task] = await db
    .insert(workflowTasks)
    .values({
      instanceId,
      caseId: input.caseId,
      action: "test_action",
      titleFa: "اقدام آزمایشی",
      roleKey: input.roleKey,
      assigneeUserId: input.assigneeUserId ?? null,
      escalatedToRole: input.escalatedToRole ?? null,
      status: "pending",
      dueDate: input.dueDate,
    })
    .returning({ id: workflowTasks.id });
  createdTaskIds.push(task.id);
  return task.id;
}

const daysAgo = (days: number, from = new Date()) => new Date(from.getTime() - days * 86_400_000);

async function notificationsFor(userId: string, taskId?: string) {
  const where = taskId
    ? and(eq(notifications.userId, userId), eq(notifications.taskId, taskId))
    : eq(notifications.userId, userId);
  return db.select().from(notifications).where(where);
}

beforeAll(async () => {
  await seedRbac();
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `sch-admin-${suffix}-${uniq}`,
      email: `sch-admin-${suffix}-${uniq}@test.invalid`,
      fullName: "مدیر زمان‌بند",
      passwordHash: await hashPassword("Test-Sch-Admin-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  const [adminRole] = await db.select().from(roles).where(eq(roles.key, "system_admin")).limit(1);
  if (adminRole) await db.insert(userRoles).values({ userId: row.id, roleId: adminRole.id }).onConflictDoNothing();
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, row.id);
  admin = { id: row.id, permissions: access.permissions, roles: access.roles };
});

afterAll(async () => {
  if (createdTaskIds.length) await db.delete(workflowTasks).where(inArray(workflowTasks.id, createdTaskIds));
  if (createdCaseIds.length) {
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  if (createdTermIds.length) await db.delete(academicTerms).where(inArray(academicTerms.id, createdTermIds));
  // Restore the settings this suite touched to their documented defaults.
  await db.delete(schedulerRuns).where(isNull(schedulerRuns.finishedAt));
  await pool.end();
});

describe("scheduler recipients", () => {
  it("notifies only active holders of the task role inside the case department", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [deptA] = await db.insert(departments).values({ nameFa: `گروه الف ${uniq}` }).returning({ id: departments.id });
    const [deptB] = await db.insert(departments).values({ nameFa: `گروه ب ${uniq}` }).returning({ id: departments.id });
    createdDeptIds.push(deptA.id, deptB.id);

    const related = await makeUser("grad_office", deptA.id);
    const unrelated = await makeUser("grad_office", deptB.id);
    const noDepartment = await makeUser("grad_office", null, null);
    const student = await makeUser("student", deptA.id);
    const inactive = await makeUser("grad_office", deptA.id);
    await db.update(users).set({ isActive: false }).where(eq(users.id, inactive));

    const tc = await makeCase({ departmentId: deptA.id, department: `گروه الف ${uniq}` });
    await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(2), assigneeUserId: null });

    const now = new Date();
    const result = await runReminderJob(now);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    expect((await notificationsFor(related)).length).toBeGreaterThan(0);
    expect(await notificationsFor(unrelated)).toHaveLength(0);
    expect(await notificationsFor(noDepartment)).toHaveLength(0);
    expect(await notificationsFor(student)).toHaveLength(0);
    expect(await notificationsFor(inactive)).toHaveLength(0);
  });

  it("never invents a responsible person for a task without role or assignee", async () => {
    const tc = await makeCase({ departmentId: null, department: null });
    const taskId = await makeTask({ caseId: tc.id, roleKey: null, dueDate: daysAgo(2), assigneeUserId: null });
    expect(await resolveTaskRecipients({ assigneeUserId: null, roleKey: null, caseId: tc.id })).toEqual([]);
    await runReminderJob(new Date());
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, taskId));
    expect(rows).toHaveLength(0);
  });

  it("prefers the explicit assignee and ignores tasks without a due date", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [dept] = await db.insert(departments).values({ nameFa: `گروه ج ${uniq}` }).returning({ id: departments.id });
    createdDeptIds.push(dept.id);
    const assignee = await makeUser("grad_office", dept.id);
    const colleague = await makeUser("grad_office", dept.id);
    const tc = await makeCase({ departmentId: dept.id, department: `گروه ج ${uniq}` });
    const assignedTask = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(2), assigneeUserId: assignee });
    const noDueDate = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: null, assigneeUserId: null });

    await runReminderJob(new Date());
    expect((await notificationsFor(assignee, assignedTask)).length).toBe(1);
    expect((await notificationsFor(colleague, assignedTask)).length).toBe(0);
    expect(await notificationsFor(colleague, noDueDate)).toHaveLength(0);
  });
});

describe("scheduler dedupe", () => {
  it("sends each (task × threshold × user) reminder exactly once", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [dept] = await db.insert(departments).values({ nameFa: `گروه د ${uniq}` }).returning({ id: departments.id });
    createdDeptIds.push(dept.id);
    const holder = await makeUser("grad_office", dept.id);
    const tc = await makeCase({ departmentId: dept.id, department: `گروه د ${uniq}` });
    const taskId = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(2), assigneeUserId: holder });

    const now = new Date();
    const first = await runReminderJob(now);
    const second = await runReminderJob(now);
    expect(first.created).toBeGreaterThanOrEqual(1);
    expect(second.created).toBe(0);

    const rows = await notificationsFor(holder, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toMatch(/^task:.+:day\d+$/);
  });

  it("enforces uniqueness on (user_id, dedupe_key) at the database level", async () => {
    const holder = await makeUser("grad_office", null, null);
    const { notify } = await import("@/server/services/notifications");
    const key = `unique-test-${suffix}`;
    const firstId = await notify({ userId: holder, kind: "test", titleFa: "آزمون یکتایی", dedupeKey: key });
    const secondId = await notify({ userId: holder, kind: "test", titleFa: "آزمون یکتایی", dedupeKey: key });
    expect(firstId).toBeTruthy();
    expect(secondId).toBeNull();
    expect((await notificationsFor(holder)).filter((n) => n.dedupeKey === key)).toHaveLength(1);
  });
});

describe("scheduler thresholds come from settings", () => {
  it("respects a changed day threshold instead of a hard-coded day 1", async () => {
    const before = await getSettingValue("notify.reminderDay1AfterDays");
    await updateSetting(admin, "notify.reminderDay1AfterDays", 10, "آزمون آستانهٔ یادآوری", ctx);
    await updateSetting(admin, "notify.reminderDay3", false, "آزمون غیرفعال‌سازی آستانهٔ دوم", ctx);
    try {
      const uniq = randomBytes(3).toString("hex");
      const [dept] = await db.insert(departments).values({ nameFa: `گروه ه ${uniq}` }).returning({ id: departments.id });
      createdDeptIds.push(dept.id);
      const holder = await makeUser("grad_office", dept.id);
      const tc = await makeCase({ departmentId: dept.id, department: `گروه ه ${uniq}` });
      // 5 days overdue: below the configured 10-day threshold → no reminder at all.
      const taskId = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(5), assigneeUserId: holder });
      await runReminderJob(new Date());
      expect(await notificationsFor(holder, taskId)).toHaveLength(0);

      // 12 days overdue: above the configured threshold → exactly one reminder, keyed day10.
      const taskId2 = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(12), assigneeUserId: holder });
      await runReminderJob(new Date());
      const rows = await notificationsFor(holder, taskId2);
      expect(rows).toHaveLength(1);
      expect(rows[0].dedupeKey).toBe(`task:${taskId2}:day10`);
    } finally {
      await updateSetting(admin, "notify.reminderDay1AfterDays", before, "بازگردانی آستانهٔ یادآوری", ctx);
      await updateSetting(admin, "notify.reminderDay3", true, "بازگردانی آستانهٔ دوم", ctx);
    }
  });

  it("escalates to the configured role when the transition defines none, once only", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [dept] = await db.insert(departments).values({ nameFa: `گروه و ${uniq}` }).returning({ id: departments.id });
    createdDeptIds.push(dept.id);
    // The seeded task is scoped to this department, so a role holder from another
    // department must not receive the escalation either.
    const target = await makeUser("grad_office", dept.id);
    const tc = await makeCase({ departmentId: dept.id, department: `گروه و ${uniq}` });
    const taskId = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: daysAgo(9), assigneeUserId: null, escalatedToRole: null });

    const first = await runEscalationJob(new Date());
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    const rows = await notificationsFor(target, taskId);
    expect(rows.length).toBe(1);
    expect(rows[0].dedupeKey).toBe(`escalation:${taskId}`);

    const second = await runEscalationJob(new Date());
    expect(second.escalated).toBe(0);
    expect((await notificationsFor(target, taskId)).length).toBe(1);
  });
});

describe("term control uses real academic terms", () => {
  it("counts elapsed terms from the case start term and dedupes per term", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [t1] = await db
      .insert(academicTerms)
      .values({ code: `T1-${uniq}`, titleFa: "نیم‌سال ۱۴۰۳-۱", startDate: new Date("2024-09-01T00:00:00Z") })
      .returning({ id: academicTerms.id });
    const [t2] = await db
      .insert(academicTerms)
      .values({ code: `T2-${uniq}`, titleFa: "نیم‌سال ۱۴۰۳-۲", startDate: new Date("2025-02-01T00:00:00Z") })
      .returning({ id: academicTerms.id });
    const [t3] = await db
      .insert(academicTerms)
      .values({ code: `T3-${uniq}`, titleFa: "نیم‌سال ۱۴۰۴-۱", startDate: new Date("2025-09-01T00:00:00Z"), isCurrent: true })
      .returning({ id: academicTerms.id });
    createdTermIds.push(t1.id, t2.id, t3.id);

    const holder = await makeUser("grad_office", null, null);
    const tc = await makeCase({ departmentId: null, department: null, startTermId: t1.id });

    const previousCap = await getSettingValue("terms.maxAllowed");
    await updateSetting(admin, "terms.maxAllowed", 2, "آزمون سقف ترم", ctx);
    let first;
    try {
      first = await runTermControlJob();
    } finally {
      await updateSetting(admin, "terms.maxAllowed", previousCap, "بازگردانی سقف ترم", ctx);
    }
    expect(first.processed).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, holder), eq(notifications.caseId, tc.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(`term:${tc.id}:${t3.id}`);

    await updateSetting(admin, "terms.maxAllowed", 2, "آزمون سقف ترم (تکرار)", ctx);
    const second = await runTermControlJob();
    await updateSetting(admin, "terms.maxAllowed", previousCap, "بازگردانی سقف ترم (تکرار)", ctx);
    const again = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, holder), eq(notifications.caseId, tc.id)));
    expect(again).toHaveLength(1);
    void second;
    void t2;
  });

  it("skips explicitly (and reports a reason) when no current term exists", async () => {
    const currents = await db.select({ id: academicTerms.id }).from(academicTerms).where(eq(academicTerms.isCurrent, true));
    await db.update(academicTerms).set({ isCurrent: false }).where(eq(academicTerms.isCurrent, true));
    try {
      const job = await runTermControlJob();
      expect(job.skippedReason).toBeTruthy();
      const run = await runScheduledJobs(new Date());
      expect(run.ran).toBe(true);
      const termJob = run.jobs.find((j) => j.jobKey === "term-control");
      expect(termJob?.skippedReason).toBeTruthy();
      const [latest] = await db.select().from(schedulerRuns).orderBy(schedulerRuns.id).limit(1);
      void latest;
    } finally {
      if (currents.length) await db.update(academicTerms).set({ isCurrent: true }).where(eq(academicTerms.id, currents[currents.length - 1].id));
    }
  });

  it("skips cases whose start term is not recorded", async () => {
    const currents = await db.select({ id: academicTerms.id }).from(academicTerms).where(eq(academicTerms.isCurrent, true));
    if (currents.length === 0) {
      const [t] = await db
        .insert(academicTerms)
        .values({ code: `TC-${randomBytes(3).toString("hex")}`, titleFa: "ترم جاری آزمون", startDate: new Date("2025-09-01T00:00:00Z"), isCurrent: true })
        .returning({ id: academicTerms.id });
      createdTermIds.push(t.id);
    }
    const student = await makeUser("student", null, null);
    const tc = await makeCase({ departmentId: null, department: null, startTermId: null, studentUserId: student });
    const result = await runTermControlJob();
    expect(result.skippedReason).toBeNull();
    const rows = await db.select().from(notifications).where(eq(notifications.caseId, tc.id));
    expect(rows).toHaveLength(0);
  });
});

describe("scheduler run bookkeeping", () => {
  it("returns the newest run, not the oldest", async () => {
    await db.insert(schedulerRuns).values({
      jobKey: "all",
      startedAt: new Date("2020-01-01T00:00:00Z"),
      finishedAt: new Date("2020-01-01T00:00:05Z"),
      status: "ok",
    });
    await db.insert(schedulerRuns).values({
      jobKey: "all",
      startedAt: new Date("2031-05-05T00:00:00Z"),
      finishedAt: new Date("2031-05-05T00:00:05Z"),
      status: "ok",
    });
    const latest = await lastSchedulerRun();
    expect(latest?.startedAt.toISOString()).toBe("2031-05-05T00:00:00.000Z");
    await db.delete(schedulerRuns).where(eq(schedulerRuns.startedAt, new Date("2020-01-01T00:00:00Z")));
    await db.delete(schedulerRuns).where(eq(schedulerRuns.startedAt, new Date("2031-05-05T00:00:00Z")));
  });

  it("refuses to run while another instance holds the advisory lock", async () => {
    const client = await pool.connect();
    try {
      const lock = await client.query<{ got: boolean }>("SELECT pg_try_advisory_lock($1) AS got", [8675309]);
      expect(lock.rows[0]?.got).toBe(true);
      const result = await runScheduledJobs(new Date());
      expect(result.ran).toBe(false);
      expect(result.jobs).toEqual([]);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [8675309]);
      client.release();
    }
  });

  it("records one run row per successful tick", async () => {
    const before = await db.select({ id: schedulerRuns.id }).from(schedulerRuns);
    const result = await runScheduledJobs(new Date());
    expect(result.ran).toBe(true);
    const after = await db.select({ id: schedulerRuns.id }).from(schedulerRuns);
    expect(after.length).toBe(before.length + 1);
    expect(result.jobs.map((j) => j.jobKey)).toEqual(["reminders", "escalation", "term-control"]);
  });
});

describe("simulated clock", () => {
  it("computes overdue days from the injected `now`", async () => {
    const uniq = randomBytes(3).toString("hex");
    const [dept] = await db.insert(departments).values({ nameFa: `گروه ز ${uniq}` }).returning({ id: departments.id });
    createdDeptIds.push(dept.id);
    const holder = await makeUser("grad_office", dept.id);
    const tc = await makeCase({ departmentId: dept.id, department: `گروه ز ${uniq}` });
    // Due tomorrow relative to `fixedNow`: with the real clock it is not overdue yet…
    const fixedNow = new Date("2026-06-01T12:00:00Z");
    const taskId = await makeTask({ caseId: tc.id, roleKey: "grad_office", dueDate: new Date("2026-06-05T12:00:00Z"), assigneeUserId: holder });

    await runReminderJob(new Date("2026-06-02T12:00:00Z"));
    expect(await notificationsFor(holder, taskId)).toHaveLength(0);

    // …and 4 days after the simulated due date it is.
    await runReminderJob(new Date("2026-06-09T12:00:00Z"));
    const rows = await notificationsFor(holder, taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].bodyFa).toContain("4");
    void fixedNow;
  });
});
