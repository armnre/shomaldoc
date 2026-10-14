import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { transitionStatus } from "@/server/services/case";
import { transitionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  // Only authentication is checked here: the service enforces the exact
  // permission attached to the requested transition plus case-level access.
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, transitionSchema);
  const result = await transitionStatus(id, user, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});