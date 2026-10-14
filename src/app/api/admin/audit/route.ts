import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { listAuditLogs } from "@/server/services/audit";
import { auditQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("audit.view");
  const url = new URL(request.url);
  const query = auditQuerySchema.parse({
    action: url.searchParams.get("action") ?? undefined,
    page: url.searchParams.get("page") ?? 1,
  });
  const result = await listAuditLogs({
    action: query.action || undefined,
    page: query.page,
    pageSize: 25,
  });
  return jsonOk(result);
});
