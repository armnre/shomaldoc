import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { settingVersions, settings } from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type Actor, type RequestContext } from "./audit";

/**
 * Data-driven settings registry. Adding a key here is enough for the admin UI to render it;
 * values are validated against these bounds on write.
 */
export const SETTING_DEFS = {
  "site.name": { type: "string", defaultValue: "شمال‌داک", min: 2, max: 80, label: "نام نمایشی سامانه" },
  "upload.maxSizeMb": { type: "number", defaultValue: 20, min: 1, max: 200, label: "حداکثر حجم فایل (مگابایت)" },
  "auth.sessionDays": { type: "number", defaultValue: 14, min: 1, max: 90, label: "مدت اعتبار نشست (روز)" },
  "auth.maxFailedLogins": { type: "number", defaultValue: 5, min: 3, max: 20, label: "حداکثر تلاش ناموفق ورود" },
  "auth.lockoutMinutes": { type: "number", defaultValue: 15, min: 1, max: 240, label: "مدت قفل موقت (دقیقه)" },
  // M3: supervisor capacity — no threshold is hard-coded anywhere else.
  "capacity.defaultBase": { type: "number", defaultValue: 5, min: 0, max: 50, label: "ظرفیت پایهٔ هر استاد" },
  "capacity.rankFactor.assistant": { type: "number", defaultValue: 1, min: 0, max: 5, label: "ضریب ظرفیت: استادیار" },
  "capacity.rankFactor.associate": { type: "number", defaultValue: 1.5, min: 0, max: 5, label: "ضریب ظرفیت: دانشیار" },
  "capacity.rankFactor.professor": { type: "number", defaultValue: 2, min: 0, max: 5, label: "ضریب ظرفیت: استاد تمام" },
  "capacity.advisorCountsAs": { type: "number", defaultValue: 0.5, min: 0, max: 2, label: "ضریب شمارش مشاور در ظرفیت" },
  "supervisor.maxAttempts": { type: "number", defaultValue: 3, min: 1, max: 10, label: "حداکثر تلاش ناموفق پیش از ارجاع به مدیر گروه" },
  "supervisor.maxSupervisors": { type: "number", defaultValue: 2, min: 1, max: 5, label: "حداکثر تعداد استاد راهنما" },
  "supervisor.advisorRequired": { type: "boolean", defaultValue: false, min: 0, max: 1, label: "الزامی‌بودن استاد مشاور" },
  // M6/M8: rule-engine thresholds
  "defense.minMonthsAfterProposal": { type: "number", defaultValue: 4, min: 0, max: 36, label: "حداقل فاصلهٔ تصویب پروپوزال تا دفاع (ماه)" },
  "similarity.maxPercent": { type: "number", defaultValue: 30, min: 1, max: 100, label: "سقف درصد همانندجویی" },
  "terms.maxAllowed": { type: "number", defaultValue: 6, min: 1, max: 24, label: "سقف ترم مجاز پایان‌نامه" },
  // M11: scheduler + reminders
  "scheduler.enabled": { type: "boolean", defaultValue: true, min: 0, max: 1, label: "فعال‌بودن زمان‌بند خودکار" },
  "scheduler.intervalMinutes": { type: "number", defaultValue: 15, min: 1, max: 1440, label: "دورهٔ اجرای زمان‌بند (دقیقه)" },
  "notify.reminderDay1": { type: "boolean", defaultValue: true, min: 0, max: 1, label: "یادآوری روز اول سررسید" },
  "notify.reminderDay3": { type: "boolean", defaultValue: true, min: 0, max: 1, label: "یادآوری روز سوم" },
  "notify.escalationDay5": { type: "boolean", defaultValue: true, min: 0, max: 1, label: "ارتقا به نقش بالاتر در روز پنجم" },
  "notify.channels.email": { type: "boolean", defaultValue: false, min: 0, max: 1, label: "کانال ایمیل (بدون کلید واقعی غیرفعال می‌ماند)" },
  "notify.channels.sms": { type: "boolean", defaultValue: false, min: 0, max: 1, label: "کانال پیامک (بدون کلید واقعی غیرفعال می‌ماند)" },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFS)[K]["type"] extends "number"
  ? number
  : (typeof SETTING_DEFS)[K]["type"] extends "boolean"
    ? boolean
    : string;

export function isSettingKey(value: string): value is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFS, value);
}

function schemaFor(key: SettingKey): z.ZodType<string | number | boolean> {
  const def = SETTING_DEFS[key];
  if (def.type === "number") {
    // Numbers may be fractional (capacity factors), so no int() restriction.
    return z.coerce.number().min(def.min).max(def.max);
  }
  if (def.type === "boolean") {
    return z.union([z.boolean(), z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1")]);
  }
  return z.string().trim().min(def.min).max(def.max);
}

export function parseSettingValue(key: SettingKey, raw: unknown): string | number | boolean {
  const result = schemaFor(key).safeParse(raw);
  if (!result.success) {
    throw new AppError(400, "INVALID_SETTING", "مقدار وارد‌شده نامعتبر است.", {
      key,
      issues: result.error.issues.map((i) => i.message),
    });
  }
  return result.data;
}

export async function getSettingValue<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (!row) return SETTING_DEFS[key].defaultValue as SettingValue<K>;
  return row.value as SettingValue<K>;
}

export interface SettingView {
  key: SettingKey;
  label: string;
  type: "string" | "number" | "boolean";
  min: number;
  max: number;
  defaultValue: string | number | boolean;
  value: string | number | boolean;
  version: number;
  updatedAt: Date | null;
}

export async function listSettings(): Promise<SettingView[]> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFS[key];
    const row = byKey.get(key);
    return {
      key,
      label: def.label,
      type: def.type,
      min: def.min,
      max: def.max,
      defaultValue: def.defaultValue,
      value: (row?.value as string | number | boolean | undefined) ?? def.defaultValue,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function listSettingVersions(key: SettingKey, limit = 10) {
  return db
    .select({
      version: settingVersions.version,
      value: settingVersions.value,
      changedAt: settingVersions.changedAt,
      changedBy: settingVersions.changedBy,
      reason: settingVersions.reason,
    })
    .from(settingVersions)
    .where(eq(settingVersions.key, key))
    .orderBy(desc(settingVersions.version))
    .limit(limit);
}

/** Writes a new immutable version; previous versions are never deleted. */
export async function updateSetting(
  actor: Actor,
  key: SettingKey,
  raw: unknown,
  reason: string,
  ctx: RequestContext,
): Promise<{ version: number; value: string | number | boolean }> {
  const value = parseSettingValue(key, raw);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(settings).where(eq(settings.key, key)).for("update").limit(1);
    const beforeValue = current ? current.value : SETTING_DEFS[key].defaultValue;
    const nextVersion = (current?.version ?? 0) + 1;

    if (current) {
      await tx
        .update(settings)
        .set({ value, version: nextVersion, updatedAt: new Date(), updatedBy: actor.id })
        .where(eq(settings.key, key));
    } else {
      await tx.insert(settings).values({ key, value, version: nextVersion, updatedBy: actor.id });
    }

    await tx.insert(settingVersions).values({
      key,
      version: nextVersion,
      value,
      changedBy: actor.id,
      reason,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "setting.updated",
        entityType: "setting",
        entityId: key,
        before: { value: beforeValue, version: current?.version ?? 0 },
        after: { value, version: nextVersion },
        reason,
      },
      ctx,
      tx,
    );
    return { version: nextVersion, value };
  });
}
