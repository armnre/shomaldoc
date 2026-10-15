import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "@/server/security-headers";
import { embedCookieAttributes, parseEnv } from "@/server/env";

const headers = (options: { appEnv?: string; allowEmbed?: boolean; isDev?: boolean } = {}) =>
  buildSecurityHeaders({ nonce: "nonce123", isDev: options.isDev ?? false, appEnv: options.appEnv ?? "production", allowEmbed: options.allowEmbed ?? false });

/**
 * M14 — security & accessibility invariants that must never regress.
 *
 * These are static checks over the shipped source: they catch the mistakes that a
 * runtime test cannot (a missing header, a control without a focus ring, an input
 * without a label, an indexable private page).
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("response security headers", () => {
  const proxy = read("src/proxy.ts");

  it("applies the hardening headers to every dynamic response", () => {
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Robots-Tag",
    ]) {
      expect(headers({ appEnv: "production" })).toHaveProperty(header);
    }
    expect(proxy).toContain("buildSecurityHeaders");
  });

  it("refuses framing in production, even when the preview flag is present", () => {
    const prod = headers({ appEnv: "production", allowEmbed: true });
    expect(prod["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(prod["X-Frame-Options"]).toBe("DENY");
    // ...and relaxes it only for an explicitly flagged preview build.
    const preview = headers({ appEnv: "preview", allowEmbed: true });
    expect(preview["Content-Security-Policy"]).toContain("frame-ancestors *");
    expect(preview["X-Frame-Options"]).toBeUndefined();
    // A preview without the flag stays locked down.
    expect(headers({ appEnv: "development" })["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("keeps the strict script policy: nonce, no unsafe-inline, no object embedding", () => {
    const prod = headers({ appEnv: "production" })["Content-Security-Policy"];
    expect(prod).toContain("'nonce-nonce123'");
    expect(prod).toContain("'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("keeps the crawler policy closed for the whole site", () => {
    const robots = read("src/app/robots.ts");
    expect(robots).toContain('disallow: "/"');
    expect(headers({ appEnv: "production" })["X-Robots-Tag"]).toContain("noindex");
    expect(headers({ appEnv: "preview", allowEmbed: true })["X-Robots-Tag"]).toContain("noindex");
  });
});

describe("session cookie attributes", () => {
  const preview = parseEnv({ APP_ENV: "preview", ALLOW_EMBED: "true", DATABASE_URL: "postgresql://x/y" });
  const production = parseEnv({ APP_ENV: "production", ALLOW_EMBED: "true", DATABASE_URL: "postgresql://x/y" });
  const development = parseEnv({ APP_ENV: "development", DATABASE_URL: "postgresql://x/y" });

  it("uses a partitioned cross-site cookie for an https preview (works inside an iframe)", () => {
    const attributes = embedCookieAttributes(preview, { secureRequest: true });
    // SameSite=None is only legal together with Secure; partitioned keeps it
    // working when third-party cookies are blocked.
    expect(attributes).toEqual({ secure: true, sameSite: "none", partitioned: true });
  });

  it("falls back to a same-site cookie over plain http (a Secure cookie would be dropped)", () => {
    expect(embedCookieAttributes(preview, { secureRequest: false })).toEqual({ secure: false, sameSite: "lax", partitioned: false });
  });

  it("never relaxes the production cookie", () => {
    expect(embedCookieAttributes(production, { secureRequest: true })).toEqual({ secure: true, sameSite: "lax", partitioned: false });
    expect(embedCookieAttributes(development, { secureRequest: false })).toEqual({ secure: false, sameSite: "lax", partitioned: false });
  });
});

describe("login flow cannot loop silently", () => {
  it("verifies the session before navigating away from the form", () => {
    const form = read("src/components/features/login-form.tsx");
    expect(form).toContain("/api/auth/session-state");
    expect(form).toContain("window.location.assign");
    // The failure must be explained in Persian, with a real way forward.
    expect(form).toContain("dict.auth.sessionNotStored");
    expect(form).toContain("dict.auth.openInNewTab");
    expect(form).toContain('target="_blank"');
  });

  it("exposes a session probe endpoint that leaks nothing", () => {
    const route = read("src/app/api/auth/session-state/route.ts");
    expect(route).toContain("authenticated: user !== null");
    expect(route).not.toContain("email");
    expect(route).not.toContain("username");
  });
});

describe("first-login password change", () => {
  it("is enforced on the server for every page except the account page", () => {
    const guard = read("src/server/auth/current-user.ts");
    expect(guard).toContain("user.mustChangePassword");
    expect(guard).toContain('redirect("/account")');
    expect(guard).toContain("x-pathname");
  });
});

describe("accessibility baseline of the design system", () => {
  const components = read("src/components/ui/index.tsx");

  it("keeps a visible focus ring and a 44px interaction target", () => {
    const css = read("src/app/globals.css");
    // One global focus-visible outline covers every interactive element.
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 3px solid var(--c-ring)");
    // Touch targets: the design system's medium button is 44px tall and coarse
    // pointers get a 44px minimum for every button/link.
    expect(components).toMatch(/md: "h-11/);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
    expect(css).toContain("min-height: 44px");
  });

  it("gives form controls an associated label and an error channel", () => {
    const form = read("src/components/ui/form.tsx");
    for (const token of ["htmlFor", "aria-invalid", "aria-describedby"]) {
      expect(form).toContain(token);
    }
  });
});

describe("no hidden disabled-by-design controls", () => {
  it("the navigation never renders an item the user cannot open", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("can(user, item.permission)");
  });
});

describe("preview session hand-off", () => {
  it("is single-use, short-lived and stores only a hash", async () => {
    const { readFileSync } = await import("node:fs");
    const service = readFileSync(join(process.cwd(), "src/server/services/handoff.ts"), "utf8");
    // Only the SHA-256 hash is persisted; the raw token never touches the database.
    expect(service).toContain("createHash(\"sha256\")");
    expect(service).toContain("randomBytes(32)");
    expect(service).toContain("isNull(loginHandoffs.usedAt)");
    // Two minutes, not hours.
    expect(service).toContain("TTL_MS = 2 * 60 * 1000");
  });

  it("is refused outside the preview", async () => {
    const route = await import("@/app/api/auth/handoff/route");
    expect(typeof route.GET).toBe("function");
    const source = (await import("node:fs")).readFileSync(join(process.cwd(), "src/app/api/auth/handoff/route.ts"), "utf8");
    expect(source).toContain("if (!isEmbedPreview(env))");
    expect(source).toContain('"/login?handoff=disabled"');
    expect(source).toContain('"/login?handoff=used"');
  });

  it("is offered by the login form only when the browser refused the cookie", () => {
    const form = read("src/components/features/login-form.tsx");
    expect(form).toContain("handoffUrl");
    expect(form).toContain("setSessionBlocked(true)");
  });
});
