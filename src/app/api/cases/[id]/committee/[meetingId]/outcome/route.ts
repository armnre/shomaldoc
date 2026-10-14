import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { recordCommitteeOutcome } from "@/server/services/thesis-admin";
import { committeeOutcomeSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; meetingId: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id, meetingId } = await ctx.params;
  const input = await parseJson(request, committeeOutcomeSchema);
  const result = await recordCommitteeOutcome(id, meetingId, user, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
