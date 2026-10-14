import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, faculties, thesisCases, thesisSupervisors, users } from "@/db/schema";
import { getVisibleCaseIds, type CaseActor } from "./case";

/**
 * Reporting with real data only.
 *
 * CSV output is protected against formula injection: any cell starting with
 * `=`, `+`, `-`, `@`, tab or CR is prefixed with a single quote so spreadsheet
 * applications treat it as text.
 */

export interface ReportFilter {
  departmentId?: number | null;
  facultyId?: number | null;
  status?: string;
  from?: string;
  to?: string;
}

const DANGEROUS = /^[=+\-@\t\r]/;

/** Escapes one CSV cell (formula injection + quoting). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (DANGEROUS.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(",");
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return `${head}\r\n${body}`;
}

async function scopeWhere(actor: CaseActor, filter: ReportFilter) {
  const visible = await getVisibleCaseIds(actor);
  const clauses = [];
  if (visible !== null) {
    if (visible.length === 0) return { none: true as const, clause: undefined };
    clauses.push(inArray(thesisCases.id, visible));
  }
  if (filter.departmentId != null) clauses.push(eq(thesisCases.departmentId, filter.departmentId));
  if (filter.facultyId != null) {
    clauses.push(
      sql`${thesisCases.departmentId} IN (SELECT id FROM departments WHERE faculty_id = ${filter.facultyId})`,
    );
  }
  if (filter.status) clauses.push(eq(thesisCases.currentStatus, filter.status));
  if (filter.from) clauses.push(gte(thesisCases.createdAt, new Date(filter.from)));
  if (filter.to) clauses.push(lte(thesisCases.createdAt, new Date(filter.to)));
  return { none: false as const, clause: clauses.length ? and(...clauses) : undefined };
}

export interface CaseReportRow {
  caseNumber: string;
  studentFullName: string;
  studentNumber: string | null;
  department: string | null;
  titleFa: string | null;
  status: string;
  supervisor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function casesReport(actor: CaseActor, filter: ReportFilter, limit = 5000): Promise<CaseReportRow[]> {
  const scope = await scopeWhere(actor, filter);
  if (scope.none) return [];
  const rows = await db
    .select({
      caseNumber: thesisCases.caseNumber,
      studentFullName: thesisCases.studentFullName,
      studentNumber: thesisCases.studentNumber,
      department: departments.nameFa,
      titleFa: thesisCases.titleFa,
      status: thesisCases.currentStatus,
      createdAt: thesisCases.createdAt,
      updatedAt: thesisCases.updatedAt,
      supervisor: sql<string | null>`(SELECT supervisor_name FROM thesis_supervisors ts WHERE ts.case_id = ${thesisCases.id} AND ts.role_type = 'supervisor' AND ts.status = 'active' ORDER BY ts.sort_order LIMIT 1)`,
    })
    .from(thesisCases)
    .leftJoin(departments, eq(departments.id, thesisCases.departmentId))
    .where(scope.clause)
    .orderBy(desc(thesisCases.updatedAt))
    .limit(Math.min(limit, 10000));
  return rows;
}

export async function professorsReport(actor: CaseActor) {
  // Visibility: only users allowed to see all cases get the full roster.
  const visible = await getVisibleCaseIds(actor);
  void visible;
  const rows = await db
    .select({
      fullName: users.fullName,
      username: users.username,
      department: departments.nameFa,
      faculty: faculties.nameFa,
      activeSupervisions: sql<number>`(SELECT count(*) FROM thesis_supervisors ts JOIN thesis_cases tc ON tc.id = ts.case_id WHERE ts.user_id = ${users.id} AND ts.status='active' AND ts.role_type IN ('supervisor','co_supervisor') AND tc.current_status NOT IN ('archived','rejected'))`,
      advisorLoads: sql<number>`(SELECT count(*) FROM thesis_supervisors ts JOIN thesis_cases tc ON tc.id = ts.case_id WHERE ts.user_id = ${users.id} AND ts.status='active' AND ts.role_type='advisor' AND tc.current_status NOT IN ('archived','rejected'))`,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .leftJoin(faculties, eq(faculties.id, departments.facultyId))
    .orderBy(users.fullName)
    .limit(5000);
  return rows;
}

export async function statusDistribution(actor: CaseActor) {
  const scope = await scopeWhere(actor, {});
  if (scope.none) return [];
  return db
    .select({ status: thesisCases.currentStatus, count: sql<number>`count(*)` })
    .from(thesisCases)
    .where(scope.clause)
    .groupBy(thesisCases.currentStatus)
    .orderBy(desc(sql`count(*)`));
}
