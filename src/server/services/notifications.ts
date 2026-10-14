import { and, desc, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { notificationLogs, notifications, users } from "@/db/schema";
import { logger } from "../logger";
import { getSettingValue } from "./settings";

/**
 * In-app notification centre plus a pluggable channel layer.
 *
 * `inapp` is implemented for real. `email` and `sms` sit behind an interface and
 * report `disabled` explicitly — without real credentials nothing is sent and
 * nothing is faked. The disabled state is visible in the UI and in the log.
 */

export type NotificationChannel = "inapp" | "email" | "sms";

export interface ChannelResult {
  channel: NotificationChannel;
  status: "sent" | "disabled" | "failed";
  detail?: string;
}

export interface NotifyInput {
  userId: string;
  kind: string;
  titleFa: string;
  bodyFa?: string | null;
  caseId?: string | null;
  taskId?: string | null;
  link?: string | null;
  channels?: NotificationChannel[];
}

/** Writes the notification and logs each channel attempt. Runs inside `executor`. */
export async function notify(input: NotifyInput, executor: DbTx | typeof db = db): Promise<string> {
  const [row] = await executor
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      titleFa: input.titleFa,
      bodyFa: input.bodyFa ?? null,
      caseId: input.caseId ?? null,
      taskId: input.taskId ?? null,
      link: input.link ?? null,
    })
    .returning({ id: notifications.id });

  const channels = input.channels ?? ["inapp"];
  for (const channel of channels) {
    const result = await deliver(channel, input.userId, row.id, executor);
    await executor.insert(notificationLogs).values({
      notificationId: row.id,
      channel,
      status: result.status,
      detail: result.detail ?? null,
    });
  }
  return row.id;
}

/**
 * Channel dispatch. Email/SMS require real provider credentials; until they are
 * configured the channel is reported `disabled` (never silently "sent").
 */
async function deliver(
  channel: NotificationChannel,
  userId: string,
  notificationId: string,
  executor: DbTx | typeof db,
): Promise<ChannelResult> {
  if (channel === "inapp") {
    return { channel, status: "sent" };
  }
  const enabled = channel === "email" ? await getSettingValue("notify.channels.email") : await getSettingValue("notify.channels.sms");
  if (!enabled) {
    return { channel, status: "disabled", detail: "کانال در تنظیمات غیرفعال است." };
  }
  const hasCredentials = channel === "email" ? !!process.env.SMTP_URL : !!process.env.SMS_API_KEY;
  if (!hasCredentials) {
    logger.warn("notification.channel_missing_credentials", { channel, userId, notificationId });
    return { channel, status: "disabled", detail: "کلید/اتصال واقعی سرویس تنظیم نشده است." };
  }
  // A real provider would be called here. No stubbed success is ever recorded.
  logger.warn("notification.channel_not_implemented", { channel });
  return { channel, status: "failed", detail: "پیاده‌سازی provider این کانال تکمیل نشده است." };
}

export async function listNotifications(userId: string, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(limit, 100));
}

export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .limit(500);
  return rows.length;
}

export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const updated = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return updated.length > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return updated.length;
}

/** Channel health for the admin dashboard: honest about what is disabled. */
export async function getChannelStatuses(): Promise<Array<{ channel: NotificationChannel; enabled: boolean; reason: string | null }>> {
  const [emailOn, smsOn] = await Promise.all([getSettingValue("notify.channels.email"), getSettingValue("notify.channels.sms")]);
  return [
    { channel: "inapp", enabled: true, reason: null },
    { channel: "email", enabled: !!emailOn && !!process.env.SMTP_URL, reason: !emailOn ? "در تنظیمات غیرفعال است." : !process.env.SMTP_URL ? "SMTP_URL تنظیم نشده است." : null },
    { channel: "sms", enabled: !!smsOn && !!process.env.SMS_API_KEY, reason: !smsOn ? "در تنظیمات غیرفعال است." : !process.env.SMS_API_KEY ? "SMS_API_KEY تنظیم نشده است." : null },
  ];
}

/** Recipients of a case-related notification: the student and linked supervisors. */
export async function caseStakeholders(caseId: string, executor: DbTx | typeof db = db): Promise<string[]> {
  const { thesisCases, thesisSupervisors } = await import("@/db/schema");
  const [tc] = await executor.select({ studentUserId: thesisCases.studentUserId }).from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1);
  const sups = await executor
    .select({ userId: thesisSupervisors.userId })
    .from(thesisSupervisors)
    .where(and(eq(thesisSupervisors.caseId, caseId), eq(thesisSupervisors.status, "active")));
  const ids = new Set<string>();
  if (tc?.studentUserId) ids.add(tc.studentUserId);
  for (const s of sups) if (s.userId) ids.add(s.userId);
  return [...ids];
}

export { users };
