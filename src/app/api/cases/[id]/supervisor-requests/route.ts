import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createSupervisorRequest, listCaseRequests } from "@/server/services/supervisor-requests";
import { createSupervisorRequestSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  return jsonOk({ requests: await listCaseRequests(id, user) });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, createSupervisorRequestSchema);
  const row = await createSupervisorRequest(user, { ...input, caseId: id }, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  return jsonOk(row, { status: 201 });
});
