import { PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/features/admin-forms";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { listSettings } from "@/server/services/settings";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const viewer = await requirePagePermission("settings.view");
  const { dict } = await getServerI18n();
  const settings = await listSettings();
  return (
    <>
      <PageHeader title={dict.settings.title} subtitle={dict.settings.subtitle} />
      <SettingsForm settings={settings} canManage={can(viewer, "settings.manage")} />
    </>
  );
}
