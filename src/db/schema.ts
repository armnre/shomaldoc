import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  pgSequence,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  /** Organisational unit set by an administrator; the only authoritative source for department-scoped case access. */
  department: varchar("department", { length: 120 }),
  /** FK to the organisational model (Phase 3); populated by backfill, takes precedence over the legacy text value when set. */
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  nameFa: varchar("name_fa", { length: 120 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: createdAt(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  groupKey: varchar("group_key", { length: 50 }).notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: createdAt(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 100 }),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_action_idx").on(t.action)],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/** Append-only: versions are never deleted. */
export const settingVersions = pgTable(
  "setting_versions",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 100 }).notNull(),
    version: integer("version").notNull(),
    value: jsonb("value").notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: createdAt(),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("setting_versions_key_version_idx").on(t.key, t.version)],
);

/** Fixed-window counters, updated atomically in a single statement. */
export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 200 }).primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  purpose: varchar("purpose", { length: 50 }).notNull().default("general"),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  storageKey: varchar("storage_key", { length: 255 }).notNull().unique(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  /** Lifecycle: files are never hard-deleted by normal operations; status flips to `deleted` with `deletedAt` set. */
  status: varchar("status", { length: 20 }).notNull().default("active"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
});


// ---------------------------------------------------------------------------
// Phase 3: Organisational model (faculties / departments)
// Rows are created only from authoritative data or backfilled from existing
// verified values — never seeded with invented university structure.
// ---------------------------------------------------------------------------

export const faculties = pgTable("faculties", {
  id: serial("id").primaryKey(),
  nameFa: varchar("name_fa", { length: 150 }).notNull().unique(),
  code: varchar("code", { length: 30 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const departments = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    facultyId: integer("faculty_id").references(() => faculties.id, { onDelete: "set null" }),
    nameFa: varchar("name_fa", { length: 150 }).notNull().unique(),
    code: varchar("code", { length: 30 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("departments_faculty_idx").on(t.facultyId)],
);

// ---------------------------------------------------------------------------
// Phase 1: Thesis Case Management
// ---------------------------------------------------------------------------

/** Atomic sequence for case-number generation (never uses SELECT MAX+1). */
export const caseNumberSeq = pgSequence("case_number_seq", { startWith: 1, increment: 1 });

export const thesisCases = pgTable(
  "thesis_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseNumber: varchar("case_number", { length: 30 }).notNull().unique(),
    studentUserId: uuid("student_user_id").references(() => users.id, { onDelete: "set null" }),
    studentNumber: varchar("student_number", { length: 30 }),
    studentFullName: varchar("student_full_name", { length: 200 }).notNull(),
    department: varchar("department", { length: 120 }),
    /** FK to the organisational model (Phase 3); backfilled from the legacy text value when it matches a department. */
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    degreeLevel: varchar("degree_level", { length: 30 }).notNull().default("کارشناسی ارشد"),
    fieldOfStudy: varchar("field_of_study", { length: 150 }),
    academicYear: varchar("academic_year", { length: 10 }),
    titleFa: text("title_fa"),
    titleEn: text("title_en"),
    abstractFa: text("abstract_fa"),
    abstractEn: text("abstract_en"),
    keywords: text("keywords"),
    currentStatus: varchar("current_status", { length: 40 }).notNull().default("draft"),
    workflowVersion: integer("workflow_version").notNull().default(1),
    /** Active workflow instance (separate concept from currentStatus). */
    currentInstanceId: uuid("current_instance_id"),
    /** Active pending task, i.e. "who must act next" (separate concept again). */
    currentTaskId: uuid("current_task_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("thesis_cases_student_user_idx").on(t.studentUserId),
    index("thesis_cases_student_number_idx").on(t.studentNumber),
    index("thesis_cases_status_idx").on(t.currentStatus),
    index("thesis_cases_created_idx").on(t.createdAt),
    index("thesis_cases_department_idx").on(t.department),
    index("thesis_cases_department_id_idx").on(t.departmentId),
    index("thesis_cases_search_idx")
      .using("gin", sql`to_tsvector('simple', coalesce(${t.studentFullName},'') || ' ' || coalesce(${t.titleFa},'') || ' ' || coalesce(${t.caseNumber},''))`),
  ],
);

export const thesisSupervisors = pgTable(
  "thesis_supervisors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    supervisorName: varchar("supervisor_name", { length: 200 }).notNull(),
    roleType: varchar("role_type", { length: 30 }).notNull(), // supervisor, co_supervisor, advisor
    sortOrder: integer("sort_order").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    assignedAt: createdAt(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("thesis_supervisors_case_idx").on(t.caseId),
    index("thesis_supervisors_user_idx").on(t.userId),
    uniqueIndex("thesis_supervisors_case_role_idx").on(t.caseId, t.roleType, t.userId),
  ],
);

export const thesisCaseEvents = pgTable(
  "thesis_case_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    previousStatus: varchar("previous_status", { length: 40 }),
    newStatus: varchar("new_status", { length: 40 }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: varchar("actor_role", { length: 64 }),
    description: text("description"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [
    index("thesis_case_events_case_idx").on(t.caseId),
    index("thesis_case_events_created_idx").on(t.createdAt),
  ],
);

export const thesisCaseAssignments = pgTable(
  "thesis_case_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
    roleKey: varchar("role_key", { length: 64 }),
    actionType: varchar("action_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [
    index("thesis_case_assignments_case_idx").on(t.caseId),
    index("thesis_case_assignments_user_idx").on(t.assignedToUserId),
    index("thesis_case_assignments_status_idx").on(t.status),
  ],
);

export const thesisCaseFiles = pgTable(
  "thesis_case_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
    purpose: varchar("purpose", { length: 50 }).notNull().default("general"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("thesis_case_files_case_idx").on(t.caseId),
    index("thesis_case_files_file_idx").on(t.fileId),
  ],
);

// ---------------------------------------------------------------------------
// M1: Data-driven workflow engine
// `workflow_transitions` is the single decision source at runtime; the TS
// catalog in src/server/workflows/transitions.ts only seeds it.
// ---------------------------------------------------------------------------

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 60 }).notNull(),
    titleFa: varchar("title_fa", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    /** A definition is only usable once published; drafts are editable. */
    isPublished: boolean("is_published").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** Marks seeded definitions whose rules still need university confirmation. */
    pendingUniversityApproval: boolean("pending_university_approval").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workflow_definitions_code_version_idx").on(t.code, t.version)],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: serial("id").primaryKey(),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    stepKey: varchar("step_key", { length: 60 }).notNull(),
    titleFa: varchar("title_fa", { length: 160 }).notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    isInitial: boolean("is_initial").notNull().default(false),
    isTerminal: boolean("is_terminal").notNull().default(false),
  },
  (t) => [uniqueIndex("workflow_steps_def_key_idx").on(t.definitionId, t.stepKey)],
);

export const workflowTransitions = pgTable(
  "workflow_transitions",
  {
    id: serial("id").primaryKey(),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    fromStep: varchar("from_step", { length: 60 }).notNull(),
    action: varchar("action", { length: 60 }).notNull(),
    actionLabelFa: varchar("action_label_fa", { length: 160 }).notNull(),
    toStep: varchar("to_step", { length: 60 }).notNull(),
    /** Exact permission required; a generic transition grant is never enough. */
    requiredPermission: varchar("required_permission", { length: 100 }).notNull(),
    reasonRequired: boolean("reason_required").notNull().default(false),
    /** Creates a task for this role when the transition fires. */
    assignRole: varchar("assign_role", { length: 64 }),
    dueDays: integer("due_days"),
    /** Role that receives the task after the due date passes. */
    escalationRole: varchar("escalation_role", { length: 64 }),
  },
  (t) => [uniqueIndex("workflow_transitions_from_action_idx").on(t.definitionId, t.fromStep, t.action)],
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "restrict" }),
    /** Instances stay on the definition version they started with. */
    currentStep: varchar("current_step", { length: 60 }).notNull(),
    startedAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("workflow_instances_case_idx").on(t.caseId)],
);

export const workflowTasks = pgTable(
  "workflow_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => workflowInstances.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 60 }).notNull(),
    titleFa: varchar("title_fa", { length: 200 }).notNull(),
    /** Null means an unassigned queue item; a reviewer is never invented. */
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    roleKey: varchar("role_key", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    escalatedToRole: varchar("escalated_to_role", { length: 64 }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    actedBy: uuid("acted_by").references(() => users.id, { onDelete: "set null" }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("workflow_tasks_case_idx").on(t.caseId),
    index("workflow_tasks_assignee_idx").on(t.assigneeUserId),
    index("workflow_tasks_status_idx").on(t.status),
    index("workflow_tasks_due_idx").on(t.dueDate),
  ],
);

/** Append-only task audit; never rewritten. */
export const workflowTaskHistory = pgTable(
  "workflow_task_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => workflowTasks.id, { onDelete: "cascade" }),
    fromStatus: varchar("from_status", { length: 20 }),
    toStatus: varchar("to_status", { length: 20 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("workflow_task_history_task_idx").on(t.taskId)],
);

// ---------------------------------------------------------------------------
// M2: full organisational model + profiles
// ---------------------------------------------------------------------------

export const fieldsOfStudy = pgTable(
  "fields_of_study",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    nameFa: varchar("name_fa", { length: 160 }).notNull(),
    code: varchar("code", { length: 30 }),
    degreeLevel: varchar("degree_level", { length: 30 }).notNull().default("کارشناسی ارشد"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fields_of_study_name_level_idx").on(t.nameFa, t.degreeLevel), index("fields_department_idx").on(t.departmentId)],
);

export const fieldTracks = pgTable(
  "field_tracks",
  {
    id: serial("id").primaryKey(),
    fieldId: integer("field_id")
      .notNull()
      .references(() => fieldsOfStudy.id, { onDelete: "cascade" }),
    nameFa: varchar("name_fa", { length: 160 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("field_tracks_field_name_idx").on(t.fieldId, t.nameFa)],
);

export const academicTerms = pgTable(
  "academic_terms",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    titleFa: varchar("title_fa", { length: 120 }).notNull(),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("academic_terms_current_idx").on(t.isCurrent)],
);

export const studentProfiles = pgTable(
  "student_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    studentNumber: varchar("student_number", { length: 30 }).unique(),
    nationalId: varchar("national_id", { length: 10 }),
    fieldId: integer("field_id").references(() => fieldsOfStudy.id, { onDelete: "set null" }),
    trackId: integer("track_id").references(() => fieldTracks.id, { onDelete: "set null" }),
    degreeLevel: varchar("degree_level", { length: 30 }),
    entryTermId: integer("entry_term_id").references(() => academicTerms.id, { onDelete: "set null" }),
    /** Eligibility is an administrative decision, never inferred. */
    thesisEligible: boolean("thesis_eligible").notNull().default(false),
    eligibilityNote: text("eligibility_note"),
    updatedAt: updatedAt(),
  },
  (t) => [index("student_profiles_field_idx").on(t.fieldId)],
);

export const professorProfiles = pgTable(
  "professor_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    academicRank: varchar("academic_rank", { length: 60 }),
    employmentType: varchar("employment_type", { length: 40 }),
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    fieldId: integer("field_id").references(() => fieldsOfStudy.id, { onDelete: "set null" }),
    researchAreas: text("research_areas"),
    /** Explicitly toggled by the professor/admin; never assumed. */
    acceptsStudents: boolean("accepts_students").notNull().default(false),
    baseCapacity: integer("base_capacity"),
    updatedAt: updatedAt(),
  },
  (t) => [index("professor_profiles_dept_idx").on(t.departmentId), index("professor_profiles_field_idx").on(t.fieldId)],
);

/** Row-level report of a bulk import; kept for auditability. */
export const userImportBatches = pgTable("user_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  format: varchar("format", { length: 10 }).notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  invalidRows: integer("invalid_rows").notNull().default(0),
  appliedRows: integer("applied_rows").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("preview"),
  report: jsonb("report"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// M3: supervisor requests + capacity
// ---------------------------------------------------------------------------

export const supervisorRequests = pgTable(
  "supervisor_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => thesisCases.id, { onDelete: "cascade" }),
    studentUserId: uuid("student_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    professorUserId: uuid("professor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleType: varchar("role_type", { length: 30 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    message: text("message"),
    rejectionReason: text("rejection_reason"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    respondedBy: uuid("responded_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when the request is escalated to the department head queue. */
    escalatedToDeptHead: boolean("escalated_to_dept_head").notNull().default(false),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("supervisor_requests_case_idx").on(t.caseId),
    index("supervisor_requests_professor_idx").on(t.professorUserId),
    index("supervisor_requests_student_idx").on(t.studentUserId),
    index("supervisor_requests_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// M6: proposals + IranDoc internal records + similarity checks
// ---------------------------------------------------------------------------

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => thesisCases.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    titleFa: text("title_fa"),
    titleEn: text("title_en"),
    problemStatement: text("problem_statement"),
    importance: text("importance"),
    objectives: text("objectives"),
    questions: text("questions"),
    hypotheses: text("hypotheses"),
    methodology: text("methodology"),
    population: text("population"),
    tools: text("tools"),
    analysis: text("analysis"),
    references: text("references"),
    keywords: text("keywords"),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("proposals_case_idx").on(t.caseId), uniqueIndex("proposals_case_version_idx").on(t.caseId, t.version)],
);

/** Internal registration/review only — NOT a connection to the official IranDoc API. */
export const irandocRecords = pgTable(
  "irandoc_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => thesisCases.id, { onDelete: "cascade" }),
    trackingCode: varchar("tracking_code", { length: 60 }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    receiptFileId: uuid("receipt_file_id").references(() => files.id, { onDelete: "set null" }),
    certificateFileId: uuid("certificate_file_id").references(() => files.id, { onDelete: "set null" }),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("irandoc_case_idx").on(t.caseId), index("irandoc_status_idx").on(t.status)],
);

/** Internal similarity-check registration (no claim of an official integration). */
export const similarityChecks = pgTable(
  "similarity_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => thesisCases.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    similarityPercent: integer("similarity_percent"),
    reportId: varchar("report_id", { length: 80 }),
    certificateFileId: uuid("certificate_file_id").references(() => files.id, { onDelete: "set null" }),
    /** pass | revision_required — decided by comparing against the setting. */
    result: varchar("result", { length: 30 }).notNull().default("pending"),
    maxPercentAtTime: integer("max_percent_at_time"),
    registeredBy: uuid("registered_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("similarity_case_idx").on(t.caseId)],
);

// ---------------------------------------------------------------------------
// M11: notifications (real in-app channel) + delivery log
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 60 }).notNull(),
    titleFa: varchar("title_fa", { length: 200 }).notNull(),
    bodyFa: text("body_fa"),
    caseId: uuid("case_id").references(() => thesisCases.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => workflowTasks.id, { onDelete: "cascade" }),
    link: varchar("link", { length: 300 }),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), index("notifications_unread_idx").on(t.userId, t.isRead)],
);

/**
 * Delivery log per channel. `inapp` is implemented; `email`/`sms` stay
 * `disabled` until real credentials are configured — never faked.
 */
export const notificationLogs = pgTable("notification_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  detail: text("detail"),
  createdAt: createdAt(),
});

/** Scheduler run bookkeeping, visible on the admin dashboard. */
export const schedulerRuns = pgTable("scheduler_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobKey: varchar("job_key", { length: 60 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  processed: integer("processed").notNull().default(0),
  created: integer("created").notNull().default(0),
  escalated: integer("escalated").notNull().default(0),
  error: text("error"),
});

// ---------------------------------------------------------------------------
// M14: TOTP two-factor authentication (optional, for administrative roles)
// ---------------------------------------------------------------------------

export const userTwoFactors = pgTable("user_two_factors", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** Encrypted at rest with APP_SECRET; never returned by any API. */
  secretCipher: text("secret_cipher").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});
