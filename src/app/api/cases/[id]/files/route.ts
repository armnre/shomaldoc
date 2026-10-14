import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk } from "@/server/http";
import { CASE_FILE_PURPOSES, getCaseById, getCaseFiles, uploadCaseFile } from "@/server/services/case";
import { getSettingValue } from "@/server/services/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiRoute<Ctx>(async (_request, ctx) => {
  const user = await requireApiUser();
  const { id } = await ctx.params;
  const tc = await getCaseById(id, user);
  if (!tc) throw new AppError(404, "CASE_NOT_FOUND", "پرونده یافت نشد.");
  const caseFiles = await getCaseFiles(id);
  // Downloads go through the authorised file-id route; internal storage
  // identifiers are never exposed to clients.
  const safeFiles = caseFiles.map((f) => ({ ...f, downloadUrl: `/api/files/${f.fileId}/download` }));
  return jsonOk({ files: safeFiles });
});

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("cases.files.upload");
  const { id } = await ctx.params;

  // Enforce the size limit before the body is fully buffered: a declared
  // Content-Length beyond limit + multipart overhead is rejected immediately,
  // and the parsed file size is checked again before anything is stored.
  const maxBytes = (await getSettingValue("upload.maxSizeMb")) * 1024 * 1024;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + 1024 * 1024) {
    throw new AppError(413, "FILE_TOO_LARGE", "حجم فایل بیش از حد مجاز است.");
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    throw new AppError(400, "NO_FILE", "فایلی ارسال نشده است.");
  }
  if (file.size === 0) {
    throw new AppError(400, "EMPTY_FILE", "فایل خالی است.");
  }
  if (file.size > maxBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", "حجم فایل بیش از حد مجاز است.");
  }

  const purposeRaw = formData.get("purpose")?.toString() ?? "general";
  if (!(CASE_FILE_PURPOSES as readonly string[]).includes(purposeRaw)) {
    throw new AppError(400, "INVALID_PURPOSE", "نوع فایل مشخص‌شده معتبر نیست.");
  }

  const data = Buffer.from(await file.arrayBuffer());
  const result = await uploadCaseFile(
    id,
    user,
    { data, originalName: file.name || "file" },
    purposeRaw,
    { ip: getClientIp(request), userAgent: getUserAgent(request) },
  );
  return jsonOk(result, { status: 201 });
});
