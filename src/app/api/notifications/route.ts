import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { listNotifications, markAllRead, unreadCount } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  const [items, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  return jsonOk({ items, unread });
});

/** Marks every notification of the caller as read (own data only). */
export const POST = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "read-all") {
    return jsonOk({ marked: await markAllRead(user.id) });
  }
  return jsonOk({ unread: await unreadCount(user.id) });
});
