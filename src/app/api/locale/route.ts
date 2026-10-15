import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { embedCookieAttributes } from "@/server/env";
import { AppError, apiRoute, assertSameOrigin, jsonOk, parseJson } from "@/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const localeBody = z.object({ locale: z.string() });

export const POST = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const body = await parseJson(request, localeBody);
  if (!isLocale(body.locale)) throw new AppError(400, "INVALID_LOCALE", "زبان نامعتبر است.");
  const store = await cookies();
  store.set(LOCALE_COOKIE, body.locale, {
    path: "/",
    ...embedCookieAttributes(),
    maxAge: 60 * 60 * 24 * 365,
  });
  return jsonOk({ locale: body.locale });
});
