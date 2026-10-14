import { getCurrentUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Does the browser present a valid session right now?
 *
 * The login form calls this immediately after a successful password check. A 200
 * from `/api/auth/login` only proves the credentials were right; if the browser
 * refused to store the session cookie (a third-party iframe with third-party
 * cookie blocking, or a plain-http origin) the next page request would silently
 * bounce back to the login screen. This endpoint turns that invisible failure
 * into an explicit, actionable message instead of a loop.
 *
 * It exposes nothing beyond "there is a session" and whether the holder must
 * change their password.
 */
export const GET = apiRoute(async () => {
  const user = await getCurrentUser();
  return jsonOk({ authenticated: user !== null, mustChangePassword: user?.mustChangePassword ?? false });
});
