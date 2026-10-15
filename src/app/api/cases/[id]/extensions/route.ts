import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getCaseById } from "@/server/services/case";
import { listExtensions, requestExtension } from "@/server/services/thesis-admin";
import { extensionRequestSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user).catch(() => null);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  return jsonOk({ extensions: await listExtensions(id) });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, extensionRequestSchema);
  const result = await requestExtension(id, user, input, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  return jsonOk(result, { status: 201 });
});
