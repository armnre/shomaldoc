import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTwoFactors, users } from "@/db/schema";
import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { decryptSecret, encryptSecret, generateSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";
import { recordAudit } from "@/server/services/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const enrollSchema = z.object({ step: z.enum(["start", "confirm"]), code: z.string().trim().max(10).optional() });

/**
 * Optional TOTP 2FA. `step=start` issues a fresh secret + otpauth URL (the only
 * moment the secret is returned); `step=confirm` verifies a code and enables it.
 * The stored secret is encrypted and never returned again.
 */
export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const input = await parseJson(request, enrollSchema);
  const ctx = { ip: getClientIp(request), userAgent: getUserAgent(request) };

  if (input.step === "start") {
    const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, user.id)).limit(1);
    const secret = generateSecret();
    const cipher = encryptSecret(secret);
    const [existing] = await db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, user.id)).limit(1);
    if (existing) {
      await db.update(userTwoFactors).set({ secretCipher: cipher, enabled: false }).where(eq(userTwoFactors.userId, user.id));
    } else {
      await db.insert(userTwoFactors).values({ userId: user.id, secretCipher: cipher, enabled: false }).returning();
    }
    return jsonOk({ step: "start", otpauthUrl: otpauthUrl(secret, me?.username ?? user.username), secret });
  }

  if (!input.code) throw new AppError(400, "CODE_REQUIRED", "کد شش‌رقمی را وارد کنید.");
  const [row] = await db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, user.id)).limit(1);
  if (!row) throw new AppError(400, "NOT_ENROLLED", "ابتدا ثبت 2FA را آغاز کنید.");
  if (!verifyTotp(decryptSecret(row.secretCipher), input.code)) {
    throw new AppError(400, "INVALID_CODE", "کد واردشده معتبر نیست.");
  }
  await db.update(userTwoFactors).set({ enabled: true, enrolledAt: new Date(), lastUsedAt: new Date() }).where(eq(userTwoFactors.userId, user.id));
  await recordAudit({ actorUserId: user.id, action: "auth.2fa_enabled", entityType: "user", entityId: user.id }, ctx);
  return jsonOk({ step: "confirm", enabled: true });
});

export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  const [row] = await db.select({ enabled: userTwoFactors.enabled, enrolledAt: userTwoFactors.enrolledAt }).from(userTwoFactors).where(eq(userTwoFactors.userId, user.id)).limit(1);
  // The secret itself is never returned.
  return jsonOk({ enabled: row?.enabled ?? false, enrolledAt: row?.enrolledAt ?? null });
});
