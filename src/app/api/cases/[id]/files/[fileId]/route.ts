import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { deleteCaseFile } from "@/server/services/case";
import { deleteCaseFileSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Soft-deletes a case file. The physical document is preserved (no hard delete);
 * it stops being downloadable and the change is recorded in the case history
 * and the audit log with a mandatory reason.
 */
export const DELETE = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id, fileId } = await ctx.params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(fileId)) {
    throw new AppError(404, "FILE_NOT_FOUND", "فایل یافت نشد.");
  }
  const input = await parseJson(request, deleteCaseFileSchema);
  const result = await deleteCaseFile(id, fileId, user, input.reason, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
