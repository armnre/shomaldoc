import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { getEnv } from "../env";
import { AppError } from "../http";

/**
 * TOTP (RFC 6238) two-factor authentication implemented with node:crypto only —
 * no new runtime dependency, no external service.
 *
 * Secrets are encrypted at rest with a key derived from APP_SECRET, so the raw
 * base32 secret never appears in the database, logs or API responses.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new AppError(400, "INVALID_SECRET", "کلید رمز معتبر نیست.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Hot value for a counter; used by TOTP with counter = floor(time / period). */
export function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", key).update(buf).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totp(secretBase32: string, at = new Date()): string {
  return hotp(secretBase32, Math.floor(at.getTime() / 1000 / PERIOD));
}

/** Verifies with a ±1 window to tolerate small clock drift. */
export function verifyTotp(secretBase32: string, code: string, at = new Date()): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(at.getTime() / 1000 / PERIOD);
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secretBase32, counter + delta));
    const actual = Buffer.from(clean);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, accountName: string, issuer = "ShomalDoc"): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

/** Key derived from APP_SECRET; development falls back to a stable local key. */
function encryptionKey(): Buffer {
  const secret = getEnv().APP_SECRET ?? "shomaldoc-dev-only-secret-key";
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(secret).digest();
}

/** Encrypts a base32 secret for storage. Output: iv:tag:ciphertext (hex). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new AppError(500, "BAD_CIPHERTEXT", "قالب رمز ذخیره‌شده معتبر نیست.");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
