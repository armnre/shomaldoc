import { z } from "zod";

/**
 * Validated runtime configuration. The app refuses to start with an invalid
 * environment and reports only the variable names, never their values.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "preview", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "DATABASE_URL must start with postgresql://"),
  UPLOAD_DIR: z.string().min(1).default("./storage/uploads"),
  COOKIE_SECURE: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  PUBLIC_BASE_URL: z.url().optional(),
  /** Required for encrypting TOTP secrets at rest; generated locally when absent in dev. */
  APP_SECRET: z.string().min(16).optional(),
  /**
   * Preview only. The sandbox/CI live preview embeds the app inside an iframe, which
   * needs `frame-ancestors` relaxed and partitioned third-party cookies. Production
   * ignores the flag entirely (`allowsEmbedding` requires APP_ENV !== "production"),
   * so the clickjacking defences can never be switched off on the real host.
   */
  ALLOW_EMBED: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`[shomaldoc] Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cached) {
    cached = parseEnv(process.env);
  }
  return cached;
}

/** True only for preview/CI environments that must be embeddable in an iframe. */
export function isEmbedPreview(env: AppEnv = getEnv()): boolean {
  return env.APP_ENV !== "production" && env.ALLOW_EMBED === true;
}

/**
 * Cookie attributes for the embed preview. Inside a third-party iframe a
 * `SameSite=Lax` cookie is never sent, which would make login appear to do
 * nothing; a partitioned `SameSite=None` cookie is stored per top-level site and
 * still works when third-party cookies are blocked.
 */
export function embedCookieAttributes(
  env: AppEnv = getEnv(),
  options: { secureRequest?: boolean } = {},
): Pick<CookieOptions, "secure" | "sameSite" | "partitioned"> {
  if (!isEmbedPreview(env)) return { secure: shouldUseSecureCookies(env), sameSite: "lax", partitioned: false };
  // `SameSite=None` is only legal together with `Secure`: a browser rejects the
  // pair otherwise and the session silently never persists. A preview reached
  // over plain HTTP therefore falls back to `Lax`, which works when the address
  // is opened as a top-level tab — the only context in which any browser accepts
  // a cross-site session over http.
  if (options.secureRequest === false) return { secure: false, sameSite: "lax", partitioned: false };
  return { secure: true, sameSite: "none", partitioned: true };
}

interface CookieOptions {
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  partitioned?: boolean;
}

/** Secure cookies are on by default in production; can be overridden via COOKIE_SECURE. */
export function shouldUseSecureCookies(env: AppEnv = getEnv()): boolean {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  return env.APP_ENV === "production";
}
