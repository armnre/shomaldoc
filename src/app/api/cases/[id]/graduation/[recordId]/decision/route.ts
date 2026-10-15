import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { decideGraduation } from "@/server/services/graduation";
import { graduationDecisionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; recordId: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id, recordId } = await ctx.params;
  const input = await parseJson(request, graduationDecisionSchema);
  const result = await decideGraduation(id, recordId, user, input.decision, input.reason ?? null, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
