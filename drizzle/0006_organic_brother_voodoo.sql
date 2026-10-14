CREATE TABLE "academic_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"title_fa" varchar(120) NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"is_current" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "field_tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"field_id" integer NOT NULL,
	"name_fa" varchar(160) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields_of_study" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer,
	"name_fa" varchar(160) NOT NULL,
	"code" varchar(30),
	"degree_level" varchar(30) DEFAULT 'کارشناسی ارشد' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"academic_rank" varchar(60),
	"employment_type" varchar(40),
	"department_id" integer,
	"field_id" integer,
	"research_areas" text,
	"accepts_students" boolean DEFAULT false NOT NULL,
	"base_capacity" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"student_number" varchar(30),
	"national_id" varchar(10),
	"field_id" integer,
	"track_id" integer,
	"degree_level" varchar(30),
	"entry_term_id" integer,
	"thesis_eligible" boolean DEFAULT false NOT NULL,
	"eligibility_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_student_number_unique" UNIQUE("student_number")
);
--> statement-breakpoint
CREATE TABLE "supervisor_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"professor_user_id" uuid NOT NULL,
	"role_type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"message" text,
	"rejection_reason" text,
	"responded_at" timestamp with time zone,
	"responded_by" uuid,
	"escalated_to_dept_head" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"format" varchar(10) NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"applied_rows" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'preview' NOT NULL,
	"report" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "field_tracks" ADD CONSTRAINT "field_tracks_field_id_fields_of_study_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields_of_study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields_of_study" ADD CONSTRAINT "fields_of_study_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_profiles" ADD CONSTRAINT "professor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_profiles" ADD CONSTRAINT "professor_profiles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_profiles" ADD CONSTRAINT "professor_profiles_field_id_fields_of_study_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields_of_study"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_field_id_fields_of_study_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields_of_study"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_track_id_field_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."field_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_entry_term_id_academic_terms_id_fk" FOREIGN KEY ("entry_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_requests" ADD CONSTRAINT "supervisor_requests_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_requests" ADD CONSTRAINT "supervisor_requests_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_requests" ADD CONSTRAINT "supervisor_requests_professor_user_id_users_id_fk" FOREIGN KEY ("professor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_requests" ADD CONSTRAINT "supervisor_requests_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_import_batches" ADD CONSTRAINT "user_import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_terms_current_idx" ON "academic_terms" USING btree ("is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "field_tracks_field_name_idx" ON "field_tracks" USING btree ("field_id","name_fa");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_of_study_name_level_idx" ON "fields_of_study" USING btree ("name_fa","degree_level");--> statement-breakpoint
CREATE INDEX "fields_department_idx" ON "fields_of_study" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "professor_profiles_dept_idx" ON "professor_profiles" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "professor_profiles_field_idx" ON "professor_profiles" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "student_profiles_field_idx" ON "student_profiles" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "supervisor_requests_case_idx" ON "supervisor_requests" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "supervisor_requests_professor_idx" ON "supervisor_requests" USING btree ("professor_user_id");--> statement-breakpoint
CREATE INDEX "supervisor_requests_student_idx" ON "supervisor_requests" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "supervisor_requests_status_idx" ON "supervisor_requests" USING btree ("status");