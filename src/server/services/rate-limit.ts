import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter persisted in PostgreSQL. The check-and-increment is a single
 * INSERT … ON CONFLICT statement, so concurrent requests cannot both pass the limit.
 * Every call counts as one hit; `allowed` is false once the count exceeds `limit`.
 */
export async function hitRateLimit(key: string, options: { limit: number; windowSec: number }): Promise<RateLimitResult> {
  const windowSec = Math.max(1, Math.floor(options.windowSec));
  const result = await db.execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO rate_limits AS rl (key, count, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rl.window_start <= now() - make_interval(secs => ${windowSec}) THEN 1
        ELSE rl.count + 1
      END,
      window_start = CASE
        WHEN rl.window_start <= now() - make_interval(secs => ${windowSec}) THEN now()
        ELSE rl.window_start
      END
    RETURNING count, window_start
  `);
  const row = result.rows[0];
  const windowEnd = new Date(row.window_start).getTime() + windowSec * 1000;
  return {
    allowed: row.count <= options.limit,
    count: row.count,
    retryAfterSec: Math.max(0, Math.ceil((windowEnd - Date.now()) / 1000)),
  };
}

export async function resetRateLimit(key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}
