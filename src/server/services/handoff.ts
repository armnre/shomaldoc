import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { loginHandoffs } from "@/db/schema";

/**
 * Session hand-off (preview only).
 *
 * A sandboxed live-preview iframe refuses to store the session cookie, so a login
 * there succeeds on the server but the very next request arrives without a cookie and
 * the user is bounced back to the login page. A hand-off token fixes that: the login
 * response carries a short-lived, single-use token which the user opens once in a real
 * browser tab. Because that request is first-party, the session cookie is stored
 * normally and the dashboard opens.
 *
 * Security properties:
 *  - the token is random (32 bytes) and only its SHA-256 hash is stored;
 *  - it expires in two minutes and can be redeemed exactly once (enforced inside the
 *    update statement, so two parallel requests cannot both win);
 *  - it carries no credentials and is invalidated as soon as it is used;
 *  - it is never logged and never included in the audit payload.
 */

const TTL_MS = 2 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLoginHandoff(sessionId: string, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(loginHandoffs).values({
    tokenHash: hashToken(token),
    sessionId,
    userId,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return token;
}

export interface HandoffResult {
  /** The session that could not be stored by the embedding browser (kept for context). */
  sessionId: string;
  userId: string;
}

/** Redeems a token exactly once. Returns null when it is unknown, used or expired. */
export async function redeemLoginHandoff(token: string): Promise<HandoffResult | null> {
  if (!token || token.length < 20) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select()
    .from(loginHandoffs)
    .where(and(eq(loginHandoffs.tokenHash, tokenHash), isNull(loginHandoffs.usedAt), gt(loginHandoffs.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  // Single-use: the row is only accepted for the request that flips `used_at` from null.
  const [claimed] = await db
    .update(loginHandoffs)
    .set({ usedAt: new Date() })
    .where(and(eq(loginHandoffs.id, row.id), isNull(loginHandoffs.usedAt)))
    .returning();
  if (!claimed) return null;
  return { sessionId: row.sessionId, userId: row.userId };
}

/** Removes expired tokens; called opportunistically so the table cannot grow forever. */
export async function pruneLoginHandoffs(): Promise<void> {
  await db.delete(loginHandoffs).where(lt(loginHandoffs.expiresAt, new Date()));
}
