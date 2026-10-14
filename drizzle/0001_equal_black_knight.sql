CREATE SEQUENCE "public"."case_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "thesis_case_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"assigned_to_user_id" uuid,
	"role_key" varchar(64),
	"action_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"previous_status" varchar(40),
	"new_status" varchar(40),
	"actor_user_id" uuid,
	"actor_role" varchar(64),
	"description" text,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_case_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"purpose" varchar(50) DEFAULT 'general' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" varchar(30) NOT NULL,
	"student_user_id" uuid,
	"student_number" varchar(30),
	"student_full_name" varchar(200) NOT NULL,
	"department" varchar(120),
	"degree_level" varchar(30) DEFAULT 'کارشناسی ارشد' NOT NULL,
	"field_of_study" varchar(150),
	"academic_year" varchar(10),
	"title_fa" text,
	"title_en" text,
	"abstract_fa" text,
	"abstract_en" text,
	"keywords" text,
	"current_status" varchar(40) DEFAULT 'draft' NOT NULL,
	"workflow_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "thesis_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE TABLE "thesis_supervisors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid,
	"supervisor_name" varchar(200) NOT NULL,
	"role_type" varchar(30) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid
);
--> statement-breakpoint
ALTER TABLE "thesis_case_assignments" ADD CONSTRAINT "thesis_case_assignments_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_assignments" ADD CONSTRAINT "thesis_case_assignments_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_events" ADD CONSTRAINT "thesis_case_events_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_events" ADD CONSTRAINT "thesis_case_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_files" ADD CONSTRAINT "thesis_case_files_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_files" ADD CONSTRAINT "thesis_case_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_case_files" ADD CONSTRAINT "thesis_case_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD CONSTRAINT "thesis_cases_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD CONSTRAINT "thesis_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD CONSTRAINT "thesis_cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_supervisors" ADD CONSTRAINT "thesis_supervisors_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_supervisors" ADD CONSTRAINT "thesis_supervisors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_supervisors" ADD CONSTRAINT "thesis_supervisors_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thesis_case_assignments_case_idx" ON "thesis_case_assignments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "thesis_case_assignments_user_idx" ON "thesis_case_assignments" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "thesis_case_assignments_status_idx" ON "thesis_case_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "thesis_case_events_case_idx" ON "thesis_case_events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "thesis_case_events_created_idx" ON "thesis_case_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "thesis_case_files_case_idx" ON "thesis_case_files" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "thesis_case_files_file_idx" ON "thesis_case_files" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "thesis_cases_student_user_idx" ON "thesis_cases" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "thesis_cases_student_number_idx" ON "thesis_cases" USING btree ("student_number");--> statement-breakpoint
CREATE INDEX "thesis_cases_status_idx" ON "thesis_cases" USING btree ("current_status");--> statement-breakpoint
CREATE INDEX "thesis_cases_created_idx" ON "thesis_cases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "thesis_cases_department_idx" ON "thesis_cases" USING btree ("department");--> statement-breakpoint
CREATE INDEX "thesis_cases_search_idx" ON "thesis_cases" USING gin (to_tsvector('simple', coalesce("student_full_name",'') || ' ' || coalesce("title_fa",'') || ' ' || coalesce("case_number",'')));--> statement-breakpoint
CREATE INDEX "thesis_supervisors_case_idx" ON "thesis_supervisors" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "thesis_supervisors_user_idx" ON "thesis_supervisors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_supervisors_case_role_idx" ON "thesis_supervisors" USING btree ("case_id","role_type","user_id");