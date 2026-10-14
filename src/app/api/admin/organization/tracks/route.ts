import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import { createTrack, listTracks } from "@/server/services/organization";
import { createTrackSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("org.view");
  const fieldId = new URL(request.url).searchParams.get("fieldId");
  return jsonOk({ tracks: await listTracks(fieldId ? Number(fieldId) : undefined) });
});

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser("org.manage");
  const input = await parseJson(request, createTrackSchema);
  return jsonOk(await createTrack(user, input, { ip: getClientIp(request), userAgent: getUserAgent(request) }), { status: 201 });
});
