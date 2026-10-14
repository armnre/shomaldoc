import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk } from "@/server/http";
import { publishFormVersion } from "@/server/services/forms";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser("forms.manage");
  const { id } = await ctx.params;
  const published = await publishFormVersion(user, Number(id), {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(published);
});
