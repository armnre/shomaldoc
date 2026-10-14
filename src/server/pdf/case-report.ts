import type { thesisCases } from "@/db/schema";
import { renderPersianPdf, type PdfSection } from "./index";
import { statusLabelFa } from "@/server/workflows";
import { formatDateTime } from "@/lib/format";

/**
 * Builds the official Persian PDF of a case from real stored data only.
 * Nothing is invented: missing values are printed as «—» and empty sections are
 * stated as such, so the document never contains placeholder content.
 */

const DASH = "—";

export interface CasePdfInput {
  caseRow: typeof thesisCases.$inferSelect & { studentName?: string | null };
  events: Array<{ createdAt: Date; description: string | null; reason: string | null; eventType: string }>;
  files: Array<{ originalName: string; createdAt: Date; purpose: string }>;
  supervisors: Array<{ supervisorName: string; roleType: string; status: string }>;
}

function value(input: string | null | undefined): string {
  return input && input.trim().length > 0 ? input : DASH;
}

export async function buildCasePdf(input: CasePdfInput): Promise<Uint8Array> {
  const { caseRow } = input;
  const sections: PdfSection[] = [
    {
      heading: "مشخصات پرونده",
      body: [
        `شمارهٔ پرونده: ${caseRow.caseNumber}`,
        `وضعیت جاری: ${statusLabelFa(caseRow.currentStatus)}`,
        `گروه آموزشی: ${value(caseRow.department)}`,
        `عنوان فارسی پایان‌نامه: ${value(caseRow.titleFa)}`,
        `عنوان انگلیسی پایان‌نامه: ${value(caseRow.titleEn)}`,
        `کلیدواژه‌ها: ${value(caseRow.keywords)}`,
        `تاریخ ایجاد پرونده: ${formatDateTime(caseRow.createdAt, "fa")}`,
        `آخرین به‌روزرسانی: ${formatDateTime(caseRow.updatedAt, "fa")}`,
      ],
    },
    {
      heading: "استادان راهنما و مشاور",
      body:
        input.supervisors.length === 0
          ? ["برای این پرونده استادی ثبت نشده است."]
          : input.supervisors.map(
              (s) => `${s.supervisorName} — نقش: ${s.roleType === "advisor" ? "مشاور" : "راهنما"} — وضعیت: ${s.status === "active" ? "فعال" : s.status}`,
            ),
    },
    {
      heading: "مستندات بارگذاری‌شده",
      body:
        input.files.length === 0
          ? ["مستندی برای این پرونده بارگذاری نشده است."]
          : input.files.map((f) => `${f.originalName} — ${f.purpose} — ${formatDateTime(f.createdAt, "fa")}`),
    },
    {
      heading: "گردش تصمیم‌ها (تایم‌لاین)",
      body:
        input.events.length === 0
          ? ["رویدادی ثبت نشده است."]
          : input.events
              .slice(-25)
              .map((e) => `${formatDateTime(e.createdAt, "fa")} — ${value(e.description)}${e.reason ? ` (دلیل: ${e.reason})` : ""}`),
    },
  ];

  return renderPersianPdf({
    title: `گزارش پروندهٔ پایان‌نامه — ${caseRow.caseNumber}`,
    subtitle: "دانشگاه شمال، آمل — معاونت پژوهش و فناوری",
    meta: [
      { label: "دانشجو", value: value(input.caseRow.studentName) },
      { label: "تاریخ تهیهٔ گزارش", value: formatDateTime(new Date(), "fa") },
    ],
    sections,
    footerNote: "این گزارش به‌صورت خودکار از داده‌های ثبت‌شده در سامانهٔ شمال‌داک تولید شده است.",
  });
}
