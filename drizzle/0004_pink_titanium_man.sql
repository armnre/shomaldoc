ALTER TABLE "thesis_cases" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "thesis_cases" ADD CONSTRAINT "thesis_cases_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thesis_cases_department_id_idx" ON "thesis_cases" USING btree ("department_id");--> statement-breakpoint
INSERT INTO "departments" ("name_fa")
SELECT DISTINCT d FROM (
  SELECT btrim("department") AS d FROM "thesis_cases" WHERE "department" IS NOT NULL AND btrim("department") <> ''
  UNION
  SELECT btrim("department") AS d FROM "users" WHERE "department" IS NOT NULL AND btrim("department") <> ''
) s
ON CONFLICT ("name_fa") DO NOTHING;--> statement-breakpoint
UPDATE "thesis_cases" c SET "department_id" = d."id" FROM "departments" d WHERE d."name_fa" = btrim(c."department") AND c."department" IS NOT NULL AND c."department_id" IS NULL;--> statement-breakpoint
UPDATE "users" u SET "department_id" = d."id" FROM "departments" d WHERE d."name_fa" = btrim(u."department") AND u."department" IS NOT NULL AND u."department_id" IS NULL;
