CREATE TABLE "case_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"rule_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graduation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'requested' NOT NULL,
	"thesis_version_id" uuid,
	"file_id" uuid,
	"note" text,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_records" ADD CONSTRAINT "graduation_records_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_records" ADD CONSTRAINT "graduation_records_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_records" ADD CONSTRAINT "graduation_records_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_records" ADD CONSTRAINT "graduation_records_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_records" ADD CONSTRAINT "graduation_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_closures_case_idx" ON "case_closures" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "graduation_records_case_idx" ON "graduation_records" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "graduation_records_status_idx" ON "graduation_records" USING btree ("status");