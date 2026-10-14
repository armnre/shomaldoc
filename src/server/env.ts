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

/** Secure cookies are on by default in production; can be overridden via COOKIE_SECURE. */
export function shouldUseSecureCookies(env: AppEnv = getEnv()): boolean {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  return env.APP_ENV === "production";
}
