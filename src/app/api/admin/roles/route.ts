import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { listRolesWithPermissions } from "@/server/rbac/service";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  await requireApiUser("roles.view");
  return jsonOk(await listRolesWithPermissions());
});
