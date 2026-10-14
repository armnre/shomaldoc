import { NextResponse, type NextRequest } from "next/server";
import { buildSecurityHeaders } from "@/server/security-headers";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Request proxy (Next.js 16 contract; replaces the deprecated middleware.ts).
 *
 * Sets the security headers for every dynamic response and issues a per-request
 * CSP nonce. Next propagates the `x-nonce` request header to the inline scripts it
 * emits, so the theme bootstrap in the root layout can be nonce-tagged while
 * `script-src 'unsafe-inline'` stays removed. Header values live in
 * `src/server/security-headers.ts` (unit-tested, including the framing policy).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // Read from process.env directly: middleware is bundled separately from the
  // server runtime. buildSecurityHeaders re-checks APP_ENV, so the flag cannot
  // relax framing on a production host.
  const headers = buildSecurityHeaders({
    nonce,
    isDev,
    appEnv: process.env.APP_ENV,
    allowEmbed: process.env.ALLOW_EMBED === "1",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // The layout needs the current path to enforce the first-login password change.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  // Static assets and the service worker are excluded so caching and PWA updates keep working.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|branding/|sw.js|manifest.webmanifest).*)"],
};
