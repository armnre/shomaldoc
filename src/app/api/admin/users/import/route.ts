import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { applyImport, parseCsvUsers, previewImport } from "@/server/services/organization";
import { importApplySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

/**
 * Bulk user import. Two explicit steps: `?mode=preview` validates and reports
 * per-row errors without writing users; `?mode=apply` writes only the rows that
 * passed validation. Nothing is guessed or fabricated.
 */
export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("users.manage");
  const mode = new URL(request.url).searchParams.get("mode") ?? "preview";
  const form = await request.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    const { AppError } = await import("@/server/http");
    throw new AppError(400, "NO_FILE", "فایلی ارسال نشده است.");
  }
  const text = await file.text();
  const rows = parseCsvUsers(text);
  const ctx = { ip: getClientIp(request), userAgent: getUserAgent(request) };

  if (mode === "apply") {
    const batchId = String(form.get("batchId") ?? "");
    const input = importApplySchema.parse({ batchId, rows });
    return jsonOk(await applyImport(user, input.batchId, input.rows, ctx));
  }
  const preview = await previewImport(user, rows, file.name, file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
  return jsonOk(preview);
});
