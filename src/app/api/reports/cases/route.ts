import { requireCaseViewApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, jsonOk } from "@/server/http";
import { casesReport, toCsv } from "@/server/services/reports";
import { buildXlsx, XLSX_MIME } from "@/server/services/xlsx";
import { reportQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

/** Case report. `?format=csv` returns a real CSV download (formula-injection safe). */
export const GET = apiRoute(async (request: Request) => {
  const user = await requireCaseViewApiUser();
  const url = new URL(request.url);
  const query = reportQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const rows = await casesReport(user, query);
  if (query.format === "csv") {
    const csv = toCsv(
      ["case_number", "student", "student_number", "department", "title_fa", "status", "supervisor", "created_at", "updated_at"],
      rows.map((r) => [r.caseNumber, r.studentFullName, r.studentNumber, r.department, r.titleFa, r.status, r.supervisor, r.createdAt.toISOString(), r.updatedAt.toISOString()]),
    );
    // BOM keeps Persian text correct in Excel.
    return new Response(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="shomaldoc-cases.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }
  if (query.format === "xlsx") {
    const bytes = await buildXlsx([
      {
        name: "پرونده‌ها",
        headers: ["شمارهٔ پرونده", "دانشجو", "شمارهٔ دانشجویی", "گروه", "عنوان", "وضعیت", "استاد راهنما", "تاریخ ایجاد", "آخرین به‌روزرسانی"],
        rows: rows.map((r) => [r.caseNumber, r.studentFullName, r.studentNumber, r.department, r.titleFa, r.status, r.supervisor, r.createdAt.toISOString().slice(0, 10), r.updatedAt.toISOString().slice(0, 10)]),
      },
    ]);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": XLSX_MIME,
        "content-disposition": `attachment; filename="shomaldoc-cases.xlsx"`,
        "cache-control": "private, no-store",
      },
    });
  }
  if (rows.length === 0 && query.status && !["draft","submitted","under_review","revision_required","approved","rejected","archived"].includes(query.status)) {
    throw new AppError(400, "INVALID_STATUS", "وضعیت انتخاب‌شده معتبر نیست.");
  }
  return jsonOk({ rows, total: rows.length });
});
