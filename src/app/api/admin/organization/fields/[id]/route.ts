import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { updateField } from "@/server/services/organization";
import { updateFieldSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, "FIELD_NOT_FOUND", "رشته یافت نشد.");
  const input = await parseJson(request, updateFieldSchema);
  return jsonOk(await updateField(user, id, input, { ip: getClientIp(request), userAgent: getUserAgent(request) }));
});
