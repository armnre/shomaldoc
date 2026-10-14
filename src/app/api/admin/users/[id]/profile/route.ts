import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getProfessorProfile, getStudentProfile, upsertProfessorProfile, upsertStudentProfile } from "@/server/services/organization";
import { professorProfileSchema, studentProfileSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; kind?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ctxOf(request: Request) {
  return { ip: getClientIp(request), userAgent: getUserAgent(request) };
}

export const GET = apiRoute<{ params: Promise<{ id: string }> }>(async (request, ctx) => {
  await requireApiUser("users.view");
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  const kind = new URL(request.url).searchParams.get("kind") ?? "student";
  return jsonOk(kind === "professor" ? await getProfessorProfile(id) : await getStudentProfile(id));
});

export const PUT = apiRoute<{ params: Promise<{ id: string }> }>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("users.manage");
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new AppError(404, "USER_NOT_FOUND", "کاربر یافت نشد.");
  const kind = new URL(request.url).searchParams.get("kind") ?? "student";
  if (kind === "professor") {
    const input = await parseJson(request, professorProfileSchema);
    return jsonOk(await upsertProfessorProfile(user, id, input, ctxOf(request)));
  }
  const input = await parseJson(request, studentProfileSchema);
  return jsonOk(await upsertStudentProfile(user, id, input, ctxOf(request)));
});
