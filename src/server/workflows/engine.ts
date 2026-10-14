import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  thesisCases,
  workflowDefinitions,
  workflowInstances,
  workflowSteps,
  workflowTaskHistory,
  workflowTasks,
  workflowTransitions,
} from "@/db/schema";
import { AppError } from "../http";
import type { TransitionDef } from "./transitions";

/**
 * Data-driven workflow engine.
 *
 * `workflow_transitions` is the single decision source at runtime: permissions,
 * reason requirements, due dates and escalation roles all come from the
 * database, never from hard-coded arrays. The TS catalog only seeds it.
 *
 * Case status, the running instance and the current task are three separate
 * concepts:
 *   thesis_cases.current_status      – where the case stands
 *   thesis_cases.current_instance_id – which definition version is running
 *   thesis_cases.current_task_id     – who must act next
 */

export interface DbTransition {
  id: number;
  definitionId: number;
  fromStep: string;
  action: string;
  actionLabelFa: string;
  toStep: string;
  requiredPermission: string;
  reasonRequired: boolean;
  assignRole: string | null;
  dueDays: number | null;
  escalationRole: string | null;
}

export type Executor = DbTx | typeof db;

/** Pure: groups transitions by source step. */
export function indexByFromStep(rows: DbTransition[]): Map<string, DbTransition[]> {
  const map = new Map<string, DbTransition[]>();
  for (const row of rows) {
    const list = map.get(row.fromStep) ?? [];
    list.push(row);
    map.set(row.fromStep, list);
  }
  return map;
}

export interface GraphIssue {
  code: "STEP_WITHOUT_EXIT" | "UNKNOWN_DESTINATION" | "UNREACHABLE_STEP" | "NO_INITIAL_STEP" | "MULTIPLE_INITIAL" | "CYCLE_WITHOUT_EXIT";
  messageFa: string;
  step?: string;
}

/**
 * Pure graph validation used before publishing a definition version.
 * Detects steps with no exit, transitions to unknown destinations, unreachable
 * steps, missing/duplicate initial steps, and cycles that cannot terminate.
 */
export function validateGraph(
  steps: Array<{ stepKey: string; isInitial: boolean; isTerminal: boolean }>,
  transitions: Array<{ fromStep: string; toStep: string }>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const keys = new Set(steps.map((s) => s.stepKey));
  const byFrom = indexByFromStep(
    transitions.map((t, i) => ({
      id: i,
      definitionId: 0,
      action: `a${i}`,
      actionLabelFa: "",
      requiredPermission: "",
      reasonRequired: false,
      assignRole: null,
      dueDays: null,
      escalationRole: null,
      fromStep: t.fromStep,
      toStep: t.toStep,
    })),
  );

  const initials = steps.filter((s) => s.isInitial);
  if (initials.length === 0) issues.push({ code: "NO_INITIAL_STEP", messageFa: "تعریف هیچ مرحلهٔ آغازینی ندارد." });
  if (initials.length > 1) issues.push({ code: "MULTIPLE_INITIAL", messageFa: "بیش از یک مرحلهٔ آغازین تعریف شده است." });

  for (const t of transitions) {
    if (!keys.has(t.fromStep)) issues.push({ code: "UNKNOWN_DESTINATION", messageFa: `مبدأ «${t.fromStep}» در مراحل تعریف نشده است.`, step: t.fromStep });
    if (!keys.has(t.toStep)) issues.push({ code: "UNKNOWN_DESTINATION", messageFa: `مقصد «${t.toStep}» در مراحل تعریف نشده است.`, step: t.toStep });
  }

  for (const step of steps) {
    if (step.isTerminal) continue;
    const exits = byFrom.get(step.stepKey) ?? [];
    if (exits.length === 0) {
      issues.push({ code: "STEP_WITHOUT_EXIT", messageFa: `مرحلهٔ «${step.stepKey}» هیچ خروجی ندارد و بن‌بست است.`, step: step.stepKey });
    }
  }

  // Reachability from the initial step.
  if (initials.length === 1) {
    const seen = new Set<string>([initials[0].stepKey]);
    const queue = [initials[0].stepKey];
    while (queue.length) {
      const current = queue.shift()!;
      for (const t of byFrom.get(current) ?? []) {
        if (!seen.has(t.toStep)) {
          seen.add(t.toStep);
          queue.push(t.toStep);
        }
      }
    }
    for (const step of steps) {
      if (!seen.has(step.stepKey)) {
        issues.push({ code: "UNREACHABLE_STEP", messageFa: `مرحلهٔ «${step.stepKey}» از مرحلهٔ آغازین قابل رسیدن نیست.`, step: step.stepKey });
      }
    }
    // A cycle is only a problem when no member can reach a terminal step.
    const terminals = new Set(steps.filter((s) => s.isTerminal).map((s) => s.stepKey));
    const canReachTerminal = (start: string): boolean => {
      const local = new Set<string>([start]);
      const q = [start];
      while (q.length) {
        const cur = q.shift()!;
        if (terminals.has(cur)) return true;
        for (const t of byFrom.get(cur) ?? []) {
          if (!local.has(t.toStep)) {
            local.add(t.toStep);
            q.push(t.toStep);
          }
        }
      }
      return false;
    };
    for (const step of steps) {
      if (!step.isTerminal && !canReachTerminal(step.stepKey)) {
        issues.push({
          code: "CYCLE_WITHOUT_EXIT",
          messageFa: `از مرحلهٔ «${step.stepKey}» به هیچ مرحلهٔ پایانی نمی‌رسیم (دور بی‌پایان).`,
          step: step.stepKey,
        });
      }
    }
  }

  return issues;
}

/** Loads the published, active definition for a code (highest version). */
export async function getActiveDefinition(code: string, executor: Executor = db) {
  const [def] = await executor
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.code, code), eq(workflowDefinitions.isPublished, true), eq(workflowDefinitions.isActive, true)))
    .orderBy(workflowDefinitions.version)
    .limit(1);
  return def ?? null;
}

export async function getDefinitionGraph(definitionId: number, executor: Executor = db) {
  const [steps, transitions] = await Promise.all([
    executor.select().from(workflowSteps).where(eq(workflowSteps.definitionId, definitionId)).orderBy(asc(workflowSteps.orderIndex)),
    executor.select().from(workflowTransitions).where(eq(workflowTransitions.definitionId, definitionId)).orderBy(asc(workflowTransitions.id)),
  ]);
  return { steps, transitions };
}

/** Transitions available from a step inside a definition (DB is the source). */
export async function getAvailableTransitionsFrom(
  definitionId: number,
  fromStep: string,
  executor: Executor = db,
): Promise<DbTransition[]> {
  return executor
    .select()
    .from(workflowTransitions)
    .where(and(eq(workflowTransitions.definitionId, definitionId), eq(workflowTransitions.fromStep, fromStep)))
    .orderBy(asc(workflowTransitions.id));
}

export interface EngineActor {
  id: string;
  permissions: Set<string>;
  roleKeys: Set<string>;
}

export interface ApplyTransitionInput {
  caseId: string;
  actor: EngineActor;
  /** Action key from workflow_transitions; `to` is derived, never trusted from the client. */
  action?: string;
  /** Target step; resolved to exactly one transition from the current step. */
  to?: string;
  reason?: string;
  now?: Date;
}

export interface AppliedTransition {
  fromStep: string;
  toStep: string;
  transition: DbTransition;
  taskId: string | null;
}

/**
 * Applies a transition inside the caller's transaction.
 *
 * The case row must already be locked with FOR UPDATE by the caller. Every
 * rule is read from the database: valid source/target, the exact required
 * permission, and whether a reason is mandatory. On success it moves the case
 * status, advances the instance, closes the task that was acted on and opens
 * the next task when the transition defines one.
 */
export async function applyTransition(tx: DbTx, input: ApplyTransitionInput): Promise<AppliedTransition> {
  const now = input.now ?? new Date();
  const [tc] = await tx.select().from(thesisCases).where(eq(thesisCases.id, input.caseId)).limit(1);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");

  const instanceId = tc.currentInstanceId;
  if (!instanceId) {
    throw new AppError(409, "NO_ACTIVE_WORKFLOW", "این پرونده گردش‌کار فعالی ندارد.");
  }
  const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId)).limit(1);
  if (!instance) throw new AppError(409, "NO_ACTIVE_WORKFLOW", "گردش‌کار فعال یافت نشد.");

  const available = await getAvailableTransitionsFrom(instance.definitionId, instance.currentStep, tx);
  const transition = available.find((t) => (input.action ? t.action === input.action : t.toStep === input.to));
  if (!transition) {
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      `انتقال درخواستی از وضعیت «${instance.currentStep}» مجاز نیست.`,
      { from: instance.currentStep, action: input.action, to: input.to, allowed: available.map((t) => t.action) },
    );
  }

  if (!input.actor.permissions.has(transition.requiredPermission)) {
    throw new AppError(403, "TRANSITION_FORBIDDEN", "مجوز لازم برای این تغییر وضعیت را ندارید.", {
      permission: transition.requiredPermission,
    });
  }

  if (transition.reasonRequired && (!input.reason || input.reason.trim().length < 3)) {
    throw new AppError(400, "REASON_REQUIRED", "دلیل تغییر وضعیت الزامی است (حداقل ۳ نویسه).");
  }

  const [targetStep] = await tx
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.definitionId, instance.definitionId), eq(workflowSteps.stepKey, transition.toStep)))
    .limit(1);

  // 1) Case status follows the workflow step.
  await tx
    .update(thesisCases)
    .set({ currentStatus: transition.toStep, updatedAt: now, updatedBy: input.actor.id })
    .where(eq(thesisCases.id, input.caseId));

  // 2) Instance advances; terminal steps end it.
  const isTerminal = !!targetStep?.isTerminal;
  await tx
    .update(workflowInstances)
    .set({ currentStep: transition.toStep, endedAt: isTerminal ? now : null })
    .where(eq(workflowInstances.id, instance.id));

  // 3) Close every pending task of the step we are leaving (no stale duplicates).
  const closed = await tx
    .update(workflowTasks)
    .set({ status: "completed", actedBy: input.actor.id, actedAt: now, reason: input.reason ?? null })
    .where(and(eq(workflowTasks.instanceId, instance.id), eq(workflowTasks.status, "pending")))
    .returning({ id: workflowTasks.id, fromStatus: workflowTasks.status });
  for (const row of closed) {
    await tx.insert(workflowTaskHistory).values({
      taskId: row.id,
      fromStatus: row.fromStatus,
      toStatus: "completed",
      actorUserId: input.actor.id,
      reason: input.reason ?? null,
    });
  }

  // 4) Open the next task only when the transition defines a responsible role.
  //    The queue item stays unassigned: a reviewer is never invented.
  let taskId: string | null = null;
  if (!isTerminal && transition.assignRole) {
    const dueDate = transition.dueDays ? new Date(now.getTime() + transition.dueDays * 86_400_000) : null;
    const [task] = await tx
      .insert(workflowTasks)
      .values({
        instanceId: instance.id,
        caseId: input.caseId,
        action: transition.action,
        titleFa: transition.actionLabelFa,
        roleKey: transition.assignRole,
        escalatedToRole: transition.escalationRole,
        status: "pending",
        dueDate,
      })
      .returning({ id: workflowTasks.id });
    taskId = task.id;
    await tx.insert(workflowTaskHistory).values({ taskId: task.id, fromStatus: null, toStatus: "pending", actorUserId: input.actor.id });
  }

  await tx.update(thesisCases).set({ currentTaskId: taskId }).where(eq(thesisCases.id, input.caseId));

  return { fromStep: instance.currentStep, toStep: transition.toStep, transition, taskId };
}

/** Starts an instance for a case at the definition's initial step. Idempotent per case. */
export async function startInstance(
  tx: DbTx,
  input: { caseId: string; definitionId: number; actorId: string; now?: Date },
): Promise<{ instanceId: string; step: string }> {
  const now = input.now ?? new Date();
  const [existing] = await tx
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.caseId, input.caseId), isNull(workflowInstances.endedAt)))
    .limit(1);
  if (existing) return { instanceId: existing.id, step: "" };

  const steps = await tx
    .select()
    .from(workflowSteps)
    .where(and(eq(workflowSteps.definitionId, input.definitionId), eq(workflowSteps.isInitial, true)))
    .limit(1);
  const initial = steps[0];
  if (!initial) throw new AppError(409, "WORKFLOW_MISCONFIGURED", "گردش‌کار مرحلهٔ آغازین ندارد.");

  const [instance] = await tx
    .insert(workflowInstances)
    .values({ caseId: input.caseId, definitionId: input.definitionId, currentStep: initial.stepKey, startedAt: now })
    .returning({ id: workflowInstances.id });

  await tx
    .update(thesisCases)
    .set({ currentInstanceId: instance.id, currentStatus: initial.stepKey, updatedAt: now, updatedBy: input.actorId })
    .where(eq(thesisCases.id, input.caseId));

  return { instanceId: instance.id, step: initial.stepKey };
}

/** Convenience: the TS catalog shape, for seeding and for legacy callers/tests. */
export function toCatalogShape(rows: DbTransition[]): TransitionDef[] {
  return rows.map((r) => ({
    from: [r.fromStep] as TransitionDef["from"],
    to: r.toStep as TransitionDef["to"],
    requiredPermission: r.requiredPermission,
    reasonRequired: r.reasonRequired,
    label: r.actionLabelFa,
  }));
}

export { inArray };
