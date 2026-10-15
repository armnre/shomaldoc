import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  academicTerms,
  auditLogs,
  notifications,
  roles,
  thesisCases,
  thesisSupervisors,
  topicVersions,
  literatureReviewVersions,
  literatureReviews,
  userRoles,
  workflowDefinitions,
  workflowInstances,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase, getCaseById } from "@/server/services/case";
import { createTopicVersion, decideTopicVersion, isStageAtOrBefore, listTopicVersions, listReviewQueue, submitLiteratureVersion, decideLiteratureVersion, listLiteratureReviews } from "@/server/services/topic";
import { getSettingValue, updateSetting } from "@/server/services/settings";

/**
 * M4 regression suite: versioned topic approval and literature review.
 * Every test exercises the three required angles — success, rejection, and an
 * unauthorised attempt — plus the invariants that matter operationally
 * (single active version, mandatory reasons, configured stage limit, no data loss).
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.10.10.10", userAgent: "vitest" };
const CASE_DEPARTMENT = "گروه آزمون M4";
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let student: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let supervisor: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let otherSupervisor: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let deptHead: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function makeUser(roleKeys: string[], department: string | null = null) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m4-${suffix}-${uniq}`,
      email: `m4-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M4 ${uniq}`,
      department,
      passwordHash: await hashPassword("Test-M4-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  for (const key of roleKeys) {
    const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  }
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, row.id);
  return { id: row.id, permissions: access.permissions, roles: access.roles };
}

async function newCase() {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(
    admin,
    { studentFullName: `دانشجوی M4 ${uniq}`, studentUserId: student.id, department: CASE_DEPARTMENT },
    ctx,
  );
  createdCaseIds.push(tc.id);
  return tc;
}

async function attachSupervisor(caseId: string, userId: string) {
  await db.insert(thesisSupervisors).values({ caseId, userId, supervisorName: "استاد راهنمای آزمون M4", roleType: "supervisor", status: "active" });
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
  supervisor = await makeUser(["supervisor"]);
  otherSupervisor = await makeUser(["supervisor"]);
  // The group manager belongs to the group the test cases are created in (department-scoped).
  deptHead = await makeUser(["dept_head"], CASE_DEPARTMENT);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(literatureReviewVersions).where(inArray(literatureReviewVersions.caseId, createdCaseIds));
    await db.delete(literatureReviews).where(inArray(literatureReviews.caseId, createdCaseIds));
    await db.delete(topicVersions).where(inArray(topicVersions.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await db.delete(academicTerms).where(eq(academicTerms.code, `M4-${suffix}`));
  await pool.end();
});

describe("M4 topic versions", () => {
  it("registers version 1, notifies the supervisor, and audits the change", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);

    const created = await createTopicVersion(
      tc.id,
      student,
      { titleFa: "بررسی روش‌های یادگیری عمیق در پردازش زبان فارسی", titleEn: "Deep Learning for Persian NLP", keywords: "یادگیری عمیق، فارسی" },
      ctx,
    );
    expect(created.version).toBe(1);
    expect(created.status).toBe("pending_supervisor");
    expect(created.isActive).toBe(false);

    const rows = await db.select().from(topicVersions).where(eq(topicVersions.caseId, tc.id));
    expect(rows).toHaveLength(1);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, student.id), eq(auditLogs.action, "topic.version_created")));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].after).toMatchObject({ version: 1 });

    // The supervising professor of the case is notified; an unrelated one is not.
    const toSupervisor = await db.select().from(notifications).where(and(eq(notifications.userId, supervisor.id), eq(notifications.kind, "topic.submitted")));
    const toOther = await db.select().from(notifications).where(and(eq(notifications.userId, otherSupervisor.id), eq(notifications.kind, "topic.submitted")));
    expect(toSupervisor.length).toBe(1);
    expect(toOther).toHaveLength(0);
  });

  it("walks supervisor approval → group approval and keeps exactly one active version", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع نخست برای آزمون نسخه‌بندی" }, ctx);

    // An unauthorised user (another professor's role but not assigned) cannot approve.
    await expect(decideTopicVersion(tc.id, v1.id, otherSupervisor, "approve_supervisor", null, ctx)).rejects.toBeInstanceOf(AppError);

    const afterSupervisor = await decideTopicVersion(tc.id, v1.id, supervisor, "approve_supervisor", null, ctx);
    expect(afterSupervisor.status).toBe("pending_group");
    expect(afterSupervisor.isActive).toBe(false);

    // Group approval requires the group permission.
    await expect(decideTopicVersion(tc.id, v1.id, student, "approve_group", null, ctx)).rejects.toBeInstanceOf(AppError);
    const approved = await decideTopicVersion(tc.id, v1.id, deptHead, "approve_group", null, ctx);
    expect(approved.status).toBe("approved");
    expect(approved.isActive).toBe(true);

    // Legacy columns stay in sync with the approved version.
    const reloaded = await getCaseById(tc.id, admin);
    expect(reloaded?.titleFa).toBe(approved.titleFa);

    // Version 2 replaces version 1 as the active version.
    const v2 = await createTopicVersion(tc.id, student, { titleFa: "موضوع بازنگری‌شده و تأییدشده نهایی", changeReason: "تغییر جهت پژوهش بر اساس نظر گروه" }, ctx);
    await decideTopicVersion(tc.id, v2.id, supervisor, "approve_supervisor", null, ctx);
    await decideTopicVersion(tc.id, v2.id, deptHead, "approve_group", null, ctx);

    const active = await db.select().from(topicVersions).where(and(eq(topicVersions.caseId, tc.id), eq(topicVersions.isActive, true)));
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);

    const history = await listTopicVersions(tc.id);
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    // History is never rewritten: version 1 is still there with its own decision trail.
    expect(history[1].status).toBe("approved");
    expect(history[1].isActive).toBe(false);
  });

  it("requires a reason for revision and preserves the rejected version", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوعی که نیازمند اصلاح است" }, ctx);

    await expect(decideTopicVersion(tc.id, v1.id, supervisor, "request_revision", "کوچک", ctx)).rejects.toBeInstanceOf(AppError);
    const revised = await decideTopicVersion(tc.id, v1.id, supervisor, "request_revision", "عنوان نیازمند شفاف‌سازی دامنه و جامعهٔ پژوهش است.", ctx);
    expect(revised.status).toBe("revision_required");
    expect(revised.decisionReason).toContain("شفاف‌سازی");

    // The student may resubmit; that is a new version, not an edit of the old one.
    const v2 = await createTopicVersion(tc.id, student, { titleFa: "موضوع اصلاح‌شده با دامنهٔ مشخص", changeReason: "اعمال اصلاحات درخواستی استاد راهنما" }, ctx);
    expect(v2.version).toBe(2);
    const rows = await db.select().from(topicVersions).where(eq(topicVersions.caseId, tc.id));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.version === 1)?.decisionReason).toContain("شفاف‌سازی");
  });

  it("blocks a topic change once the case has passed the configured stage", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع تأییدشدهٔ آزمون محدودیت تغییر" }, ctx);
    await decideTopicVersion(tc.id, v1.id, supervisor, "approve_supervisor", null, ctx);
    await decideTopicVersion(tc.id, v1.id, deptHead, "approve_group", null, ctx);

    // Move the case past the configured limit ("approved" by default).
    await db.update(thesisCases).set({ currentStatus: "archived" }).where(eq(thesisCases.id, tc.id));
    await expect(
      createTopicVersion(tc.id, student, { titleFa: "تغییر دیرهنگام موضوع پس از پایان چرخه", changeReason: "دلیل آزمون برای تغییر" }, ctx),
    ).rejects.toBeInstanceOf(AppError);

    // With a wider setting the same change is allowed again (no hard-coded ceiling).
    await db.update(thesisCases).set({ currentStatus: "approved" }).where(eq(thesisCases.id, tc.id));
    const previous = await getSettingValue("topic.changeAllowedUntil");
    await updateSetting(admin, "topic.changeAllowedUntil", "archived", "آزمون بازکردن سقف تغییر موضوع", ctx);
    try {
      expect(isStageAtOrBefore("archived", "archived")).toBe(true);
      await db.update(thesisCases).set({ currentStatus: "archived" }).where(eq(thesisCases.id, tc.id));
      const v2 = await createTopicVersion(tc.id, student, { titleFa: "تغییر مجاز پس از بازکردن سقف تنظیمات", changeReason: "دلیل آزمون برای تغییر مجاز" }, ctx);
      expect(v2.version).toBe(2);
    } finally {
      await updateSetting(admin, "topic.changeAllowedUntil", previous, "بازگردانی سقف تغییر موضوع", ctx);
    }
  });

  it("forces a mandatory reason when changing an already approved topic", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع تأییدشده برای آزمون دلیل اجباری" }, ctx);
    await decideTopicVersion(tc.id, v1.id, supervisor, "approve_supervisor", null, ctx);
    await decideTopicVersion(tc.id, v1.id, deptHead, "approve_group", null, ctx);

    await expect(createTopicVersion(tc.id, student, { titleFa: "تغییر بدون دلیل قابل قبول موضوع" }, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("keeps drafts invisible to review and out of the queue", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const draft = await createTopicVersion(tc.id, student, { titleFa: "پیش‌نویس ارسال‌نشدهٔ موضوع پژوهش", submitForReview: false }, ctx);
    expect(draft.status).toBe("draft");
    await expect(decideTopicVersion(tc.id, draft.id, supervisor, "approve_supervisor", null, ctx)).rejects.toBeInstanceOf(AppError);
    const queue = await listReviewQueue();
    expect(queue.topic.some((row) => row.id === draft.id)).toBe(false);
  });

  it("refuses cross-case access (IDOR) for an unrelated professor", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع پرونده‌ای که استاد نامرتبط دارد" }, ctx);
    await expect(decideTopicVersion(tc.id, v1.id, otherSupervisor, "request_revision", "دلیل آزمون دسترسی غیرمجاز", ctx)).rejects.toBeInstanceOf(AppError);
    await expect(createTopicVersion(tc.id, otherSupervisor, { titleFa: "تلاش ثبت موضوع توسط کاربر نامرتبط به پرونده" }, ctx)).rejects.toBeInstanceOf(AppError);
  });
});

describe("M4 literature review", () => {
  it("records a submission, enforces the reference floor, and completes a full round", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);

    const minReferences = await getSettingValue("literature.minReferences");
    await expect(
      submitLiteratureVersion(tc.id, student, { summaryFa: "خلاصهٔ پیشینه پژوهش برای آزمون سقف منابع که به اندازهٔ کافی طولانی است.", referencesCount: Math.max(0, minReferences - 1) }, ctx),
    ).rejects.toBeInstanceOf(AppError);

    const v1 = await submitLiteratureVersion(
      tc.id,
      student,
      {
        summaryFa: "پیشینهٔ پژوهش شامل مروری نظام‌مند بر مطالعات داخلی و خارجی حوزهٔ پردازش زبان طبیعی و یادگیری عمیق است.",
        objectivesFa: "شناسایی شکاف پژوهشی",
        referencesCount: minReferences,
      },
      ctx,
    );
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("submitted");

    await expect(decideLiteratureVersion(tc.id, v1.id, supervisor, "request_revision", "کم", ctx)).rejects.toBeInstanceOf(AppError);
    const revised = await decideLiteratureVersion(tc.id, v1.id, supervisor, "request_revision", "نیازمند افزودن منابع سال‌های اخیر و بازنویسی بخش شکاف پژوهشی.", ctx);
    expect(revised.status).toBe("revision_required");

    const v2 = await submitLiteratureVersion(
      tc.id,
      student,
      { summaryFa: "نسخهٔ دوم پیشینه پژوهش با افزودن منابع جدید و بازنویسی بخش شکاف پژوهشی به‌صورت کامل.", referencesCount: minReferences + 3 },
      ctx,
    );
    expect(v2.version).toBe(2);
    const approved = await decideLiteratureVersion(tc.id, v2.id, supervisor, "approve", null, ctx);
    expect(approved.status).toBe("approved");

    const rounds = await listLiteratureReviews(tc.id);
    const allVersions = rounds.flatMap((r) => r.versions);
    expect(allVersions.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(rounds[0].status).toBe("approved");
    expect(rounds[0].rounds).toBe(2);

    // The student is informed exactly once per decision.
    const notified = await db.select().from(notifications).where(and(eq(notifications.userId, student.id), eq(notifications.kind, "literature.revision_required")));
    expect(notified.length).toBe(1);
  });

  it("rejects a review attempt from a user without review rights", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await submitLiteratureVersion(tc.id, student, { summaryFa: "پیشینهٔ پژوهش برای آزمون دسترسی غیرمجاز بررسی توسط کاربر نامرتبط." }, ctx);
    await expect(decideLiteratureVersion(tc.id, v1.id, otherSupervisor, "approve", null, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("prevents double decisions on the same version", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await submitLiteratureVersion(tc.id, student, { summaryFa: "پیشینهٔ پژوهش برای آزمون تصمیم دوباره روی یک نسخهٔ بررسی‌شده." }, ctx);
    await decideLiteratureVersion(tc.id, v1.id, supervisor, "approve", null, ctx);
    await expect(decideLiteratureVersion(tc.id, v1.id, supervisor, "reject", "دلیل آزمون تصمیم دوباره", ctx)).rejects.toBeInstanceOf(AppError);
  });
});

describe("M4 drives the data-driven workflow", () => {
  it("advances the case along workflow_transitions when the full-cycle definition is driving it", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع پرونده‌ای که روی چرخهٔ کامل گردش می‌کند" }, ctx);

    // Put the case on the full-cycle definition at the supervisor review step, exactly
    // as a published full-cycle workflow would have it.
    const { seedWorkflows } = await import("@/server/workflows");
    await seedWorkflows();
    const { workflowDefinitions } = await import("@/db/schema");
    const [fullCycle] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, "thesis_full_cycle")).limit(1);
    expect(fullCycle).toBeDefined();
    await db.update(thesisCases).set({ currentStatus: "WAITING_SUPERVISOR" }).where(eq(thesisCases.id, tc.id));
    await db.update(workflowInstances).set({ definitionId: fullCycle.id, currentStep: "WAITING_SUPERVISOR" }).where(eq(workflowInstances.caseId, tc.id));

    // Supervisor approval moves the case to the step the workflow transition defines.
    await decideTopicVersion(tc.id, v1.id, supervisor, "approve_supervisor", null, ctx);
    const [afterSupervisor] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(afterSupervisor.currentStatus).toBe("GROUP_REVIEW");

    // The group decision then follows the next transition in the graph.
    await decideTopicVersion(tc.id, v1.id, deptHead, "approve_group", null, ctx);
    const [afterGroup] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(afterGroup.currentStatus).toBe("TOPIC_APPROVED");
  });

  it("stays a documented no-op on the core definition that has no topic steps", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const v1 = await createTopicVersion(tc.id, student, { titleFa: "موضوع پروندهٔ روی تعریف هسته برای آزمون بی‌اثری پل گردش‌کار" }, ctx);
    await decideTopicVersion(tc.id, v1.id, supervisor, "approve_supervisor", null, ctx);
    await decideTopicVersion(tc.id, v1.id, deptHead, "approve_group", null, ctx);
    const [after] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(after.currentStatus).toBe("draft");
  });
});

describe("M4 queue and stage helper", () => {
  it("lists submitted literature and pending topic versions for reviewers", async () => {
    const tc = await newCase();
    await attachSupervisor(tc.id, supervisor.id);
    const topic = await createTopicVersion(tc.id, student, { titleFa: "موضوع در صف بررسی برای آزمون فهرست بازبینی" }, ctx);
    const literature = await submitLiteratureVersion(tc.id, student, { summaryFa: "پیشینهٔ پژوهش در صف بررسی برای آزمون فهرست بازبینی کارشناسان." }, ctx);
    const queue = await listReviewQueue();
    expect(queue.topic.some((row) => row.id === topic.id)).toBe(true);
    expect(queue.literature.some((row) => row.id === literature.id)).toBe(true);
  });

  it("orders stages deterministically and defaults unknown stages to the strictest value", () => {
    expect(isStageAtOrBefore("draft", "approved")).toBe(true);
    expect(isStageAtOrBefore("approved", "draft")).toBe(false);
    expect(isStageAtOrBefore("unknown-status", "draft")).toBe(true);
    expect(isStageAtOrBefore("approved", "unknown-limit")).toBe(true);
  });
});
