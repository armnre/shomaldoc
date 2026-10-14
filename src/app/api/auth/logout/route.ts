import { cookies } from "next/headers";
import { SESSION_COOKIE, getCurrentUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk } from "@/server/http";
import { logoutSession } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await getCurrentUser();
  if (user) {
    await logoutSession(user, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return jsonOk({ redirectTo: "/login" });
});
