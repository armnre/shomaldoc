import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type RequestContext } from "./audit";

/**
 * Session management: list the caller's own active sessions (device/IP/last seen)
 * and revoke one or all of them. Only the owner may act on their sessions.
 */

export async function listMySessions(userId: string) {
  const rows = await db
    .select({
      id: sessions.id,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.lastSeenAt));
  return rows;
}

export async function revokeSession(userId: string, sessionId: string, ctx: RequestContext, keepCurrentId?: string) {
  if (sessionId === keepCurrentId) {
    throw new AppError(400, "CANNOT_REVOKE_CURRENT", "نشست جاری از این مسیر قابل خاتمه نیست؛ از دکمهٔ خروج استفاده کنید.");
  }
  const updated = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (updated.length === 0) throw new AppError(404, "SESSION_NOT_FOUND", "نشست یافت نشد.");
  await recordAudit({ actorUserId: userId, action: "auth.session_revoked", entityType: "session", entityId: sessionId }, ctx);
  return { revoked: 1 };
}

export async function revokeAllSessions(userId: string, ctx: RequestContext, keepCurrentId?: string) {
  // The caller's own session must survive, otherwise "sign out everywhere"
  // would log the user out of the very request that asked for it.
  const where = keepCurrentId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, keepCurrentId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  const rows = await db.update(sessions).set({ revokedAt: new Date() }).where(where).returning({ id: sessions.id });
  const revoked = rows.length;
  await recordAudit({ actorUserId: userId, action: "auth.sessions_revoked_all", entityType: "user", entityId: userId, after: { revoked } }, ctx);
  return { revoked };
}
