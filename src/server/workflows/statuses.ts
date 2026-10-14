/**
 * Centralized workflow status definitions for thesis cases.
 *
 * The status list below is a minimal verifiable set that can be confirmed
 * without a formal PRD. The full university workflow (reported as 29 statuses)
 * requires explicit departmental confirmation before implementation.
 *
 * Statuses pending university confirmation are documented in docs/workflow-statuses.md.
 */

export const CASE_STATUSES = [
  { key: "draft", fa: "پیش‌نویس", en: "Draft", color: "neutral" },
  { key: "submitted", fa: "ثبت‌شده برای بررسی", en: "Submitted", color: "info" },
  { key: "under_review", fa: "در حال بررسی", en: "Under Review", color: "primary" },
  { key: "revision_required", fa: "نیازمند اصلاح", en: "Revision Required", color: "warning" },
  { key: "approved", fa: "تأییدشده", en: "Approved", color: "success" },
  { key: "rejected", fa: "ردشده", en: "Rejected", color: "danger" },
  { key: "archived", fa: "بایگانی‌شده", en: "Archived", color: "neutral" },
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number]["key"];

export const STATUS_MAP = Object.fromEntries(CASE_STATUSES.map((s) => [s.key, s])) as Record<
  CaseStatus,
  (typeof CASE_STATUSES)[number]
>;

/** Returns the human-readable Persian label for a status key. */
export function statusLabelFa(status: string): string {
  return (STATUS_MAP as Record<string, (typeof CASE_STATUSES)[number]>)[status]?.fa ?? status;
}

/** Guard: check whether a raw string is a valid CaseStatus. */
export function isCaseStatus(value: string): value is CaseStatus {
  return value in STATUS_MAP;
}

export const STATUS_KEYS: readonly string[] = CASE_STATUSES.map((s) => s.key);