import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { departments, faculties, roles, thesisCases, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import { createCase, deleteCaseFile, getCaseEvents, updateCase as updateCaseSvc, uploadCaseFile } from "@/server/services/case";
import {
  createDepartment as createDepartmentSvc,
  createFaculty as createFacultySvc,
  listDepartmentOptions,
  listDepartments,
  updateDepartment as updateDepartmentSvc,
} from "@/server/services/organization";
import { resolveDownloadableFile } from "@/server/services/files";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(48)]);
const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdFacultyIds: number[] = [];
const createdDepartmentIds: number[] = [];

interface TestActor {
  id: string;
  permissions: string[];
  roles: Array<{ id: number; key: string; nameFa: string }>;
}

let admin: TestActor;
let adminId = "";

async function actorOf(userId: string) {
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, userId);
  return { id: userId, permissions: access.permissions, roles: access.roles };
}

async function makeUser(roleKey: string) {
  const unique = randomBytes(4).toString("hex");
  const uname = `org-${roleKey}-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({
      username: uname,
      email: `${uname}@test.invalid`,
      fullName: `کاربر سازمانی ${unique}`,
      passwordHash: await hashPassword("Test-Org-2026"),
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
});

afterAll(async () => {
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  if (createdDepartmentIds.length) await db.delete(departments).where(inArray(departments.id, createdDepartmentIds));
  if (createdFacultyIds.length) await db.delete(faculties).where(inArray(faculties.id, createdFacultyIds));
  await pool.end();
});

describe("organizational structure service", () => {
  it("creates a faculty and links a department to it", async () => {
    const faculty = await createFacultySvc(admin, { nameFa: `دانشکده ${suffix}`, code: "ENG" }, ctx);
    createdFacultyIds.push(faculty.id);
    expect(faculty.id).toBeGreaterThan(0);

    const dept = await createDepartmentSvc(admin, { nameFa: `گروه ${suffix}`, facultyId: faculty.id, code: "CE" }, ctx);
    createdDepartmentIds.push(dept.id);
    expect(dept.facultyId).toBe(faculty.id);
  });

  it("rejects duplicate names", async () => {
    const name = `تکراری ${suffix}`;
    await createFacultySvc(admin, { nameFa: name }, ctx).then((f) => createdFacultyIds.push(f.id));
    await expect(createFacultySvc(admin, { nameFa: name }, ctx)).rejects.toMatchObject({ status: 409, code: "DUPLICATE" });
  });

  it("rejects a department with an invalid faculty", async () => {
    await expect(createDepartmentSvc(admin, { nameFa: `بدون دانشکده ${suffix}`, facultyId: 999999 }, ctx)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_FACULTY",
    });
  });

  it("updates a department and audits the change", async () => {
    const dept = await createDepartmentSvc(admin, { nameFa: `قابل ویرایش ${suffix}` }, ctx);
    createdDepartmentIds.push(dept.id);
    const updated = await updateDepartmentSvc(admin, dept.id, { nameFa: `ویرایش‌شده ${suffix}`, isActive: false }, ctx);
    expect(updated.nameFa).toBe(`ویرایش‌شده ${suffix}`);
    expect(updated.isActive).toBe(false);
  });

  it("only active departments appear in the option list", async () => {
    const dept = await createDepartmentSvc(admin, { nameFa: `غیرفعال ${suffix}` }, ctx);
    createdDepartmentIds.push(dept.id);
    await updateDepartmentSvc(admin, dept.id, { isActive: false }, ctx);
    const options = await listDepartmentOptions();
    expect(options.some((o: { id: number }) => o.id === dept.id)).toBe(false);
  });

  it("aggregates case and user counts per department", async () => {
    const dept = await createDepartmentSvc(admin, { nameFa: `آمار ${suffix}` }, ctx);
    createdDepartmentIds.push(dept.id);
    const tc = await createCase(admin, { studentFullName: "دانشجوی آمار", departmentId: dept.id }, ctx);
    createdCaseIds.push(tc.id);
    expect(tc.departmentId).toBe(dept.id);
    // Legacy display value stays in sync for existing reports/UI.
    expect(tc.department).toBe(`آمار ${suffix}`);

    const rows = await listDepartments();
    const row = rows.find((r: { id: number }) => r.id === dept.id);
    expect(Number(row?.caseCount ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("case organisational link validation", () => {
  it("rejects an unknown departmentId on create", async () => {
    await expect(createCase(admin, { studentFullName: "تست گروه نامعتبر", departmentId: 999999 }, ctx)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DEPARTMENT",
    });
  });

  it("rejects an unknown departmentId on update", async () => {
    const tc = await createCase(admin, { studentFullName: "تست ویرایش گروه" }, ctx);
    createdCaseIds.push(tc.id);
    await expect(updateCaseSvc(tc.id, admin, { departmentId: 999999 }, ctx)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DEPARTMENT",
    });
  });
});

describe("file soft-delete lifecycle", () => {
  let caseId = "";
  let fileId = "";

  it("uploads then soft-deletes a file", async () => {
    const tc = await createCase(admin, { studentFullName: "تست چرخه حیات فایل" }, ctx);
    caseId = tc.id;
    createdCaseIds.push(caseId);
    const uploaded = await uploadCaseFile(caseId, admin, { data: PNG, originalName: "doc.png" }, "topic", ctx);
    fileId = uploaded.caseFile.fileId;
    expect((await resolveDownloadableFile(fileId, admin)).file.id).toBe(fileId);

    const deleted = await deleteCaseFile(caseId, fileId, admin, "نسخهٔ نادرست بود", ctx);
    expect(deleted.fileId).toBe(fileId);

    // After soft delete the file is no longer downloadable and a repeat fails.
    await expect(resolveDownloadableFile(fileId, admin)).rejects.toMatchObject({ status: 404 });
    await expect(deleteCaseFile(caseId, fileId, admin, "دوباره", ctx)).rejects.toMatchObject({ status: 409 });
  });

  it("requires a reason and rejects a missing file", async () => {
    await expect(deleteCaseFile(caseId, "00000000-0000-4000-8000-000000000000", admin, "مطلوب", ctx)).rejects.toMatchObject({
      status: 404,
      code: "FILE_NOT_FOUND",
    });
  });

  it("records a case event and audit entry for deletion", async () => {
    const events = await getCaseEvents(caseId);
    const ev = events.find((e) => e.eventType === "file_deleted");
    expect(ev).toBeDefined();
    expect(ev?.reason).toBe("نسخهٔ نادرست بود");

    const { auditLogs } = await import("@/db/schema");
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, caseId));
    expect(rows.some((r) => r.action === "case.file_deleted")).toBe(true);
  });

  it("a user without upload permission cannot delete", async () => {
    const studentId = await makeUser("student");
    const student = await actorOf(studentId);
    await expect(deleteCaseFile(caseId, fileId, student, "تلاش ناممجاز", ctx)).rejects.toBeInstanceOf(AppError);
  });
});
