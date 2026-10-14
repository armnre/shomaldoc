import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { listDefinitions } from "@/server/services/workflow-admin";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  await requireApiUser("workflow.view");
  return jsonOk({ definitions: await listDefinitions() });
});
