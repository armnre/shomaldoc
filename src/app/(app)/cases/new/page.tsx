import { PageHeader } from "@/components/ui";
import { CaseCreateForm } from "@/components/features/case-forms";
import { requireUser } from "@/server/auth/current-user";
import { getServerI18n } from "@/i18n/server";
import { listDepartmentOptions } from "@/server/services/organization";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  await requireUser();
  const { dict } = await getServerI18n();
  const departments = await listDepartmentOptions();
  return (
    <>
      <PageHeader title={dict.cases.newCase} />
      <CaseCreateForm dict={dict} departments={departments} />
    </>
  );
}