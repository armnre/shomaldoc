import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute } from "@/server/http";
import { getCaseById, getCaseEvents, getCaseFiles, getCaseSupervisors } from "@/server/services/case";
import { buildCasePdf } from "@/server/pdf/case-report";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Downloadable Persian PDF of a case (real PDF: embedded font, shaped RTL text). */
export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user).catch(() => null);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const [events, files, supervisors] = await Promise.all([getCaseEvents(id), getCaseFiles(id), getCaseSupervisors(id)]);
  const bytes = await buildCasePdf({ caseRow: tc, events, files, supervisors });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="case-${tc.caseNumber.replace(/\//g, "-")}.pdf"`,
      "cache-control": "no-store",
    },
  });
});
