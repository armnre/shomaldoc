import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/**
 * scrypt via Node's built-in crypto (no native dependency).
 * Stored format: scrypt$N$r$p$saltB64$hashB64 — parameters travel with the hash so they can be raised later.
 */
const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer, keyLength: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, DEFAULT_N, DEFAULT_R, DEFAULT_P);
  return ["scrypt", DEFAULT_N, DEFAULT_R, DEFAULT_P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, N, r, p);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHashPromise: Promise<string> | null = null;

/** Used to spend the same time on unknown usernames as on real ones (prevents account enumeration by timing). */
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(12).toString("hex"));
  return dummyHashPromise;
}
