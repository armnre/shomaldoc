import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, jsonOk } from "@/server/http";
import { markRead } from "@/server/services/notifications";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = apiRoute<Ctx>(async (request, ctx) => {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "اعلان یافت نشد.");
  const changed = await markRead(user.id, id);
  if (!changed) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "اعلان یافت نشد.");
  return jsonOk({ read: true });
});
