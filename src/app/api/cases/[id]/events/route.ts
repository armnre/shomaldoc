import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, jsonOk } from "@/server/http";
import { getCaseById, getCaseEvents } from "@/server/services/case";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser("cases.events.view");
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const events = await getCaseEvents(id);
  return jsonOk({ events });
});