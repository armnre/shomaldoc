import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getUserDetail, updateUser } from "@/server/services/users";
import { updateUserSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

async function readId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  return id;
}

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  await requireApiUser("users.view");
  const id = await readId(ctx);
  const detail = await getUserDetail(id);
  if (!detail) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  return jsonOk(detail);
});

export const PATCH = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("users.manage");
  const id = await readId(ctx);
  const input = await parseJson(request, updateUserSchema);
  const user = await updateUser(actor, id, input, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(user);
});
