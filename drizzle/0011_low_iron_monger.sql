CREATE TABLE "committee_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"meeting_type" varchar(40) DEFAULT 'pre_defense' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" varchar(200),
	"status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"held_at" timestamp with time zone,
	"result" varchar(30),
	"minutes_fa" text,
	"file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" varchar(200) NOT NULL,
	"role_type" varchar(30) DEFAULT 'internal' NOT NULL,
	"is_present" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" varchar(40) DEFAULT 'defense_fee' NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(10) DEFAULT 'IRR' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"receipt_file_id" uuid,
	"paid_at" timestamp with time zone,
	"note" text,
	"settle_reason" text,
	"created_by" uuid,
	"settled_by" uuid,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"term_id" integer,
	"requested_terms" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"file_id" uuid,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "committee_meetings" ADD CONSTRAINT "committee_meetings_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_meetings" ADD CONSTRAINT "committee_meetings_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_meetings" ADD CONSTRAINT "committee_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_meeting_id_committee_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."committee_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_members" ADD CONSTRAINT "committee_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_receipt_file_id_files_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_extensions" ADD CONSTRAINT "thesis_extensions_case_id_thesis_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."thesis_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_extensions" ADD CONSTRAINT "thesis_extensions_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_extensions" ADD CONSTRAINT "thesis_extensions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_extensions" ADD CONSTRAINT "thesis_extensions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_extensions" ADD CONSTRAINT "thesis_extensions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_meetings_case_idx" ON "committee_meetings" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "committee_meetings_status_idx" ON "committee_meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "committee_members_meeting_idx" ON "committee_members" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "finance_records_case_idx" ON "finance_records" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "finance_records_status_idx" ON "finance_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "thesis_extensions_case_idx" ON "thesis_extensions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "thesis_extensions_status_idx" ON "thesis_extensions" USING btree ("status");