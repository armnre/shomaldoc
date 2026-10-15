import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, thesisCases, thesisSupervisors, users } from "@/db/schema";
import { getVisibleCaseIds, type CaseActor } from "./case";

/**
 * M13 — global search.
 *
 * The search respects exactly the same visibility rules as the case list: a student
 * only ever finds their own cases, a professor the cases they supervise, a department
 * head the cases of their department. Nothing is filtered client-side.
 */

export interface SearchHit {
  caseId: string;
  caseNumber: string;
  titleFa: string | null;
  status: string;
  studentName: string | null;
  department: string | null;
  matchedField: "case_number" | "title" | "student" | "supervisor";
}

/** Characters that would change the meaning of a LIKE pattern are escaped. */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function searchCases(actor: CaseActor, rawTerm: string, limit = 20): Promise<SearchHit[]> {
  const term = rawTerm.trim();
  if (term.length < 2) return [];
  const visible = await getVisibleCaseIds(actor);
  if (visible !== null && visible.length === 0) return [];

  const pattern = likeTerm(term);
  const match = or(
    ilike(thesisCases.caseNumber, pattern),
    ilike(thesisCases.titleFa, pattern),
    ilike(thesisCases.titleEn, pattern),
    ilike(users.fullName, pattern),
    sql`EXISTS (SELECT 1 FROM thesis_supervisors ts WHERE ts.case_id = ${thesisCases.id} AND ts.supervisor_name ILIKE ${pattern})`,
  );

  const clauses = [match];
  if (visible !== null) clauses.push(inArray(thesisCases.id, visible));

  const rows = await db
    .select({
      caseId: thesisCases.id,
      caseNumber: thesisCases.caseNumber,
      titleFa: thesisCases.titleFa,
      status: thesisCases.currentStatus,
      studentName: users.fullName,
      department: departments.nameFa,
      legacyDepartment: thesisCases.department,
    })
    .from(thesisCases)
    .leftJoin(users, eq(users.id, thesisCases.studentUserId))
    .leftJoin(departments, eq(departments.id, thesisCases.departmentId))
    .where(and(...clauses))
    .orderBy(desc(thesisCases.updatedAt))
    .limit(limit);

  const lowered = term.toLowerCase();
  return rows.map((row) => {
    const matchedField: SearchHit["matchedField"] = row.caseNumber.toLowerCase().includes(lowered)
      ? "case_number"
      : (row.studentName ?? "").toLowerCase().includes(lowered)
        ? "student"
        : (row.titleFa ?? "").toLowerCase().includes(lowered)
          ? "title"
          : "supervisor";
    return {
      caseId: row.caseId,
      caseNumber: row.caseNumber,
      titleFa: row.titleFa,
      status: row.status,
      studentName: row.studentName,
      department: row.department ?? row.legacyDepartment,
      matchedField,
    };
  });
}

/** Advisor/supervisor name search helper used by the supervisor directory page. */
export async function searchSupervisorCases(actor: CaseActor, rawTerm: string, limit = 20) {
  const term = rawTerm.trim();
  if (term.length < 2) return [];
  const visible = await getVisibleCaseIds(actor);
  if (visible !== null && visible.length === 0) return [];
  const clauses = [ilike(thesisSupervisors.supervisorName, likeTerm(term))];
  if (visible !== null) clauses.push(inArray(thesisCases.id, visible));
  return db
    .select({ caseId: thesisCases.id, caseNumber: thesisCases.caseNumber, supervisorName: thesisSupervisors.supervisorName, roleType: thesisSupervisors.roleType })
    .from(thesisSupervisors)
    .innerJoin(thesisCases, eq(thesisCases.id, thesisSupervisors.caseId))
    .where(and(...clauses))
    .limit(limit);
}
