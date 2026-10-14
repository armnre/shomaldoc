import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/current-user";
import { shouldUseSecureCookies } from "@/server/env";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { loginWithPassword } from "@/server/services/auth";
import { loginSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseJson(request, loginSchema);
  const result = await loginWithPassword(input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });

  return jsonOk({
    redirectTo: result.mustChangePassword ? "/account" : "/dashboard",
    mustChangePassword: result.mustChangePassword,
  });
});
