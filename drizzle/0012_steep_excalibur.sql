CREATE TABLE "thesis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"title_fa" text,
	"file_id" uuid NOT NULL,
	"change_reason" text,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD CONSTRAINT "thesis_versions_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD CONSTRAINT "thesis_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD CONSTRAINT "thesis_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD CONSTRAINT "thesis_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_versions_case_version_idx" ON "thesis_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "thesis_versions_case_idx" ON "thesis_versions" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thesis_versions_one_active_idx" ON "thesis_versions" ("case_id") WHERE "thesis_versions"."is_active" = true;
