import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createField, listFields } from "@/server/services/organization";
import { createFieldSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("org.view");
  const departmentId = new URL(request.url).searchParams.get("departmentId");
  return jsonOk({ fields: await listFields(departmentId ? Number(departmentId) : undefined) });
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const input = await parseJson(request, createFieldSchema);
  return jsonOk(await createField(user, input, { ip: getClientIp(request), userAgent: getUserAgent(request) }), { status: 201 });
});
