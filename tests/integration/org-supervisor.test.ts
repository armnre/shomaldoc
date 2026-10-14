import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { academicTerms, departments, fieldTracks, fieldsOfStudy, professorProfiles, roles, studentProfiles, supervisorRequests, thesisCases, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import {
  applyImport, createDepartment, createField, createTerm, createTrack, listFields, parseCsvUsers, previewImport,
  upsertProfessorProfile, upsertStudentProfile, validateImportRows,
} from "@/server/services/organization";
import { computeCapacity, getProfessorCapacity } from "@/server/services/capacity";
import { createSupervisorRequest, listProfessorRequests, respondToRequest } from "@/server/services/supervisor-requests";
import { createCase } from "@/server/services/case";
import { updateSetting } from "@/server/services/settings";

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdDeptIds: number[] = [];
const createdFieldIds: number[] = [];
const createdTrackIds: number[] = [];
const createdTermIds: number[] = [];

let admin: { id: string; permissions: string[]; roles: Array<{ id: number; key: string; nameFa: string }> };

async function actorOf(id: string) {
  const { loadUserAccess } = await import("@/server/rbac/service");
  const access = await loadUserAccess(db, id);
  return { id, permissions: access.permissions, roles: access.roles };
}

async function makeUser(roleKey: string, extra?: { fullName?: string }) {
  const unique = randomBytes(4).toString("hex");
  const uname = `org2-${roleKey}-${suffix}-${unique}`;
  const [u] = await db.insert(users).values({
    username: uname, email: `${uname}@test.invalid`,
    fullName: extra?.fullName ?? `کاربر ${unique}`, passwordHash: await hashPassword("Test-Org2-2026"),
  }).returning({ id: users.id, fullName: users.fullName });
  createdUserIds.push(u.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  return u;
}

beforeAll(async () => {
  await seedRbac();
  admin = await actorOf((await makeUser("system_admin")).id);
});

afterAll(async () => {
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) {
    await db.delete(supervisorRequests).where(inArray(supervisorRequests.studentUserId, createdUserIds));
    await db.delete(professorProfiles).where(inArray(professorProfiles.userId, createdUserIds));
    await db.delete(studentProfiles).where(inArray(studentProfiles.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  if (createdTrackIds.length) await db.delete(fieldTracks).where(inArray(fieldTracks.id, createdTrackIds));
  if (createdFieldIds.length) await db.delete(fieldsOfStudy).where(inArray(fieldsOfStudy.id, createdFieldIds));
  if (createdTermIds.length) await db.delete(academicTerms).where(inArray(academicTerms.id, createdTermIds));
  if (createdDeptIds.length) await db.delete(departments).where(inArray(departments.id, createdDeptIds));
  await pool.end();
});

describe("M2 organisational entities", () => {
  it("creates department → field → track → term with audit-friendly values", async () => {
    const dept = await createDepartment(admin, { nameFa: `گروه ${suffix}` }, ctx);
    createdDeptIds.push(dept.id);
    const field = await createField(admin, { nameFa: `مهندسی نرم‌افزار ${suffix}`, departmentId: dept.id, degreeLevel: "کارشناسی ارشد" }, ctx);
    createdFieldIds.push(field.id);
    const track = await createTrack(admin, { fieldId: field.id, nameFa: `نرم‌افزار ${suffix}` }, ctx);
    createdTrackIds.push(track.id);
    const term = await createTerm(admin, { code: `T-${suffix.slice(0, 6)}`, titleFa: `ترم ${suffix}`, isCurrent: true }, ctx);
    createdTermIds.push(term.id);

    expect(field.departmentId).toBe(dept.id);
    expect(track.fieldId).toBe(field.id);
    expect(term.isCurrent).toBe(true);
    // Only one current term at a time.
    const currents = await db.select().from(academicTerms).where(eq(academicTerms.isCurrent, true));
    expect(currents).toHaveLength(1);
  });

  it("rejects a field pointing at a non-existent department", async () => {
    await expect(createField(admin, { nameFa: `رشتهٔ نامعتبر ${suffix}`, departmentId: 999999 }, ctx)).rejects.toMatchObject({ status: 400, code: "INVALID_DEPARTMENT" });
  });

  it("lists only real rows and never fabricates structure", async () => {
    const fields = await listFields();
    expect(fields.every((f) => f.nameFa.length > 0)).toBe(true);
    expect(fields.some((f) => f.nameFa.includes(suffix))).toBe(true);
  });

  it("student profile stores eligibility explicitly and validates national id", async () => {
    const student = await makeUser("student");
    await expect(upsertStudentProfile(admin, student.id, { nationalId: "123", thesisEligible: true }, ctx)).rejects.toMatchObject({ code: "INVALID_NATIONAL_ID" });
    const row = await upsertStudentProfile(admin, student.id, { studentNumber: `S-${suffix.slice(0, 6)}`, nationalId: "0012345678", thesisEligible: true }, ctx);
    expect(row.thesisEligible).toBe(true);
    expect(row.studentNumber).toBe(`S-${suffix.slice(0, 6)}`);
  });

  it("professor profile keeps acceptsStudents off unless explicitly set", async () => {
    const prof = await makeUser("supervisor");
    const created = await upsertProfessorProfile(admin, prof.id, { academicRank: "دانشیار", baseCapacity: 4 }, ctx);
    expect(created.acceptsStudents).toBe(false);
    const updated = await upsertProfessorProfile(admin, prof.id, { acceptsStudents: true }, ctx);
    expect(updated.acceptsStudents).toBe(true);
    expect(updated.academicRank).toBe("دانشیار");
  });

  it("rejects an out-of-range base capacity", async () => {
    const prof = await makeUser("supervisor");
    await expect(upsertProfessorProfile(admin, prof.id, { baseCapacity: 999 }, ctx)).rejects.toMatchObject({ code: "INVALID_CAPACITY" });
  });
});

describe("M2 bulk import", () => {
  const csv = [
    "username,email,full_name,initial_password,roles",
    `imp-a-${suffix},imp-a-${suffix}@test.invalid,کاربر الف,Strong-Pass-123,student`,
    `imp-b-${suffix},invalid-email,کاربر ب,short,student`,
    `imp-a-${suffix},imp-a-${suffix}@test.invalid,کاربر الف تکراری,Strong-Pass-123,student`,
  ].join("\n");

  it("parses CSV and reports per-row errors without writing anything", async () => {
    const rows = parseCsvUsers(csv);
    expect(rows).toHaveLength(3);
    const preview = await previewImport(admin, rows, "test.csv", "csv");
    expect(preview.results[0].status).toBe("valid");
    expect(preview.results[1].status).toBe("invalid");
    expect(preview.results[1].errors.some((e) => e.includes("ایمیل"))).toBe(true);
    expect(preview.results[1].errors.some((e) => e.includes("رمز"))).toBe(true);
    expect(preview.results[2].status).toBe("invalid");
    expect(preview.results[2].errors.some((e) => e.includes("تکراری"))).toBe(true);
    // Preview must not create users.
    const [found] = await db.select().from(users).where(eq(users.username, `imp-a-${suffix}`));
    expect(found).toBeUndefined();
    // Passwords never appear in the stored report.
    const { userImportBatches } = await import("@/db/schema");
    const [batch] = await db.select().from(userImportBatches).where(eq(userImportBatches.id, preview.batchId));
    expect(JSON.stringify(batch.report)).not.toContain("Strong-Pass-123");
  });

  it("rejects a CSV without the required header", () => {
    expect(() => parseCsvUsers("a,b\n1,2")).toThrowError(AppError);
  });

  it("validateImportRows is pure and flags unknown roles", () => {
    const results = validateImportRows(
      [{ username: "x.y", email: "x@y.z", fullName: "نام کامل", initialPassword: "Strong-Pass-1", roleKeys: ["ghost_role"] }],
      { usernames: new Set(), emails: new Set(), roles: new Map([["student", 1]]) },
    );
    expect(results[0].status).toBe("invalid");
    expect(results[0].errors.some((e) => e.includes("ghost_role"))).toBe(true);
  });

  it("applies only valid rows and reports the skipped ones", async () => {
    const rows = parseCsvUsers(csv);
    const preview = await previewImport(admin, rows, "test.csv", "csv");
    const result = await applyImport(admin, preview.batchId, rows, ctx);
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toHaveLength(2);
    const [created] = await db.select().from(users).where(eq(users.username, `imp-a-${suffix}`));
    expect(created).toBeDefined();
    expect(created.mustChangePassword).toBe(true);
    createdUserIds.push(created.id);
    // Applying twice is refused.
    await expect(applyImport(admin, preview.batchId, rows, ctx)).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
  });
});

describe("M3 capacity engine", () => {
  it("computes allowed/remaining from settings-driven factors (pure)", () => {
    const factors = { defaultBase: 5, rankFactors: { دانشیار: 1.5 }, advisorCountsAs: 0.5 };
    expect(computeCapacity({ baseCapacity: null, academicRank: null, used: 0 }, factors)).toEqual({ allowed: 5, used: 0, remaining: 5 });
    expect(computeCapacity({ baseCapacity: 4, academicRank: "دانشیار", used: 2 }, factors)).toEqual({ allowed: 6, used: 2, remaining: 4 });
    expect(computeCapacity({ baseCapacity: 4, academicRank: "دانشیار", used: 99 }, factors).remaining).toBe(0);
  });

  it("reads live capacity from the database for a professor", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { academicRank: "استادیار", baseCapacity: 3, acceptsStudents: true }, ctx);
    const cap = await getProfessorCapacity(prof.id);
    expect(cap).not.toBeNull();
    expect(cap!.allowed).toBe(3);
    expect(cap!.used).toBe(0);
    expect(cap!.remaining).toBe(3);
    expect(cap!.acceptsStudents).toBe(true);
  });

  it("capacity follows the settings threshold when it changes", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { acceptsStudents: true }, ctx);
    const before = await getProfessorCapacity(prof.id);
    await updateSetting(admin, "capacity.defaultBase", 7, "آزمون ظرفیت", ctx);
    const after = await getProfessorCapacity(prof.id);
    expect(after!.allowed).toBe(7);
    expect(after!.allowed).not.toBe(before!.allowed === 7 ? 5 : before!.allowed);
    await updateSetting(admin, "capacity.defaultBase", 5, "بازگردانی ظرفیت پیش‌فرض", ctx);
  });
});

describe("M3 supervisor request flow", () => {
  it("student request → professor accept creates a real supervisor link", async () => {
    const dept = await createDepartment(admin, { nameFa: `گروه ظرفیت ${suffix}` }, ctx);
    createdDeptIds.push(dept.id);
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { departmentId: dept.id, baseCapacity: 1, acceptsStudents: true }, ctx);
    const student = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "دانشجوی درخواست", departmentId: dept.id, studentUserId: student.id }, ctx);
    createdCaseIds.push(tc.id);

    const requester = await actorOf(student.id);
    const req = await createSupervisorRequest(requester, { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    expect(req.status).toBe("pending");
    expect(req.attemptNumber).toBe(1);

    const professor = await actorOf(prof.id);
    const queue = await listProfessorRequests(prof.id, "pending");
    expect(queue.some((q) => q.request.id === req.id)).toBe(true);

    const responded = await respondToRequest(professor, { requestId: req.id, accept: true }, ctx);
    expect(responded.status).toBe("accepted");

    const cap = await getProfessorCapacity(prof.id);
    expect(cap!.remaining).toBe(0);
  });

  it("rejects a request to a professor who is not accepting students", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { acceptsStudents: false }, ctx);
    const student = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "دانشجوی رد", studentUserId: student.id }, ctx);
    createdCaseIds.push(tc.id);
    await expect(createSupervisorRequest(await actorOf(student.id), { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx))
      .rejects.toMatchObject({ status: 409, code: "NOT_ACCEPTING_STUDENTS" });
  });

  it("rejects a duplicate pending request for the same professor", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { acceptsStudents: true }, ctx);
    const student = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "دانشجوی تکراری", studentUserId: student.id }, ctx);
    createdCaseIds.push(tc.id);
    const requester = await actorOf(student.id);
    await createSupervisorRequest(requester, { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    await expect(createSupervisorRequest(requester, { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx))
      .rejects.toMatchObject({ status: 409, code: "DUPLICATE_REQUEST" });
  });

  it("rejection requires a reason and increments the attempt counter", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { acceptsStudents: true }, ctx);
    const student = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "دانشجوی رد دلیل", studentUserId: student.id }, ctx);
    createdCaseIds.push(tc.id);
    const requester = await actorOf(student.id);
    const first = await createSupervisorRequest(requester, { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    const professor = await actorOf(prof.id);

    await expect(respondToRequest(professor, { requestId: first.id, accept: false }, ctx)).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const rejected = await respondToRequest(professor, { requestId: first.id, accept: false, reason: "ظرفیت این ترم تکمیل است" }, ctx);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("ظرفیت این ترم تکمیل است");

    const second = await createSupervisorRequest(requester, { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    expect(second.attemptNumber).toBe(2);
  });

  it("a professor outside the case department cannot be requested", async () => {
    const deptA = await createDepartment(admin, { nameFa: `گروه الف ${suffix}2` }, ctx);
    const deptB = await createDepartment(admin, { nameFa: `گروه ب ${suffix}2` }, ctx);
    createdDeptIds.push(deptA.id, deptB.id);
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { departmentId: deptB.id, acceptsStudents: true }, ctx);
    const student = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "دانشجوی گروه دیگر", departmentId: deptA.id, studentUserId: student.id }, ctx);
    createdCaseIds.push(tc.id);
    await expect(createSupervisorRequest(await actorOf(student.id), { caseId: tc.id, professorUserId: prof.id, roleType: "supervisor" }, ctx))
      .rejects.toMatchObject({ status: 403, code: "ORG_MISMATCH" });
  });

  it("backend blocks accepting when capacity is already full (race-safe)", async () => {
    const prof = await makeUser("supervisor");
    await upsertProfessorProfile(admin, prof.id, { baseCapacity: 1, acceptsStudents: true }, ctx);
    const s1 = await makeUser("student");
    const s2 = await makeUser("student");
    const c1 = await createCase(admin, { studentFullName: "دانشجوی رقابت ۱", studentUserId: s1.id }, ctx);
    const c2 = await createCase(admin, { studentFullName: "دانشجوی رقابت ۲", studentUserId: s2.id }, ctx);
    createdCaseIds.push(c1.id, c2.id);

    const r1 = await createSupervisorRequest(await actorOf(s1.id), { caseId: c1.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    const r2 = await createSupervisorRequest(await actorOf(s2.id), { caseId: c2.id, professorUserId: prof.id, roleType: "supervisor" }, ctx);
    const professor = await actorOf(prof.id);

    const results = await Promise.allSettled([
      respondToRequest(professor, { requestId: r1.id, accept: true }, ctx),
      respondToRequest(professor, { requestId: r2.id, accept: true }, ctx),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const cap = await getProfessorCapacity(prof.id);
    expect(cap!.remaining).toBe(0);
  });
});
