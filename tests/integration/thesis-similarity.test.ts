import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  auditLogs,
  files,
  notifications,
  roles,
  similarityChecks,
  thesisCaseEvents,
  thesisCaseFiles,
  thesisCases,
  thesisSupervisors,
  thesisVersions,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { AppError } from "@/server/http";
import { createCase } from "@/server/services/case";
import { evaluateSimilarity, listSimilarityChecks, listThesisVersions, recordSimilarityCheck, saveThesisVersion } from "@/server/services/thesis";
import { storeFile } from "@/server/storage/service";
import { updateSetting } from "@/server/services/settings";

/**
 * M8 regression suite — thesis versions and the similarity gate.
 * Success, rejection and unauthorised paths are all covered, plus the two
 * invariants that matter: a version always has a real file and the verdict follows
 * the Setting rather than a constant.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.40.50.60", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const uploadDir = resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
let admin: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;
let outsider: Awaited<ReturnType<typeof makeUser>>;
let noAccess: Awaited<ReturnType<typeof makeUser>>;

async function makeUser(roleKeys: string[]) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m8-${suffix}-${uniq}`,
      email: `m8-${suffix}-${uniq}@test.invalid`,
      fullName: `کاربر M8 ${uniq}`,
      passwordHash: await hashPassword("Test-M8-2026"),
    })
    .returning({ id: users.id, fullName: users.fullName });
  createdUserIds.push(row.id);
  for (const key of roleKeys) {
    const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: row.id, roleId: role.id }).onConflictDoNothing();
  }
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, row.id);
  return { id: row.id, fullName: row.fullName, permissions: access.permissions, roles: access.roles };
}

/**
 * Stores a real PDF on disk and registers it as a `files` row attached to the case,
 * exactly the way the upload API does (storeFile returns only the storage metadata,
 * so the `files` row is inserted here with the same values the API persists).
 */
async function attachFile(caseId: string, name: string) {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(`thesis ${name}\n`), Buffer.from("%%EOF\n")]);
  const stored = await storeFile({ data: pdf, originalName: name });
  const [row] = await db
    .insert(files)
    .values({
      ownerUserId: student.id,
      purpose: "thesis",
      originalName: name,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      status: "active",
    })
    .returning({ id: files.id, storageKey: files.storageKey, sha256: files.sha256 });
  await db.insert(thesisCaseFiles).values({ caseId, fileId: row.id, purpose: "thesis", uploadedBy: student.id });
  return { ...stored, id: row.id };
}

async function makeCase() {
  const uniq = randomBytes(4).toString("hex");
  const tc = await createCase(admin, { studentFullName: `دانشجوی M8 ${uniq}`, studentUserId: student.id, department: `گروه آزمون M8 ${uniq}` }, ctx);
  createdCaseIds.push(tc.id);
  await db.insert(thesisSupervisors).values({ caseId: tc.id, userId: outsider.id, supervisorName: "استاد M8", roleType: "supervisor", status: "active" });
  return tc;
}

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  student = await makeUser(["student"]);
  outsider = await makeUser(["supervisor"]);
  noAccess = await makeUser([]);
});

afterAll(async () => {
  if (createdCaseIds.length) {
    const fileIds = await db.select({ id: thesisCaseFiles.fileId }).from(thesisCaseFiles).where(inArray(thesisCaseFiles.caseId, createdCaseIds));
    await db.delete(similarityChecks).where(inArray(similarityChecks.caseId, createdCaseIds));
    await db.delete(thesisVersions).where(inArray(thesisVersions.caseId, createdCaseIds));
    await db.delete(notifications).where(inArray(notifications.caseId, createdCaseIds));
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(thesisCaseFiles).where(inArray(thesisCaseFiles.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
    if (fileIds.length) await db.delete(files).where(inArray(files.id, fileIds.map((f) => f.id)));
  }
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("thesis file versions", () => {
  it("stores the first version with its real file and hash", async () => {
    const tc = await makeCase();
    const stored = await attachFile(tc.id, "thesis-v1.pdf");
    const onDisk = await readFile(join(uploadDir, stored.storageKey));
    expect(createHash("sha256").update(onDisk).digest("hex")).toBe(stored.sha256);

    const created = await saveThesisVersion(tc.id, student, { fileId: stored.id, titleFa: "پایان‌نامهٔ آزمون" }, ctx);
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.status).toBe("submitted");

    const rows = await listThesisVersions(tc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("thesis-v1.pdf");
    expect(rows[0].submittedByName).toBe(student.fullName);
  });

  it("refuses a second version without a reason and keeps exactly one active version", async () => {
    const tc = await makeCase();
    const first = await attachFile(tc.id, "thesis-a1.pdf");
    await saveThesisVersion(tc.id, student, { fileId: first.id, titleFa: "نسخهٔ اول" }, ctx);

    const second = await attachFile(tc.id, "thesis-a2.pdf");
    await expect(saveThesisVersion(tc.id, student, { fileId: second.id, changeReason: "کم" }, ctx)).rejects.toThrow(AppError);

    const v2 = await saveThesisVersion(tc.id, student, { fileId: second.id, changeReason: "اصلاح فصل روش‌شناسی بر اساس نظر داوران." }, ctx);
    expect(v2.version).toBe(2);
    const rows = await listThesisVersions(tc.id);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect(rows.find((r) => r.isActive)?.version).toBe(2);
    // The first version is never rewritten or deleted.
    expect(rows.find((r) => r.version === 1)?.status).toBe("submitted");
  });

  it("refuses a file that is not attached to the case and an outsider", async () => {
    const tc = await makeCase();
    const other = await makeCase();
    const foreign = await attachFile(other.id, "thesis-foreign.pdf");
    await expect(saveThesisVersion(tc.id, student, { fileId: foreign.id }, ctx)).rejects.toThrow(AppError);

    const mine = await attachFile(tc.id, "thesis-mine.pdf");
    await expect(saveThesisVersion(tc.id, outsider, { fileId: mine.id }, ctx)).rejects.toThrow(AppError);
  });
});

describe("similarity check", () => {
  it("passes below the configured limit and blocks a second pass", async () => {
    const tc = await makeCase();
    const stored = await attachFile(tc.id, "thesis-similarity.pdf");
    await saveThesisVersion(tc.id, student, { fileId: stored.id }, ctx);

    const result = await recordSimilarityCheck(tc.id, admin, { similarityPercent: 12, reportId: "SIM-1402-777" }, ctx);
    expect(result.result).toBe("pass");
    expect(result.messageFa).toContain("۱۲");
    expect(result.messageFa).toContain("۳۰");
    await expect(recordSimilarityCheck(tc.id, admin, { similarityPercent: 8 }, ctx)).rejects.toThrow(AppError);
    const notes = await db.select().from(notifications).where(eq(notifications.caseId, tc.id));
    expect(notes.some((n) => n.kind === "similarity.pass" && n.userId === student.id)).toBe(true);
  });

  it("requires revision above the limit and names the real limit in the reason", async () => {
    const tc = await makeCase();
    const stored = await attachFile(tc.id, "thesis-over.pdf");
    await saveThesisVersion(tc.id, student, { fileId: stored.id }, ctx);

    const result = await recordSimilarityCheck(tc.id, admin, { similarityPercent: 46 }, ctx);
    expect(result.result).toBe("revision_required");
    expect(result.maxPercentAtTime).toBe(30);
    expect(result.messageFa).toContain("۳۰");
    expect(result.messageFa).toContain("۴۶");

    // The threshold lives in Settings: raising it changes the verdict with no code change.
    await updateSetting(admin, "similarity.maxPercent", 50, "آزمون تغییر سقف همانندجویی", ctx);
    const tc2 = await makeCase();
    const stored2 = await attachFile(tc2.id, "thesis-v2.pdf");
    await saveThesisVersion(tc2.id, student, { fileId: stored2.id }, ctx);
    const afterRaise = await recordSimilarityCheck(tc2.id, admin, { similarityPercent: 46 }, ctx);
    expect(afterRaise.result).toBe("pass");
    await updateSetting(admin, "similarity.maxPercent", 30, "بازگرداندن سقف همانندجویی", ctx);

    const rows = await listSimilarityChecks(tc2.id);
    expect(rows[0].registeredByName).toBe(admin.fullName);
  });

  it("refuses a check before a version exists, an out-of-range percentage and an outsider", async () => {
    const tc = await makeCase();
    await expect(recordSimilarityCheck(tc.id, admin, { similarityPercent: 10 }, ctx)).rejects.toThrow(AppError);

    const stored = await attachFile(tc.id, "thesis-x.pdf");
    await saveThesisVersion(tc.id, student, { fileId: stored.id }, ctx);
    await expect(recordSimilarityCheck(tc.id, admin, { similarityPercent: 140 }, ctx)).rejects.toThrow(AppError);
    await expect(recordSimilarityCheck(tc.id, noAccess, { similarityPercent: 10 }, ctx)).rejects.toThrow(AppError);
  });

  it("computes the verdict purely from the limit (unit-level contract)", () => {
    expect(evaluateSimilarity(0, 30).result).toBe("pass");
    expect(evaluateSimilarity(30, 30).result).toBe("pass");
    expect(evaluateSimilarity(31, 30).result).toBe("revision_required");
    expect(evaluateSimilarity(31, 30).maxPercentAtTime).toBe(30);
  });
});
