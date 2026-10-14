import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { updateDepartment } from "@/server/services/organization";
import { updateDepartmentSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const { id } = await ctx.params;
  const departmentId = Number(id);
  if (!Number.isInteger(departmentId) || departmentId <= 0) {
    throw new AppError(404, "DEPARTMENT_NOT_FOUND", "گروه یافت نشد.");
  }
  const input = await parseJson(request, updateDepartmentSchema);
  const row = await updateDepartment(user, departmentId, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(row);
});
