import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createDepartment, createFaculty, listDepartments, listFaculties } from "@/server/services/organization";
import { createDepartmentSchema, createFacultySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  await requireApiUser("org.view");
  const [faculties, departments] = await Promise.all([listFaculties(), listDepartments()]);
  return jsonOk({ faculties, departments });
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const ctx = { ip: getClientIp(request), userAgent: getUserAgent(request) };

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "faculty") {
    const input = await parseJson(request, createFacultySchema);
    return jsonOk(await createFaculty(user, input, ctx), { status: 201 });
  }
  if (kind === "department") {
    const input = await parseJson(request, createDepartmentSchema);
    return jsonOk(await createDepartment(user, input, ctx), { status: 201 });
  }
  throw new AppError(400, "INVALID_KIND", "نوع درخواست نامعتبر است.");
});
