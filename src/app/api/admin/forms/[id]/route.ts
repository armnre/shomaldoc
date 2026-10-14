import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getFormDefinition, updateDraftFormFields } from "@/server/services/forms";
import { formFieldsSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  await requireApiUser("forms.view");
  const { id } = await ctx.params;
  const definition = await getFormDefinition(Number(id));
  if (!definition) throw new AppError(404, "FORM_NOT_FOUND", "فرم یافت نشد.");
  return jsonOk(definition);
});

export const PUT = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("forms.manage");
  const { id } = await ctx.params;
  const input = await parseJson(request, formFieldsSchema);
  const result = await updateDraftFormFields(user, Number(id), input.fields, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
