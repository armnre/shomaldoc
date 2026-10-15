import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createTopicVersion, listTopicVersions } from "@/server/services/topic";
import { topicVersionSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  // Visibility is enforced by the service through the same gate used for writes.
  const { getCaseById } = await import("@/server/services/case");
  const tc = await getCaseById(id, user).catch(() => null);
  if (!tc) {
    const { AppError } = await import("@/server/http");
    throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  }
  return jsonOk({ versions: await listTopicVersions(id) });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("cases.submit_topic");
  const { id } = await ctx.params;
  const input = await parseJson(request, topicVersionSchema);
  const result = await createTopicVersion(id, user, input, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  return jsonOk(result, { status: 201 });
});
