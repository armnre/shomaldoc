import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { addSupervisor, getCaseById, getCaseSupervisors } from "@/server/services/case";
import { addSupervisorSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const supervisors = await getCaseSupervisors(id);
  return jsonOk({ supervisors });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("cases.assign_supervisors");
  const { id } = await ctx.params;
  const input = await parseJson(request, addSupervisorSchema);
  const supervisor = await addSupervisor(id, user, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(supervisor, { status: 201 });
});