import { and, count, desc, eq, gte } from "drizzle-orm";
import { db, type DbLike } from "@/db";
import { auditLogs, users } from "@/db/schema";

export interface Actor {
  id: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string | null;
}

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Appends an audit record. Pass the transaction handle as `executor` so the audit row
 * commits or rolls back together with the change it describes.
 * Callers must never put secrets (password hashes, tokens) into before/after.
 */
export async function recordAudit(
  entry: AuditEntry,
  ctx: RequestContext | null,
  executor: DbLike = db,
): Promise<void> {
  await executor.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
  });
}

export interface AuditQuery {
  action?: string;
  page: number;
  pageSize: number;
}

export async function listAuditLogs(query: AuditQuery) {
  const conditions = [];
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ value: total }] = await db.select({ value: count() }).from(auditLogs).where(where);
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorUserId,
      actorUsername: users.username,
      actorFullName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows, total: Number(total), page: query.page, pageSize: query.pageSize };
}

export async function countAuditSince(since: Date): Promise<number> {
  const [row] = await db.select({ value: count() }).from(auditLogs).where(gte(auditLogs.createdAt, since));
  return Number(row?.value ?? 0);
}

export async function listDistinctAuditActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}

