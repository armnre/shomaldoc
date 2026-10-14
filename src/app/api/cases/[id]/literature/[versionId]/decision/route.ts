import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { decideLiteratureVersion } from "@/server/services/topic";
import { literatureDecisionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id, versionId } = await ctx.params;
  const input = await parseJson(request, literatureDecisionSchema);
  const result = await decideLiteratureVersion(id, versionId, user, input.decision, input.reason ?? null, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
