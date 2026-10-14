import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { listProfessorCapacities, getProfessorCapacity } from "@/server/services/capacity";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("cases.view_own");
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (userId) return jsonOk({ capacity: await getProfessorCapacity(userId) });
  const departmentId = url.searchParams.get("departmentId");
  const fieldId = url.searchParams.get("fieldId");
  const rows = await listProfessorCapacities({
    departmentId: departmentId ? Number(departmentId) : undefined,
    fieldId: fieldId ? Number(fieldId) : undefined,
  });
  return jsonOk({ capacities: rows });
});
