import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { files, roles, thesisCases, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import { createCase, uploadCaseFile } from "@/server/services/case";
import { resolveDownloadableFile } from "@/server/services/files";
import { deleteFromDisk } from "@/server/storage";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(48)]);
const suffix = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

let admin: { id: string; permissions: string[]; roles: { key: string }[] };
let adminId = "";
let fileId = "";
let storageKey = "";

async function actorOf(userId: string) {
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, userId);
  return { id: userId, permissions: access.permissions, roles: access.roles };
}

async function makeUser(roleKey: string) {
  const unique = randomBytes(4).toString("hex");
  const uname = `dl-${roleKey}-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({
      username: uname,
      email: `${uname}@test.invalid`,
      fullName: `کاربر دانلود ${unique}`,
      passwordHash: await hashPassword("Test-Download-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  return u.id;
}

beforeAll(async () => {
  await seedRbac();
  adminId = await makeUser("system_admin");
  admin = await actorOf(adminId);
  const tc = await createCase(admin, { studentFullName: "تست دانلود" }, ctx);
  createdCaseIds.push(tc.id);
  const result = await uploadCaseFile(tc.id, admin, { data: PNG, originalName: "سند.png" }, "topic", ctx);
  fileId = result.caseFile.fileId;
  const [row] = await db.select({ storageKey: files.storageKey }).from(files).where(eq(files.id, fileId));
  storageKey = row.storageKey;
});

afterAll(async () => {
  if (storageKey) deleteFromDisk(storageKey);
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  await pool.end();
});

describe("resolveDownloadableFile", () => {
  it("resolves for an authorised user with case visibility", async () => {
    const resolved = await resolveDownloadableFile(fileId, admin);
    expect(resolved.file.id).toBe(fileId);
    expect(resolved.caseId).toBe(createdCaseIds[0]);
    expect(resolved.file.originalName).toBe("سند.png");
  });

  it("rejects a user who cannot see the owning case", async () => {
    const studentId = await makeUser("student");
    const student = await actorOf(studentId);
    await expect(resolveDownloadableFile(fileId, student)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("rejects a user without the download permission even with case visibility", async () => {
    // grad_office has view_all; strip download permission by using a finance-like actor:
    const financeId = await makeUser("finance");
    const finance = await actorOf(financeId);
    expect(finance.permissions).not.toContain("cases.files.download");
    await expect(resolveDownloadableFile(fileId, finance)).rejects.toMatchObject({ status: 403 });
  });

  it("returns an indistinguishable 404 for malformed ids", async () => {
    await expect(resolveDownloadableFile("../../etc/passwd", admin)).rejects.toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
    await expect(resolveDownloadableFile("not-a-uuid", admin)).rejects.toMatchObject({ status: 404 });
  });

  it("returns 404 for a well-formed but unknown file id", async () => {
    await expect(resolveDownloadableFile("00000000-0000-4000-8000-000000000000", admin)).rejects.toMatchObject({ status: 404 });
  });

  it("returns 404 for an inactive (logically deleted) file", async () => {
    await db.update(files).set({ status: "deleted", deletedAt: new Date() }).where(eq(files.id, fileId));
    try {
      await expect(resolveDownloadableFile(fileId, admin)).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.update(files).set({ status: "active", deletedAt: null }).where(eq(files.id, fileId));
    }
  });

  it("tampering with the id does not leak another case's file", async () => {
    const otherId = randomBytes(16).toString("hex");
    const fakeUuid = `${otherId.slice(0, 8)}-${otherId.slice(8, 12)}-4000-8000-${otherId.slice(20, 32)}`;
    await expect(resolveDownloadableFile(fakeUuid, admin)).rejects.toMatchObject({ status: 404 });
  });
});
