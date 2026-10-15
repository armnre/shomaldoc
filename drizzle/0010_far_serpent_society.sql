CREATE TABLE "dynamic_form_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(60) NOT NULL,
	"title_fa" varchar(200) NOT NULL,
	"description_fa" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stage_key" varchar(40),
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dynamic_form_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"field_key" varchar(60) NOT NULL,
	"label_fa" varchar(200) NOT NULL,
	"field_type" varchar(30) NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"placeholder_fa" varchar(200),
	"help_fa" text,
	"options" jsonb,
	"validation" jsonb,
	"visible_when" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"definition_id" integer,
	"form_code" varchar(60) NOT NULL,
	"form_version" integer NOT NULL,
	"version" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"title_fa" text,
	"title_en" text,
	"keywords" text,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"attachment_file_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dynamic_form_definitions" ADD CONSTRAINT "dynamic_form_definitions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_form_definitions" ADD CONSTRAINT "dynamic_form_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_form_fields" ADD CONSTRAINT "dynamic_form_fields_definition_id_dynamic_form_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."dynamic_form_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_definition_id_dynamic_form_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."dynamic_form_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_form_definitions_code_version_idx" ON "dynamic_form_definitions" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "dynamic_form_definitions_code_idx" ON "dynamic_form_definitions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_form_fields_definition_key_idx" ON "dynamic_form_fields" USING btree ("definition_id","field_key");--> statement-breakpoint
CREATE INDEX "dynamic_form_fields_definition_idx" ON "dynamic_form_fields" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_versions_case_version_idx" ON "proposal_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "proposal_versions_case_idx" ON "proposal_versions" USING btree ("case_id");