ALTER TABLE "notifications" ADD COLUMN "dedupe_key" varchar(160);--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD COLUMN "start_term_id" integer;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD CONSTRAINT "thesis_cases_start_term_id_academic_terms_id_fk" FOREIGN KEY ("start_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_idx" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
UPDATE "thesis_cases" AS tc SET "start_term_id" = sp."entry_term_id" FROM "student_profiles" AS sp WHERE tc."student_user_id" = sp."user_id" AND tc."start_term_id" IS NULL AND sp."entry_term_id" IS NOT NULL;--> statement-breakpoint
UPDATE "thesis_cases" AS tc SET "start_term_id" = (SELECT t."id" FROM "academic_terms" AS t WHERE t."is_current" = true ORDER BY t."id" LIMIT 1) WHERE tc."start_term_id" IS NULL AND EXISTS (SELECT 1 FROM "academic_terms" AS t WHERE t."is_current" = true);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thesis_cases_start_term_idx" ON "thesis_cases" ("start_term_id");
