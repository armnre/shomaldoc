import { PageHeader } from "@/components/ui";
import { OrganizationManager } from "@/components/features/org-forms";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { listDepartments, listFaculties, listFields, listTerms, listTracks } from "@/server/services/organization";
import { FieldsManager, TermsManager, TracksManager, UserImportPanel } from "@/components/features/org-entities";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  const viewer = await requirePagePermission("org.view");
  const { dict } = await getServerI18n();
  const [faculties, departments, fields, tracks, terms] = await Promise.all([
    listFaculties(),
    listDepartments(),
    listFields(),
    listTracks(),
    listTerms(),
  ]);
  const canManage = can(viewer, "org.manage");

  return (
    <>
      <PageHeader title={dict.cases.org.title} subtitle={dict.cases.org.subtitle} />
      <OrganizationManager
        dict={dict}
        faculties={faculties.map((f) => ({ id: f.id, nameFa: f.nameFa, code: f.code }))}
        departments={departments.map((d) => ({
          id: d.id,
          nameFa: d.nameFa,
          code: d.code,
          facultyId: d.facultyId,
          facultyNameFa: d.facultyNameFa,
          isActive: d.isActive,
          caseCount: Number(d.caseCount),
          userCount: Number(d.userCount),
        }))}
        canManage={canManage}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FieldsManager
          dict={dict}
          canManage={canManage}
          fields={fields.map((f) => ({ id: f.id, nameFa: f.nameFa, code: f.code, degreeLevel: f.degreeLevel, departmentId: f.departmentId, isActive: f.isActive }))}
          departments={departments.map((d) => ({ id: d.id, nameFa: d.nameFa }))}
        />
        <TracksManager
          dict={dict}
          canManage={canManage}
          tracks={tracks.map((t) => ({ id: t.id, fieldId: t.fieldId, nameFa: t.nameFa, isActive: t.isActive }))}
          fields={fields.map((f) => ({ id: f.id, nameFa: f.nameFa, code: f.code, degreeLevel: f.degreeLevel, departmentId: f.departmentId, isActive: f.isActive }))}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TermsManager
          dict={dict}
          canManage={canManage}
          terms={terms.map((t) => ({
            id: t.id, code: t.code, titleFa: t.titleFa, isCurrent: t.isCurrent, isActive: t.isActive,
            startDate: t.startDate ? t.startDate.toISOString() : null,
            endDate: t.endDate ? t.endDate.toISOString() : null,
          }))}
        />
        {canManage ? <UserImportPanel dict={dict} /> : null}
      </div>
    </>
  );
}
