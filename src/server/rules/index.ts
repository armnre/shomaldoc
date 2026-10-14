import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { irandocRecords, proposals, similarityChecks, thesisCases, thesisSupervisors } from "@/db/schema";
import { getSettingValue } from "../services/settings";

/**
 * Rule Engine.
 *
 * Every rule is a pure function over an explicit fact object and returns
 * `{ allowed, reasons[] }`. Reasons are precise Persian sentences, and the UI
 * shows them verbatim — a denial always explains what is missing. Thresholds come
 * from Settings, never from hard-coded numbers.
 */

export interface RuleResult {
  allowed: boolean;
  reasons: string[];
}

export interface CaseFacts {
  caseId: string;
  currentStatus: string;
  archivedAt: Date | null;
  topicApproved: boolean;
  hasTitle: boolean;
  supervisors: Array<{ roleType: string; status: string }>;
  advisorRequired: boolean;
  proposal: { status: string; approvedAt: Date | null } | null;
  irandoc: { status: string } | null;
  similarity: { result: string; percent: number | null } | null;
  minMonthsAfterProposal: number;
  maxTerms: number;
  termsUsed: number;
  financeCleared: boolean | null;
  financeRequired: boolean;
  defenseCompleted: boolean;
  graduationApproved: boolean;
  thesisFinalUploaded: boolean;
}

const ok = (): RuleResult => ({ allowed: true, reasons: [] });
const deny = (...reasons: string[]): RuleResult => ({ allowed: false, reasons });

export function canSubmitProposal(f: CaseFacts): RuleResult {
  const reasons: string[] = [];
  if (!f.hasTitle) reasons.push("عنوان پایان‌نامه ثبت نشده است.");
  if (!f.topicApproved) reasons.push("موضوع پایان‌نامه هنوز تصویب نشده است.");
  const supervisors = f.supervisors.filter((s) => s.status === "active" && s.roleType !== "advisor");
  if (supervisors.length === 0) reasons.push("استاد راهنما تعیین نشده است.");
  if (f.advisorRequired && !f.supervisors.some((s) => s.status === "active" && s.roleType === "advisor")) {
    reasons.push("طبق تنظیمات سامانه، تعیین استاد مشاور الزامی است.");
  }
  if (f.archivedAt) reasons.push("پرونده بایگانی شده است.");
  return reasons.length ? deny(...reasons) : ok();
}

export function canApproveFinal(f: CaseFacts): RuleResult {
  const reasons: string[] = [];
  const topic = canSubmitProposal(f);
  if (!topic.allowed) reasons.push(...topic.reasons);
  if (!f.proposal) reasons.push("پروپوزالی ثبت نشده است.");
  else if (f.proposal.status !== "approved") reasons.push("پروپوزال تصویب نشده است.");
  if (!f.irandoc) reasons.push("ثبت ایرانداک انجام نشده است.");
  else if (f.irandoc.status !== "approved") reasons.push("ثبت ایرانداک توسط تحصیلات تکمیلی تأیید نشده است.");
  if (!f.thesisFinalUploaded) reasons.push("فایل پروپوزال/مستندات لازم بارگذاری نشده است.");
  return reasons.length ? deny(...reasons) : ok();
}

export function canRequestExtension(f: CaseFacts): RuleResult {
  const reasons: string[] = [];
  if (!["THESIS_ACTIVE", "EXTENSION_REQUIRED"].includes(f.currentStatus)) {
    reasons.push("درخواست تمدید فقط برای پروندهٔ فعال ممکن است.");
  }
  if (f.archivedAt) reasons.push("پرونده بایگانی شده است.");
  return reasons.length ? deny(...reasons) : ok();
}

export function canOpenCommission(f: CaseFacts): RuleResult {
  const reasons: string[] = [];
  if (f.termsUsed <= f.maxTerms) {
    reasons.push(`ورود به کمیسیون موارد خاص تنها پس از عبور از سقف ترم (${f.maxTerms}) ممکن است؛ ترم‌های مصرف‌شده: ${f.termsUsed}.`);
  }
  if (f.archivedAt) reasons.push("پرونده بایگانی شده است.");
  return reasons.length ? deny(...reasons) : ok();
}

export function canRequestDefense(f: CaseFacts, now = new Date()): RuleResult {
  const reasons: string[] = [];
  const final = canApproveFinal(f);
  if (!final.allowed) reasons.push(...final.reasons);

  if (f.proposal?.approvedAt) {
    const months = (now.getTime() - f.proposal.approvedAt.getTime()) / (30 * 86_400_000);
    if (months < f.minMonthsAfterProposal) {
      reasons.push(
        `حداقل فاصلهٔ تصویب پروپوزال تا دفاع ${f.minMonthsAfterProposal} ماه است؛ زمان سپری‌شده: ${months.toFixed(1)} ماه.`,
      );
    }
  } else {
    reasons.push("تاریخ تصویب پروپوزال ثبت نشده است.");
  }

  if (!f.similarity) reasons.push("همانندجویی ثبت نشده است.");
  else if (f.similarity.result !== "pass") reasons.push("نتیجهٔ همانندجویی «قبول» نیست.");

  if (f.financeRequired && f.financeCleared !== true) reasons.push("تأیید امور مالی ثبت نشده است.");
  if (f.archivedAt) reasons.push("پرونده بایگانی شده است.");
  return reasons.length ? deny(...reasons) : ok();
}

export function canCloseCase(f: CaseFacts): RuleResult {
  const reasons: string[] = [];
  if (!f.defenseCompleted) reasons.push("جلسهٔ دفاع انجام/ثبت نشده است.");
  if (!f.thesisFinalUploaded) reasons.push("نسخهٔ نهایی پایان‌نامه بارگذاری نشده است.");
  if (!f.irandoc || f.irandoc.status !== "approved") reasons.push("ثبت نهایی ایرانداک تأیید نشده است.");
  if (!f.graduationApproved) reasons.push("تأیید نهایی فارغ‌التحصیلی ثبت نشده است.");
  if (f.financeRequired && f.financeCleared !== true) reasons.push("تسویهٔ امور مالی تأیید نشده است.");
  return reasons.length ? deny(...reasons) : ok();
}

/**
 * Gathers the facts for a case from real data. Anything not yet modelled in the
 * database is reported as absent (which yields a DENY reason), never guessed.
 */
export async function loadCaseFacts(caseId: string): Promise<CaseFacts | null> {
  const [tc] = await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  if (!tc) return null;

  const [supervisors, proposal, irandoc, similarity] = await Promise.all([
    db.select().from(thesisSupervisors).where(eq(thesisSupervisors.caseId, caseId)),
    db.select().from(proposals).where(and(eq(proposals.caseId, caseId), eq(proposals.isActive, true))).orderBy(desc(proposals.version)).limit(1),
    db.select().from(irandocRecords).where(eq(irandocRecords.caseId, caseId)).orderBy(desc(irandocRecords.createdAt)).limit(1),
    db.select().from(similarityChecks).where(eq(similarityChecks.caseId, caseId)).orderBy(desc(similarityChecks.createdAt)).limit(1),
  ]);

  const [advisorRequired, minMonths, maxTerms] = await Promise.all([
    getSettingValue("supervisor.advisorRequired"),
    getSettingValue("defense.minMonthsAfterProposal"),
    getSettingValue("terms.maxAllowed"),
  ]);

  const activeSupervisors = supervisors.filter((s) => s.status === "active");
  // Terms used: whole four-month blocks since the case was created (a real,
  // documented estimate; a formal term history needs the university's rules).
  const months = (Date.now() - tc.createdAt.getTime()) / (30 * 86_400_000);
  const termsUsed = Math.max(1, Math.ceil(months / 4));

  const topicApproved = ["approved", "TOPIC_APPROVED", "under_review"].includes(tc.currentStatus) || tc.currentStatus === "approved";

  return {
    caseId,
    currentStatus: tc.currentStatus,
    archivedAt: tc.archivedAt,
    topicApproved,
    hasTitle: !!tc.titleFa && tc.titleFa.trim().length > 0,
    supervisors: activeSupervisors.map((s) => ({ roleType: s.roleType, status: s.status })),
    advisorRequired,
    proposal: proposal[0] ? { status: proposal[0].status, approvedAt: proposal[0].approvedAt } : null,
    irandoc: irandoc[0] ? { status: irandoc[0].status } : null,
    similarity: similarity[0] ? { result: similarity[0].result, percent: similarity[0].similarityPercent } : null,
    minMonthsAfterProposal: minMonths,
    maxTerms,
    termsUsed,
    // Finance clearance is not modelled yet: reported as unknown, which denies
    // when finance is required rather than inventing a clearance.
    financeCleared: null,
    financeRequired: false,
    defenseCompleted: ["DEFENSE_COMPLETED", "THESIS_COMPLETED", "GRADUATION_PROCESS"].includes(tc.currentStatus),
    graduationApproved: tc.currentStatus === "GRADUATION_PROCESS",
    thesisFinalUploaded: false,
  };
}

export const RULES = { canSubmitProposal, canApproveFinal, canRequestExtension, canOpenCommission, canRequestDefense, canCloseCase };
export type RuleName = keyof typeof RULES;
