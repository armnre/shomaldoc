/**
 * Runs once when the Node.js server starts.
 *  1. Validates the environment so a misconfigured deployment fails fast.
 *  2. Starts the in-process scheduler (reminders, escalation, term control).
 *     The scheduler guards itself with a PostgreSQL advisory lock, so running
 *     several instances is safe.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("@/server/env");
  getEnv();

  // Only the server process should run jobs; Next may load instrumentation in
  // edge contexts where the pg pool is unavailable.
  try {
    const { startScheduler } = await import("@/server/scheduler");
    await startScheduler();
  } catch (error) {
    const { logger } = await import("@/server/logger");
    logger.error("scheduler.start_failed", { error });
  }
}
