import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/current-user";
import { embedCookieAttributes, getEnv, isEmbedPreview } from "@/server/env";
import { apiRoute, getClientIp, getForwardedProto, getUserAgent, isSecureRequest } from "@/server/http";
import { logger } from "@/server/logger";
import { createSession } from "@/server/services/auth";
import { redeemLoginHandoff } from "@/server/services/handoff";

export const dynamic = "force-dynamic";

/**
 * Redeems a preview hand-off token: the browser gets a *new* session for the same user,
 * established from a first-party navigation, so the cookie is stored normally (see
 * src/server/services/handoff.ts for the why).
 *
 * The token is single-use and expires after two minutes; an unknown, used or expired
 * token redirects to the login page with a flag instead of showing a blank screen.
 */
export const GET = apiRoute(async (request: Request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const next = url.searchParams.get("next") ?? "/dashboard";
  const env = getEnv();

  if (!isEmbedPreview(env)) {
    // The mechanism exists only for the embedded preview; never open it elsewhere.
    return NextResponse.redirect(new URL("/login?handoff=disabled", url));
  }

  const result = await redeemLoginHandoff(token);
  if (!result) {
    logger.warn("auth.handoff_rejected", {
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      forwardedProto: getForwardedProto(request),
    });
    return NextResponse.redirect(new URL("/login?handoff=used", url));
  }

  const session = await createSession(result.userId, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  const attributes = embedCookieAttributes(env, { secureRequest: isSecureRequest(request) });
  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/dashboard", url));
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    path: "/",
    expires: session.expiresAt,
    ...attributes,
  });
  logger.info("auth.handoff_redeemed", {
    userId: result.userId,
    secureRequest: isSecureRequest(request),
    forwardedProto: getForwardedProto(request),
    ip: getClientIp(request),
  });
  return response;
});
