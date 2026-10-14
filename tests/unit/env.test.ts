import { describe, expect, it } from "vitest";
import { parseEnv, shouldUseSecureCookies } from "@/server/env";

describe("env validation", () => {
  it("fails with variable names but without echoing values", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://secret-host/db" })).toThrowError(/DATABASE_URL/);
    try {
      parseEnv({ DATABASE_URL: "mysql://user:TOP-SECRET@host/db" });
    } catch (e) {
      expect((e as Error).message).not.toContain("TOP-SECRET");
    }
  });

  it("applies defaults for optional settings", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" });
    expect(env.APP_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.UPLOAD_DIR).toBe("./storage/uploads");
  });

  it("enables secure cookies by default only in production", () => {
    const base = { DATABASE_URL: "postgresql://u:p@h/db" };
    expect(shouldUseSecureCookies(parseEnv({ ...base, APP_ENV: "production" }))).toBe(true);
    expect(shouldUseSecureCookies(parseEnv({ ...base, APP_ENV: "preview" }))).toBe(false);
    expect(shouldUseSecureCookies(parseEnv({ ...base, APP_ENV: "preview", COOKIE_SECURE: "true" }))).toBe(true);
  });
});
