import { and, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { workflowDefinitions, workflowSteps, workflowTransitions } from "@/db/schema";
import { TRANSITIONS } from "./transitions";
import { CASE_STATUSES } from "./statuses";

/**
 * Seeds workflow definitions from the TypeScript catalog.
 *
 * Two definitions are seeded:
 *  1. `thesis_case_core` — the seven statuses already in production behaviour.
 *     Seeded verbatim from TRANSITIONS so no existing behaviour changes.
 *  2. `thesis_full_cycle` — the complete 31-step cycle as an *editable draft*
 *     flagged `pendingUniversityApproval`. It is NOT published, so it can never
 *     drive a real case until an administrator reviews and publishes it.
 *
 * Seeding is idempotent and never overwrites an administrator's edits: a
 * definition that already exists for (code, version) is skipped.
 */

export const CORE_DEFINITION_CODE = "thesis_case_core";
export const FULL_CYCLE_DEFINITION_CODE = "thesis_full_cycle";

const STEP_LABELS: Record<string, string> = Object.fromEntries(CASE_STATUSES.map((s) => [s.key, s.fa]));

/** Steps of the full cycle, in order. Initial proposal — requires university confirmation. */
export const FULL_CYCLE_STEPS = [
  { key: "DRAFT", fa: "پیش‌نویس", terminal: false },
  { key: "SUBMITTED", fa: "ثبت‌شده", terminal: false },
  { key: "WAITING_SUPERVISOR", fa: "در انتظار تعیین استاد راهنما", terminal: false },
  { key: "SUPERVISOR_APPROVED", fa: "تأیید استاد راهنما", terminal: false },
  { key: "SUPERVISOR_REJECTED", fa: "رد توسط استاد راهنما", terminal: false },
  { key: "GROUP_REVIEW", fa: "بررسی گروه آموزشی", terminal: false },
  { key: "TOPIC_REVISION", fa: "اصلاح موضوع", terminal: false },
  { key: "TOPIC_APPROVED", fa: "تصویب موضوع", terminal: false },
  { key: "LITERATURE_REVIEW", fa: "بررسی پیشینه پژوهش", terminal: false },
  { key: "LITERATURE_REVISION", fa: "اصلاح پیشینه پژوهش", terminal: false },
  { key: "PROPOSAL_DRAFT", fa: "پیش‌نویس پروپوزال", terminal: false },
  { key: "PROPOSAL_REVIEW", fa: "بررسی پروپوزال", terminal: false },
  { key: "PROPOSAL_REVISION", fa: "اصلاح پروپوزال", terminal: false },
  { key: "PROPOSAL_APPROVED", fa: "تصویب پروپوزال", terminal: false },
  { key: "IRANDOC_PENDING", fa: "در انتظار ثبت ایرانداک", terminal: false },
  { key: "IRANDOC_REVIEW", fa: "بررسی ایرانداک", terminal: false },
  { key: "IRANDOC_APPROVED", fa: "تأیید ایرانداک", terminal: false },
  { key: "THESIS_ACTIVE", fa: "پایان‌نامه فعال", terminal: false },
  { key: "EXTENSION_REQUIRED", fa: "نیازمند تمدید", terminal: false },
  { key: "EXTENSION_REQUESTED", fa: "درخواست تمدید ثبت شد", terminal: false },
  { key: "SPECIAL_COMMISSION", fa: "کمیسیون موارد خاص", terminal: false },
  { key: "READY_FOR_DEFENSE", fa: "آماده دفاع", terminal: false },
  { key: "SIMILARITY_CHECK", fa: "همانندجویی", terminal: false },
  { key: "DEFENSE_SCHEDULED", fa: "دفاع زمان‌بندی شد", terminal: false },
  { key: "DEFENSE_COMPLETED", fa: "دفاع انجام شد", terminal: false },
  { key: "DEFENSE_REVISION", fa: "اصلاحات پس از دفاع", terminal: false },
  { key: "THESIS_COMPLETED", fa: "پایان‌نامه تکمیل شد", terminal: false },
  { key: "GRADUATION_PROCESS", fa: "فرآیند فارغ‌التحصیلی", terminal: false },
  { key: "REJECTED", fa: "ردشده", terminal: true },
  { key: "CANCELLED", fa: "انصراف", terminal: true },
  { key: "ARCHIVED", fa: "بایگانی‌شده", terminal: true },
] as const;

export async function seedWorkflows(executor: DbTx | typeof db = db): Promise<{ created: string[] }> {
  const created: string[] = [];

  // ---- 1) core definition: mirrors the existing hard-coded engine exactly ----
  const [coreExisting] = await executor
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.code, CORE_DEFINITION_CODE), eq(workflowDefinitions.version, 1)))
    .limit(1);

  if (!coreExisting) {
    const [def] = await executor
      .insert(workflowDefinitions)
      .values({
        code: CORE_DEFINITION_CODE,
        titleFa: "گردش‌کار هستهٔ پرونده (۷ وضعیت)",
        version: 1,
        isPublished: true,
        isActive: true,
        pendingUniversityApproval: false,
      })
      .returning({ id: workflowDefinitions.id });
    created.push(CORE_DEFINITION_CODE);

    await executor.insert(workflowSteps).values(
      CASE_STATUSES.map((s, i) => ({
        definitionId: def.id,
        stepKey: s.key,
        titleFa: STEP_LABELS[s.key] ?? s.key,
        orderIndex: i,
        isInitial: s.key === "draft",
        isTerminal: s.key === "archived",
      })),
    );

    // Expand the catalog's `from[]` arrays into one row per (from, action, to).
    const rows = TRANSITIONS.flatMap((t) =>
      t.from.map((from) => ({
        definitionId: def.id,
        fromStep: from,
        action: `${from}_to_${t.to}`,
        actionLabelFa: t.label,
        toStep: t.to,
        requiredPermission: t.requiredPermission,
        reasonRequired: t.reasonRequired,
        // The review queue is assigned to the graduate office; due dates stay
        // null because no university SLA has been confirmed yet.
        assignRole: t.to === "submitted" || t.to === "under_review" ? "grad_office" : null,
        dueDays: null,
        escalationRole: null,
      })),
    );
    await executor.insert(workflowTransitions).values(rows);
  }

  // ---- 2) full cycle: editable DRAFT, never published automatically ----
  const [fullExisting] = await executor
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.code, FULL_CYCLE_DEFINITION_CODE), eq(workflowDefinitions.version, 1)))
    .limit(1);

  if (!fullExisting) {
    const [def] = await executor
      .insert(workflowDefinitions)
      .values({
        code: FULL_CYCLE_DEFINITION_CODE,
        titleFa: "چرخهٔ کامل پایان‌نامه (پیشنهاد اولیه — نیازمند تأیید دانشگاه)",
        version: 1,
        isPublished: false,
        isActive: true,
        pendingUniversityApproval: true,
      })
      .returning({ id: workflowDefinitions.id });
    created.push(FULL_CYCLE_DEFINITION_CODE);

    await executor.insert(workflowSteps).values(
      FULL_CYCLE_STEPS.map((s, i) => ({
        definitionId: def.id,
        stepKey: s.key,
        titleFa: s.fa,
        orderIndex: i,
        isInitial: s.key === "DRAFT",
        isTerminal: s.terminal,
      })),
    );

    // A conservative, fully-connected draft graph. Every transition names the
    // exact permission that must hold it, so publishing it cannot widen access.
    const T = (fromStep: string, action: string, labelFa: string, toStep: string, requiredPermission: string, reasonRequired = false, assignRole: string | null = null, dueDays: number | null = null, escalationRole: string | null = null) => ({
      definitionId: def.id,
      fromStep,
      action,
      actionLabelFa: labelFa,
      toStep,
      requiredPermission,
      reasonRequired,
      assignRole,
      dueDays,
      escalationRole,
    });

    await executor.insert(workflowTransitions).values([
      T("DRAFT", "submit", "ارسال پرونده", "SUBMITTED", "cases.submit_topic", false, "grad_office"),
      T("SUBMITTED", "await_supervisor", "ارجاع برای تعیین استاد", "WAITING_SUPERVISOR", "cases.assign_supervisors", false, "dept_head"),
      T("WAITING_SUPERVISOR", "supervisor_approved", "تأیید استاد راهنما", "SUPERVISOR_APPROVED", "cases.review_topic", false, "dept_head"),
      T("WAITING_SUPERVISOR", "supervisor_rejected", "رد توسط استاد راهنما", "SUPERVISOR_REJECTED", "cases.review_topic", true, "student"),
      T("SUPERVISOR_REJECTED", "resubmit", "ارسال مجدد", "SUBMITTED", "cases.submit_topic"),
      T("SUPERVISOR_APPROVED", "group_review", "ارجاع به بررسی گروه", "GROUP_REVIEW", "cases.review_topic", false, "dept_head"),
      T("GROUP_REVIEW", "topic_revision", "درخواست اصلاح موضوع", "TOPIC_REVISION", "cases.review_topic", true, "student"),
      T("GROUP_REVIEW", "topic_approved", "تصویب موضوع", "TOPIC_APPROVED", "cases.review_topic", false, "student"),
      T("GROUP_REVIEW", "reject", "رد پرونده", "REJECTED", "cases.review_topic", true),
      T("TOPIC_REVISION", "resubmit_topic", "ارسال موضوع اصلاح‌شده", "GROUP_REVIEW", "cases.submit_topic", false, "dept_head"),
      T("TOPIC_APPROVED", "submit_literature", "ارسال پیشینه پژوهش", "LITERATURE_REVIEW", "cases.submit_topic", false, "supervisor"),
      T("LITERATURE_REVIEW", "literature_revision", "درخواست اصلاح پیشینه", "LITERATURE_REVISION", "cases.review_topic", true, "student"),
      T("LITERATURE_REVIEW", "literature_approved", "تأیید پیشینه", "PROPOSAL_DRAFT", "cases.review_topic", false, "student"),
      T("LITERATURE_REVISION", "resubmit_literature", "ارسال مجدد پیشینه", "LITERATURE_REVIEW", "cases.submit_topic", false, "supervisor"),
      T("PROPOSAL_DRAFT", "submit_proposal", "ارسال پروپوزال", "PROPOSAL_REVIEW", "cases.submit_topic", false, "supervisor"),
      T("PROPOSAL_REVIEW", "proposal_revision", "درخواست اصلاح پروپوزال", "PROPOSAL_REVISION", "cases.review_topic", true, "student"),
      T("PROPOSAL_REVIEW", "proposal_approved", "تصویب پروپوزال", "PROPOSAL_APPROVED", "cases.review_topic", false, "grad_office"),
      T("PROPOSAL_REVIEW", "reject", "رد پرونده", "REJECTED", "cases.review_topic", true),
      T("PROPOSAL_REVISION", "resubmit_proposal", "ارسال مجدد پروپوزال", "PROPOSAL_REVIEW", "cases.submit_topic", false, "supervisor"),
      T("PROPOSAL_APPROVED", "irandoc_pending", "ارجاع برای ثبت ایرانداک", "IRANDOC_PENDING", "cases.transition_status", false, "student"),
      T("IRANDOC_PENDING", "irandoc_submitted", "ثبت کد پیگیری ایرانداک", "IRANDOC_REVIEW", "cases.submit_topic", false, "grad_office"),
      T("IRANDOC_REVIEW", "irandoc_revision", "رد ثبت ایرانداک", "IRANDOC_PENDING", "cases.review_topic", true, "student"),
      T("IRANDOC_REVIEW", "irandoc_approved", "تأیید ایرانداک", "IRANDOC_APPROVED", "cases.review_topic", false, "grad_office"),
      T("IRANDOC_APPROVED", "activate_thesis", "فعال‌سازی پایان‌نامه", "THESIS_ACTIVE", "cases.transition_status", false, "student"),
      T("THESIS_ACTIVE", "extension_required", "نیاز به تمدید", "EXTENSION_REQUIRED", "cases.transition_status", true, "student"),
      T("EXTENSION_REQUIRED", "request_extension", "ثبت درخواست تمدید", "EXTENSION_REQUESTED", "cases.submit_topic", false, "dept_head"),
      T("EXTENSION_REQUESTED", "extension_to_commission", "ارجاع به کمیسیون موارد خاص", "SPECIAL_COMMISSION", "cases.transition_status", true, "grad_office"),
      T("EXTENSION_REQUESTED", "extension_approved", "تأیید تمدید", "THESIS_ACTIVE", "cases.review_topic", false, "student"),
      T("SPECIAL_COMMISSION", "commission_approved", "تأیید کمیسیون", "THESIS_ACTIVE", "cases.transition_status", true, "student"),
      T("SPECIAL_COMMISSION", "commission_rejected", "رد کمیسیون", "REJECTED", "cases.transition_status", true),
      T("THESIS_ACTIVE", "ready_for_defense", "اعلام آمادگی دفاع", "READY_FOR_DEFENSE", "cases.transition_status", false, "dept_head"),
      T("READY_FOR_DEFENSE", "similarity_check", "ثبت همانندجویی", "SIMILARITY_CHECK", "cases.transition_status", false, "grad_office"),
      T("SIMILARITY_CHECK", "similarity_passed", "قبول همانندجویی", "DEFENSE_SCHEDULED", "cases.review_topic", false, "student"),
      T("SIMILARITY_CHECK", "similarity_revision", "نیاز به اصلاح و همانندجویی مجدد", "THESIS_ACTIVE", "cases.review_topic", true, "student"),
      T("DEFENSE_SCHEDULED", "defense_completed", "انجام دفاع", "DEFENSE_COMPLETED", "cases.review_topic", false, "student"),
      T("DEFENSE_COMPLETED", "defense_revision", "درخواست اصلاحات پس از دفاع", "DEFENSE_REVISION", "cases.review_topic", true, "student"),
      T("DEFENSE_COMPLETED", "thesis_completed", "تکمیل پایان‌نامه", "THESIS_COMPLETED", "cases.review_topic", false, "graduation_officer"),
      T("DEFENSE_REVISION", "revision_approved", "تأیید اصلاحات", "THESIS_COMPLETED", "cases.review_topic", false, "graduation_officer"),
      T("THESIS_COMPLETED", "start_graduation", "آغاز فرآیند فارغ‌التحصیلی", "GRADUATION_PROCESS", "cases.transition_status", false, "graduation_officer"),
      T("GRADUATION_PROCESS", "archive", "بایگانی پرونده", "ARCHIVED", "cases.archive"),
      T("THESIS_ACTIVE", "cancel", "انصراف از پایان‌نامه", "CANCELLED", "cases.archive", true),
      T("THESIS_COMPLETED", "archive", "بایگانی پرونده", "ARCHIVED", "cases.archive"),
    ]);
  }

  return { created };
}
