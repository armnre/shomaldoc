import { requireApiUser } from "@/server/auth/current-user";
import { AppError, apiRoute, assertSameOrigin, getClientIp, getUserAgent, jsonOk, parseJson } from "@/server/http";
import {
  isSettingKey,
  listSettingVersions,
  listSettings,
  updateSetting,
} from "@/server/services/settings";
import { settingUpdateSchema } from "@/validations/schemas";

export const dynamic = "force-dynamic";

export const GET = apiRoute(async (request: Request) => {
  await requireApiUser("settings.view");
  const url = new URL(request.url);
  const historyKey = url.searchParams.get("history");
  if (historyKey) {
    if (!isSettingKey(historyKey)) throw new AppError(404, "SETTING_NOT_FOUND", "تنظیم یافت نشد.");
    return jsonOk({ versions: await listSettingVersions(historyKey) });
  }
  return jsonOk({ settings: await listSettings() });
});

export const PUT = apiRoute(async (request: Request) => {
  assertSameOrigin(request);
  const actor = await requireApiUser("settings.manage");
  const input = await parseJson(request, settingUpdateSchema);
  if (!isSettingKey(input.key)) throw new AppError(400, "UNKNOWN_SETTING", "کلید تنظیم نامعتبر است.");
  const result = await updateSetting(actor, input.key, input.value, input.reason, {
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });
  return jsonOk(result);
});
