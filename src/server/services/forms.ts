import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbLike, type DbTx } from "@/db";
import { dynamicFormDefinitions, dynamicFormFields, proposalVersions, proposals, thesisCaseEvents, thesisCases, workflowInstances } from "@/db/schema";
import { AppError } from "@/server/http";
import { recordAudit, type Actor, type RequestContext } from "./audit";
import { notify } from "./notifications";
import { gateCase, resolveAccess } from "./topic";
import { applyTransition, getAvailableTransitionsFrom, type EngineActor } from "@/server/workflows";

/**
 * M5 — the dynamic form engine (first half: definitions, builder, rendering, answering).
 *
 * Design rules:
 *  - A definition is addressed by `(code, version)`. Publishing is the only way to make a
 *    version renderable, and publishing is additive: existing answers keep pointing at the
 *    version they were submitted against, so a new version never rewrites history.
 *  - Every answer payload is validated on the server against the definition it claims to
 *    answer — required fields, choice membership, length/number/pattern rules and the simple
 *    conditional-display rule. The client-side form is convenience, never the check.
 *  - Answers are stored append-only in `proposal_versions` with a monotonic version number.
 */

export const FIELD_TYPES = ["text", "textarea", "number", "select", "radio", "checkbox", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FormFieldInput {
  fieldKey: string;
  labelFa: string;
  fieldType: FieldType;
  isRequired?: boolean;
  orderIndex?: number;
  placeholderFa?: string | null;
  helpFa?: string | null;
  options?: string[] | null;
  validation?: Record<string, number | string> | null;
  visibleWhen?: { fieldKey: string; equals?: string; notEquals?: string } | null;
  isActive?: boolean;
}

export interface FormDefinitionInput {
  code: string;
  titleFa: string;
  descriptionFa?: string | null;
  stageKey?: string | null;
  fields: FormFieldInput[];
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,58}$/;

function assertFieldShape(field: FormFieldInput, index: number): void {
  if (!KEY_PATTERN.test(field.fieldKey)) {
    throw new AppError(400, "INVALID_FIELD_KEY", `کلید فیلد «${field.fieldKey}» نامعتبر است (حروف کوچک لاتین، عدد و _).`);
  }
  if (!FIELD_TYPES.includes(field.fieldType)) {
    throw new AppError(400, "INVALID_FIELD_TYPE", `نوع فیلد «${field.fieldType}» پشتیبانی نمی‌شود.`);
  }
  if (field.fieldType === "select" || field.fieldType === "radio") {
    if (!field.options || field.options.length === 0) {
      throw new AppError(400, "OPTIONS_REQUIRED", `فیلد «${field.labelFa}» از نوع انتخابی است و باید گزینه داشته باشد.`);
    }
  }
  if (field.validation?.pattern) {
    try {
      new RegExp(String(field.validation.pattern));
    } catch {
      throw new AppError(400, "INVALID_PATTERN", `الگوی اعتبارسنجی فیلد «${field.labelFa}» معتبر نیست.`);
    }
  }
  if (index < 0) throw new AppError(400, "INVALID_ORDER", "ترتیب فیلد نامعتبر است.");
}

/** A conditional rule must point at a field that exists in the same version. */
function assertConditionsResolvable(fields: FormFieldInput[]): void {
  const keys = new Set(fields.map((f) => f.fieldKey));
  for (const field of fields) {
    if (field.visibleWhen && !keys.has(field.visibleWhen.fieldKey)) {
      throw new AppError(400, "DANGLING_CONDITION", `شرط نمایش فیلد «${field.labelFa}» به فیلد ناموجود «${field.visibleWhen.fieldKey}» اشاره می‌کند.`);
    }
  }
}

/** Ordered definitions (newest version first) with a field-count summary for the admin list. */
export async function listFormDefinitions() {
  const definitions = await db
    .select()
    .from(dynamicFormDefinitions)
    .orderBy(asc(dynamicFormDefinitions.code), desc(dynamicFormDefinitions.version));
  const fieldCounts = await db
    .select({ definitionId: dynamicFormFields.definitionId, count: sql<number>`count(*)::int` })
    .from(dynamicFormFields)
    .where(eq(dynamicFormFields.isActive, true))
    .groupBy(dynamicFormFields.definitionId);
  const byId = new Map(fieldCounts.map((r) => [r.definitionId, Number(r.count)]));
  return definitions.map((d) => ({ ...d, activeFieldCount: byId.get(d.id) ?? 0 }));
}

export async function getFormDefinition(definitionId: number, executor: DbLike = db) {
  const [definition] = await executor.select().from(dynamicFormDefinitions).where(eq(dynamicFormDefinitions.id, definitionId)).limit(1);
  if (!definition) return null;
  const fields = await executor
    .select()
    .from(dynamicFormFields)
    .where(eq(dynamicFormFields.definitionId, definitionId))
    .orderBy(asc(dynamicFormFields.orderIndex), asc(dynamicFormFields.id));
  return { ...definition, fields };
}

/** The published version a code currently renders, or null when nothing is published. */
export async function getPublishedFormDefinition(code: string, executor: DbLike = db) {
  const [definition] = await executor
    .select()
    .from(dynamicFormDefinitions)
    .where(and(eq(dynamicFormDefinitions.code, code), eq(dynamicFormDefinitions.isPublished, true), eq(dynamicFormDefinitions.isActive, true)))
    .orderBy(desc(dynamicFormDefinitions.version))
    .limit(1);
  if (!definition) return null;
  const fields = await executor
    .select()
    .from(dynamicFormFields)
    .where(and(eq(dynamicFormFields.definitionId, definition.id), eq(dynamicFormFields.isActive, true)))
    .orderBy(asc(dynamicFormFields.orderIndex), asc(dynamicFormFields.id));
  return { ...definition, fields };
}

/** Creates the next draft version of a form. Requires `forms.manage`. */
export async function createFormVersion(actor: Actor, input: FormDefinitionInput, ctx: RequestContext) {
  const access = await resolveAccess(actor);
  if (!access.permissions.has("forms.manage")) throw new AppError(403, "FORBIDDEN", "دسترسی مدیریت فرم‌ها را ندارید.");
  if (input.fields.length === 0) throw new AppError(400, "NO_FIELDS", "فرم بدون فیلد قابل ثبت نیست.");
  input.fields.forEach(assertFieldShape);
  const keys = input.fields.map((f) => f.fieldKey);
  if (new Set(keys).size !== keys.length) throw new AppError(400, "DUPLICATE_FIELD_KEY", "کلید فیلدها باید یکتا باشد.");
  assertConditionsResolvable(input.fields);

  return db.transaction(async (tx) => {
    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${dynamicFormDefinitions.version}), 0) + 1` })
      .from(dynamicFormDefinitions)
      .where(eq(dynamicFormDefinitions.code, input.code));

    const [definition] = await tx
      .insert(dynamicFormDefinitions)
      .values({
        code: input.code,
        titleFa: input.titleFa,
        descriptionFa: input.descriptionFa ?? null,
        version: Number(nextVersion),
        isPublished: false,
        isActive: true,
        stageKey: input.stageKey ?? null,
        createdBy: actor.id,
      })
      .returning();

    await tx.insert(dynamicFormFields).values(
      input.fields.map((f, index) => ({
        definitionId: definition.id,
        fieldKey: f.fieldKey,
        labelFa: f.labelFa,
        fieldType: f.fieldType,
        isRequired: f.isRequired ?? false,
        orderIndex: f.orderIndex ?? index,
        placeholderFa: f.placeholderFa ?? null,
        helpFa: f.helpFa ?? null,
        options: f.options ?? null,
        validation: f.validation ?? null,
        visibleWhen: f.visibleWhen ?? null,
        isActive: f.isActive ?? true,
      })),
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "forms.version_created",
        entityType: "dynamic_form_definition",
        entityId: String(definition.id),
        after: { code: definition.code, version: definition.version, fields: input.fields.length },
      },
      ctx,
      tx,
    );
    return definition;
  });
}

/** Replaces the field set of a draft version only — published versions are immutable. */
export async function updateDraftFormFields(actor: Actor, definitionId: number, fields: FormFieldInput[], ctx: RequestContext) {
  const access = await resolveAccess(actor);
  if (!access.permissions.has("forms.manage")) throw new AppError(403, "FORBIDDEN", "دسترسی مدیریت فرم‌ها را ندارید.");
  fields.forEach(assertFieldShape);
  const keys = fields.map((f) => f.fieldKey);
  if (new Set(keys).size !== keys.length) throw new AppError(400, "DUPLICATE_FIELD_KEY", "کلید فیلدها باید یکتا باشد.");
  assertConditionsResolvable(fields);

  return db.transaction(async (tx) => {
    const [definition] = await tx.select().from(dynamicFormDefinitions).where(eq(dynamicFormDefinitions.id, definitionId)).for("update").limit(1);
    if (!definition) throw new AppError(404, "FORM_NOT_FOUND", "فرم یافت نشد.");
    if (definition.isPublished) {
      throw new AppError(409, "FORM_PUBLISHED", "نسخهٔ منتشرشده قابل ویرایش نیست؛ نسخهٔ جدید بسازید.");
    }
    const before = await tx.select().from(dynamicFormFields).where(eq(dynamicFormFields.definitionId, definitionId));
    await tx.delete(dynamicFormFields).where(eq(dynamicFormFields.definitionId, definitionId));
    await tx.insert(dynamicFormFields).values(
      fields.map((f, index) => ({
        definitionId,
        fieldKey: f.fieldKey,
        labelFa: f.labelFa,
        fieldType: f.fieldType,
        isRequired: f.isRequired ?? false,
        orderIndex: f.orderIndex ?? index,
        placeholderFa: f.placeholderFa ?? null,
        helpFa: f.helpFa ?? null,
        options: f.options ?? null,
        validation: f.validation ?? null,
        visibleWhen: f.visibleWhen ?? null,
        isActive: f.isActive ?? true,
      })),
    );
    await tx.update(dynamicFormDefinitions).set({ updatedAt: new Date() }).where(eq(dynamicFormDefinitions.id, definitionId));
    await recordAudit(
      {
        actorUserId: actor.id,
        action: "forms.draft_fields_updated",
        entityType: "dynamic_form_definition",
        entityId: String(definitionId),
        before: { fields: before.map((f) => f.fieldKey) },
        after: { fields: keys },
      },
      ctx,
      tx,
    );
    return { definitionId, fieldCount: fields.length };
  });
}

/**
 * Publishes a draft version. Older published versions of the same code stay in place for
 * the answers that reference them; the newest published version becomes the one rendered.
 */
export async function publishFormVersion(actor: Actor, definitionId: number, ctx: RequestContext) {
  const access = await resolveAccess(actor);
  if (!access.permissions.has("forms.manage")) throw new AppError(403, "FORBIDDEN", "دسترسی مدیریت فرم‌ها را ندارید.");

  return db.transaction(async (tx) => {
    const [definition] = await tx.select().from(dynamicFormDefinitions).where(eq(dynamicFormDefinitions.id, definitionId)).for("update").limit(1);
    if (!definition) throw new AppError(404, "FORM_NOT_FOUND", "فرم یافت نشد.");
    if (definition.isPublished) throw new AppError(409, "ALREADY_PUBLISHED", "این نسخه پیش‌تر منتشر شده است.");
    const fields = await tx.select().from(dynamicFormFields).where(eq(dynamicFormFields.definitionId, definitionId));
    const activeFields = fields.filter((f) => f.isActive);
    if (activeFields.length === 0) throw new AppError(400, "NO_ACTIVE_FIELDS", "نسخهٔ بدون فیلد فعال منتشر نمی‌شود.");
    // The same invariant is re-checked on publish: an administrator may have edited
    // the draft through an older client, and a dangling rule must never go live.
    assertConditionsResolvable(
      fields.map((f) => ({ fieldKey: f.fieldKey, labelFa: f.labelFa, fieldType: f.fieldType as FieldType, visibleWhen: f.visibleWhen })),
    );

    const [published] = await tx
      .update(dynamicFormDefinitions)
      .set({ isPublished: true, publishedAt: new Date(), publishedBy: actor.id, updatedAt: new Date() })
      .where(eq(dynamicFormDefinitions.id, definitionId))
      .returning();

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "forms.version_published",
        entityType: "dynamic_form_definition",
        entityId: String(definitionId),
        after: { code: definition.code, version: definition.version, fields: activeFields.length },
      },
      ctx,
      tx,
    );
    return published;
  });
}

/**
 * Validates an answer payload against the definition version it claims to answer.
 * Returns the clean payload; throws a 400 with the exact field labels that failed.
 */
export function validateAnswers(
  fields: Array<{
    fieldKey: string;
    labelFa: string;
    fieldType: string;
    isRequired: boolean;
    isActive: boolean;
    options: string[] | null;
    validation: Record<string, number | string> | null;
    visibleWhen: { fieldKey: string; equals?: string; notEquals?: string } | null;
  }>,
  answers: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const issues: string[] = [];
  const clean: Record<string, string | number | boolean | null> = {};
  const active = fields.filter((f) => f.isActive);

  const isVisible = (field: (typeof active)[number]): boolean => {
    if (!field.visibleWhen) return true;
    const controlling = String(answers[field.visibleWhen.fieldKey] ?? "");
    if (field.visibleWhen.equals !== undefined) return controlling === field.visibleWhen.equals;
    if (field.visibleWhen.notEquals !== undefined) return controlling !== field.visibleWhen.notEquals;
    return true;
  };

  for (const field of active) {
    if (!isVisible(field)) continue;
    const raw = answers[field.fieldKey];
    const missing = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (missing) {
      if (field.isRequired) issues.push(`«${field.labelFa}» الزامی است.`);
      continue;
    }

    if (field.fieldType === "number") {
      const value = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) {
        issues.push(`«${field.labelFa}» باید عدد باشد.`);
        continue;
      }
      const min = field.validation?.min !== undefined ? Number(field.validation.min) : undefined;
      const max = field.validation?.max !== undefined ? Number(field.validation.max) : undefined;
      if (min !== undefined && value < min) issues.push(`«${field.labelFa}» نباید کمتر از ${min} باشد.`);
      if (max !== undefined && value > max) issues.push(`«${field.labelFa}» نباید بیشتر از ${max} باشد.`);
      clean[field.fieldKey] = value;
      continue;
    }

    if (field.fieldType === "checkbox") {
      const list = Array.isArray(raw) ? raw.map((v) => String(v)) : [String(raw)];
      if (field.options && field.options.length > 0) {
        const invalid = list.filter((v) => !field.options!.includes(v));
        if (invalid.length > 0) issues.push(`گزینهٔ نامعتبر برای «${field.labelFa}»: ${invalid.join("، ")}.`);
      }
      clean[field.fieldKey] = list.join("، ");
      continue;
    }

    const text = String(raw).trim();
    if ((field.fieldType === "select" || field.fieldType === "radio") && field.options && !field.options.includes(text)) {
      issues.push(`گزینهٔ انتخاب‌شده برای «${field.labelFa}» معتبر نیست.`);
      continue;
    }
    const minLength = field.validation?.minLength !== undefined ? Number(field.validation.minLength) : undefined;
    const maxLength = field.validation?.maxLength !== undefined ? Number(field.validation.maxLength) : undefined;
    if (minLength !== undefined && text.length < minLength) issues.push(`«${field.labelFa}» باید حداقل ${minLength} نویسه باشد.`);
    if (maxLength !== undefined && text.length > maxLength) issues.push(`«${field.labelFa}» نباید بیشتر از ${maxLength} نویسه باشد.`);
    if (field.validation?.pattern && !new RegExp(String(field.validation.pattern)).test(text)) {
      issues.push(`قالب «${field.labelFa}» با الگوی تعیین‌شده همخوان نیست.`);
    }
    clean[field.fieldKey] = text;
  }

  if (issues.length > 0) {
    throw new AppError(400, "INVALID_ANSWERS", "پاسخ‌های ارسالی با تعریف فرم همخوان نیست.", { issues });
  }
  return clean;
}

/** Saved answers of a case for a form code, newest first. */
export async function listProposalVersions(caseId: string) {
  return db.select().from(proposalVersions).where(eq(proposalVersions.caseId, caseId)).orderBy(desc(proposalVersions.version));
}

/**
 * Saves answers. `submitForReview` moves the version to `submitted` and notifies the
 * case's supervisors; drafts stay private to the author and are never active.
 */
export async function saveProposalVersion(
  caseId: string,
  actor: Actor,
  input: { code: string; answers: Record<string, unknown>; submitForReview: boolean; attachmentFileId?: string | null },
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  if (!gate.isOwner && !gate.access.permissions.has("cases.submit_topic") && !gate.isAssignedSupervisor) {
    throw new AppError(403, "FORBIDDEN", "ثبت پروپوزال برای این پرونده مجاز نیست.");
  }
  const definition = await getPublishedFormDefinition(input.code);
  if (!definition) {
    throw new AppError(409, "FORM_NOT_PUBLISHED", "نسخهٔ منتشرشده‌ای برای این فرم وجود ندارد.");
  }
  const answers = validateAnswers(definition.fields, input.answers);

  return db.transaction(async (tx) => {
    const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, caseId)).for("update").limit(1);
    if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
    if (tc.archivedAt) throw new AppError(409, "CASE_ARCHIVED", "پرونده بایگانی شده و قابل ویرایش نیست.");

    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${proposalVersions.version}), 0) + 1` })
      .from(proposalVersions)
      .where(eq(proposalVersions.caseId, caseId));

    const titleFa = typeof answers.title_fa === "string" ? answers.title_fa : null;
    const titleEn = typeof answers.title_en === "string" ? answers.title_en : null;
    const keywords = typeof answers.keywords === "string" ? answers.keywords : null;

    const [created] = await tx
      .insert(proposalVersions)
      .values({
        caseId,
        definitionId: definition.id,
        formCode: definition.code,
        formVersion: definition.version,
        version: Number(nextVersion),
        answers,
        titleFa,
        titleEn,
        keywords,
        status: input.submitForReview ? "submitted" : "draft",
        isActive: false,
        attachmentFileId: input.attachmentFileId ?? null,
        submittedBy: actor.id,
        submittedAt: input.submitForReview ? new Date() : null,
      })
      .returning();

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: input.submitForReview ? "proposal_submitted" : "proposal_draft_saved",
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `نسخهٔ ${created.version} پروپوزال (فرم ${definition.code} v${definition.version})`,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: input.submitForReview ? "proposal.submitted" : "proposal.draft_saved",
        entityType: "proposal_version",
        entityId: created.id,
        after: { caseId, version: created.version, formCode: definition.code, formVersion: definition.version, fields: Object.keys(answers).length },
      },
      ctx,
      tx,
    );

    if (input.submitForReview) {
      const { thesisSupervisors } = await import("@/db/schema");
      const rows = await tx.select({ userId: thesisSupervisors.userId }).from(thesisSupervisors).where(and(eq(thesisSupervisors.caseId, caseId), eq(thesisSupervisors.status, "active")));
      for (const row of rows) {
        if (!row.userId || row.userId === actor.id) continue;
        await notify(
          {
            userId: row.userId,
            kind: "proposal.submitted",
            titleFa: "پروپوزال جدید برای بررسی",
            bodyFa: `پروندهٔ ${tc.caseNumber} — نسخهٔ ${created.version} پروپوزال ارسال شد.`,
            caseId,
            link: `/cases/${caseId}`,
          },
          tx,
        );
      }
    }

    return created;
  });
}

/**
 * Proposal review decision. The chain follows `workflow_transitions` when the case runs on
 * a definition that carries the proposal steps (PROPOSAL_REVIEW → PROPOSAL_APPROVED /
 * PROPOSAL_REVISION), and always records the decision, the mandatory reason and the audit.
 */
export async function decideProposalVersion(
  caseId: string,
  versionId: string,
  actor: Actor,
  decision: "approve" | "request_revision" | "reject",
  reason: string | null,
  ctx: RequestContext,
) {
  const gate = await gateCase(actor, caseId, db);
  const isSupervisor = gate.isAssignedSupervisor;
  const canGroupReview = gate.access.permissions.has("cases.approve_topic_group");
  const canReview = gate.access.permissions.has("cases.review_topic");
  if (!isSupervisor && !canReview) {
    throw new AppError(403, "FORBIDDEN", "بررسی پروپوزال برای نقش شما مجاز نیست.");
  }
  if (decision !== "approve" && (!reason || reason.trim().length < 5)) {
    throw new AppError(400, "REASON_REQUIRED", "ثبت دلیل برای بازگشت یا رد الزامی است (حداقل ۵ نویسه).");
  }

  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(proposalVersions).where(and(eq(proposalVersions.id, versionId), eq(proposalVersions.caseId, caseId))).for("update").limit(1);
    if (!version) throw new AppError(404, "PROPOSAL_NOT_FOUND", "نسخهٔ پروپوزال یافت نشد.");
    if (version.status !== "submitted") throw new AppError(409, "INVALID_STATUS", "این نسخه در وضعیت قابل بررسی نیست.");

    const newStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revision_required";
    const now = new Date();

    // Approval by a supervisor only closes the first level; the group/graduate office
    // confirms it. The extra level is expressed by the workflow, not by a flag in code.
    if (decision === "approve" && isSupervisor && !canGroupReview) {
      const [updated] = await tx
        .update(proposalVersions)
        .set({ status: "submitted", decisionReason: reason?.trim() ?? null, decidedBy: actor.id, decidedAt: now, updatedAt: now })
        .where(eq(proposalVersions.id, versionId))
        .returning();
      await tx.insert(thesisCaseEvents).values({
        caseId,
        eventType: "proposal_supervisor_approved",
        actorUserId: actor.id,
        actorRole: [...gate.access.roleKeys][0] ?? null,
        description: `تأیید استاد راهنما بر نسخهٔ ${version.version} پروپوزال (در انتظار تأیید گروه)`,
        reason: reason?.trim() ?? null,
      });
      await recordAudit(
        { actorUserId: actor.id, action: "proposal.supervisor_approved", entityType: "proposal_version", entityId: versionId, after: { caseId, version: version.version }, reason: reason?.trim() ?? null },
        ctx,
        tx,
      );
      await advanceProposalWorkflow(tx, caseId, ["PROPOSAL_REVIEW"], { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys }, reason?.trim() ?? null);
      return updated;
    }

    const [updated] = await tx
      .update(proposalVersions)
      .set({
        status: newStatus,
        isActive: newStatus === "approved",
        decidedBy: actor.id,
        decidedAt: now,
        decisionReason: reason?.trim() ?? null,
        updatedAt: now,
      })
      .where(eq(proposalVersions.id, versionId))
      .returning();

    if (newStatus === "approved") {
      // The structured proposal row (used by the rule engine and reports) follows the
      // approved dynamic-form version — answers are never invented, only copied.
      await tx
        .update(proposals)
        .set({
          isActive: false,
          updatedAt: now,
        })
        .where(and(eq(proposals.caseId, caseId), eq(proposals.isActive, true)));
      await tx
        .insert(proposals)
        .values({
          caseId,
          version: version.version,
          isActive: true,
          titleFa: version.titleFa,
          titleEn: version.titleEn,
          keywords: version.keywords,
          problemStatement: asText(version.answers.problem_statement),
          importance: asText(version.answers.importance),
          objectives: asText(version.answers.objectives),
          questions: asText(version.answers.questions),
          hypotheses: asText(version.answers.hypotheses),
          methodology: asText(version.answers.methodology),
          population: asText(version.answers.population),
          tools: asText(version.answers.tools),
          analysis: asText(version.answers.analysis),
          references: asText(version.answers.references),
          status: "approved",
          approvedAt: now,
          approvedBy: actor.id,
          createdBy: actor.id,
        });
    }

    await tx.insert(thesisCaseEvents).values({
      caseId,
      eventType: `proposal_${newStatus}`,
      actorUserId: actor.id,
      actorRole: [...gate.access.roleKeys][0] ?? null,
      description: `نسخهٔ ${version.version} پروپوزال — ${newStatus === "approved" ? "تصویب شد" : newStatus === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
      reason: reason?.trim() ?? null,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: `proposal.${newStatus}`,
        entityType: "proposal_version",
        entityId: versionId,
        before: { status: version.status },
        after: { status: newStatus },
        reason: reason?.trim() ?? null,
      },
      ctx,
      tx,
    );

    const targetSteps = newStatus === "approved" ? ["PROPOSAL_APPROVED"] : newStatus === "rejected" ? ["REJECTED"] : ["PROPOSAL_REVISION"];
    await advanceProposalWorkflow(tx, caseId, targetSteps, { id: actor.id, permissions: gate.access.permissions, roleKeys: gate.access.roleKeys }, reason?.trim() ?? null);

    if (gate.caseRow.studentUserId && gate.caseRow.studentUserId !== actor.id) {
      await notify(
        {
          userId: gate.caseRow.studentUserId,
          kind: `proposal.${newStatus}`,
          titleFa: `پروپوزال — ${newStatus === "approved" ? "تصویب شد" : newStatus === "rejected" ? "رد شد" : "نیازمند اصلاح"}`,
          bodyFa: `پروندهٔ ${gate.caseRow.caseNumber}: نسخهٔ ${version.version}${reason ? ` — دلیل: ${reason.trim()}` : ""}`,
          caseId,
          link: `/cases/${caseId}`,
        },
        tx,
      );
    }
    return updated;
  });
}

/** Copies an answer into the legacy structured column only when it is a string. */
function asText(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  return String(value);
}

/** Walks the proposal steps available in `workflow_transitions` (no hard-coded graph). */
async function advanceProposalWorkflow(
  tx: DbTx,
  caseId: string,
  targetSteps: string[],
  actor: EngineActor,
  reason: string | null,
): Promise<string | null> {
  const [tc] = await tx.select({ instanceId: thesisCases.currentInstanceId }).from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc?.instanceId) return null;
  let lastStep: string | null = null;
  for (const target of targetSteps) {
    const [instance] = await tx
      .select({ definitionId: workflowInstances.definitionId, currentStep: workflowInstances.currentStep })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, tc.instanceId))
      .limit(1);
    if (!instance) return lastStep;
    const available = await getAvailableTransitionsFrom(instance.definitionId, instance.currentStep, tx);
    const transition = available.find((t) => t.toStep === target && actor.permissions.has(t.requiredPermission));
    if (!transition) return lastStep;
    const applied = await applyTransition(tx, { caseId, actor, action: transition.action, reason: reason ?? undefined, now: new Date() });
    lastStep = applied.toStep;
  }
  return lastStep;
}

/**
 * Default proposal form, seeded from the university's standard proposal sections.
 * It is published as version 1 so a student form renders immediately; administrators
 * extend it by publishing new versions (never by editing a published one).
 */
export const DEFAULT_PROPOSAL_FIELDS: FormFieldInput[] = [
  { fieldKey: "title_fa", labelFa: "عنوان فارسی پایان‌نامه", fieldType: "text", isRequired: true, validation: { minLength: 5, maxLength: 300 } },
  { fieldKey: "title_en", labelFa: "عنوان انگلیسی پایان‌نامه", fieldType: "text", validation: { maxLength: 300 } },
  { fieldKey: "problem_statement", labelFa: "بیان مسئله", fieldType: "textarea", isRequired: true, validation: { minLength: 50, maxLength: 8000 } },
  { fieldKey: "importance", labelFa: "ضرورت و اهمیت پژوهش", fieldType: "textarea", validation: { maxLength: 8000 } },
  { fieldKey: "objectives", labelFa: "اهداف پژوهش", fieldType: "textarea", isRequired: true, validation: { maxLength: 8000 } },
  { fieldKey: "questions", labelFa: "پرسش‌های پژوهش", fieldType: "textarea", validation: { maxLength: 8000 } },
  { fieldKey: "hypotheses", labelFa: "فرضیه‌ها", fieldType: "textarea", validation: { maxLength: 8000 } },
  { fieldKey: "methodology", labelFa: "روش‌شناسی پژوهش", fieldType: "textarea", isRequired: true, validation: { maxLength: 8000 } },
  { fieldKey: "population", labelFa: "جامعه و نمونهٔ آماری", fieldType: "textarea", validation: { maxLength: 4000 } },
  { fieldKey: "tools", labelFa: "ابزار گردآوری داده", fieldType: "textarea", validation: { maxLength: 4000 } },
  { fieldKey: "analysis", labelFa: "روش تحلیل داده", fieldType: "textarea", validation: { maxLength: 4000 } },
  { fieldKey: "references", labelFa: "منابع اصلی", fieldType: "textarea", isRequired: true, validation: { maxLength: 8000 } },
  { fieldKey: "keywords", labelFa: "کلیدواژه‌ها", fieldType: "text", validation: { maxLength: 300 } },
  { fieldKey: "research_type", labelFa: "نوع پژوهش", fieldType: "select", options: ["بنیادی", "کاربردی", "توسعه‌ای"], placeholderFa: "انتخاب کنید" },
  { fieldKey: "has_advisor", labelFa: "استاد مشاور دارد", fieldType: "checkbox", options: ["دارد"] },
  { fieldKey: "advisor_name", labelFa: "نام استاد مشاور", fieldType: "text", visibleWhen: { fieldKey: "has_advisor", equals: "دارد" }, helpFa: "تنها در صورت داشتن استاد مشاور نمایش داده می‌شود." },
];

export async function seedDefaultProposalForm(actorId: string | null = null): Promise<{ created: boolean; definitionId: number | null }> {
  const existing = await db.select({ id: dynamicFormDefinitions.id }).from(dynamicFormDefinitions).where(eq(dynamicFormDefinitions.code, "proposal")).limit(1);
  if (existing.length > 0) return { created: false, definitionId: existing[0].id };
  return db.transaction(async (tx) => {
    const [definition] = await tx
      .insert(dynamicFormDefinitions)
      .values({
        code: "proposal",
        titleFa: "پروپوزال پایان‌نامه",
        descriptionFa: "فرم پیش‌فرض پروپوزال بر پایهٔ بخش‌های استاندارد دانشگاه؛ مدیر می‌تواند با انتشار نسخهٔ جدید آن را گسترش دهد.",
        version: 1,
        isPublished: true,
        isActive: true,
        stageKey: "proposal",
        publishedAt: new Date(),
        publishedBy: null,
        createdBy: actorId,
      })
      .returning();
    await tx.insert(dynamicFormFields).values(
      DEFAULT_PROPOSAL_FIELDS.map((f, index) => ({
        definitionId: definition.id,
        fieldKey: f.fieldKey,
        labelFa: f.labelFa,
        fieldType: f.fieldType,
        isRequired: f.isRequired ?? false,
        orderIndex: index,
        placeholderFa: f.placeholderFa ?? null,
        helpFa: f.helpFa ?? null,
        options: f.options ?? null,
        validation: f.validation ?? null,
        visibleWhen: f.visibleWhen ?? null,
        isActive: true,
      })),
    );
    return { created: true, definitionId: definition.id };
  });
}
