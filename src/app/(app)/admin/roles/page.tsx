import { PageHeader } from "@/components/ui";
import { RolesMatrix } from "@/components/features/admin-forms";
import { can, requirePagePermission } from "@/server/auth/current-user";
import { listRolesWithPermissions } from "@/server/rbac/service";
import { PROTECTED_GRANTS } from "@/server/rbac/catalog";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const viewer = await requirePagePermission("roles.view");
  const { dict } = await getServerI18n();
  const data = await listRolesWithPermissions();
  const protectedKeys = Object.fromEntries(
    Object.entries(PROTECTED_GRANTS).map(([role, perms]) => [role, [...(perms ?? [])]]),
  ) as Record<string, string[]>;

  return (
    <>
      <PageHeader title={dict.roles.title} subtitle={dict.roles.subtitle} />
      <RolesMatrix
        roles={data.roles}
        permissions={data.permissions}
        granted={data.granted}
        protectedKeys={protectedKeys}
        canManage={can(viewer, "roles.manage")}
      />
    </>
  );
}
