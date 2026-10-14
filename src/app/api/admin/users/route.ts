import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createUser, listUsers } from "@/server/services/users";
import { createUserSchema, usersQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("users.view");
  const url = new URL(request.url);
  const query = usersQuerySchema.parse({
    q: url.searchParams.get("q") ?? undefined,
    page: url.searchParams.get("page") ?? 1,
  });
  const result = await listUsers({ q: query.q, page: query.page, pageSize: PAGE_SIZE });
  return jsonOk(result);
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("users.manage");
  const input = await parseJson(request, createUserSchema);
  const user = await createUser(actor, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(user, { status: 201 });
});
