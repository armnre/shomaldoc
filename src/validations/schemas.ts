import { z } from "zod";

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, "نام کاربری فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط (۳ تا ۶۴ نویسه) باشد.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .pipe(z.email({ error: "ایمیل معتبر وارد کنید." }));

export const passwordSchema = z
  .string()
  .min(10, "رمز عبور حداقل ۱۰ نویسه باشد.")
  .max(256, "رمز عبور بیش از حد طولانی است.")
  .regex(/[A-Za-z]/, "رمز عبور باید حداقل یک حرف انگلیسی داشته باشد.")
  .regex(/[0-9]/, "رمز عبور باید حداقل یک عدد داشته باشد.");

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "نام کاربری یا ایمیل را وارد کنید.").max(255),
  password: z.string().min(1, "رمز عبور را وارد کنید.").max(256),
  twoFactorCode: z.string().trim().max(10).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید.").max(256),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "رمز جدید باید با رمز فعلی متفاوت باشد.",
    path: ["newPassword"],
  });

const roleIdsSchema = z.array(z.number().int().positive()).max(20);

export const createUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  fullName: z.string().trim().min(3, "نام و نام خانوادگی را کامل وارد کنید.").max(200),
  initialPassword: passwordSchema,
  roleIds: roleIdsSchema.default([]),
  mustChangePassword: z.boolean().default(true),
});

export type CreateUserInput = z.output<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    roleIds: roleIdsSchema.optional(),
    department: z.string().trim().max(120).nullable().optional(),
    departmentId: z.number().int().positive().nullable().optional(),
    reason: z.string().trim().min(3, "دلیل تغییر را بنویسید (حداقل ۳ نویسه).").max(500),
  })
  .refine((v) => v.isActive !== undefined || v.roleIds !== undefined || v.department !== undefined || v.departmentId !== undefined, {
    message: "حداقل یک تغییر برای ذخیره لازم است.",
  });

export type UpdateUserInput = z.output<typeof updateUserSchema>;

export const rolePermissionSchema = z.object({
  permissionKey: z.string().min(1).max(100),
  granted: z.boolean(),
  reason: z.string().trim().min(3, "دلیل تغییر را بنویسید (حداقل ۳ نویسه).").max(500),
});

export const settingUpdateSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.union([z.string().max(200), z.number()]),
  reason: z.string().trim().min(3, "دلیل تغییر را بنویسید (حداقل ۳ نویسه).").max(500),
});

export const usersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).catch(1),
});

export const auditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).catch(1),
});

// ---------------------------------------------------------------------------
// Case management
// ---------------------------------------------------------------------------

export const createCaseSchema = z.object({
  studentFullName: z.string().trim().min(3, "نام دانشجو الزامی است.").max(200),
  studentNumber: z.string().trim().max(30).nullable().optional(),
  studentUserId: z.string().uuid().nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  degreeLevel: z.string().trim().max(30).default("کارشناسی ارشد"),
  fieldOfStudy: z.string().trim().max(150).nullable().optional(),
  academicYear: z.string().trim().max(10).nullable().optional(),
  titleFa: z.string().trim().max(500).nullable().optional(),
  titleEn: z.string().trim().max(500).nullable().optional(),
});
export type CreateCaseInput = z.output<typeof createCaseSchema>;

export const updateCaseSchema = z.object({
  studentFullName: z.string().trim().min(3).max(200).optional(),
  studentNumber: z.string().trim().max(30).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  degreeLevel: z.string().trim().max(30).optional(),
  fieldOfStudy: z.string().trim().max(150).nullable().optional(),
  academicYear: z.string().trim().max(10).nullable().optional(),
  titleFa: z.string().trim().max(500).nullable().optional(),
  titleEn: z.string().trim().max(500).nullable().optional(),
  abstractFa: z.string().max(5000).nullable().optional(),
  abstractEn: z.string().max(5000).nullable().optional(),
  keywords: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateCaseInput = z.output<typeof updateCaseSchema>;

export const topicSubmissionSchema = z.object({
  titleFa: z.string().trim().min(3, "عنوان فارسی الزامی است.").max(500),
  titleEn: z.string().trim().max(500).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  keywords: z.string().trim().max(500).nullable().optional(),
  submitForReview: z.boolean().default(false),
});
export type TopicSubmissionInput = z.output<typeof topicSubmissionSchema>;

export const transitionSchema = z.object({
  to: z.string().trim().min(1).max(40),
  reason: z.string().trim().max(500).optional(),
});
export type TransitionInput = z.output<typeof transitionSchema>;

export const addSupervisorSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  supervisorName: z.string().trim().min(2, "نام استاد الزامی است.").max(200),
  roleType: z.enum(["supervisor", "co_supervisor", "advisor"]),
});
export type AddSupervisorInput = z.output<typeof addSupervisorSchema>;

export const casesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).catch(1),
});
export type CasesQuery = z.output<typeof casesQuerySchema>;

// ---------------------------------------------------------------------------
// Organisational structure (Phase 3 completion)
// ---------------------------------------------------------------------------

export const createFacultySchema = z.object({
  nameFa: z.string().trim().min(2, "نام دانشکده الزامی است.").max(150),
  code: z.string().trim().max(30).nullable().optional(),
});
export type CreateFacultyInput = z.output<typeof createFacultySchema>;

export const createDepartmentSchema = z.object({
  nameFa: z.string().trim().min(2, "نام گروه الزامی است.").max(150),
  facultyId: z.number().int().positive().nullable().optional(),
  code: z.string().trim().max(30).nullable().optional(),
});
export type CreateDepartmentInput = z.output<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    nameFa: z.string().trim().min(2).max(150).optional(),
    facultyId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    code: z.string().trim().max(30).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "حداقل یک تغییر برای ذخیره لازم است." });
export type UpdateDepartmentInput = z.output<typeof updateDepartmentSchema>;

/** Reason is required for destructive operations such as deleting a file. */
export const deleteCaseFileSchema = z.object({
  reason: z.string().trim().min(3, "دلیل حذف فایل را بنویسید (حداقل ۳ نویسه).").max(500),
});
export type DeleteCaseFileInput = z.output<typeof deleteCaseFileSchema>;

// ---------------------------------------------------------------------------
// M1: data-driven workflow definitions
// ---------------------------------------------------------------------------

const stepKeySchema = z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_.-]+$/, "کلید مرحله فقط حروف لاتین، عدد، نقطه، خط تیره و زیرخط باشد.");

export const workflowStepSchema = z.object({
  stepKey: stepKeySchema,
  titleFa: z.string().trim().min(2).max(160),
  orderIndex: z.number().int().min(0).max(999),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
});

export const workflowTransitionSchema = z.object({
  fromStep: stepKeySchema,
  action: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_.-]+$/, "کلید اقدام معتبر نیست."),
  actionLabelFa: z.string().trim().min(2).max(160),
  toStep: stepKeySchema,
  requiredPermission: z.string().trim().min(3).max(100),
  reasonRequired: z.boolean(),
  assignRole: z.string().trim().max(64).nullable().optional(),
  dueDays: z.number().int().min(1).max(365).nullable().optional(),
  escalationRole: z.string().trim().max(64).nullable().optional(),
});

export const publishWorkflowVersionSchema = z.object({
  titleFa: z.string().trim().min(2).max(160).optional(),
  steps: z.array(workflowStepSchema).min(1).max(200),
  transitions: z.array(workflowTransitionSchema).max(2000),
  reason: z.string().trim().min(3, "دلیل انتشار نسخه را بنویسید.").max(500),
});

export const setWorkflowPublishedSchema = z.object({
  published: z.boolean(),
  reason: z.string().trim().min(3, "دلیل تغییر وضعیت انتشار را بنویسید.").max(500),
});

export const workflowDetailQuerySchema = {
  publishVersion: publishWorkflowVersionSchema,
  setPublished: setWorkflowPublishedSchema,
};

export type PublishWorkflowVersionInput = z.output<typeof publishWorkflowVersionSchema>;
export type WorkflowStepInput = z.output<typeof workflowStepSchema>;
export type WorkflowTransitionInput = z.output<typeof workflowTransitionSchema>;

// ---------------------------------------------------------------------------
// M2: organisational entities, profiles, bulk import
// ---------------------------------------------------------------------------

const orgName = (label: string) => z.string().trim().min(2, `${label} الزامی است.`).max(160);

export const createFieldSchema = z.object({
  nameFa: orgName("نام رشته"),
  departmentId: z.number().int().positive().nullable().optional(),
  code: z.string().trim().max(30).nullable().optional(),
  degreeLevel: z.string().trim().max(30).optional(),
});
export type CreateFieldInput = z.output<typeof createFieldSchema>;

export const updateFieldSchema = z
  .object({
    nameFa: orgName("نام رشته").optional(),
    departmentId: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "حداقل یک تغییر لازم است." });
export type UpdateFieldInput = z.output<typeof updateFieldSchema>;

export const createTrackSchema = z.object({ fieldId: z.number().int().positive(), nameFa: orgName("نام گرایش") });
export type CreateTrackInput = z.output<typeof createTrackSchema>;

export const createTermSchema = z.object({
  code: z.string().trim().min(2, "کد ترم الزامی است.").max(20),
  titleFa: orgName("عنوان ترم"),
  startDate: z.string().trim().max(40).nullable().optional(),
  endDate: z.string().trim().max(40).nullable().optional(),
  isCurrent: z.boolean().optional(),
});
export type CreateTermInput = z.output<typeof createTermSchema>;

export const studentProfileSchema = z.object({
  studentNumber: z.string().trim().max(30).nullable().optional(),
  nationalId: z.string().trim().max(10).nullable().optional(),
  fieldId: z.number().int().positive().nullable().optional(),
  trackId: z.number().int().positive().nullable().optional(),
  degreeLevel: z.string().trim().max(30).nullable().optional(),
  entryTermId: z.number().int().positive().nullable().optional(),
  thesisEligible: z.boolean().optional(),
  eligibilityNote: z.string().trim().max(1000).nullable().optional(),
});
export type StudentProfileInput = z.output<typeof studentProfileSchema>;

export const professorProfileSchema = z.object({
  academicRank: z.string().trim().max(60).nullable().optional(),
  employmentType: z.string().trim().max(40).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  fieldId: z.number().int().positive().nullable().optional(),
  researchAreas: z.string().trim().max(1000).nullable().optional(),
  acceptsStudents: z.boolean().optional(),
  baseCapacity: z.number().int().min(0).max(50).nullable().optional(),
});
export type ProfessorProfileInput = z.output<typeof professorProfileSchema>;

const importRowSchema = z.object({
  username: z.string().max(64),
  email: z.string().max(255),
  fullName: z.string().max(200),
  initialPassword: z.string().max(256),
  roleKeys: z.array(z.string().max(64)).max(20),
});

export const importApplySchema = z.object({
  batchId: z.string().uuid("شناسهٔ batches معتبر نیست."),
  rows: z.array(importRowSchema).max(5000, "حداکثر ۵۰۰۰ ردیف در هر فایل."),
});
export type ImportApplyInput = z.output<typeof importApplySchema>;

// ---------------------------------------------------------------------------
// M3: supervisor requests
// ---------------------------------------------------------------------------

export const createSupervisorRequestSchema = z.object({
  professorUserId: z.string().uuid("شناسهٔ استاد معتبر نیست."),
  roleType: z.enum(["supervisor", "advisor"]),
  message: z.string().trim().max(1000).nullable().optional(),
});
export type CreateSupervisorRequestInput = z.output<typeof createSupervisorRequestSchema>;

export const respondSupervisorRequestSchema = z
  .object({
    accept: z.boolean(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.accept || (v.reason && v.reason.trim().length >= 3), {
    message: "رد درخواست بدون دلیل معتبر ممکن نیست.",
    path: ["reason"],
  });
export type RespondSupervisorRequestInput = z.output<typeof respondSupervisorRequestSchema>;

export const deptHeadAssignSchema = z.object({
  professorUserId: z.string().uuid("شناسهٔ استاد معتبر نیست."),
  roleType: z.enum(["supervisor", "advisor"]),
  reason: z.string().trim().min(3, "دلیل تخصیص الزامی است.").max(500),
});
export type DeptHeadAssignInput = z.output<typeof deptHeadAssignSchema>;

// ---------------------------------------------------------------------------
// M13: reports
// ---------------------------------------------------------------------------

export const reportQuerySchema = z.object({
  departmentId: z.coerce.number().int().positive().optional(),
  facultyId: z.coerce.number().int().positive().optional(),
  status: z.string().trim().max(40).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;
