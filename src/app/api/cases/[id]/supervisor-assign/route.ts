import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { assignByDeptHead } from "@/server/services/supervisor-requests";
import { deptHeadAssignSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Department-head assignment after the student's attempts were exhausted. */
export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, deptHeadAssignSchema);
  const link = await assignByDeptHead(user, id, input.professorUserId, input.roleType, input.reason, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(link, { status: 201 });
});
