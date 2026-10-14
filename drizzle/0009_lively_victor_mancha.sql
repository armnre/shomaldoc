CREATE TABLE "literature_review_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"summary_fa" text NOT NULL,
	"objectives_fa" text,
	"gap_fa" text,
	"keywords" text,
	"references_count" integer,
	"file_id" uuid,
	"status" varchar(24) DEFAULT 'submitted' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "literature_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'in_review' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title_fa" text NOT NULL,
	"title_en" text,
	"keywords" text,
	"description" text,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"stage_at_submission" varchar(40),
	"change_reason" text,
	"file_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"review_stage" varchar(20),
	"supervisor_decision_at" timestamp with time zone,
	"supervisor_decided_by" uuid,
	"group_decision_at" timestamp with time zone,
	"group_decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "literature_review_versions" ADD CONSTRAINT "literature_review_versions_review_id_literature_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."literature_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_review_versions" ADD CONSTRAINT "literature_review_versions_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_review_versions" ADD CONSTRAINT "literature_review_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_review_versions" ADD CONSTRAINT "literature_review_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_review_versions" ADD CONSTRAINT "literature_review_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_reviews" ADD CONSTRAINT "literature_reviews_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_reviews" ADD CONSTRAINT "literature_reviews_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_supervisor_decided_by_users_id_fk" FOREIGN KEY ("supervisor_decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_group_decided_by_users_id_fk" FOREIGN KEY ("group_decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_versions" ADD CONSTRAINT "topic_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "literature_review_versions_review_version_idx" ON "literature_review_versions" USING btree ("review_id","version");--> statement-breakpoint
CREATE INDEX "literature_review_versions_case_idx" ON "literature_review_versions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "literature_reviews_case_idx" ON "literature_reviews" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "literature_reviews_active_idx" ON "literature_reviews" USING btree ("case_id") WHERE "literature_reviews"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "topic_versions_case_version_idx" ON "topic_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_versions_active_idx" ON "topic_versions" USING btree ("case_id") WHERE "topic_versions"."is_active" = true;--> statement-breakpoint
CREATE INDEX "topic_versions_case_idx" ON "topic_versions" USING btree ("case_id");--> statement-breakpoint
INSERT INTO "topic_versions" ("case_id", "version", "title_fa", "title_en", "keywords", "description", "status", "is_active", "stage_at_submission", "submitted_by", "submitted_at", "decided_at", "decision_reason")
SELECT tc."id", 1, tc."title_fa", tc."title_en", tc."keywords", tc."abstract_fa", 'approved', true, tc."current_status", tc."created_by", tc."created_at", tc."updated_at", 'بک‌فیل نسخهٔ اول از موضوع ثبت‌شدهٔ پرونده (مهاجرت ۰۰۰۹).'
FROM "thesis_cases" AS tc
WHERE tc."title_fa" IS NOT NULL AND btrim(tc."title_fa") <> ''
  AND NOT EXISTS (SELECT 1 FROM "topic_versions" AS tv WHERE tv."case_id" = tc."id");
