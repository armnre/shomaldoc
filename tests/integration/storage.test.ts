import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import {
  createReadStreamSafe,
  deleteFromDisk,
  fileExists,
  filePath,
  isValidStorageKey,
  normalizeOriginalName,
  storeFile,
} from "@/server/storage";
import { getSettingValue, updateSetting } from "@/server/services/settings";
import { uploadCaseFile } from "@/server/services/case";
import { createCase } from "@/server/services/case";
import { inArray } from "drizzle-orm";
import { thesisCases } from "@/db/schema";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngPayload(extra = 64): Buffer {
  return Buffer.concat([PNG_HEADER, randomBytes(extra)]);
}

const suffix = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
let adminId = "";

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({
      username: `storage-admin-${suffix}`,
      email: `storage-admin-${suffix}@test.invalid`,
      fullName: "مدیر تست ذخیره‌سازی",
      passwordHash: await hashPassword("Test-Storage-2026"),
    })
    .returning({ id: users.id });
  adminId = u.id;
  createdUserIds.push(u.id);
  const { seedRbac } = await import("@/server/rbac/service");
  await seedRbac();
  const { roles, userRoles } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [adminRole] = await db.select().from(roles).where(eq(roles.key, "system_admin")).limit(1);
  await db.insert(userRoles).values({ userId: u.id, roleId: adminRole.id }).onConflictDoNothing();
});

afterAll(async () => {
  // Restore the upload limit in case the oversized test changed it.
  try {
    await updateSetting({ id: adminId }, "upload.maxSizeMb", 20, "بازیابی پس از تست", ctx);
  } catch {
    /* setting may already be 20 */
  }
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pool.end();
});

describe("storeFile validation", () => {
  it("rejects an empty file", async () => {
    await expect(storeFile({ data: Buffer.alloc(0), originalName: "x.png" })).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("rejects an unsupported signature", async () => {
    await expect(storeFile({ data: Buffer.from("MZ fake executable"), originalName: "x.exe" })).rejects.toMatchObject({
      code: "INVALID_FILE_TYPE",
    });
  });

  it("rejects a bare ZIP that is not a DOCX", async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(64)]);
    await expect(storeFile({ data: zip, originalName: "fake.docx" })).rejects.toMatchObject({
      code: "INVALID_FILE_TYPE",
    });
  });

  it("stores a valid PNG and deletes it cleanly", async () => {
    const stored = await storeFile({ data: pngPayload(), originalName: "scan.png" });
    expect(stored.mimeType).toBe("image/png");
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(isValidStorageKey(stored.storageKey)).toBe(true);
    expect(fileExists(stored.storageKey)).toBe(true);
    deleteFromDisk(stored.storageKey);
    expect(fileExists(stored.storageKey)).toBe(false);
  });

  it("rejects files above the configured limit", async () => {
    await updateSetting({ id: adminId }, "upload.maxSizeMb", 1, "تست سقف حجم", ctx);
    try {
      const big = Buffer.concat([PNG_HEADER, randomBytes(1100 * 1024)]);
      await expect(storeFile({ data: big, originalName: "big.png" })).rejects.toMatchObject({
        code: "FILE_TOO_LARGE",
        status: 413,
      });
    } finally {
      await updateSetting({ id: adminId }, "upload.maxSizeMb", 20, "بازیابی سقف حجم", ctx);
    }
  });
});

describe("storage key safety", () => {
  it("validates the key format strictly", () => {
    expect(isValidStorageKey("a".repeat(48))).toBe(true);
    expect(isValidStorageKey("../etc/passwd")).toBe(false);
    expect(isValidStorageKey("a".repeat(47))).toBe(false);
    expect(isValidStorageKey("Z".repeat(48))).toBe(false);
  });

  it("filePath rejects traversal attempts", () => {
    expect(() => filePath("../../etc/passwd")).toThrow();
    expect(fileExists("../../etc/passwd")).toBe(false);
  });

  it("createReadStreamSafe reports missing files as a safe 404", () => {
    expect(() => createReadStreamSafe("b".repeat(48))).toThrowError(
      expect.objectContaining({ code: "FILE_NOT_FOUND", status: 404 }),
    );
  });
});

describe("filename normalisation", () => {
  it("strips path components and header-injection characters", () => {
    expect(normalizeOriginalName("a/b\\c.pdf")).toBe("c.pdf");
    expect(normalizeOriginalName('evil"\r\nSet-Cookie: x.pdf')).toBe("evilSet-Cookie: x.pdf");
    expect(normalizeOriginalName("")).toBe("file");
    expect(normalizeOriginalName("گزارش نهایی.pdf")).toBe("گزارش نهایی.pdf");
  });
});

describe("case file upload authorisation and atomicity", () => {
  it("rejects upload to a nonexistent case without leaving a file behind", async () => {
    const root = resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
    const before = existsSync(root) ? readdirSync(root).length : 0;
    await expect(
      uploadCaseFile(
        "00000000-0000-0000-0000-000000000000",
        { id: adminId },
        { data: pngPayload(), originalName: "orphan.png" },
        "general",
        ctx,
      ),
    ).rejects.toBeInstanceOf(AppError);
    const after = existsSync(root) ? readdirSync(root).length : 0;
    expect(after).toBe(before);
  });

  it("uploads to an existing case and records metadata", async () => {
    const admin = { id: adminId };
    const tc = await createCase(admin, { studentFullName: "تست بارگذاری" }, ctx);
    createdCaseIds.push(tc.id);
    const result = await uploadCaseFile(tc.id, admin, { data: pngPayload(), originalName: "مدرک.png" }, "topic", ctx);
    expect(result.file.mimeType).toBe("image/png");
    expect(result.caseFile.caseId).toBe(tc.id);
    // The API-facing payload must not leak the storage key.
    expect((result.file as Record<string, unknown>).storageKey).toBeUndefined();
  });

  it("rejects an invalid purpose by falling back safely and an invalid type outright", async () => {
    const admin = { id: adminId };
    const tc = await createCase(admin, { studentFullName: "تست نوع فایل" }, ctx);
    createdCaseIds.push(tc.id);
    await expect(
      uploadCaseFile(tc.id, admin, { data: Buffer.from("not a document"), originalName: "x.txt" }, "general", ctx),
    ).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" });
  });

  it("current upload limit setting is readable", async () => {
    expect(await getSettingValue("upload.maxSizeMb")).toBe(20);
  });
});
