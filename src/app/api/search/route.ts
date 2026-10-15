import { requireCaseViewApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { searchCases } from "@/server/services/search";
import { searchQuerySchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

/** Global case search within the caller's visibility scope. */
export const GET = apiRoute(async (request: Request) => {
  const user = await requireCaseViewApiUser();
  const url = new URL(request.url);
  const query = searchQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const hits = await searchCases(user, query.q, 25);
  return jsonOk({ hits, term: query.q });
});
