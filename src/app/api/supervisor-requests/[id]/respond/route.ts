import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { respondToRequest } from "@/server/services/supervisor-requests";
import { respondSupervisorRequestSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, respondSupervisorRequestSchema);
  return jsonOk(await respondToRequest(user, { ...input, requestId: id }, { ip: getClientIp(request), userAgent: getUserAgent(request) }));
});
