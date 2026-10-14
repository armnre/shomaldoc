import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { setRolePermission } from "@/server/rbac/service";
import { rolePermissionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Changes exactly one (role, permission) pair per request. */
export const PUT = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("roles.manage");
  const { id } = await ctx.params;
  const roleId = Number(id);
  if (!Number.isInteger(roleId) || roleId <= 0) throw new AppError(404, "ROLE_NOT_FOUND", "نقش یافت نشد.");
  const input = await parseJson(request, rolePermissionSchema);
  const result = await setRolePermission(
    actor,
    { roleId, permissionKey: input.permissionKey, granted: input.granted, reason: input.reason },
    { ip: getClientIp(request), userAgent: getUserAgent(request) },
  );
  return jsonOk(result);
});
