import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { changeOwnPassword } from "@/server/services/auth";
import { changePasswordSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const input = await parseJson(request, changePasswordSchema);
  const result = await changeOwnPassword(user, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk({ changed: true, otherSessionsRevoked: result.otherSessionsRevoked });
});
