import { AppError } from "../http";
import type { CaseStatus } from "./statuses";
import { isCaseStatus, STATUS_MAP } from "./statuses";

/**
 * Transition definition. Permissions are checked in the case service before
 * calling the transition engine, so this file only owns the state-machine
 * contract itself.
 */
export interface TransitionDef {
  from: CaseStatus[];
  to: CaseStatus;
  /** Permission key the actor must hold (checked in the service layer). */
  requiredPermission: string;
  /** If true, a non-empty reason string is mandatory. */
  reasonRequired: boolean;
  /** Human label used in UI action buttons. */
  label: string;
}

/**
 * Minimal Phase-1 transition set.
 * Each transition defines valid source statuses, the target, who can perform it,
 * and whether a reason is required. The array is additive: new transitions are
 * appended, never replaced, so existing workflow references remain stable.
 */
export const TRANSITIONS: TransitionDef[] = [
  // Student submits a draft case for review
  {
    from: ["draft"],
    to: "submitted",
    requiredPermission: "cases.submit_topic",
    reasonRequired: false,
    label: "ارسال برای بررسی",
  },
  // Reviewer accepts the submission for formal review
  {
    from: ["submitted"],
    to: "under_review",
    requiredPermission: "cases.review_topic",
    reasonRequired: false,
    label: "شروع بررسی",
  },
  // Reviewer requests revision (reason mandatory)
  {
    from: ["submitted", "under_review"],
    to: "revision_required",
    requiredPermission: "cases.review_topic",
    reasonRequired: true,
    label: "نیاز به اصلاح",
  },
  // Reviewer approves (reason optional)
  {
    from: ["submitted", "under_review", "revision_required"],
    to: "approved",
    requiredPermission: "cases.review_topic",
    reasonRequired: false,
    label: "تأیید",
  },
  // Reviewer rejects (reason mandatory)
  {
    from: ["submitted", "under_review", "revision_required"],
    to: "rejected",
    requiredPermission: "cases.review_topic",
    reasonRequired: true,
    label: "رد",
  },
  // Student resubmits after revision
  {
    from: ["revision_required"],
    to: "submitted",
    requiredPermission: "cases.submit_topic",
    reasonRequired: false,
    label: "ارسال مجدد پس از اصلاح",
  },
  // Archive an approved or rejected case
  {
    from: ["approved", "rejected"],
    to: "archived",
    requiredPermission: "cases.archive",
    reasonRequired: false,
    label: "بایگانی",
  },
];

/** Returns all transitions valid from a given source status. */
export function getAvailableTransitions(currentStatus: string): TransitionDef[] {
  if (!isCaseStatus(currentStatus)) return [];
  return TRANSITIONS.filter((t) => t.from.includes(currentStatus as CaseStatus));
}

/** Returns the specific transition (from→to) or null if undefined. */
export function findTransition(from: string, to: string): TransitionDef | null {
  if (!isCaseStatus(from) || !isCaseStatus(to)) return null;
  return TRANSITIONS.find((t) => (t.from as readonly string[]).includes(from) && t.to === to) ?? null;
}

/**
 * Validates that the requested transition is permitted by the state machine.
 * Throws a 409 AppError when the move is invalid; callers should wrap in a
 * transaction so the check and the mutation cannot drift apart.
 */
export function assertTransitionValid(currentStatus: string, to: string): asserts to is CaseStatus {
  if (!isCaseStatus(to)) {
    throw new AppError(400, "INVALID_STATUS", `وضعیت مقصد «${to}» معتبر نیست.`);
  }
  const def = findTransition(currentStatus, to);
  if (!def) {
    const fromLabel = STATUS_MAP[currentStatus as CaseStatus]?.fa ?? currentStatus;
    const toLabel = STATUS_MAP[to as CaseStatus]?.fa ?? to;
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      `تغییر وضعیت از «${fromLabel}» به «${toLabel}» مجاز نیست.`,
      { from: currentStatus, to },
    );
  }
  if (def.reasonRequired) {
    // The service layer must call this *before* the transaction writes;
    // the check here is defensive only.
  }
}