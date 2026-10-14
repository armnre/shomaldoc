import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createTerm, listTerms } from "@/server/services/organization";
import { createTermSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  await requireApiUser("org.view");
  return jsonOk({ terms: await listTerms() });
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const input = await parseJson(request, createTermSchema);
  return jsonOk(await createTerm(user, input, { ip: getClientIp(request), userAgent: getUserAgent(request) }), { status: 201 });
});
