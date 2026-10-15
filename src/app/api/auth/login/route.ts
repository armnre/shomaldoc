import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth/current-user";
import { embedCookieAttributes, getEnv, isEmbedPreview } from "@/server/env";
import { apiRoute, assertSameOrigin, getClientIp, getForwardedProto, getUserAgent, isSecureRequest, jsonOk, parseJson } from "@/server/http";
import { logger } from "@/server/logger";
import { loginWithPassword } from "@/server/services/auth";
import { createLoginHandoff } from "@/server/services/handoff";
import { loginSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseJson(request, loginSchema);
  const result = await loginWithPassword(input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  const secureRequest = isSecureRequest(request);
  const attributes = embedCookieAttributes(getEnv(), { secureRequest });
  const store = await cookies();
  store.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    ...attributes,
    path: "/",
    expires: result.expiresAt,
  });
  // Observable session handshake: if a client reports "login succeeded but I keep
  // landing on /login", this line shows which cookie the browser was offered and
  // whether it arrived over TLS. No token, no password, no cookie value is logged.
  logger.info("auth.session_issued", {
    userId: result.userId,
    sessionMode: attributes.sameSite === "none" ? "cross-site-partitioned" : "same-site",
    secure: attributes.secure,
    partitioned: attributes.partitioned,
    secureRequest,
    forwardedProto: getForwardedProto(request),
    host: request.headers.get("host"),
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  // Inside the embedded preview the browser may refuse to keep the cookie; a
  // single-use hand-off link lets the user continue in a real tab. Production never
  // receives this field.
  const handoffToken = isEmbedPreview(getEnv()) ? await createLoginHandoff(result.sessionId, result.userId) : null;

  return jsonOk({
    redirectTo: result.mustChangePassword ? "/account" : "/dashboard",
    mustChangePassword: result.mustChangePassword,
    handoffUrl: handoffToken ? `/api/auth/handoff?t=${handoffToken}&next=${encodeURIComponent(result.mustChangePassword ? "/account" : "/dashboard")}` : null,
  });
});
