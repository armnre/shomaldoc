import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk } from "@/server/http";
import { revokeSession } from "@/server/services/sessions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, "SESSION_NOT_FOUND", "نشست یافت نشد.");
  return jsonOk(await revokeSession(user.id, id, { ip: getClientIp(request), userAgent: getUserAgent(request) }, user.sessionId));
});
