import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { hitRateLimit, resetRateLimit } from "@/server/services/rate-limit";

const key = `test:rl:${randomBytes(6).toString("hex")}`;

afterAll(async () => {
  await resetRateLimit(key);
  await pool.end();
});

describe("persistent rate limit", () => {
  it("never admits more than the limit under concurrent requests", async () => {
    const limit = 5;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hitRateLimit(key, { limit, windowSec: 60 })),
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(limit);
    expect(Math.max(...results.map((r) => r.count))).toBe(25);
  });

  it("reports a positive retry window once blocked", async () => {
    const blocked = await hitRateLimit(key, { limit: 5, windowSec: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("resets after an explicit reset (successful login path)", async () => {
    await resetRateLimit(key);
    const first = await hitRateLimit(key, { limit: 5, windowSec: 60 });
    expect(first.allowed).toBe(true);
    expect(first.count).toBe(1);
  });
});
