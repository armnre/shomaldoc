import { asc, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { departments, faculties, roles, thesisCases, userRoles, users } from "@/db/schema";
import { AppError } from "../http";
import { recordAudit, type Actor, type RequestContext } from "./audit";

/**
 * Organisational structure (faculties and departments).
 *
 * Rows are created only by authorised administrators or by the migration
 * backfill that derives them from existing verified values. Nothing here
 * invents the university's official structure.
 */

export async function listFaculties() {
  return db.select().from(faculties).orderBy(asc(faculties.nameFa));
}

export async function listDepartments() {
  return db
    .select({
      id: departments.id,
      nameFa: departments.nameFa,
      code: departments.code,
      facultyId: departments.facultyId,
      facultyNameFa: faculties.nameFa,
      isActive: departments.isActive,
      caseCount: db.$count(thesisCases, eq(thesisCases.departmentId, departments.id)),
      userCount: db.$count(users, eq(users.departmentId, departments.id)),
    })
    .from(departments)
    .leftJoin(faculties, eq(faculties.id, departments.facultyId))
    .orderBy(asc(departments.nameFa));
}

export interface CreateFacultyInput {
  nameFa: string;
  code?: string | null;
}

export async function createFaculty(actor: Actor, input: CreateFacultyInput, ctx: RequestContext) {
  const name = input.nameFa.trim();
  if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام دانشکده الزامی است.");
  const [existing] = await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.nameFa, name)).limit(1);
  if (existing) throw new AppError(409, "DUPLICATE", "دانشکده با این نام قبلاً ثبت شده است.");
  const [row] = await db
    .insert(faculties)
    .values({ nameFa: name, code: input.code?.trim() || null })
    .returning();
  await recordAudit(
    { actorUserId: actor.id, action: "org.faculty_created", entityType: "faculty", entityId: String(row.id), after: { nameFa: name } },
    ctx,
  );
  return row;
}

export interface CreateDepartmentInput {
  nameFa: string;
  facultyId?: number | null;
  code?: string | null;
}

export async function createDepartment(actor: Actor, input: CreateDepartmentInput, ctx: RequestContext) {
  const name = input.nameFa.trim();
  if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام گروه الزامی است.");
  const [existing] = await db.select({ id: departments.id }).from(departments).where(eq(departments.nameFa, name)).limit(1);
  if (existing) throw new AppError(409, "DUPLICATE", "گروه با این نام قبلاً ثبت شده است.");

  let facultyId: number | null = null;
  if (input.facultyId) {
    const [faculty] = await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, input.facultyId)).limit(1);
    if (!faculty) throw new AppError(400, "INVALID_FACULTY", "دانشکده انتخاب‌شده معتبر نیست.");
    facultyId = faculty.id;
  }

  const [row] = await db
    .insert(departments)
    .values({ nameFa: name, facultyId, code: input.code?.trim() || null })
    .returning();
  await recordAudit(
    {
      actorUserId: actor.id,
      action: "org.department_created",
      entityType: "department",
      entityId: String(row.id),
      after: { nameFa: name, facultyId },
    },
    ctx,
  );
  return row;
}

export interface UpdateDepartmentInput {
  nameFa?: string;
  facultyId?: number | null;
  isActive?: boolean;
  code?: string | null;
}

export async function updateDepartment(actor: Actor, departmentId: number, input: UpdateDepartmentInput, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(departments).where(eq(departments.id, departmentId)).for("update").limit(1);
    if (!current) throw new AppError(404, "DEPARTMENT_NOT_FOUND", "گروه یافت نشد.");

    const patch: Record<string, unknown> = {};
    if (input.nameFa !== undefined) {
      const name = input.nameFa.trim();
      if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام گروه الزامی است.");
      if (name !== current.nameFa) {
        const [clash] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.nameFa, name)).limit(1);
        if (clash) throw new AppError(409, "DUPLICATE", "گروهی با این نام وجود دارد.");
        patch.nameFa = name;
      }
    }
    if (input.facultyId !== undefined) {
      if (input.facultyId === null) {
        patch.facultyId = null;
      } else {
        const [faculty] = await tx.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, input.facultyId)).limit(1);
        if (!faculty) throw new AppError(400, "INVALID_FACULTY", "دانشکده انتخاب‌شده معتبر نیست.");
        patch.facultyId = faculty.id;
      }
    }
    if (input.code !== undefined) patch.code = input.code?.trim() || null;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    if (Object.keys(patch).length === 0) throw new AppError(400, "NOTHING_TO_UPDATE", "تغییری برای ذخیره وجود ندارد.");

    await tx.update(departments).set(patch).where(eq(departments.id, departmentId));

    await recordAudit(
      {
        actorUserId: actor.id,
        action: "org.department_updated",
        entityType: "department",
        entityId: String(departmentId),
        before: { nameFa: current.nameFa, facultyId: current.facultyId, isActive: current.isActive },
        after: patch,
      },
      ctx,
      tx,
    );

    const [fresh] = await tx.select().from(departments).where(eq(departments.id, departmentId)).limit(1);
    return fresh;
  });
}

/** Lightweight option list used by case and user forms. */
export async function listDepartmentOptions(): Promise<Array<{ id: number; nameFa: string; facultyNameFa: string | null }>> {
  const rows = await db
    .select({ id: departments.id, nameFa: departments.nameFa, facultyNameFa: faculties.nameFa })
    .from(departments)
    .leftJoin(faculties, eq(faculties.id, departments.facultyId))
    .where(eq(departments.isActive, true))
    .orderBy(asc(departments.nameFa));
  return rows;
}

/** True when the given department exists and is active. */
export async function isActiveDepartment(departmentId: number, executor: Pick<DbTx, "select"> = db): Promise<boolean> {
  const [row] = await executor
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  return !!row;
}

// ---------------------------------------------------------------------------
// M2: fields of study, tracks, academic terms, profiles, bulk import
// ---------------------------------------------------------------------------

import {
  academicTerms,
  fieldTracks,
  fieldsOfStudy,
  professorProfiles,
  studentProfiles,
  userImportBatches,
} from "@/db/schema";
import { desc } from "drizzle-orm";

export async function listFields(departmentId?: number | null) {
  const where = departmentId != null ? eq(fieldsOfStudy.departmentId, departmentId) : undefined;
  return db.select().from(fieldsOfStudy).where(where).orderBy(asc(fieldsOfStudy.nameFa));
}

export async function createField(actor: Actor, input: { nameFa: string; departmentId?: number | null; code?: string | null; degreeLevel?: string }, ctx: RequestContext) {
  const name = input.nameFa.trim();
  if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام رشته الزامی است.");
  if (input.departmentId && !(await isActiveDepartment(input.departmentId))) {
    throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
  }
  const [row] = await db
    .insert(fieldsOfStudy)
    .values({
      nameFa: name,
      departmentId: input.departmentId ?? null,
      code: input.code?.trim() || null,
      degreeLevel: input.degreeLevel?.trim() || "کارشناسی ارشد",
    })
    .returning();
  await recordAudit({ actorUserId: actor.id, action: "org.field_created", entityType: "field_of_study", entityId: String(row.id), after: { nameFa: name } }, ctx);
  return row;
}

export async function updateField(actor: Actor, fieldId: number, input: { nameFa?: string; departmentId?: number | null; isActive?: boolean }, ctx: RequestContext) {
  const [current] = await db.select().from(fieldsOfStudy).where(eq(fieldsOfStudy.id, fieldId)).limit(1);
  if (!current) throw new AppError(404, "FIELD_NOT_FOUND", "رشته یافت نشد.");
  const patch: Record<string, unknown> = {};
  if (input.nameFa !== undefined) {
    const name = input.nameFa.trim();
    if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام رشته الزامی است.");
    patch.nameFa = name;
  }
  if (input.departmentId !== undefined) {
    if (input.departmentId !== null && !(await isActiveDepartment(input.departmentId))) {
      throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
    }
    patch.departmentId = input.departmentId;
  }
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) throw new AppError(400, "NOTHING_TO_UPDATE", "تغییری برای ذخیره وجود ندارد.");
  await db.update(fieldsOfStudy).set(patch).where(eq(fieldsOfStudy.id, fieldId));
  await recordAudit(
    { actorUserId: actor.id, action: "org.field_updated", entityType: "field_of_study", entityId: String(fieldId), before: { nameFa: current.nameFa }, after: patch },
    ctx,
  );
  const [fresh] = await db.select().from(fieldsOfStudy).where(eq(fieldsOfStudy.id, fieldId)).limit(1);
  return fresh;
}

export async function listTracks(fieldId?: number) {
  const where = fieldId != null ? eq(fieldTracks.fieldId, fieldId) : undefined;
  return db.select().from(fieldTracks).where(where).orderBy(asc(fieldTracks.nameFa));
}

export async function createTrack(actor: Actor, input: { fieldId: number; nameFa: string }, ctx: RequestContext) {
  const name = input.nameFa.trim();
  if (name.length < 2) throw new AppError(400, "INVALID_INPUT", "نام گرایش الزامی است.");
  const [field] = await db.select({ id: fieldsOfStudy.id }).from(fieldsOfStudy).where(eq(fieldsOfStudy.id, input.fieldId)).limit(1);
  if (!field) throw new AppError(400, "INVALID_FIELD", "رشتهٔ انتخاب‌شده معتبر نیست.");
  const [row] = await db.insert(fieldTracks).values({ fieldId: input.fieldId, nameFa: name }).returning();
  await recordAudit({ actorUserId: actor.id, action: "org.track_created", entityType: "field_track", entityId: String(row.id), after: { fieldId: input.fieldId, nameFa: name } }, ctx);
  return row;
}

export async function listTerms() {
  return db.select().from(academicTerms).orderBy(desc(academicTerms.isCurrent), asc(academicTerms.code));
}

export async function createTerm(actor: Actor, input: { code: string; titleFa: string; startDate?: string | null; endDate?: string | null; isCurrent?: boolean }, ctx: RequestContext) {
  const code = input.code.trim();
  if (code.length < 2) throw new AppError(400, "INVALID_INPUT", "کد ترم الزامی است.");
  return db.transaction(async (tx) => {
    if (input.isCurrent) {
      // Exactly one current term at a time.
      await tx.update(academicTerms).set({ isCurrent: false }).where(eq(academicTerms.isCurrent, true));
    }
    const [row] = await tx
      .insert(academicTerms)
      .values({
        code,
        titleFa: input.titleFa.trim(),
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        isCurrent: !!input.isCurrent,
      })
      .returning();
    await recordAudit({ actorUserId: actor.id, action: "org.term_created", entityType: "academic_term", entityId: String(row.id), after: { code, isCurrent: !!input.isCurrent } }, ctx, tx);
    return row;
  });
}

export async function getStudentProfile(userId: string) {
  const [row] = await db
    .select({ profile: studentProfiles, user: users, field: fieldsOfStudy, term: academicTerms })
    .from(studentProfiles)
    .innerJoin(users, eq(users.id, studentProfiles.userId))
    .leftJoin(fieldsOfStudy, eq(fieldsOfStudy.id, studentProfiles.fieldId))
    .leftJoin(academicTerms, eq(academicTerms.id, studentProfiles.entryTermId))
    .where(eq(studentProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertStudentProfile(
  actor: Actor,
  userId: string,
  input: {
    studentNumber?: string | null;
    nationalId?: string | null;
    fieldId?: number | null;
    trackId?: number | null;
    degreeLevel?: string | null;
    entryTermId?: number | null;
    thesisEligible?: boolean;
    eligibilityNote?: string | null;
  },
  ctx: RequestContext,
) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  if (input.fieldId != null) {
    const [f] = await db.select({ id: fieldsOfStudy.id }).from(fieldsOfStudy).where(eq(fieldsOfStudy.id, input.fieldId)).limit(1);
    if (!f) throw new AppError(400, "INVALID_FIELD", "رشتهٔ انتخاب‌شده معتبر نیست.");
  }
  if (input.entryTermId != null) {
    const [t] = await db.select({ id: academicTerms.id }).from(academicTerms).where(eq(academicTerms.id, input.entryTermId)).limit(1);
    if (!t) throw new AppError(400, "INVALID_TERM", "ترم انتخاب‌شده معتبر نیست.");
  }
  if (input.nationalId != null && input.nationalId !== "" && !/^\d{10}$/.test(input.nationalId)) {
    throw new AppError(400, "INVALID_NATIONAL_ID", "کد ملی باید ۱۰ رقم باشد.");
  }

  const [existing] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  const values = {
    studentNumber: input.studentNumber !== undefined ? input.studentNumber : existing?.studentNumber ?? null,
    nationalId: input.nationalId !== undefined ? input.nationalId || null : existing?.nationalId ?? null,
    fieldId: input.fieldId !== undefined ? input.fieldId : existing?.fieldId ?? null,
    trackId: input.trackId !== undefined ? input.trackId : existing?.trackId ?? null,
    degreeLevel: input.degreeLevel !== undefined ? input.degreeLevel : existing?.degreeLevel ?? null,
    entryTermId: input.entryTermId !== undefined ? input.entryTermId : existing?.entryTermId ?? null,
    thesisEligible: input.thesisEligible !== undefined ? input.thesisEligible : existing?.thesisEligible ?? false,
    eligibilityNote: input.eligibilityNote !== undefined ? input.eligibilityNote : existing?.eligibilityNote ?? null,
    updatedAt: new Date(),
  };

  const row = existing
    ? (await db.update(studentProfiles).set(values).where(eq(studentProfiles.userId, userId)).returning())[0]
    : (await db.insert(studentProfiles).values({ userId, ...values }).returning())[0];

  await recordAudit(
    {
      actorUserId: actor.id,
      action: "profile.student_updated",
      entityType: "student_profile",
      entityId: userId,
      before: existing ? { thesisEligible: existing.thesisEligible, fieldId: existing.fieldId } : null,
      after: { thesisEligible: values.thesisEligible, fieldId: values.fieldId, studentNumber: values.studentNumber },
    },
    ctx,
  );
  return row;
}

export async function getProfessorProfile(userId: string) {
  const [row] = await db
    .select({ profile: professorProfiles, user: users, department: departments, field: fieldsOfStudy })
    .from(professorProfiles)
    .innerJoin(users, eq(users.id, professorProfiles.userId))
    .leftJoin(departments, eq(departments.id, professorProfiles.departmentId))
    .leftJoin(fieldsOfStudy, eq(fieldsOfStudy.id, professorProfiles.fieldId))
    .where(eq(professorProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertProfessorProfile(
  actor: Actor,
  userId: string,
  input: {
    academicRank?: string | null;
    employmentType?: string | null;
    departmentId?: number | null;
    fieldId?: number | null;
    researchAreas?: string | null;
    acceptsStudents?: boolean;
    baseCapacity?: number | null;
  },
  ctx: RequestContext,
) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  if (input.departmentId != null && !(await isActiveDepartment(input.departmentId))) {
    throw new AppError(400, "INVALID_DEPARTMENT", "گروه انتخاب‌شده معتبر نیست.");
  }
  if (input.fieldId != null) {
    const [f] = await db.select({ id: fieldsOfStudy.id }).from(fieldsOfStudy).where(eq(fieldsOfStudy.id, input.fieldId)).limit(1);
    if (!f) throw new AppError(400, "INVALID_FIELD", "رشتهٔ انتخاب‌شده معتبر نیست.");
  }
  if (input.baseCapacity != null && (input.baseCapacity < 0 || input.baseCapacity > 50)) {
    throw new AppError(400, "INVALID_CAPACITY", "ظرفیت پایه باید بین ۰ و ۵۰ باشد.");
  }

  const [existing] = await db.select().from(professorProfiles).where(eq(professorProfiles.userId, userId)).limit(1);
  const values = {
    academicRank: input.academicRank !== undefined ? input.academicRank : existing?.academicRank ?? null,
    employmentType: input.employmentType !== undefined ? input.employmentType : existing?.employmentType ?? null,
    departmentId: input.departmentId !== undefined ? input.departmentId : existing?.departmentId ?? null,
    fieldId: input.fieldId !== undefined ? input.fieldId : existing?.fieldId ?? null,
    researchAreas: input.researchAreas !== undefined ? input.researchAreas : existing?.researchAreas ?? null,
    acceptsStudents: input.acceptsStudents !== undefined ? input.acceptsStudents : existing?.acceptsStudents ?? false,
    baseCapacity: input.baseCapacity !== undefined ? input.baseCapacity : existing?.baseCapacity ?? null,
    updatedAt: new Date(),
  };

  const row = existing
    ? (await db.update(professorProfiles).set(values).where(eq(professorProfiles.userId, userId)).returning())[0]
    : (await db.insert(professorProfiles).values({ userId, ...values }).returning())[0];

  await recordAudit(
    {
      actorUserId: actor.id,
      action: "profile.professor_updated",
      entityType: "professor_profile",
      entityId: userId,
      before: existing ? { acceptsStudents: existing.acceptsStudents, academicRank: existing.academicRank } : null,
      after: { acceptsStudents: values.acceptsStudents, academicRank: values.academicRank, departmentId: values.departmentId },
    },
    ctx,
  );
  return row;
}

// ---------------------------------------------------------------------------
// Bulk user import (CSV/XLSX) with preview + validation before applying
// ---------------------------------------------------------------------------

export interface ImportRow {
  username: string;
  email: string;
  fullName: string;
  initialPassword: string;
  roleKeys: string[];
}

export interface ImportRowResult {
  line: number;
  status: "valid" | "invalid";
  errors: string[];
  row: ImportRow;
}

/** Pure validator used by both the preview and the apply steps. */
export function validateImportRows(rows: ImportRow[], existing: { usernames: Set<string>; emails: Set<string>; roles: Map<string, number> }): ImportRowResult[] {
  const seenUsernames = new Set<string>();
  const seenEmails = new Set<string>();
  return rows.map((row, i) => {
    const errors: string[] = [];
    const line = i + 2; // header is line 1
    if (!row.username || !/^[a-z0-9._-]{3,64}$/.test(row.username)) errors.push("نام کاربری معتبر نیست (۳ تا ۶۴ نویسهٔ لاتین، عدد، نقطه، خط تیره یا زیرخط).");
    if (existing.usernames.has(row.username)) errors.push("این نام کاربری قبلاً ثبت شده است.");
    if (seenUsernames.has(row.username)) errors.push("نام کاربری در همین فایل تکراری است.");
    if (!row.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) errors.push("ایمیل معتبر نیست.");
    if (existing.emails.has(row.email)) errors.push("این ایمیل قبلاً ثبت شده است.");
    if (seenEmails.has(row.email)) errors.push("ایمیل در همین فایل تکراری است.");
    if (!row.fullName || row.fullName.trim().length < 3) errors.push("نام و نام خانوادگی کامل نیست.");
    if (!row.initialPassword || row.initialPassword.length < 10 || !/[A-Za-z]/.test(row.initialPassword) || !/[0-9]/.test(row.initialPassword)) {
      errors.push("رمز اولیه باید حداقل ۱۰ نویسه و شامل حرف و عدد باشد.");
    }
    if (row.roleKeys.length === 0) errors.push("حداقل یک نقش لازم است.");
    for (const key of row.roleKeys) {
      if (!existing.roles.has(key)) errors.push(`نقش «${key}» در سامانه تعریف نشده است.`);
    }
    seenUsernames.add(row.username);
    seenEmails.add(row.email);
    return { line, status: errors.length ? "invalid" : "valid", errors, row };
  });
}

/**
 * Parses a CSV payload. XLSX is converted to the same row shape by the caller
 * (exceljs) so validation logic stays single-sourced.
 */
export function parseCsvUsers(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iUsername = idx("username");
  const iEmail = idx("email");
  const iName = idx("full_name") >= 0 ? idx("full_name") : idx("fullname");
  const iPass = idx("initial_password") >= 0 ? idx("initial_password") : idx("password");
  const iRoles = idx("roles") >= 0 ? idx("roles") : idx("role_keys");
  if (iUsername < 0 || iEmail < 0 || iName < 0 || iPass < 0 || iRoles < 0) {
    throw new AppError(400, "INVALID_CSV_HEADER", "سرستون‌های فایل باید شامل username,email,full_name,initial_password,roles باشد.");
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return {
      username: (cells[iUsername] ?? "").toLowerCase(),
      email: (cells[iEmail] ?? "").toLowerCase(),
      fullName: cells[iName] ?? "",
      initialPassword: cells[iPass] ?? "",
      roleKeys: (cells[iRoles] ?? "").split(/[;|\s]+/).map((r) => r.trim().toLowerCase()).filter(Boolean),
    };
  });
}

export async function previewImport(actor: Actor, rows: ImportRow[], fileName: string, format: "csv" | "xlsx") {
  const [allUsers, allRoles] = await Promise.all([db.select({ username: users.username, email: users.email }).from(users), db.select().from(roles)]);
  const results = validateImportRows(rows, {
    usernames: new Set(allUsers.map((u) => u.username)),
    emails: new Set(allUsers.map((u) => u.email)),
    roles: new Map(allRoles.map((r) => [r.key, r.id])),
  });
  const [batch] = await db
    .insert(userImportBatches)
    .values({
      fileName,
      format,
      totalRows: rows.length,
      validRows: results.filter((r) => r.status === "valid").length,
      invalidRows: results.filter((r) => r.status === "invalid").length,
      status: "preview",
      // Passwords are never stored in the report.
      report: results.map((r) => ({ line: r.line, status: r.status, errors: r.errors, username: r.row.username, email: r.row.email, fullName: r.row.fullName, roleKeys: r.row.roleKeys })),
      createdBy: actor.id,
    })
    .returning();
  return { batchId: batch.id, results };
}

/** Applies only the rows that passed validation; invalid rows are reported, never guessed. */
export async function applyImport(actor: Actor, batchId: string, rows: ImportRow[], ctx: RequestContext) {
  const [batch] = await db.select().from(userImportBatches).where(eq(userImportBatches.id, batchId)).limit(1);
  if (!batch) throw new AppError(404, "BATCH_NOT_FOUND", "بatches ورود یافت نشد.");
  if (batch.status === "applied") throw new AppError(409, "ALREADY_APPLIED", "این batches پیش‌تر اعمال شده است.");

  const [allUsers, allRoles] = await Promise.all([db.select({ username: users.username, email: users.email }).from(users), db.select().from(roles)]);
  const results = validateImportRows(rows, {
    usernames: new Set(allUsers.map((u) => u.username)),
    emails: new Set(allUsers.map((u) => u.email)),
    roles: new Map(allRoles.map((r) => [r.key, r.id])),
  });
  const valid = results.filter((r) => r.status === "valid");
  if (valid.length === 0) throw new AppError(422, "NO_VALID_ROWS", "هیچ ردیف معتبری برای اعمال وجود ندارد.");

  const { hashPassword } = await import("../auth/password");
  let applied = 0;
  for (const item of valid) {
    const passwordHash = await hashPassword(item.row.initialPassword);
    const created = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          username: item.row.username,
          email: item.row.email,
          fullName: item.row.fullName.trim(),
          passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      const roleIds = item.row.roleKeys.map((k) => allRoles.find((r) => r.key === k)?.id).filter((x): x is number => typeof x === "number");
      if (roleIds.length) {
        await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: u.id, roleId, assignedBy: actor.id })));
      }
      return u;
    });
    applied++;
    await recordAudit(
      { actorUserId: actor.id, action: "user.imported", entityType: "user", entityId: created.id, after: { username: item.row.username, batchId } },
      ctx,
    );
  }

  await db
    .update(userImportBatches)
    .set({ status: "applied", appliedRows: applied, appliedAt: new Date(), validRows: valid.length, invalidRows: results.length - valid.length })
    .where(eq(userImportBatches.id, batchId));

  return {
    applied,
    skipped: results.length - valid.length,
    errors: results.filter((r) => r.status === "invalid").map((r) => ({ line: r.line, errors: r.errors })),
  };
}
