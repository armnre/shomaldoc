import { count, desc, eq, gt, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, sessions, users } from "@/db/schema";
import { countAuditSince } from "./audit";

export async function getDashboardStats() {
  const now = new Date();
  const [[totalRow], [activeRow], [sessionRow], auditLast24h, recent] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(eq(users.isActive, true)),
    db
      .select({ value: count() })
      .from(sessions)
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now))),
    countAuditSince(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        createdAt: auditLogs.createdAt,
        actorFullName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .orderBy(desc(auditLogs.id))
      .limit(10),
  ]);

  return {
    totalUsers: Number(totalRow?.value ?? 0),
    activeUsers: Number(activeRow?.value ?? 0),
    activeSessions: Number(sessionRow?.value ?? 0),
    auditLast24h,
    recentActivity: recent,
  };
}
