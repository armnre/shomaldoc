import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import {
  files,
  roles,
  thesisCaseEvents,
  thesisCaseFiles,
  thesisCases,
  thesisSupervisors,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { AppError } from "@/server/http";
import { seedRbac } from "@/server/rbac/service";
import {
  createCase,
  getCaseById,
  listCases,
  submitTopic,
  transitionStatus,
  addSupervisor,
  getCaseEvents,
  getCaseSupervisors,
  uploadCaseFile,
  getCaseFiles,
  getVisibleCaseIds,
} from "@/server/services/case";

const suffix = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

async function makeUser(roleKey: string) {
  const unique = randomBytes(4).toString("hex");
  const uname = `case-${roleKey}-${suffix}-${unique}`;
  const [u] = await db
    .insert(users)
    .values({
      username: uname,
      email: `${uname}@test.invalid`,
      fullName: `Test ${roleKey} ${unique}`,
      passwordHash: await hashPassword("Test-Case-2026"),
    })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  return { id: u.id };
}

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(thesisCaseFiles).where(inArray(thesisCaseFiles.caseId, createdCaseIds));
    await db.delete(thesisSupervisors).where(inArray(thesisSupervisors.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(userRoles).where(inArray(userRoles.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("case creation", () => {
  let adminUser: { id: string };
  let studentUser: { id: string };

  it("seeds RBAC before running", async () => {
    await seedRbac();
    adminUser = await makeUser("system_admin");
    studentUser = await makeUser("student");
  });

  it("creates a case with a unique generated case number", async () => {
    const tc = await createCase(adminUser, { studentFullName: "علی رضایی", studentNumber: "12345678" }, ctx);
    expect(tc.caseNumber).toMatch(/^TH-\d{4}-\d{5}$/);
    expect(tc.currentStatus).toBe("draft");
    expect(tc.studentFullName).toBe("علی رضایی");
    expect(tc.id).toBeDefined();
    createdCaseIds.push(tc.id);
  });

  it("rejects creation with empty student name", async () => {
    await expect(createCase(adminUser, { studentFullName: "" }, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("generates unique case numbers even when called twice", async () => {
    const tc1 = await createCase(adminUser, { studentFullName: "دانشجوی اول" }, ctx);
    const tc2 = await createCase(adminUser, { studentFullName: "دانشجوی دوم" }, ctx);
    expect(tc1.caseNumber).not.toBe(tc2.caseNumber);
    createdCaseIds.push(tc1.id, tc2.id);
  });
});

describe("case access control", () => {
  let adminUser: { id: string };
  let studentUser: { id: string };
  let otherStudent: { id: string };
  let studentCaseId: string;

  it("creates users", async () => {
    adminUser = await makeUser("system_admin");
    studentUser = await makeUser("student");
    otherStudent = await makeUser("student");
  });

  it("student can create and see their own case", async () => {
    const tc = await createCase(studentUser, { studentFullName: "دانشجوی تست", studentUserId: studentUser.id }, ctx);
    studentCaseId = tc.id;
    createdCaseIds.push(tc.id);
    const visible = await getVisibleCaseIds(studentUser);
    expect(visible).toContain(tc.id);
  });

  it("admin can see all cases", async () => {
    const visible = await getVisibleCaseIds(adminUser);
    expect(visible).toBeNull(); // null = no filter, see all
  });

  it("student cannot see another student's case via getCaseById", async () => {
    // getCaseById throws a 403 AppError when the user has no access
    try {
      await getCaseById(studentCaseId, otherStudent);
      expect.unreachable("should have thrown 403");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(403);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("admin can see any case", async () => {
    const tc = await getCaseById(studentCaseId, adminUser);
    expect(tc).not.toBeNull();
    expect(tc!.id).toBe(studentCaseId);
  });
});

describe("workflow transitions", () => {
  let adminUser: { id: string };
  let tc: { id: string; currentStatus: string; caseNumber: string };

  it("creates admin and case", async () => {
    adminUser = await makeUser("system_admin");
    const created = await createCase(adminUser, { studentFullName: "دانشجوی ترنزیشن" }, ctx);
    tc = created;
    createdCaseIds.push(tc.id);
    expect(tc.currentStatus).toBe("draft");
  });

  it("draft → submitted succeeds", async () => {
    const result = await transitionStatus(tc.id, adminUser, { to: "submitted" }, ctx);
    expect(result.currentStatus).toBe("submitted");
    tc.currentStatus = result.currentStatus;
  });

  it("submitted → under_review succeeds", async () => {
    const result = await transitionStatus(tc.id, adminUser, { to: "under_review" }, ctx);
    expect(result.currentStatus).toBe("under_review");
    tc.currentStatus = result.currentStatus;
  });

  it("under_review → revision_required requires reason", async () => {
    await expect(transitionStatus(tc.id, adminUser, { to: "revision_required" }, ctx)).rejects.toBeInstanceOf(AppError);
    const result = await transitionStatus(tc.id, adminUser, { to: "revision_required", reason: "عنوان مناسب نیست" }, ctx);
    expect(result.currentStatus).toBe("revision_required");
    tc.currentStatus = result.currentStatus;
  });

  it("draft → approved is not a valid direct transition", async () => {
    const draftCase = await createCase(adminUser, { studentFullName: "تست غیرمجاز" }, ctx);
    createdCaseIds.push(draftCase.id);
    await expect(transitionStatus(draftCase.id, adminUser, { to: "approved" }, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("event history is recorded for all transitions", async () => {
    const events = await getCaseEvents(tc.id);
    expect(events.length).toBeGreaterThanOrEqual(4); // created + submitted + under_review + revision_required
    const transitionEvents = events.filter((e) => e.eventType === "status_transition");
    expect(transitionEvents.length).toBeGreaterThanOrEqual(3);
    // Check reason was recorded
    const revisionEvent = events.find((e) => e.newStatus === "revision_required");
    expect(revisionEvent?.reason).toBe("عنوان مناسب نیست");
  });
});

describe("case search and pagination", () => {
  let adminUser: { id: string };

  it("creates admin", async () => {
    adminUser = await makeUser("system_admin");
  });

  it("searches by case number", async () => {
    const tc = await createCase(adminUser, { studentFullName: "جستجوی تست", studentNumber: "99887766" }, ctx);
    createdCaseIds.push(tc.id);
    const result = await listCases(adminUser, { q: tc.caseNumber, page: 1, pageSize: 10 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some((c) => c.id === tc.id)).toBe(true);
  });

  it("searches by student name", async () => {
    const result = await listCases(adminUser, { q: "جستجوی", page: 1, pageSize: 10 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it("paginates results", async () => {
    const result = await listCases(adminUser, { page: 1, pageSize: 5 });
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.page).toBe(1);
  });

  it("filters by status", async () => {
    const result = await listCases(adminUser, { status: "draft", page: 1, pageSize: 100 });
    for (const c of result.items) {
      expect(c.currentStatus).toBe("draft");
    }
  });
});

describe("supervisors", () => {
  let adminUser: { id: string };
  let tc: { id: string };

  it("creates admin and case", async () => {
    adminUser = await makeUser("system_admin");
    const created = await createCase(adminUser, { studentFullName: "تست استادان" }, ctx);
    tc = created;
    createdCaseIds.push(tc.id);
  });

  it("adds a primary supervisor", async () => {
    const sup = await addSupervisor(tc.id, adminUser, { supervisorName: "دکتر محمدی", roleType: "supervisor" }, ctx);
    expect(sup.supervisorName).toBe("دکتر محمدی");
    expect(sup.roleType).toBe("supervisor");
  });

  it("rejects duplicate primary supervisor", async () => {
    await expect(addSupervisor(tc.id, adminUser, { supervisorName: "دکتر رضایی", roleType: "supervisor" }, ctx)).rejects.toBeInstanceOf(AppError);
  });

  it("allows an advisor alongside a supervisor", async () => {
    const adv = await addSupervisor(tc.id, adminUser, { supervisorName: "دکتر کریمی", roleType: "advisor" }, ctx);
    expect(adv.roleType).toBe("advisor");
  });

  it("lists supervisors in correct order", async () => {
    const sups = await getCaseSupervisors(tc.id);
    expect(sups.length).toBe(2);
    expect(sups[0].sortOrder).toBeLessThan(sups[1].sortOrder);
  });
});

describe("topic submission", () => {
  let adminUser: { id: string };
  let tc: { id: string };

  it("creates admin and case", async () => {
    adminUser = await makeUser("system_admin");
    const created = await createCase(adminUser, { studentFullName: "تست موضوع" }, ctx);
    tc = created;
    createdCaseIds.push(tc.id);
  });

  it("saves topic as draft without changing status", async () => {
    const result = await submitTopic(tc.id, adminUser, {
      titleFa: "بررسی الگوریتم‌های یادگیری عمیق",
      titleEn: "Deep Learning Algorithms Review",
      keywords: "هوش مصنوعی, یادگیری عمیق",
      submitForReview: false,
    }, ctx);
    expect(result.titleFa).toBe("بررسی الگوریتم‌های یادگیری عمیق");
    expect(result.currentStatus).toBe("draft");
  });

  it("submits topic for review, changing status to submitted", async () => {
    const result = await submitTopic(tc.id, adminUser, {
      titleFa: "بررسی الگوریتم‌های یادگیری عمیق (اصلاح‌شده)",
      submitForReview: true,
    }, ctx);
    expect(result.titleFa).toContain("اصلاح‌شده");
    expect(result.currentStatus).toBe("submitted");
  });

  it("rejects topic submission for a non-draft case", async () => {
    await expect(submitTopic(tc.id, adminUser, { titleFa: "عنوان جدید", submitForReview: false }, ctx)).rejects.toBeInstanceOf(AppError);
  });
});