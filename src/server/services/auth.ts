import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getDummyHash, hashPassword, verifyPassword } from "../auth/password";
import { AppError } from "../http";
import { loadUserAccess } from "../rbac/service";
import { recordAudit, type RequestContext } from "./audit";
import { hitRateLimit, resetRateLimit } from "./rate-limit";
import { getSettingValue } from "./settings";

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  sessionId: string;
  roles: Array<{ id: number; key: string; nameFa: string }>;
  permissions: string[];
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, ctx: RequestContext) {
  const token = randomBytes(32).toString("base64url");
  const days = await getSettingValue("auth.sessionDays");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })
    .returning({ id: sessions.id });
  return { token, expiresAt, sessionId: row.id };
}

/** Resolves a raw session token to the active user, or null if missing, expired, revoked, or disabled. */
export async function resolveSessionUser(token: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;

  const access = await loadUserAccess(db, row.user.id);
  // Throttle last-seen writes to at most one per five minutes per session.
  if (Date.now() - row.session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }
  return {
    id: row.user.id,
    username: row.user.username,
    email: row.user.email,
    fullName: row.user.fullName,
    mustChangePassword: row.user.mustChangePassword,
    sessionId: row.session.id,
    roles: access.roles.map((r) => ({ id: r.id, key: r.key, nameFa: r.nameFa })),
    permissions: access.permissions,
  };
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  userId: string;
  mustChangePassword: boolean;
}

export async function loginWithPassword(
  input: { identifier: string; password: string; twoFactorCode?: string },
  ctx: RequestContext,
): Promise<LoginResult> {
  const identifier = input.identifier.trim().toLowerCase();
  const maxFailed = await getSettingValue("auth.maxFailedLogins");
  const lockoutMinutes = await getSettingValue("auth.lockoutMinutes");

  // Per-IP ceiling protects against spraying many accounts from one source.
  const ipHit = await hitRateLimit(`login:ip:${ctx.ip}`, { limit: 60, windowSec: 15 * 60 });
  if (!ipHit.allowed) {
    throw new AppError(429, "RATE_LIMITED", "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.", {
      retryAfterSec: ipHit.retryAfterSec,
    });
  }

  // Per-identifier counter: every attempt is counted and a successful login resets it.
  const userKey = `login:user:${identifier}`;
  const userHit = await hitRateLimit(userKey, { limit: maxFailed, windowSec: lockoutMinutes * 60 });
  if (!userHit.allowed) {
    throw new AppError(429, "RATE_LIMITED", "تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر دوباره تلاش کنید.", {
      retryAfterSec: userHit.retryAfterSec,
    });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.username, identifier), eq(users.email, identifier)))
    .limit(1);

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !passwordOk) {
    await recordAudit(
      {
        actorUserId: user?.id ?? null,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user?.id ?? null,
        after: { attemptedIdentifier: identifier.slice(0, 255) },
      },
      ctx,
    );
    throw new AppError(401, "INVALID_CREDENTIALS", "نام کاربری/ایمیل یا رمز عبور نادرست است.");
  }

  if (!user.isActive) {
    throw new AppError(403, "ACCOUNT_DISABLED", "این حساب غیرفعال است. با مدیر سامانه تماس بگیرید.");
  }

  // Two-factor: when the account has TOTP enabled, a valid code is mandatory.
  // The challenge is only revealed after the password check succeeded.
  const { userTwoFactors } = await import("@/db/schema");
  const [twoFa] = await db.select().from(userTwoFactors).where(eq(userTwoFactors.userId, user.id)).limit(1);
  if (twoFa?.enabled) {
    if (!input.twoFactorCode) {
      throw new AppError(401, "TWO_FACTOR_REQUIRED", "کد تأیید دومرحله‌ای را وارد کنید.");
    }
    const { decryptSecret, verifyTotp } = await import("../auth/totp");
    if (!verifyTotp(decryptSecret(twoFa.secretCipher), input.twoFactorCode)) {
      await recordAudit(
        { actorUserId: user.id, action: "auth.2fa_failed", entityType: "user", entityId: user.id },
        ctx,
      );
      throw new AppError(401, "INVALID_TWO_FACTOR", "کد تأیید دومرحله‌ای نامعتبر است.");
    }
    await db.update(userTwoFactors).set({ lastUsedAt: new Date() }).where(eq(userTwoFactors.userId, user.id));
  }

  await resetRateLimit(userKey);
  const session = await createSession(user.id, ctx);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAudit(
    {
      actorUserId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      after: { sessionId: session.sessionId, sessionExpiresAt: session.expiresAt.toISOString() },
    },
    ctx,
  );

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    userId: user.id,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logoutSession(user: Pick<CurrentUser, "id" | "sessionId">, ctx: RequestContext): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, user.sessionId));
  await recordAudit(
    { actorUserId: user.id, action: "auth.logout", entityType: "user", entityId: user.id, after: { sessionId: user.sessionId } },
    ctx,
  );
}

export async function changeOwnPassword(
  user: Pick<CurrentUser, "id" | "sessionId">,
  input: { currentPassword: string; newPassword: string },
  ctx: RequestContext,
): Promise<{ otherSessionsRevoked: number }> {
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !(await verifyPassword(input.currentPassword, row.hash))) {
    throw new AppError(400, "WRONG_CURRENT_PASSWORD", "رمز عبور فعلی نادرست است.");
  }
  const newHash = await hashPassword(input.newPassword);

  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), ne(sessions.id, user.sessionId)),
      )
      .returning({ id: sessions.id });
    // Hashes and plaintext passwords are intentionally absent from the audit payload.
    await recordAudit(
      {
        actorUserId: user.id,
        action: "auth.password_changed",
        entityType: "user",
        entityId: user.id,
        after: { otherSessionsRevoked: revoked.length },
      },
      ctx,
      tx,
    );
    return { otherSessionsRevoked: revoked.length };
  });
}
