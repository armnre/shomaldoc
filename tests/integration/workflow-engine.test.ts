import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { roles, thesisCases, userRoles, users, workflowDefinitions, workflowInstances, workflowTasks } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import { CORE_DEFINITION_CODE, FULL_CYCLE_DEFINITION_CODE, seedWorkflows, validateGraph } from "@/server/workflows";
import { TRANSITIONS } from "@/server/workflows/transitions";
import { getActiveDefinition, getAvailableTransitionsFrom, getDefinitionGraph } from "@/server/workflows/engine";
import {
  getDefinitionDetail,
  listDefinitions,
  publishNewVersion,
  saveWorkflowDraft,
  setPublished,
  validateDraft,
} from "@/server/services/workflow-admin";
import { createCase, transitionStatus } from "@/server/services/case";

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdDefinitionIds: number[] = [];

let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function makeUser(roleKey: string) {
  const unique = randomBytes(4).toString("hex");
  const uname = `wf-${roleKey}-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({ username: uname, email: `${uname}@test.invalid`, fullName: `کاربر گردش‌کار ${unique}`, passwordHash: await hashPassword("Test-Wf-2026") })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, u.id);
  return { id: u.id, permissions: access.permissions, roles: access.roles };
}

beforeAll(async () => {
  await seedRbac();
  await seedWorkflows();
  admin = await makeUser("system_admin");
});

afterAll(async () => {
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdDefinitionIds.length) await db.delete(workflowDefinitions).where(inArray(workflowDefinitions.id, createdDefinitionIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pool.end();
});

describe("validateGraph (pure)", () => {
  it("accepts a well-formed graph", () => {
    const issues = validateGraph(
      [
        { stepKey: "A", isInitial: true, isTerminal: false },
        { stepKey: "B", isInitial: false, isTerminal: true },
      ],
      [{ fromStep: "A", toStep: "B" }],
    );
    expect(issues).toEqual([]);
  });

  it("detects a step without exit, unknown destination, missing/duplicate initial, unreachable step and endless cycle", () => {
    const issues = validateGraph(
      [
        { stepKey: "A", isInitial: true, isTerminal: false },
        { stepKey: "B", isInitial: false, isTerminal: false }, // no exit
        { stepKey: "C", isInitial: false, isTerminal: false }, // unreachable
        { stepKey: "Z", isInitial: false, isTerminal: true },
      ],
      [
        { fromStep: "A", toStep: "X" }, // unknown destination
        { fromStep: "C", toStep: "C" }, // cycle with no terminal
      ],
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("STEP_WITHOUT_EXIT");
    expect(codes).toContain("UNKNOWN_DESTINATION");
    expect(codes).toContain("UNREACHABLE_STEP");
    expect(codes).toContain("CYCLE_WITHOUT_EXIT");
  });

  it("detects missing and multiple initial steps", () => {
    expect(validateGraph([{ stepKey: "A", isInitial: false, isTerminal: true }], []).map((i) => i.code)).toContain("NO_INITIAL_STEP");
    const multi = validateGraph(
      [
        { stepKey: "A", isInitial: true, isTerminal: false },
        { stepKey: "B", isInitial: true, isTerminal: false },
        { stepKey: "Z", isInitial: false, isTerminal: true },
      ],
      [
        { fromStep: "A", toStep: "Z" },
        { fromStep: "B", toStep: "Z" },
      ],
    ).map((i) => i.code);
    expect(multi).toContain("MULTIPLE_INITIAL");
  });

  it("validateDraft rejects a transition without a required permission", () => {
    const issues = validateDraft(
      [
        { stepKey: "A", titleFa: "آ", orderIndex: 0, isInitial: true, isTerminal: false },
        { stepKey: "Z", titleFa: "ز", orderIndex: 1, isInitial: false, isTerminal: true },
      ],
      [{ fromStep: "A", action: "go", actionLabelFa: "برو", toStep: "Z", requiredPermission: "", reasonRequired: false }],
    );
    expect(issues.some((i) => i.messageFa.includes("هیچ مجوزی ندارد"))).toBe(true);
  });
});

describe("seeded definitions", () => {
  it("core definition mirrors the TS catalog exactly (no behaviour change)", async () => {
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(def).not.toBeNull();
    const { steps, transitions } = await getDefinitionGraph(def!.id);
    expect(steps.map((s) => s.stepKey).sort()).toEqual(["approved", "archived", "draft", "rejected", "revision_required", "submitted", "under_review"]);

    const expected = TRANSITIONS.flatMap((t) => t.from.map((f) => `${f}->${t.to}|${t.requiredPermission}|${t.reasonRequired}`)).sort();
    const actual = transitions.map((t) => `${t.fromStep}->${t.toStep}|${t.requiredPermission}|${t.reasonRequired}`).sort();
    expect(actual).toEqual(expected);
  });

  it("full cycle is seeded as an UNPUBLISHED draft pending university approval", async () => {
    const defs = await listDefinitions();
    const full = defs.filter((d) => d.code === FULL_CYCLE_DEFINITION_CODE);
    expect(full.length).toBeGreaterThan(0);
    expect(full.every((d) => d.isPublished === false)).toBe(true);
    expect(full.every((d) => d.pendingUniversityApproval === true)).toBe(true);
    // A draft can never drive a case.
    expect(await getActiveDefinition(FULL_CYCLE_DEFINITION_CODE)).toBeNull();
  });

  it("seeding is idempotent", async () => {
    const before = await listDefinitions();
    await seedWorkflows();
    const after = await listDefinitions();
    expect(after.length).toBe(before.length);
  });
});

describe("engine reads decisions from the database", () => {
  it("available transitions come from workflow_transitions", async () => {
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    const fromSubmitted = await getAvailableTransitionsFrom(def!.id, "submitted");
    expect(fromSubmitted.map((t) => t.toStep).sort()).toEqual(["approved", "rejected", "revision_required", "under_review"]);
    const fromArchived = await getAvailableTransitionsFrom(def!.id, "archived");
    expect(fromArchived).toEqual([]);
  });

  it("creates a case with a live instance at the initial step", async () => {
    const tc = await createCase(admin, { studentFullName: "تست نمونهٔ گردش‌کار" }, ctx);
    createdCaseIds.push(tc.id);
    expect(tc.currentInstanceId).not.toBeNull();
    const [instance] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId!));
    expect(instance.currentStep).toBe("draft");
    expect(instance.endedAt).toBeNull();
  });

  it("transition advances status, instance and opens a task for the assigned role", async () => {
    const tc = await createCase(admin, { studentFullName: "تست تسک گردش‌کار" }, ctx);
    createdCaseIds.push(tc.id);
    const moved = await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    expect(moved.currentStatus).toBe("submitted");

    const [instance] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId!));
    expect(instance.currentStep).toBe("submitted");

    const tasks = await db.select().from(workflowTasks).where(eq(workflowTasks.caseId, tc.id));
    const pending = tasks.filter((t) => t.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].roleKey).toBe("grad_office");
    // A reviewer is never invented: the queue item stays unassigned.
    expect(pending[0].assigneeUserId).toBeNull();
    expect(moved.currentTaskId).toBe(pending[0].id);
  });

  it("rejects an unknown destination and a move the database does not allow", async () => {
    const tc = await createCase(admin, { studentFullName: "تست انتقال نامعتبر" }, ctx);
    createdCaseIds.push(tc.id);
    await expect(transitionStatus(tc.id, admin, { to: "not_a_status" }, ctx)).rejects.toMatchObject({ status: 400, code: "INVALID_STATUS" });
    await expect(transitionStatus(tc.id, admin, { to: "approved" }, ctx)).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
    const [fresh] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(fresh.currentStatus).toBe("draft");
  });

  it("reason requirement is enforced from the database row", async () => {
    const tc = await createCase(admin, { studentFullName: "تست دلیل اجباری" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    await expect(transitionStatus(tc.id, admin, { to: "rejected" }, ctx)).rejects.toMatchObject({ status: 400, code: "REASON_REQUIRED" });
    const rejected = await transitionStatus(tc.id, admin, { to: "rejected", reason: "موضوع تکراری است" }, ctx);
    expect(rejected.currentStatus).toBe("rejected");
  });

  it("terminal step ends the instance and closes pending tasks", async () => {
    const tc = await createCase(admin, { studentFullName: "تست پایان نمونه" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    await transitionStatus(tc.id, admin, { to: "approved" }, ctx);
    const archived = await transitionStatus(tc.id, admin, { to: "archived" }, ctx);
    expect(archived.archivedAt).not.toBeNull();

    const [instance] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId!));
    expect(instance.endedAt).not.toBeNull();
    expect(instance.currentStep).toBe("archived");

    const openTasks = await db
      .select()
      .from(workflowTasks)
      .where(and(eq(workflowTasks.caseId, tc.id), eq(workflowTasks.status, "pending")));
    expect(openTasks).toHaveLength(0);
  });
});

describe("definition versioning", () => {
  it("publishing a new version leaves running instances on the old version", async () => {
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    const tc = await createCase(admin, { studentFullName: "تست نسخه‌بندی" }, ctx);
    createdCaseIds.push(tc.id);
    const [instanceBefore] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId!));

    const detail = await getDefinitionDetail(def!.id);
    const created = await publishNewVersion(
      admin,
      def!.id,
      {
        steps: detail.steps.map((s) => ({ stepKey: s.stepKey, titleFa: s.titleFa, orderIndex: s.orderIndex, isInitial: s.isInitial, isTerminal: s.isTerminal })),
        transitions: detail.transitions.map((t) => ({
          fromStep: t.fromStep,
          action: t.action,
          actionLabelFa: t.actionLabelFa,
          toStep: t.toStep,
          requiredPermission: t.requiredPermission,
          reasonRequired: t.reasonRequired,
          assignRole: t.assignRole,
          dueDays: t.dueDays,
          escalationRole: t.escalationRole,
        })),
        titleFa: "گردش‌کار هستهٔ پرونده (نسخهٔ آزمایشی)",
        reason: "آزمون نسخه‌بندی",
      },
      ctx,
    );
    createdDefinitionIds.push(created.id);
    expect(created.version).toBe(def!.version + 1);
    expect(created.isPublished).toBe(false);

    // The running instance still points at the previous version row.
    const [instanceAfter] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, tc.currentInstanceId!));
    expect(instanceAfter.definitionId).toBe(instanceBefore.definitionId);
    expect(instanceAfter.definitionId).not.toBe(created.id);

    // The old published version is still the active one until the draft is published.
    const stillActive = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(stillActive!.id).toBe(def!.id);
  });

  it("rejects publishing an invalid graph with Persian reasons", async () => {
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    await expect(
      publishNewVersion(
        admin,
        def!.id,
        {
          steps: [{ stepKey: "A", titleFa: "آ", orderIndex: 0, isInitial: true, isTerminal: false }],
          transitions: [{ fromStep: "A", action: "go", actionLabelFa: "برو", toStep: "MISSING", requiredPermission: "cases.archive", reasonRequired: false }],
          reason: "آزمون گراف نامعتبر",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422, code: "INVALID_GRAPH" });
  });

  it("setPublished deactivates other versions of the same code", async () => {
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    // Always branch from the newest version of the code so repeated runs and
    // the previous test's draft cannot collide on (code, version).
    const all = await db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.code, CORE_DEFINITION_CODE))
      .orderBy(desc(workflowDefinitions.version));
    const base = all[0];
    const detail = await getDefinitionDetail(base.id);
    const created = await publishNewVersion(
      admin,
      base.id,
      {
        steps: detail.steps.map((s) => ({ stepKey: s.stepKey, titleFa: s.titleFa, orderIndex: s.orderIndex, isInitial: s.isInitial, isTerminal: s.isTerminal })),
        transitions: detail.transitions.map((t) => ({
          fromStep: t.fromStep, action: t.action, actionLabelFa: t.actionLabelFa, toStep: t.toStep,
          requiredPermission: t.requiredPermission, reasonRequired: t.reasonRequired, assignRole: t.assignRole, dueDays: t.dueDays, escalationRole: t.escalationRole,
        })),
        reason: "آزمون انتشار",
      },
      ctx,
    );
    createdDefinitionIds.push(created.id);

    const published = await setPublished(admin, created.id, true, "انتشار نسخهٔ آزمایشی", ctx);
    expect(published.isPublished).toBe(true);

    const active = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(active!.id).toBe(created.id);
    const [old] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, def!.id));
    expect(old.isActive).toBe(false);

    // Restore the original version so other suites keep their expectations.
    await setPublished(admin, def!.id, true, "بازگردانی نسخهٔ اصلی پس از آزمون", ctx);
    const restored = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(restored!.id).toBe(def!.id);
  });

  it("creates one draft, updates it in place, then publishes exactly one active version", async () => {
    const original = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(original).not.toBeNull();
    const input = {
      steps: [
        { stepKey: "START", titleFa: "شروع آزمون", orderIndex: 0, isInitial: true, isTerminal: false },
        { stepKey: "DONE", titleFa: "پایان آزمون", orderIndex: 1, isInitial: false, isTerminal: true },
      ],
      transitions: [
        { fromStep: "START", action: "finish", actionLabelFa: "پایان", toStep: "DONE", requiredPermission: "cases.archive", reasonRequired: false },
      ],
      reason: "ساخت پیش‌نویس چرخه آزمون",
    };

    const firstDraft = await saveWorkflowDraft(admin, original!.id, input, ctx);
    createdDefinitionIds.push(firstDraft.id);
    expect(firstDraft.isPublished).toBe(false);

    const secondDraft = await saveWorkflowDraft(
      admin,
      firstDraft.id,
      { ...input, steps: [{ ...input.steps[0], titleFa: "شروع ویرایش‌شده" }, input.steps[1]], reason: "ویرایش دوباره همان پیش‌نویس" },
      ctx,
    );
    expect(secondDraft.id).toBe(firstDraft.id);
    const persisted = await getDefinitionDetail(firstDraft.id);
    expect(persisted.steps.find((step) => step.stepKey === "START")?.titleFa).toBe("شروع ویرایش‌شده");

    await setPublished(admin, firstDraft.id, true, "انتشار چرخه آزمون", ctx);
    const versions = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, CORE_DEFINITION_CODE));
    expect(versions.filter((definition) => definition.isActive)).toHaveLength(1);
    expect(versions.find((definition) => definition.isActive)?.id).toBe(firstDraft.id);

    await setPublished(admin, original!.id, true, "بازگردانی نسخه اصلی پس از آزمون چرخه", ctx);
  });

  it("a user without workflow.manage cannot publish or unpublish", async () => {
    const student = await makeUser("student");
    const def = await getActiveDefinition(CORE_DEFINITION_CODE);
    await expect(setPublished(student, def!.id, false, "تلاش ناممجاز", ctx)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(
      publishNewVersion(
        student,
        def!.id,
        { steps: [], transitions: [], reason: "تلاش ناممجاز" },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    // The definition must be untouched by the denied attempts.
    const after = await getActiveDefinition(CORE_DEFINITION_CODE);
    expect(after!.id).toBe(def!.id);
    expect(after!.isPublished).toBe(true);
  });
});
