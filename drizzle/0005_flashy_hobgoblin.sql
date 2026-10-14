CREATE TABLE "workflow_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(60) NOT NULL,
	"title_fa" varchar(160) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"pending_university_approval" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"definition_id" integer NOT NULL,
	"current_step" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"step_key" varchar(60) NOT NULL,
	"title_fa" varchar(160) NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_initial" boolean DEFAULT false NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_task_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"action" varchar(60) NOT NULL,
	"title_fa" varchar(200) NOT NULL,
	"assignee_user_id" uuid,
	"role_key" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"escalated_to_role" varchar(64),
	"escalated_at" timestamp with time zone,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"from_step" varchar(60) NOT NULL,
	"action" varchar(60) NOT NULL,
	"action_label_fa" varchar(160) NOT NULL,
	"to_step" varchar(60) NOT NULL,
	"required_permission" varchar(100) NOT NULL,
	"reason_required" boolean DEFAULT false NOT NULL,
	"assign_role" varchar(64),
	"due_days" integer,
	"escalation_role" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD COLUMN "current_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD COLUMN "current_task_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_history" ADD CONSTRAINT "workflow_task_history_task_id_workflow_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_task_history" ADD CONSTRAINT "workflow_task_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_code_version_idx" ON "workflow_definitions" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "workflow_instances_case_idx" ON "workflow_instances" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_def_key_idx" ON "workflow_steps" USING btree ("definition_id","step_key");--> statement-breakpoint
CREATE INDEX "workflow_task_history_task_idx" ON "workflow_task_history" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_case_idx" ON "workflow_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_assignee_idx" ON "workflow_tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_status_idx" ON "workflow_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_due_idx" ON "workflow_tasks" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_transitions_from_action_idx" ON "workflow_transitions" USING btree ("definition_id","from_step","action");--> statement-breakpoint
-- Backfill: every existing case gets an instance of the core definition at its
-- current step, so the data-driven engine can drive legacy rows unchanged.
INSERT INTO "workflow_definitions" ("code", "title_fa", "version", "is_published", "is_active", "pending_university_approval")
VALUES ('thesis_case_core', 'گردش‌کار هستهٔ پرونده (۷ وضعیت)', 1, true, true, false)
ON CONFLICT ("code", "version") DO NOTHING;--> statement-breakpoint
INSERT INTO "workflow_steps" ("definition_id", "step_key", "title_fa", "order_index", "is_initial", "is_terminal")
SELECT d."id", s."key", s."fa", s."idx", s."key" = 'draft', s."key" = 'archived'
FROM "workflow_definitions" d
CROSS JOIN (VALUES
  ('draft','پیش‌نویس',0),('submitted','ثبت‌شده برای بررسی',1),('under_review','در حال بررسی',2),
  ('revision_required','نیازمند اصلاح',3),('approved','تأییدشده',4),('rejected','ردشده',5),('archived','بایگانی‌شده',6)
) AS s("key","fa","idx")
WHERE d."code" = 'thesis_case_core' AND d."version" = 1
ON CONFLICT ("definition_id", "step_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "workflow_transitions"
  ("definition_id","from_step","action","action_label_fa","to_step","required_permission","reason_required","assign_role","due_days","escalation_role")
SELECT d."id", t."from_step", t."from_step" || '_to_' || t."to_step", t."label", t."to_step", t."perm", t."reason_required",
       CASE WHEN t."to_step" IN ('submitted','under_review') THEN 'grad_office' ELSE NULL END, NULL, NULL
FROM "workflow_definitions" d
CROSS JOIN (VALUES
  ('draft','submitted','ارسال برای بررسی','cases.submit_topic',false),
  ('submitted','under_review','شروع بررسی','cases.review_topic',false),
  ('submitted','revision_required','نیاز به اصلاح','cases.review_topic',true),
  ('submitted','approved','تأیید','cases.review_topic',false),
  ('submitted','rejected','رد','cases.review_topic',true),
  ('under_review','revision_required','نیاز به اصلاح','cases.review_topic',true),
  ('under_review','approved','تأیید','cases.review_topic',false),
  ('under_review','rejected','رد','cases.review_topic',true),
  ('revision_required','submitted','ارسال مجدد پس از اصلاح','cases.submit_topic',false),
  ('revision_required','approved','تأیید','cases.review_topic',false),
  ('revision_required','rejected','رد','cases.review_topic',true),
  ('approved','archived','بایگانی','cases.archive',false),
  ('rejected','archived','بایگانی','cases.archive',false)
) AS t("from_step","to_step","label","perm","reason_required")
WHERE d."code" = 'thesis_case_core' AND d."version" = 1
ON CONFLICT ("definition_id","from_step","action") DO NOTHING;--> statement-breakpoint
INSERT INTO "workflow_instances" ("case_id","definition_id","current_step")
SELECT c."id", d."id", c."current_status"
FROM "thesis_cases" c
CROSS JOIN "workflow_definitions" d
WHERE d."code" = 'thesis_case_core' AND d."version" = 1 AND c."current_instance_id" IS NULL;--> statement-breakpoint
UPDATE "thesis_cases" c SET "current_instance_id" = i."id"
FROM "workflow_instances" i
WHERE i."case_id" = c."id" AND c."current_instance_id" IS NULL;
