import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getDefinitionDetail } from "@/server/services/workflow-admin";
import { workflowDetailQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function readId(ctx: Ctx): Promise<number> {
  const { id } = await ctx.params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new AppError(404, "DEFINITION_NOT_FOUND", "تعریف گردش‌کار یافت نشد.");
  return parsed;
}

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  await requireApiUser("workflow.view");
  return jsonOk(await getDefinitionDetail(await readId(ctx)));
});

/** Publishes a NEW version; the running one is never edited in place. */
export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("workflow.manage");
  const id = await readId(ctx);
  const input = await parseJson(request, workflowDetailQuerySchema.publishVersion);
  const { publishNewVersion } = await import("@/server/services/workflow-admin");
  const created = await publishNewVersion(actor, id, input, { ip: getClientIp(request), userAgent: getUserAgent(request) });
  return jsonOk(created, { status: 201 });
});

export const PATCH = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("workflow.manage");
  const id = await readId(ctx);
  const body = await parseJson(request, workflowDetailQuerySchema.setPublished);
  const { setPublished } = await import("@/server/services/workflow-admin");
  const row = await setPublished(actor, id, body.published, body.reason, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(row);
});
