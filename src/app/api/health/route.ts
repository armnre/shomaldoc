import { sql } from "drizzle-orm";
import { db } from "@/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** Public health probe. Deliberately exposes no secrets, hostnames, or configuration values. */
export async function GET() {
  let dbUp = false;
  try {
    await db.execute(sql`select 1`);
    dbUp = true;
  } catch {
    dbUp = false;
  }
  return Response.json(
    {
      ok: dbUp,
      status: dbUp ? "ok" : "degraded",
      app: "shomaldoc",
      version: pkg.version,
      uptimeSec: Math.round(process.uptime()),
      db: dbUp ? "up" : "down",
      time: new Date().toISOString(),
    },
    { status: dbUp ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
