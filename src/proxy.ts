import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Request proxy (Next.js 16 contract; replaces the deprecated middleware.ts).
 *
 * Sets the security headers for every dynamic response and issues a per-request
 * CSP nonce. Next propagates the `x-nonce` request header to the inline scripts
 * it emits, so the theme bootstrap in the root layout can be nonce-tagged while
 * `script-src 'unsafe-inline'` stays removed.
 *
 * `style-src 'unsafe-inline'` is retained deliberately: Tailwind injects styles
 * and several components use inline style attributes; removing it would require
 * rewriting the design system for no security gain.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  return response;
}

export const config = {
  // Static assets and the service worker are excluded so caching and PWA updates keep working.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|branding/|sw.js|manifest.webmanifest).*)"],
};
