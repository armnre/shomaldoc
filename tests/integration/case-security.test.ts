import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { sql } from "drizzle-orm";
import {
  departments,
  permissions,
  rolePermissions,
  roles,
  thesisCaseAssignments,
  thesisCases,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import {
  addSupervisor,
  createCase,
  getCaseById,
  getVisibleCaseIds,
  submitTopic,
  transitionStatus,
  updateCase,
} from "@/server/services/case";

const suffix = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const createdRoleIds: number[] = [];
const createdDepartmentIds: number[] = [];
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

async function makeUser(roleKey: string) {
  const unique = randomBytes(4).toString("hex");
  const uname = `sec-${roleKey}-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({
      username: uname,
      email: `${uname}@test.invalid`,
      fullName: `کاربر ${roleKey} ${unique}`,
      passwordHash: await hashPassword("Test-Sec-2026"),
    })
    .returning({ id: users.id, fullName: users.fullName });
  createdUserIds.push(u.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  return { id: u.id, fullName: u.fullName };
}

/** Creates a user whose role holds exactly the given permissions. */
async function makeUserWithPermissions(perms: string[]) {
  const unique = randomBytes(4).toString("hex");
  const [role] = await db
    .insert(roles)
    .values({ key: `sec-role-${suffix}-${unique}`, nameFa: "نقش آزمایشی امنیتی", isSystem: false })
    .returning();
  createdRoleIds.push(role.id);
  const permRows = await db.select().from(permissions).where(inArray(permissions.key, perms));
  if (permRows.length) {
    await db.insert(rolePermissions).values(permRows.map((p) => ({ roleId: role.id, permissionId: p.id })));
  }
  const uname = `sec-custom-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({
      username: uname,
      email: `${uname}@test.invalid`,
      fullName: `کاربر سفارشی ${unique}`,
      passwordHash: await hashPassword("Test-Sec-2026"),
    })
    .returning({ id: users.id, fullName: users.fullName });
  createdUserIds.push(u.id);
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id });
  return { id: u.id, fullName: u.fullName };
}

async function expectForbidden(promise: Promise<unknown>, code?: string) {
  try {
    await promise;
    expect.unreachable("should have been rejected");
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(403);
    if (code) expect((e as AppError).code).toBe(code);
  }
}

beforeAll(async () => {
  await seedRbac();
});

afterAll(async () => {
  if (createdCaseIds.length) await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  if (createdUserIds.length) await db.delete(users).where(inArray(users.id, createdUserIds));
  if (createdRoleIds.length) await db.delete(roles).where(inArray(roles.id, createdRoleIds));
  if (createdDepartmentIds.length) await db.delete(departments).where(inArray(departments.id, createdDepartmentIds));
  await pool.end();
});

describe("PATCH field-level authorization", () => {
  it("student cannot edit another student's case at all", async () => {
    const owner = await makeUser("student");
    const other = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "صاحب پرونده" }, ctx);
    createdCaseIds.push(tc.id);
    await expectForbidden(updateCase(tc.id, other, { department: "مهندسی" }, ctx));
  });

  it("student owner can edit academic fields of own draft but not identity fields", async () => {
    const owner = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "نام اصلی" }, ctx);
    createdCaseIds.push(tc.id);

    const ok = await updateCase(tc.id, owner, { department: "کامپیوتر", fieldOfStudy: "نرم‌افزار" }, ctx);
    expect(ok.department).toBe("کامپیوتر");

    await expectForbidden(updateCase(tc.id, owner, { studentFullName: "نام جعلی" }, ctx), "FIELD_FORBIDDEN");
    await expectForbidden(updateCase(tc.id, owner, { studentNumber: "0000" }, ctx), "FIELD_FORBIDDEN");
  });

  it("protected fields cannot be mass-assigned through PATCH", async () => {
    const owner = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "تست فیلد محافظت‌شده" }, ctx);
    createdCaseIds.push(tc.id);
    const malicious = { currentStatus: "approved", caseNumber: "TH-0000-99999", titleFa: "عنوان" } as never;
    const result = await updateCase(tc.id, owner, malicious, ctx).catch((e: AppError) => e);
    const [fresh] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(fresh.currentStatus).toBe("draft");
    expect(fresh.caseNumber).toBe(tc.caseNumber);
    void result;
  });

  it("edit_metadata holder can change identity fields", async () => {
    const admin = await makeUser("system_admin");
    const tc = await createCase(admin, { studentFullName: "قبل از اصلاح" }, ctx);
    createdCaseIds.push(tc.id);
    const updated = await updateCase(tc.id, admin, { studentFullName: "بعد از اصلاح" }, ctx);
    expect(updated.studentFullName).toBe("بعد از اصلاح");
  });
});

describe("topic submission authorization", () => {
  it("student cannot submit a topic for another student's case", async () => {
    const owner = await makeUser("student");
    const other = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "صاحب موضوع" }, ctx);
    createdCaseIds.push(tc.id);
    await expectForbidden(submitTopic(tc.id, other, { titleFa: "موضوع جعلی" }, ctx));
  });

  it("owner can save a draft topic and submit it for review", async () => {
    const owner = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "دانشجوی موضوع" }, ctx);
    createdCaseIds.push(tc.id);
    const draft = await submitTopic(tc.id, owner, { titleFa: "موضوع آزمایشی" }, ctx);
    expect(draft.currentStatus).toBe("draft");
    const submitted = await submitTopic(tc.id, owner, { titleFa: "موضوع آزمایشی", submitForReview: true }, ctx);
    expect(submitted.currentStatus).toBe("submitted");
  });
});

describe("transition-specific permission enforcement", () => {
  it("generic transition permission without review_topic cannot approve", async () => {
    const admin = await makeUser("system_admin");
    const generic = await makeUserWithPermissions(["dashboard.view", "cases.view_all", "cases.transition_status"]);
    const tc = await createCase(admin, { studentFullName: "تست مجوز انتقال" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    await expectForbidden(transitionStatus(tc.id, generic, { to: "approved" }, ctx), "TRANSITION_FORBIDDEN");
  });

  it("review_topic holder can move submitted → under_review → approved", async () => {
    const admin = await makeUser("system_admin");
    const reviewer = await makeUserWithPermissions(["dashboard.view", "cases.view_all", "cases.review_topic"]);
    const tc = await createCase(admin, { studentFullName: "تست بازبین" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    const under = await transitionStatus(tc.id, reviewer, { to: "under_review" }, ctx);
    expect(under.currentStatus).toBe("under_review");
    const approved = await transitionStatus(tc.id, reviewer, { to: "approved" }, ctx);
    expect(approved.currentStatus).toBe("approved");
  });

  it("archive requires cases.archive specifically", async () => {
    const admin = await makeUser("system_admin");
    const noArchive = await makeUserWithPermissions(["dashboard.view", "cases.view_all", "cases.review_topic"]);
    const tc = await createCase(admin, { studentFullName: "تست بایگانی" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    await transitionStatus(tc.id, admin, { to: "approved" }, ctx);
    await expectForbidden(transitionStatus(tc.id, noArchive, { to: "archived" }, ctx), "TRANSITION_FORBIDDEN");
    const archived = await transitionStatus(tc.id, admin, { to: "archived" }, ctx);
    expect(archived.currentStatus).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("archived cases are immutable", async () => {
    const admin = await makeUser("system_admin");
    const tc = await createCase(admin, { studentFullName: "تست تغییرناپذیری" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
    await transitionStatus(tc.id, admin, { to: "approved" }, ctx);
    await transitionStatus(tc.id, admin, { to: "archived" }, ctx);
    try {
      await updateCase(tc.id, admin, { titleFa: "نباید ذخیره شود" }, ctx);
      expect.unreachable("archived case must not be editable");
    } catch (e) {
      expect((e as AppError).status).toBe(409);
    }
    try {
      await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);
      expect.unreachable("archived case must not transition");
    } catch (e) {
      expect((e as AppError).status).toBe(409);
    }
  });

  it("concurrent transitions cannot both succeed or corrupt history", async () => {
    const admin = await makeUser("system_admin");
    const tc = await createCase(admin, { studentFullName: "تست هم‌زمانی" }, ctx);
    createdCaseIds.push(tc.id);
    await transitionStatus(tc.id, admin, { to: "submitted" }, ctx);

    const results = await Promise.allSettled([
      transitionStatus(tc.id, admin, { to: "under_review" }, ctx),
      transitionStatus(tc.id, admin, { to: "under_review" }, ctx),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const [fresh] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
    expect(fresh.currentStatus).toBe("under_review");
  });

  it("review assignments are created once and completed on decision", async () => {
    const owner = await makeUser("student");
    const admin = await makeUser("system_admin");
    const tc = await createCase(owner, { studentFullName: "تست ارجاع بررسی" }, ctx);
    createdCaseIds.push(tc.id);
    await submitTopic(tc.id, owner, { titleFa: "موضوع ارجاع", submitForReview: true }, ctx);

    const pending = await db
      .select()
      .from(thesisCaseAssignments)
      .where(
        and(
          eq(thesisCaseAssignments.caseId, tc.id),
          eq(thesisCaseAssignments.actionType, "review_topic"),
          eq(thesisCaseAssignments.status, "pending"),
        ),
      );
    expect(pending).toHaveLength(1);
    expect(pending[0].assignedToUserId).toBeNull();

    await transitionStatus(tc.id, admin, { to: "under_review" }, ctx);
    const stillPending = await db
      .select()
      .from(thesisCaseAssignments)
      .where(and(eq(thesisCaseAssignments.caseId, tc.id), eq(thesisCaseAssignments.status, "pending")));
    expect(stillPending).toHaveLength(1);

    await transitionStatus(tc.id, admin, { to: "approved" }, ctx);
    const afterDecision = await db
      .select()
      .from(thesisCaseAssignments)
      .where(eq(thesisCaseAssignments.caseId, tc.id));
    expect(afterDecision).toHaveLength(1);
    expect(afterDecision[0].status).toBe("completed");
    expect(afterDecision[0].completedAt).not.toBeNull();
  });
});

describe("supervisor eligibility", () => {
  it("a student account cannot be assigned as supervisor", async () => {
    const admin = await makeUser("system_admin");
    const studentAccount = await makeUser("student");
    const tc = await createCase(admin, { studentFullName: "تست اهلیت استاد" }, ctx);
    createdCaseIds.push(tc.id);
    try {
      await addSupervisor(tc.id, admin, { userId: studentAccount.id, supervisorName: "نام جعلی", roleType: "supervisor" }, ctx);
      expect.unreachable("ineligible account must be rejected");
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe("SUPERVISOR_NOT_ELIGIBLE");
    }
  });

  it("an eligible supervisor account is linked with its real name snapshot", async () => {
    const admin = await makeUser("system_admin");
    const professor = await makeUser("supervisor");
    const tc = await createCase(admin, { studentFullName: "تست استاد واجد شرایط" }, ctx);
    createdCaseIds.push(tc.id);
    const sup = await addSupervisor(
      tc.id,
      admin,
      { userId: professor.id, supervisorName: "نامی که فرستنده حدس زده", roleType: "supervisor" },
      ctx,
    );
    expect(sup.userId).toBe(professor.id);
    expect(sup.supervisorName).toBe(professor.fullName);
  });

  it("actor without assign permission cannot add a supervisor", async () => {
    const owner = await makeUser("student");
    const tc = await createCase(owner, { studentFullName: "تست مجوز انتساب" }, ctx);
    createdCaseIds.push(tc.id);
    await expectForbidden(addSupervisor(tc.id, owner, { supervisorName: "دکتر نمونه", roleType: "advisor" }, ctx));
  });
});

describe("department scoping and student linking", () => {
  it("department head sees only own-department cases", async () => {
    const admin = await makeUser("system_admin");
    const head = await makeUser("dept_head");
    await db.update(users).set({ department: "مهندسی کامپیوتر" }).where(eq(users.id, head.id));

    const inDept = await createCase(admin, { studentFullName: "داخل گروه", department: "مهندسی کامپیوتر" }, ctx);
    const outDept = await createCase(admin, { studentFullName: "خارج گروه", department: "مهندسی برق" }, ctx);
    createdCaseIds.push(inDept.id, outDept.id);

    const visible = await getVisibleCaseIds(head);
    expect(visible).not.toBeNull();
    expect(visible).toContain(inDept.id);
    expect(visible).not.toContain(outDept.id);
    await expectForbidden(getCaseById(outDept.id, head) as Promise<unknown>);
  });

  it("department head without a recorded department sees no department cases", async () => {
    const admin = await makeUser("system_admin");
    const head = await makeUser("dept_head");
    const tc = await createCase(admin, { studentFullName: "بدون گروه مشخص", department: "مهندسی کامپیوتر" }, ctx);
    createdCaseIds.push(tc.id);
    const visible = await getVisibleCaseIds(head);
    expect(visible).not.toContain(tc.id);
  });

  it("linking a non-student account as the case student is rejected", async () => {
    const admin = await makeUser("system_admin");
    const professor = await makeUser("supervisor");
    try {
      await createCase(admin, { studentFullName: "پیوند نامعتبر", studentUserId: professor.id }, ctx);
      expect.unreachable("non-student link must be rejected");
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe("INVALID_STUDENT_USER");
    }
  });

  it("a student creating a case is force-linked to their own account", async () => {
    const student = await makeUser("student");
    const professor = await makeUser("supervisor");
    const tc = await createCase(student, { studentFullName: "پرونده خودم", studentUserId: professor.id }, ctx);
    createdCaseIds.push(tc.id);
    expect(tc.studentUserId).toBe(student.id);
  });
});

describe("organisational department scoping (Phase 3)", () => {
  it("department_id links scope visibility and take precedence over names", async () => {
    const admin = await makeUser("system_admin");
    const head = await makeUser("dept_head");
    const unique = randomBytes(4).toString("hex");
    const [deptA] = await db.insert(departments).values({ nameFa: `گروه الف ${unique}` }).returning();
    const [deptB] = await db.insert(departments).values({ nameFa: `گروه ب ${unique}` }).returning();
    createdDepartmentIds.push(deptA.id, deptB.id);
    await db.update(users).set({ departmentId: deptA.id, department: `گروه الف ${unique}` }).where(eq(users.id, head.id));

    const inDept = await createCase(admin, { studentFullName: "داخل گروه سازمانی", department: `گروه الف ${unique}` }, ctx);
    await db.update(thesisCases).set({ departmentId: deptA.id }).where(eq(thesisCases.id, inDept.id));
    createdCaseIds.push(inDept.id);

    // Same display name but a DIFFERENT department_id: FK precedence must deny access.
    const impostor = await createCase(admin, { studentFullName: "نام مشابه گروه دیگر", department: `گروه الف ${unique}` }, ctx);
    await db.update(thesisCases).set({ departmentId: deptB.id }).where(eq(thesisCases.id, impostor.id));
    createdCaseIds.push(impostor.id);

    const visible = await getVisibleCaseIds(head);
    expect(visible).toContain(inDept.id);
    expect(visible).not.toContain(impostor.id);
    await expectForbidden(getCaseById(impostor.id, head) as Promise<unknown>);
  });
});

describe("transactional integrity", () => {
  it("rolls back the status change when recording the case event fails", async () => {
    const admin = await makeUser("system_admin");
    const tc = await createCase(admin, { studentFullName: "تست rollback رویداد" }, ctx);
    createdCaseIds.push(tc.id);

    await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION shd_block_case_event() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'blocked by test'; END; $f$ LANGUAGE plpgsql`));
    await db.execute(sql.raw(`CREATE TRIGGER shd_block_event BEFORE INSERT ON thesis_case_events FOR EACH ROW WHEN (NEW.case_id = '${tc.id}') EXECUTE FUNCTION shd_block_case_event()`));
    try {
      // The raw database error propagates (the route layer maps it to a safe
      // 500); the integrity property asserted here is that nothing committed.
      await expect(transitionStatus(tc.id, admin, { to: "submitted" }, ctx)).rejects.toThrow();
      const [fresh] = await db.select().from(thesisCases).where(eq(thesisCases.id, tc.id));
      expect(fresh.currentStatus).toBe("draft");
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS shd_block_event ON thesis_case_events`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS shd_block_case_event()`));
    }
  });

  it("generates unique case numbers under concurrency", async () => {
    const admin = await makeUser("system_admin");
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createCase(admin, { studentFullName: `هم‌زمان ${i}` }, ctx)),
    );
    for (const c of created) createdCaseIds.push(c.id);
    const numbers = new Set(created.map((c) => c.caseNumber));
    expect(numbers.size).toBe(created.length);
  });

  it("concurrent primary-supervisor assignments cannot both succeed", async () => {
    const admin = await makeUser("system_admin");
    const tc = await createCase(admin, { studentFullName: "تست هم‌زمانی استاد" }, ctx);
    createdCaseIds.push(tc.id);
    const results = await Promise.allSettled([
      addSupervisor(tc.id, admin, { supervisorName: "استاد اول", roleType: "supervisor" }, ctx),
      addSupervisor(tc.id, admin, { supervisorName: "استاد دوم", roleType: "supervisor" }, ctx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
