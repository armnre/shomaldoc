import { requireApiUser } from "@/server/auth/current-user";
import { apiRoute, jsonOk } from "@/server/http";
import { lastSchedulerRun, runScheduledJobs } from "@/server/scheduler";

export const dynamic = "force-dynamic";

/**
 * Manual trigger — a monitoring tool only. The scheduler itself runs
 * automatically from instrumentation.ts on an interval.
 */
export const POST = apiRoute(async () => {
  await requireApiUser("settings.manage");
  const result = await runScheduledJobs();
  return jsonOk({ ...result, lastRun: await lastSchedulerRun() });
});

export const GET = apiRoute(async () => {
  await requireApiUser("settings.view");
  return jsonOk({ lastRun: await lastSchedulerRun() });
});
