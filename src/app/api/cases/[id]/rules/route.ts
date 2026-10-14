import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, jsonOk } from "@/server/http";
import { getCaseById } from "@/server/services/case";
import { RULES, loadCaseFacts } from "@/server/rules";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Returns ALLOW/DENY with precise Persian reasons for every rule of a case. */
export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const facts = await loadCaseFacts(id);
  if (!facts) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const evaluations = Object.entries(RULES).map(([name, fn]) => ({ name, ...fn(facts) }));
  return jsonOk({ evaluations });
});
