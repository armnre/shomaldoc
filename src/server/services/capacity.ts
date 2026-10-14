import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { professorProfiles, supervisorRequests, thesisCases, thesisSupervisors, users } from "@/db/schema";
import { getSettingValue } from "./settings";

/**
 * Live supervisor capacity.
 *
 * Formula (every factor comes from Settings, nothing is hard-coded):
 *   allowed = round(baseCapacity × rankFactor)
 *   used    = active supervisors + (advisorCount × advisorCountsAs) + accepted pending-free requests
 *   remaining = max(0, allowed − used)
 *
 * `used` counts *accepted* commitments only: an active `thesis_supervisors`
 * link, plus accepted supervisor requests that have not yet been converted into
 * a link. Pending requests do not consume capacity, but `pendingCount` is
 * reported so the UI can show real demand.
 */

export interface CapacityFactors {
  defaultBase: number;
  rankFactors: Record<string, number>;
  advisorCountsAs: number;
}

/** Pure formula, exported for unit testing without a database. */
export function computeCapacity(
  input: { baseCapacity: number | null; academicRank: string | null; used: number },
  factors: CapacityFactors,
): { allowed: number; used: number; remaining: number } {
  const base = input.baseCapacity ?? factors.defaultBase;
  const rankKey = (input.academicRank ?? "").trim().toLowerCase();
  const rankFactor = factors.rankFactors[rankKey] ?? 1;
  const allowed = Math.max(0, Math.round(base * rankFactor));
  const used = Math.max(0, input.used);
  return { allowed, used, remaining: Math.max(0, allowed - used) };
}

export async function loadCapacityFactors(): Promise<CapacityFactors> {
  const [defaultBase, assistant, associate, professor, advisorCountsAs] = await Promise.all([
    getSettingValue("capacity.defaultBase"),
    getSettingValue("capacity.rankFactor.assistant"),
    getSettingValue("capacity.rankFactor.associate"),
    getSettingValue("capacity.rankFactor.professor"),
    getSettingValue("capacity.advisorCountsAs"),
  ]);
  return {
    defaultBase,
    rankFactors: {
      استادیار: assistant,
      assistant: assistant,
      دانشیار: associate,
      associate: associate,
      استاد: professor,
      professor: professor,
      "استاد تمام": professor,
      full: professor,
    },
    advisorCountsAs,
  };
}

/** Supervisor/advisor links that still consume capacity (case not archived/rejected). */
const ACTIVE_CASE_STATUSES = ["draft", "submitted", "under_review", "revision_required", "approved"];

async function usedByProfessor(professorUserId: string): Promise<{ supervisors: number; advisors: number; acceptedRequests: number }> {
  const [links] = await db
    .select({
      supervisors: sql<number>`count(*) filter (where ${thesisSupervisors.roleType} in ('supervisor','co_supervisor'))`,
      advisors: sql<number>`count(*) filter (where ${thesisSupervisors.roleType} = 'advisor')`,
    })
    .from(thesisSupervisors)
    .innerJoin(thesisCases, eq(thesisCases.id, thesisSupervisors.caseId))
    .where(
      and(
        eq(thesisSupervisors.userId, professorUserId),
        eq(thesisSupervisors.status, "active"),
        inArray(thesisCases.currentStatus, ACTIVE_CASE_STATUSES),
      ),
    );

  const [accepted] = await db
    .select({ value: sql<number>`count(*)` })
    .from(supervisorRequests)
    .where(and(eq(supervisorRequests.professorUserId, professorUserId), eq(supervisorRequests.status, "accepted")));

  return {
    supervisors: Number(links?.supervisors ?? 0),
    advisors: Number(links?.advisors ?? 0),
    acceptedRequests: Number(accepted?.value ?? 0),
  };
}

export interface ProfessorCapacity {
  userId: string;
  fullName: string;
  departmentId: number | null;
  fieldId: number | null;
  academicRank: string | null;
  acceptsStudents: boolean;
  allowed: number;
  used: number;
  remaining: number;
  pendingCount: number;
}

/** Capacity for one professor. */
export async function getProfessorCapacity(professorUserId: string): Promise<ProfessorCapacity | null> {
  const rows = await db
    .select({ user: users, profile: professorProfiles })
    .from(users)
    .leftJoin(professorProfiles, eq(professorProfiles.userId, users.id))
    .where(eq(users.id, professorUserId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const factors = await loadCapacityFactors();
  const usage = await usedByProfessor(professorUserId);
  const used = usage.supervisors + usage.acceptedRequests + usage.advisors * factors.advisorCountsAs;
  const cap = computeCapacity(
    { baseCapacity: row.profile?.baseCapacity ?? null, academicRank: row.profile?.academicRank ?? null, used },
    factors,
  );
  const [pending] = await db
    .select({ value: sql<number>`count(*)` })
    .from(supervisorRequests)
    .where(and(eq(supervisorRequests.professorUserId, professorUserId), eq(supervisorRequests.status, "pending")));

  return {
    userId: row.user.id,
    fullName: row.user.fullName,
    departmentId: row.profile?.departmentId ?? null,
    fieldId: row.profile?.fieldId ?? null,
    academicRank: row.profile?.academicRank ?? null,
    acceptsStudents: row.profile?.acceptsStudents ?? false,
    allowed: cap.allowed,
    used: Math.round(cap.used * 100) / 100,
    remaining: cap.remaining,
    pendingCount: Number(pending?.value ?? 0),
  };
}

/**
 * Capacity for every professor of a department/field, used by the student
 * directory. Only professors whose account is active are listed.
 */
export async function listProfessorCapacities(filter: { departmentId?: number | null; fieldId?: number | null } = {}): Promise<ProfessorCapacity[]> {
  const rows = await db
    .select({ user: users, profile: professorProfiles })
    .from(users)
    .innerJoin(professorProfiles, eq(professorProfiles.userId, users.id))
    .where(eq(users.isActive, true));

  const factors = await loadCapacityFactors();
  const out: ProfessorCapacity[] = [];
  for (const row of rows) {
    if (filter.departmentId != null && row.profile.departmentId !== filter.departmentId) continue;
    if (filter.fieldId != null && row.profile.fieldId !== filter.fieldId) continue;
    const usage = await usedByProfessor(row.user.id);
    const used = usage.supervisors + usage.acceptedRequests + usage.advisors * factors.advisorCountsAs;
    const cap = computeCapacity({ baseCapacity: row.profile.baseCapacity, academicRank: row.profile.academicRank, used }, factors);
    out.push({
      userId: row.user.id,
      fullName: row.user.fullName,
      departmentId: row.profile.departmentId,
      fieldId: row.profile.fieldId,
      academicRank: row.profile.academicRank,
      acceptsStudents: row.profile.acceptsStudents,
      allowed: cap.allowed,
      used: Math.round(cap.used * 100) / 100,
      remaining: cap.remaining,
      pendingCount: 0,
    });
  }
  return out.sort((a, b) => b.remaining - a.remaining || a.fullName.localeCompare(b.fullName, "fa"));
}
