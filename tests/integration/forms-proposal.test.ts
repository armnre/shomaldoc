import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { auditLogs, dynamicFormDefinitions, dynamicFormFields, notifications, proposalVersions, roles, thesisCases, thesisSupervisors, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase } from "@/server/services/case";
import {
  createFormVersion,
  getFormDefinition,
  getPublishedFormDefinition,
  listProposalVersions,
  publishFormVersion,
  decideProposalVersion,
  saveProposalVersion,
  seedDefaultProposalForm,
  updateDraftFormFields,
  validateAnswers,
} from "@/server/services/forms";

/**
 * M5 regression suite (definitions, builder, answers).
 * Covers the three required angles everywhere — success, rejection and unauthorised —
 * plus the versioning invariant: publishing a new version never invalidates or
 * rewrites answers recorded against an older one.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.11.12.13", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdDefinitionIds: number[] = [];
let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let student: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };
let supervisor: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function makeUser(roleKeys: string[]) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m5-${suffix}-${uniq}`,
      email: `m5-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M5 ${uniq}`,
      passwordHash: await hashPassword("Test-M5-2026"),
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

async function makeCase() {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(admin, { studentFullName: `دانشجوی M5 ${uniq}`, studentUserId: student.id, department: "گروه آزمون M5" }, ctx);
  createdCaseIds.push(tc.id);
  await db.insert(thesisSupervisors).values({ caseId: tc.id, userId: supervisor.id, supervisorName: "استاد راهنمای آزمون M5", roleType: "supervisor", status: "active" });
  return tc;
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
  supervisor = await makeUser(["supervisor"]);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(proposalVersions).where(inArray(proposalVersions.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdDefinitionIds.length) {
    await db.delete(dynamicFormFields).where(inArray(dynamicFormFields.definitionId, createdDefinitionIds));
    await db.delete(dynamicFormDefinitions).where(inArray(dynamicFormDefinitions.id, createdDefinitionIds));
  }
  if (createdUserIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("answer validation against the definition", () => {
  const fields = [
    { fieldKey: "title_fa", labelFa: "عنوان فارسی", fieldType: "text", isRequired: true, isActive: true, options: null, validation: { minLength: 5 }, visibleWhen: null },
    { fieldKey: "type", labelFa: "نوع پژوهش", fieldType: "select", isRequired: true, isActive: true, options: ["بنیادی", "کاربردی"], validation: null, visibleWhen: null },
    { fieldKey: "advisor", labelFa: "نام مشاور", fieldType: "text", isRequired: true, isActive: true, options: null, validation: null, visibleWhen: { fieldKey: "has_advisor", equals: "دارد" } },
  ];

  it("accepts a conforming payload", () => {
    const clean = validateAnswers(fields, { title_fa: "عنوان معتبر پژوهش", type: "کاربردی", has_advisor: "ندارد" });
    expect(clean.title_fa).toBe("عنوان معتبر پژوهش");
    // A required field hidden by its condition must not block submission.
    expect(clean.advisor).toBeUndefined();
  });

  it("rejects missing required fields, bad choices and short text", () => {
    expect(() => validateAnswers(fields, { type: "کاربردی" })).toThrow(AppError);
    expect(() => validateAnswers(fields, { title_fa: "عنوان معتبر پژوهش", type: "خیالی" })).toThrow(AppError);
    expect(() => validateAnswers(fields, { title_fa: "کم", type: "بنیادی" })).toThrow(AppError);
  });

  it("requires the conditional field once its condition is met", () => {
    expect(() => validateAnswers(fields, { title_fa: "عنوان معتبر پژوهش", type: "بنیادی", has_advisor: "دارد" })).toThrow(AppError);
    const clean = validateAnswers(fields, { title_fa: "عنوان معتبر پژوهش", type: "بنیادی", has_advisor: "دارد", advisor: "دکتر نمونه" });
    expect(clean.advisor).toBe("دکتر نمونه");
  });

  it("ignores inactive fields entirely", () => {
    const withInactive = [...fields, { fieldKey: "legacy", labelFa: "فیلد قدیمی", fieldType: "text", isRequired: true, isActive: false, options: null, validation: null, visibleWhen: null }];
    const clean = validateAnswers(withInactive, { title_fa: "عنوان معتبر پژوهش", type: "بنیادی", has_advisor: "ندارد" });
    expect(clean.legacy).toBeUndefined();
  });
});

describe("form definitions and versioning", () => {
  it("creates a draft version, refuses publication when invalid, then publishes it", async () => {
    const code = `test_form_${suffix}`;
    const definition = await createFormVersion(
      admin,
      {
        code,
        titleFa: "فرم آزمون پویا",
        fields: [
          { fieldKey: "title_fa", labelFa: "عنوان", fieldType: "text", isRequired: true },
          { fieldKey: "detail", labelFa: "توضیح", fieldType: "textarea" },
        ],
      },
      ctx,
    );
    createdDefinitionIds.push(definition.id);
    expect(definition.version).toBe(1);
    expect(definition.isPublished).toBe(false);

    // A dangling conditional rule is rejected before publication.
    await expect(
      updateDraftFormFields(admin, definition.id, [
        { fieldKey: "title_fa", labelFa: "عنوان", fieldType: "text", isRequired: true },
        { fieldKey: "detail", labelFa: "توضیح", fieldType: "textarea", visibleWhen: { fieldKey: "missing_key", equals: "x" } },
      ], ctx),
    ).rejects.toThrow(AppError);

    await publishFormVersion(admin, definition.id, ctx);
    const published = await getPublishedFormDefinition(code);
    expect(published?.id).toBe(definition.id);

    // A published version is immutable, and a new version is a fresh draft.
    await expect(updateDraftFormFields(admin, definition.id, [{ fieldKey: "title_fa", labelFa: "عنوان", fieldType: "text" }], ctx)).rejects.toThrow(AppError);
    await expect(publishFormVersion(admin, definition.id, ctx)).rejects.toThrow(AppError);

    const v2 = await createFormVersion(admin, { code, titleFa: "فرم آزمون پویا", fields: [{ fieldKey: "title_fa", labelFa: "عنوان", fieldType: "text", isRequired: true }, { fieldKey: "extra", labelFa: "فیلد جدید", fieldType: "text" }] }, ctx);
    createdDefinitionIds.push(v2.id);
    expect(v2.version).toBe(2);
    expect((await getPublishedFormDefinition(code))?.id).toBe(definition.id);
  });

  it("denies form management to a user without forms.manage", async () => {
    await expect(createFormVersion(student, { code: `denied_${suffix}`, titleFa: "فرم غیرمجاز", fields: [{ fieldKey: "field_a", labelFa: "الف", fieldType: "text" }] }, ctx)).rejects.toThrow(AppError);
    const definition = await createFormVersion(admin, { code: `denied_${suffix}`, titleFa: "فرم مجاز", fields: [{ fieldKey: "field_a", labelFa: "الف", fieldType: "text" }] }, ctx);
    createdDefinitionIds.push(definition.id);
    await expect(publishFormVersion(student, definition.id, ctx)).rejects.toThrow(AppError);
    await expect(updateDraftFormFields(supervisor, definition.id, [{ fieldKey: "field_a", labelFa: "الف", fieldType: "text" }], ctx)).rejects.toThrow(AppError);
  });

  it("rejects structurally invalid field definitions", async () => {
    await expect(createFormVersion(admin, { code: `bad_${suffix}`, titleFa: "فرم بد", fields: [{ fieldKey: "Bad Key", labelFa: "کلید بد", fieldType: "text" }] }, ctx)).rejects.toThrow(AppError);
    await expect(createFormVersion(admin, { code: `bad2_${suffix}`, titleFa: "فرم بد ۲", fields: [{ fieldKey: "choice", labelFa: "انتخابی", fieldType: "select" }] }, ctx)).rejects.toThrow(AppError);
    await expect(
      createFormVersion(admin, { code: `bad3_${suffix}`, titleFa: "فرم بد ۳", fields: [{ fieldKey: "dup", labelFa: "الف", fieldType: "text" }, { fieldKey: "dup", labelFa: "ب", fieldType: "text" }] }, ctx),
    ).rejects.toThrow(AppError);
  });

  it("loads a definition with its fields ordered by orderIndex", async () => {
    const definition = await createFormVersion(
      admin,
      {
        code: `ordered_${suffix}`,
        titleFa: "فرم ترتیب",
        fields: [
          { fieldKey: "third", labelFa: "سوم", fieldType: "text", orderIndex: 3 },
          { fieldKey: "first", labelFa: "اول", fieldType: "text", orderIndex: 1 },
          { fieldKey: "second", labelFa: "دوم", fieldType: "text", orderIndex: 2 },
        ],
      },
      ctx,
    );
    createdDefinitionIds.push(definition.id);
    const loaded = await getFormDefinition(definition.id);
    expect(loaded?.fields.map((f) => f.fieldKey)).toEqual(["first", "second", "third"]);
  });
});

describe("proposal answers", () => {
  it("seeds the default proposal form once, idempotently", async () => {
    const first = await seedDefaultProposalForm(admin.id);
    // Only a definition this test actually created may be removed again: the seeded
    // production form is shared data and must survive the suite.
    if (first.created && first.definitionId) createdDefinitionIds.push(first.definitionId);
    const second = await seedDefaultProposalForm(admin.id);
    expect(second.created).toBe(false);
    expect(second.definitionId).toBe(first.definitionId);
    const published = await getPublishedFormDefinition("proposal");
    expect(published?.code).toBe("proposal");
    expect((published?.fields.length ?? 0)).toBeGreaterThan(10);
  });

  it("saves a draft, then submits a validated version and notifies the supervisor", async () => {
    const tc = await makeCase();
    const definition = await getPublishedFormDefinition("proposal");
    const required = (definition?.fields ?? []).filter((f) => f.isRequired && !f.visibleWhen).map((f) => f.fieldKey);
    const answers: Record<string, string> = {};
    for (const key of required) answers[key] = key === "title_fa" ? "عنوان پروپوزال آزمون یکپارچه" : "متن آزمون برای این فیلد در حداقل طول تعیین‌شده و بیشتر از آن.";

    const draft = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: false }, ctx);
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(1);

    const submitted = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: true }, ctx);
    expect(submitted.status).toBe("submitted");
    expect(submitted.version).toBe(2);
    expect(submitted.formVersion).toBe(1);

    const rows = await db.select().from(proposalVersions).where(eq(proposalVersions.caseId, tc.id));
    expect(rows).toHaveLength(2);
    const notification = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, supervisor.id), eq(notifications.kind, "proposal.submitted")));
    expect(notification.length).toBe(1);

    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, student.id), eq(auditLogs.action, "proposal.submitted")));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("rejects an answer payload that violates the definition", async () => {
    const tc = await makeCase();
    await expect(saveProposalVersion(tc.id, student, { code: "proposal", answers: { title_fa: "کم" }, submitForReview: true }, ctx)).rejects.toThrow(AppError);
    const { listProposalVersions } = await import("@/server/services/forms");
    expect(await listProposalVersions(tc.id)).toHaveLength(0);
  });

  it("keeps old answers readable after a newer form version is published", async () => {
    const tc = await makeCase();
    const definition = await getPublishedFormDefinition("proposal");
    const required = (definition?.fields ?? []).filter((f) => f.isRequired && !f.visibleWhen).map((f) => f.fieldKey);
    const answers: Record<string, string> = {};
    for (const key of required) answers[key] = key === "title_fa" ? "عنوان پروپوزال نسخهٔ اول" : "متن آزمون برای این فیلد در حداقل طول تعیین‌شده و بیشتر از آن.";
    const first = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: true }, ctx);
    expect(first.formVersion).toBe(1);

    // Publish version 2 with one extra field; version 1 answers must stay untouched.
    const v2 = await createFormVersion(
      admin,
      {
        code: "proposal",
        titleFa: "پروپوزال پایان‌نامه",
        fields: [{ fieldKey: "title_fa", labelFa: "عنوان فارسی پایان‌نامه", fieldType: "text", isRequired: true, validation: { minLength: 5 } }, { fieldKey: "added_later", labelFa: "فیلد افزوده‌شده", fieldType: "text" }],
      },
      ctx,
    );
    createdDefinitionIds.push(v2.id);
    await publishFormVersion(admin, v2.id, ctx);

    const stillThere = await listProposalVersions(tc.id);
    expect(stillThere[0].formVersion).toBe(1);
    expect(stillThere[0].answers.title_fa).toBe("عنوان پروپوزال نسخهٔ اول");

    // The newly published version is the one a new form renders, and its extra field works.
    const current = await getPublishedFormDefinition("proposal");
    expect(current?.version).toBe(2);
    const second = await saveProposalVersion(tc.id, student, { code: "proposal", answers: { title_fa: "عنوان پروپوزال نسخهٔ دوم", added_later: "مقدار تازه" }, submitForReview: false }, ctx);
    expect(second.formVersion).toBe(2);
    expect(second.answers.added_later).toBe("مقدار تازه");
  });

  it("runs the approval chain: supervisor confirms, group approves, rule-engine row follows", async () => {
    const tc = await makeCase();
    const definition = await getPublishedFormDefinition("proposal");
    const required = (definition?.fields ?? []).filter((f) => f.isRequired && !f.visibleWhen).map((f) => f.fieldKey);
    const answers: Record<string, string> = {};
    for (const key of required) answers[key] = key === "title_fa" ? "عنوان پروپوزال برای آزمون زنجیرهٔ تأیید" : "متن آزمون برای این فیلد در حداقل طول تعیین‌شده و بیشتر از آن.";
    const submitted = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: true }, ctx);

    // A student may never review a proposal.
    await expect(decideProposalVersion(tc.id, submitted.id, student, "approve", null, ctx)).rejects.toThrow(AppError);
    // A revision request without a reason is rejected by the server.
    await expect(decideProposalVersion(tc.id, submitted.id, supervisor, "request_revision", "کم", ctx)).rejects.toThrow(AppError);

    // The supervisor's approval keeps the version open for the group level.
    const afterSupervisor = await decideProposalVersion(tc.id, submitted.id, supervisor, "request_revision", "نیازمند تکمیل بخش روش‌شناسی و افزودن منابع جدید.", ctx);
    expect(afterSupervisor.status).toBe("revision_required");

    const resubmitted = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: true }, ctx);
    const supervisorOk = await decideProposalVersion(tc.id, resubmitted.id, supervisor, "approve", null, ctx);
    expect(supervisorOk.status).toBe("submitted");

    const approved = await decideProposalVersion(tc.id, resubmitted.id, admin, "approve", "تصویب نهایی در تحصیلات تکمیلی.", ctx);
    expect(approved.status).toBe("approved");
    expect(approved.isActive).toBe(true);

    // The structured proposal row the rule engine reads is created from the answers.
    const { proposals } = await import("@/db/schema");
    const rows = await db.select().from(proposals).where(eq(proposals.caseId, tc.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].titleFa).toBe("عنوان پروپوزال برای آزمون زنجیرهٔ تأیید");

    // A second decision on the same version is impossible.
    await expect(decideProposalVersion(tc.id, resubmitted.id, admin, "reject", "دلیل آزمون تصمیم دوباره", ctx)).rejects.toThrow(AppError);
  });

  it("denies proposal review to an unrelated professor (IDOR)", async () => {
    const outsider = await makeUser(["supervisor"]);
    const tc = await makeCase();
    const definition = await getPublishedFormDefinition("proposal");
    const required = (definition?.fields ?? []).filter((f) => f.isRequired && !f.visibleWhen).map((f) => f.fieldKey);
    const answers: Record<string, string> = {};
    for (const key of required) answers[key] = key === "title_fa" ? "عنوان پروپوزال برای آزمون دسترسی نامرتبط" : "متن آزمون برای این فیلد در حداقل طول تعیین‌شده و بیشتر از آن.";
    const submitted = await saveProposalVersion(tc.id, student, { code: "proposal", answers, submitForReview: true }, ctx);
    await expect(decideProposalVersion(tc.id, submitted.id, outsider, "approve", null, ctx)).rejects.toThrow(AppError);
  });

  it("refuses answers from a user with no access to the case", async () => {
    const other = await makeUser(["student"]);
    const tc = await makeCase();
    await expect(saveProposalVersion(tc.id, other, { code: "proposal", answers: { title_fa: "عنوان غیرمجاز برای پروندهٔ دیگران" }, submitForReview: false }, ctx)).rejects.toThrow(AppError);
  });

  it("reports a missing published definition instead of accepting anything", async () => {
    const tc = await makeCase();
    await expect(saveProposalVersion(tc.id, student, { code: `unknown_${suffix}`, answers: {}, submitForReview: true }, ctx)).rejects.toThrow(AppError);
  });
});
