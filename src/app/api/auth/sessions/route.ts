import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk } from "@/server/http";
import { listMySessions, revokeAllSessions } from "@/server/services/sessions";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  return jsonOk({ sessions: await listMySessions(user.id) });
});

/** `?all=1` revokes every other session of the caller. */
export const DELETE = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const all = new URL(request.url).searchParams.get("all") === "1";
  if (!all) return jsonOk({ revoked: 0 });
  const result = await revokeAllSessions(user.id, { ip: getClientIp(request), userAgent: getUserAgent(request) }, user.sessionId);
  return jsonOk(result);
});
