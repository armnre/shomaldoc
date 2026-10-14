import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { getPublishedFormDefinition, listProposalVersions, saveProposalVersion } from "@/server/services/forms";
import { proposalAnswersSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  await requireApiUser();
  const { id } = await ctx.params;
  const [definition, versions] = await Promise.all([getPublishedFormDefinition("proposal"), listProposalVersions(id)]);
  return jsonOk({ definition, versions });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const input = await parseJson(request, proposalAnswersSchema);
  const result = await saveProposalVersion(
    id,
    user,
    { code: input.code, answers: input.answers, submitForReview: input.submitForReview, attachmentFileId: input.attachmentFileId ?? null },
    { ip: getClientIp(request), userAgent: getUserAgent(request) },
  );
  return jsonOk(result, { status: 201 });
});
