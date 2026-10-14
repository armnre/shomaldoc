import { eq } from "drizzle-orm";
import { db } from "@/db";
import { files, thesisCaseFiles, thesisCases } from "@/db/schema";
import { AppError } from "@/server/http";
import { canViewCase } from "./case";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DownloadActor {
  id: string;
  permissions: readonly string[];
  roles: ReadonlyArray<{ key: string } | string>;
}

export interface DownloadableFile {
  file: typeof files.$inferSelect;
  caseId: string;
}

/**
 * Resolves a file for download with full authorisation.
 *
 * The file id is only an identifier — never an authorisation token. Access
 * requires the `cases.files.download` permission plus verified visibility of
 * the case the file belongs to. Missing, malformed or inactive files produce
 * an indistinguishable 404; a visible file on an inaccessible case produces
 * 403 and no bytes are ever returned by this layer.
 */
export async function resolveDownloadableFile(fileId: string, actor: DownloadActor): Promise<DownloadableFile> {
  if (!UUID_PATTERN.test(fileId)) {
    throw new AppError(404, "FILE_NOT_FOUND", "فایل مورد نظر یافت نشد.");
  }

  const access = {
    permissions: new Set(actor.permissions),
    roleKeys: new Set(actor.roles.map((r) => (typeof r === "string" ? r : r.key))),
  };
  if (!access.permissions.has("cases.files.download")) {
    throw new AppError(403, "FORBIDDEN", "مجوز دانلود فایل را ندارید.", { permission: "cases.files.download" });
  }

  const [row] = await db
    .select({ file: files, caseId: thesisCaseFiles.caseId, thesisCase: thesisCases })
    .from(files)
    .innerJoin(thesisCaseFiles, eq(thesisCaseFiles.fileId, files.id))
    .innerJoin(thesisCases, eq(thesisCases.id, thesisCaseFiles.caseId))
    .where(eq(files.id, fileId))
    .limit(1);

  if (!row || row.file.status !== "active") {
    throw new AppError(404, "FILE_NOT_FOUND", "فایل مورد نظر یافت نشد.");
  }

  if (!(await canViewCase(access, actor.id, row.thesisCase))) {
    throw new AppError(403, "FORBIDDEN", "دسترسی به این فایل ندارید.");
  }

  return { file: row.file, caseId: row.caseId };
}
