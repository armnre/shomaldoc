/**
 * Security headers for every dynamic response.
 *
 * Kept as a pure function so the exact header values (especially the framing
 * policy) are unit-testable: a regression in the clickjacking defence must fail a
 * test, not be discovered on the production host.
 */

export interface SecurityHeaderOptions {
  /** Per-request CSP nonce; Next propagates `x-nonce` to the inline bootstrap script. */
  nonce: string;
  /** Dev keeps `'unsafe-eval'` and `ws:` for the Next dev overlay. */
  isDev: boolean;
  /** Raw APP_ENV value ("development" | "preview" | "production" | undefined). */
  appEnv: string | undefined;
  /** Raw ALLOW_EMBED flag (preview live-preview iframe only). */
  allowEmbed: boolean;
}

/**
 * Embedding is a preview-only convenience: the live preview shows the app inside an
 * iframe. The APP_ENV guard comes first, so production can never be framed even if
 * the flag is present in its environment file.
 */
export function isEmbedPreview({ appEnv, allowEmbed }: Pick<SecurityHeaderOptions, "appEnv" | "allowEmbed">): boolean {
  return appEnv !== "production" && allowEmbed === true;
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const { nonce, isDev } = options;
  const embedPreview = isEmbedPreview(options);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind injects styles and components use inline style attributes; removing
    // this would require rewriting the design system for no security gain.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${embedPreview ? "*" : "'none'"}`,
  ].join("; ");

  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // The system holds personal data; no page may ever be indexed by a crawler.
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  };
  if (!embedPreview) headers["X-Frame-Options"] = "DENY";
  return headers;
}
