import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { decideThesisVersion } from "@/server/services/thesis";
import { thesisVersionDecisionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id, versionId } = await ctx.params;
  const input = await parseJson(request, thesisVersionDecisionSchema);
  const result = await decideThesisVersion(id, versionId, user, input.decision, input.reason ?? null, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
