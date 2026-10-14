import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createCase, listCases } from "@/server/services/case";
import { createCaseSchema, casesQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export const GET = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  const url = new URL(request.url);
  const query = casesQuerySchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: url.searchParams.get("page") ?? 1,
  });
  // Visibility is enforced inside the service from the actor's permissions.
  const result = await listCases(user, { ...query, pageSize: PAGE_SIZE });
  return jsonOk(result);
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("cases.create");
  const input = await parseJson(request, createCaseSchema);
  const tc = await createCase(user, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(tc, { status: 201 });
});
