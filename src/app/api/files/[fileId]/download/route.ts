import { Readable } from "node:stream";
import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, getClientIp, getUserAgent } from "@/server/http";
import { resolveDownloadableFile } from "@/server/services/files";
import { recordAudit } from "@/server/services/audit";
import { ALLOWED_MIME_TYPES, createReadStreamSafe } from "@/server/storage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ fileId: string }> };

/**
 * Authorised file download.
 *
 * The file id in the URL is only an identifier — never an authorisation
 * token. `resolveDownloadableFile` enforces the download permission and
 * verified visibility of the owning case before any byte is read. Physical
 * paths are never exposed.
 */
export const GET = apiRoute<Ctx>(async (request, ctx) => {
  const user = await requireApiUser("cases.files.download");
  const { fileId } = await ctx.params;

  const { file, caseId } = await resolveDownloadableFile(fileId, user);

  if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new AppError(404, "FILE_NOT_FOUND", "فایل مورد نظر یافت نشد.");
  }

  // Throws a safe 404 when the physical file is missing from disk.
  const stream = createReadStreamSafe(file.storageKey);

  await recordAudit(
    {
      actorUserId: user.id,
      action: "case.file_downloaded",
      entityType: "thesis_case",
      entityId: caseId,
      after: { fileName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
    },
    { ip: getClientIp(request), userAgent: getUserAgent(request) },
  );

  // Safe Content-Disposition: strip quotes/CRLF, provide an ASCII fallback
  // plus an RFC 5987 UTF-8 filename so Persian names survive intact.
  const safeName = file.originalName.replace(/["\r\n\\]/g, "").slice(0, 200) || "file";
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, "_") || "file";
  const headers = new Headers({
    "Content-Type": file.mimeType,
    "Content-Length": String(file.sizeBytes),
    "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });

  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
});
