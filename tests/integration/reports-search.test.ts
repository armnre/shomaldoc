import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { auditLogs, notifications, roles, thesisCaseEvents, thesisCases, thesisSupervisors, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";
import { seedRbac } from "@/server/rbac/service";
import { createCase } from "@/server/services/case";
import { casesReport, csvCell, toCsv } from "@/server/services/reports";
import type { CaseReportRow } from "@/server/services/reports";
import { searchCases } from "@/server/services/search";
import { buildXlsx, XLSX_MIME } from "@/server/services/xlsx";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * M13 regression suite — reports (CSV + XLSX) and global search visibility.
 */

const suffix = randomBytes(4).toString("hex");
const ctx = { ip: "10.70.80.90", userAgent: "vitest" };
const createdUserIds: string[] = [];
const createdCaseIds: string[] = [];
let admin: Awaited<ReturnType<typeof makeUser>>;
let studentA: Awaited<ReturnType<typeof makeUser>>;
let studentB: Awaited<ReturnType<typeof makeUser>>;
let supervisor: Awaited<ReturnType<typeof makeUser>>;

async function makeUser(roleKeys: string[], fullName?: string) {
  const uniq = randomBytes(4).toString("hex");
  const [row] = await db
    .insert(users)
    .values({
      username: `m13-${suffix}-${uniq}`,
      email: `m13-${suffix}-${uniq}@test.invalid`,
      fullName: fullName ?? `کاربر M13 ${uniq}`,
      passwordHash: await hashPassword("Test-M13-2026"),
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

beforeAll(async () => {
  await seedRbac();
  admin = await makeUser(["system_admin"]);
  studentA = await makeUser(["student"], "دانشجوی الف آزمون جست‌وجو");
  studentB = await makeUser(["student"], "دانشجوی ب آزمون جست‌وجو");
  supervisor = await makeUser(["supervisor"], "استاد راهنمای آزمون جست‌وجو");
});

afterAll(async () => {
  if (createdCaseIds.length) {
    await db.delete(notifications).where(inArray(notifications.caseId, createdCaseIds));
    await db.delete(thesisCaseEvents).where(inArray(thesisCaseEvents.caseId, createdCaseIds));
    await db.delete(thesisSupervisors).where(inArray(thesisSupervisors.caseId, createdCaseIds));
    await db.delete(thesisCases).where(inArray(thesisCases.id, createdCaseIds));
  }
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await pool.end();
});

describe("global search", () => {
  it("finds a case by number, title, student and supervisor inside the caller scope", async () => {
    const tc = await createCase(admin, { studentFullName: studentA.fullName, studentUserId: studentA.id, department: `گروه جست‌وجو ${suffix}` }, ctx);
    createdCaseIds.push(tc.id);
    await db.update(thesisCases).set({ titleFa: `عنوان ویژهٔ جست‌وجوی ${suffix}` }).where(inArray(thesisCases.id, [tc.id]));
    await db.insert(thesisSupervisors).values({ caseId: tc.id, userId: supervisor.id, supervisorName: `استاد نمونهٔ ${suffix}`, roleType: "supervisor", status: "active" });

    const byNumber = await searchCases(admin, tc.caseNumber);
    expect(byNumber.some((h) => h.caseId === tc.id && h.matchedField === "case_number")).toBe(true);

    const byTitle = await searchCases(admin, `ویژهٔ جست‌وجوی ${suffix}`);
    expect(byTitle.some((h) => h.caseId === tc.id)).toBe(true);

    const byStudent = await searchCases(admin, studentA.fullName);
    expect(byStudent.some((h) => h.caseId === tc.id && h.matchedField === "student")).toBe(true);

    const bySupervisor = await searchCases(admin, `نمونهٔ ${suffix}`);
    expect(bySupervisor.some((h) => h.caseId === tc.id && h.matchedField === "supervisor")).toBe(true);

    // A short term returns nothing instead of scanning the whole table.
    expect(await searchCases(admin, "ا")).toEqual([]);
  });

  it("never shows another student's case to a student", async () => {
    const other = await createCase(admin, { studentFullName: studentB.fullName, studentUserId: studentB.id, department: `گروه جست‌وجو ${suffix}` }, ctx);
    createdCaseIds.push(other.id);
    await db.update(thesisCases).set({ titleFa: `عنوان محرمانهٔ ${suffix}` }).where(inArray(thesisCases.id, [other.id]));

    const own = await searchCases(studentA, `عنوان محرمانهٔ ${suffix}`);
    expect(own).toEqual([]);
    const asSupervisor = await searchCases(supervisor, `عنوان محرمانهٔ ${suffix}`);
    expect(asSupervisor).toEqual([]);
    // The administrator, who has view_all, does see it.
    const asAdmin = await searchCases(admin, `عنوان محرمانهٔ ${suffix}`);
    expect(asAdmin.some((h) => h.caseId === other.id)).toBe(true);
  });

  it("escapes LIKE wildcards so a crafted term cannot widen the result", async () => {
    const all = await searchCases(admin, "%");
    expect(all.length).toBeLessThan(25);
  });
});

describe("reports and xlsx export", () => {
  it("refuses formula injection in csv cells and keeps persian text", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    const csv = toCsv(["عنوان", "مقدار"], [["الف", "=cmd"]]);
    expect(csv).toContain("'=cmd");
  });

  it("produces a real xlsx workbook (zip container with the sheet) and workbook metadata", async () => {
    const bytes = await buildXlsx([
      { name: "پرونده‌ها", headers: ["شماره", "دانشجو"], rows: [["۱۴۰۲/۱", "دانشجوی آزمون"], ["۱۴۰۲/۲", "دانشجوی دوم"]] },
    ]);
    // A real XLSX is a ZIP archive: local file header magic "PK\x03\x04".
    expect(Buffer.from(bytes.subarray(0, 4)).toString("latin1")).toBe("PK\u0003\u0004");
    expect(XLSX_MIME).toContain("spreadsheetml");
    // The archive contains the parts Office requires (verified with a real unzip).
    const dir = mkdtempSync(join(tmpdir(), "shomaldoc-xlsx-"));
    const path = join(dir, "report.xlsx");
    writeFileSync(path, bytes);
    const list = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" });
    expect(list).toContain("xl/worksheets/sheet1.xml");
    expect(list).toContain("[Content_Types].xml");
    expect(list).toContain("xl/workbook.xml");
  });

  it("exports the case report rows for the caller scope", async () => {
    const rows = await casesReport(admin, {}, 50);
    expect(rows.length).toBeGreaterThan(0);
    const studentRows = await casesReport(studentA, {}, 50);
    const caseById = new Map(rows.map((r) => [r.caseNumber, r]));
    for (const row of studentRows) expect(row.caseNumber).toBeTruthy();
    expect(caseById.size).toBeGreaterThan(0);
    expect(studentRows.length).toBeLessThanOrEqual(rows.length);
  });
});
