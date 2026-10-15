import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createFormVersion, listFormDefinitions } from "@/server/services/forms";
import { formDefinitionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  await requireApiUser("forms.view");
  return jsonOk({ definitions: await listFormDefinitions() });
});

export const POST = apiRoute(async (request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("forms.manage");
  const input = await parseJson(request, formDefinitionSchema);
  const definition = await createFormVersion(user, { ...input, stageKey: input.stageKey ?? null, descriptionFa: input.descriptionFa ?? null }, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(definition, { status: 201 });
});
