import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workflowDefinitions,
  workflowInstances,
  workflowSteps,
  workflowTransitions,
} from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type Actor, type RequestContext } from "./audit";

/** Actor shape accepted by this service; permissions are re-checked here, not only in the route. */
export interface WorkflowActor {
  id: string;
  permissions?: readonly string[];
  roles?: ReadonlyArray<{ key: string } | string>;
}

function assertCan(actor: WorkflowActor, permission: "workflow.view" | "workflow.manage"): void {
  const perms = actor.permissions ? new Set(actor.permissions) : null;
  if (perms && !perms.has(permission)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای این عملیات را ندارید.", { permission });
  }
}

async function assertCanFromDb(actor: WorkflowActor, permission: "workflow.view" | "workflow.manage"): Promise<void> {
  if (actor.permissions) return assertCan(actor, permission);
  const { loadUserAccess } = await import("../rbac/service");
  const access = await loadUserAccess(db, actor.id);
  if (!access.permissions.includes(permission)) {
    throw new AppError(403, "FORBIDDEN", "دسترسی لازم برای این عملیات را ندارید.", { permission });
  }
}
import { validateGraph, type GraphIssue } from "@/server/workflows/engine";

/**
 * Workflow definition administration.
 *
 * Versioning rule: a definition that already has running instances is never
 * edited in place. Publishing changes creates `version + 1`; open instances
 * keep pointing at the version they started with, so in-flight cases are not
 * retro-fitted with new rules.
 */

export interface StepDraft {
  stepKey: string;
  titleFa: string;
  orderIndex: number;
  isInitial: boolean;
  isTerminal: boolean;
}

export interface TransitionDraft {
  fromStep: string;
  action: string;
  actionLabelFa: string;
  toStep: string;
  requiredPermission: string;
  reasonRequired: boolean;
  assignRole?: string | null;
  dueDays?: number | null;
  escalationRole?: string | null;
}

export async function listDefinitions(actor?: WorkflowActor) {
  if (actor) await assertCanFromDb(actor, "workflow.view");
  const defs = await db.select().from(workflowDefinitions).orderBy(asc(workflowDefinitions.code), desc(workflowDefinitions.version));
  const counts = await db
    .select({ definitionId: workflowInstances.definitionId, open: workflowInstances.endedAt })
    .from(workflowInstances);
  const openByDef = new Map<number, number>();
  for (const c of counts) {
    if (c.open !== null) continue;
    openByDef.set(c.definitionId, (openByDef.get(c.definitionId) ?? 0) + 1);
  }
  return defs.map((d) => ({ ...d, openInstances: openByDef.get(d.id) ?? 0 }));
}

export async function getDefinitionDetail(definitionId: number, actor?: WorkflowActor) {
  if (actor) await assertCanFromDb(actor, "workflow.view");
  const [def] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).limit(1);
  if (!def) throw new AppError(404, "DEFINITION_NOT_FOUND", "تعریف گردش‌کار یافت نشد.");
  const [steps, transitions] = await Promise.all([
    db.select().from(workflowSteps).where(eq(workflowSteps.definitionId, definitionId)).orderBy(asc(workflowSteps.orderIndex)),
    db.select().from(workflowTransitions).where(eq(workflowTransitions.definitionId, definitionId)).orderBy(asc(workflowTransitions.id)),
  ]);
  const issues = validateGraph(steps, transitions);
  return { definition: def, steps, transitions, issues };
}

/** Pure pre-publish validation, exposed so the UI can show Persian reasons. */
export function validateDraft(steps: StepDraft[], transitions: TransitionDraft[]): GraphIssue[] {
  const keySet = new Set(steps.map((s) => s.stepKey));
  const problems: GraphIssue[] = [];
  if (steps.length === 0) problems.push({ code: "NO_INITIAL_STEP", messageFa: "حداقل یک مرحله لازم است." });
  for (const t of transitions) {
    if (!t.action.trim()) problems.push({ code: "UNKNOWN_DESTINATION", messageFa: "کلید اقدام نمی‌تواند خالی باشد.", step: t.fromStep });
    if (!t.requiredPermission.trim()) {
      problems.push({ code: "UNKNOWN_DESTINATION", messageFa: `انتقال «${t.action}» هیچ مجوزی ندارد؛ این ناامن است.`, step: t.fromStep });
    }
    if (!keySet.has(t.fromStep) || !keySet.has(t.toStep)) {
      problems.push({ code: "UNKNOWN_DESTINATION", messageFa: `انتقال «${t.action}» به مرحلهٔ تعریف‌نشده اشاره می‌کند.`, step: t.fromStep });
    }
  }
  const dupKeys = steps.map((s) => s.stepKey).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dupKeys)) {
    problems.push({ code: "UNKNOWN_DESTINATION", messageFa: `کلید مرحلهٔ «${k}» تکراری است.`, step: k });
  }
  const dupActions = transitions.map((t) => `${t.fromStep}|${t.action}`).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dupActions)) {
    problems.push({ code: "UNKNOWN_DESTINATION", messageFa: `اقدام «${k.split("|")[1]}» در مبدأ «${k.split("|")[0]}» تکراری است.` });
  }
  return [...problems, ...validateGraph(steps, transitions)];
}

export interface PublishVersionInput {
  steps: StepDraft[];
  transitions: TransitionDraft[];
  titleFa?: string;
  reason: string;
}

/**
 * Publishes a NEW version of an existing definition. Validation runs before any
 * write; an invalid graph is rejected with the exact Persian reasons.
 */
export async function publishNewVersion(actor: WorkflowActor, definitionId: number, input: PublishVersionInput, ctx: RequestContext) {
  await assertCanFromDb(actor, "workflow.manage");
  const issues = validateDraft(input.steps, input.transitions);
  if (issues.length > 0) {
    throw new AppError(422, "INVALID_GRAPH", "گراف گردش‌کار معتبر نیست.", { issues });
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).for("update").limit(1);
    if (!current) throw new AppError(404, "DEFINITION_NOT_FOUND", "تعریف گردش‌کار یافت نشد.");

    const nextVersion = current.version + 1;
    const [clash] = await tx
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.code, current.code), eq(workflowDefinitions.version, nextVersion)))
      .limit(1);
    if (clash) throw new AppError(409, "VERSION_EXISTS", `نسخهٔ ${nextVersion} از قبل وجود دارد.`);

    const [created] = await tx
      .insert(workflowDefinitions)
      .values({
        code: current.code,
        titleFa: input.titleFa?.trim() || current.titleFa,
        version: nextVersion,
        isPublished: false,
        isActive: true,
        pendingUniversityApproval: current.pendingUniversityApproval,
        createdBy: actor.id,
      })
      .returning();

    await tx.insert(workflowSteps).values(input.steps.map((s) => ({ ...s, definitionId: created.id })));
    await tx.insert(workflowTransitions).values(
      input.transitions.map((t) => ({
        definitionId: created.id,
        fromStep: t.fromStep,
        action: t.action,
        actionLabelFa: t.actionLabelFa,
        toStep: t.toStep,
        requiredPermission: t.requiredPermission,
        reasonRequired: t.reasonRequired,
        assignRole: t.assignRole ?? null,
        dueDays: t.dueDays ?? null,
        escalationRole: t.escalationRole ?? null,
      })),
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "workflow.version_created",
        entityType: "workflow_definition",
        entityId: String(created.id),
        before: { definitionId: current.id, version: current.version },
        after: { definitionId: created.id, version: nextVersion, steps: input.steps.length, transitions: input.transitions.length },
        reason: input.reason,
      },
      ctx,
      tx,
    );

    return created;
  });
}

/** Publishes/unpublishes a draft version. Only one version per code stays active. */
export async function setPublished(actor: WorkflowActor, definitionId: number, published: boolean, reason: string, ctx: RequestContext) {
  await assertCanFromDb(actor, "workflow.manage");
  return db.transaction(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).for("update").limit(1);
    if (!def) throw new AppError(404, "DEFINITION_NOT_FOUND", "تعریف گردش‌کار یافت نشد.");

    if (published) {
      const { steps, transitions } = await getDefinitionGraphForTx(tx, definitionId);
      const issues = validateGraph(steps, transitions);
      if (issues.length > 0) throw new AppError(422, "INVALID_GRAPH", "انتشار گراف نامعتبر مجاز نیست.", { issues });
      // Deactivate other versions of the same code so exactly one is live.
      await tx
        .update(workflowDefinitions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(workflowDefinitions.code, def.code), eq(workflowDefinitions.isPublished, true)));
    }

    await tx
      .update(workflowDefinitions)
      .set({ isPublished: published, isActive: published, updatedAt: new Date() })
      .where(eq(workflowDefinitions.id, definitionId));

    await recordAudit(
      {
        actorUserId: actor.id,
        action: published ? "workflow.published" : "workflow.unpublished",
        entityType: "workflow_definition",
        entityId: String(definitionId),
        before: { isPublished: def.isPublished },
        after: { isPublished: published, code: def.code, version: def.version },
        reason,
      },
      ctx,
      tx,
    );
    const [fresh] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, definitionId)).limit(1);
    return fresh;
  });
}

async function getDefinitionGraphForTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], definitionId: number) {
  const [steps, transitions] = await Promise.all([
    tx.select().from(workflowSteps).where(eq(workflowSteps.definitionId, definitionId)),
    tx.select().from(workflowTransitions).where(eq(workflowTransitions.definitionId, definitionId)),
  ]);
  return { steps, transitions };
}
