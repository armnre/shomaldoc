import { PageHeader } from "@/components/ui";
import { FormBuilder } from "@/components/features/form-builder";
import { requirePagePermission } from "@/server/auth/current-user";
import { listFormDefinitions } from "@/server/services/forms";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function FormsAdminPage() {
  await requirePagePermission("forms.view");
  const { dict } = await getServerI18n();
  const definitions = await listFormDefinitions();
  return (
    <>
      <PageHeader title={dict.forms.title} subtitle={dict.forms.subtitle} />
      <FormBuilder
        dict={dict}
        initialDefinitions={definitions.map((d) => ({
          id: d.id,
          code: d.code,
          titleFa: d.titleFa,
          descriptionFa: d.descriptionFa,
          version: d.version,
          isPublished: d.isPublished,
          isActive: d.isActive,
          stageKey: d.stageKey,
          activeFieldCount: d.activeFieldCount,
        }))}
      />
    </>
  );
}
