import { PageHeader } from "@/components/ui";
import { ReportsPanel } from "@/components/features/security-panels";
import { requireCaseViewPage } from "@/server/auth/current-user";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireCaseViewPage();
  const { dict } = await getServerI18n();
  return (
    <>
      <PageHeader title={dict.reports.title} subtitle={dict.reports.subtitle} />
      <ReportsPanel dict={dict} />
    </>
  );
}
