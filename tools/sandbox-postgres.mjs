/**
 * SANDBOX/CI ONLY — not part of the shipped application.
 *
 * A throw-away PostgreSQL for local previews and CI runs, where no system
 * PostgreSQL exists. It uses the `embedded-postgres` package, which is
 * deliberately NOT an application dependency (the production host uses its own
 * PostgreSQL 16 behind the app; see docs/deployment-fa.md).
 *
 * Setup (outside the app tree so the application lockfile stays untouched):
 *   mkdir -p /home/user/pgsrv && cd /home/user/pgsrv
 *   npm init -y && npm install embedded-postgres
 *   cp <repo>/tools/sandbox-postgres.mjs /home/user/pgsrv/server.mjs
 *   node /home/user/pgsrv/server.mjs
 *
 * Local PostgreSQL 18 for the sandbox preview.
 *
 * The sandbox has no system PostgreSQL, so the cluster runs from the
 * embedded-postgres binaries. Data lives in /home/user/pgdata (persistent: the
 * cluster is NOT deleted on shutdown). Start it with:
 *
 *   node /home/user/pgsrv/server.mjs
 *
 * It initialises the cluster on first run, starts it, and makes sure the
 * application database exists. Keep this process alive: postgres is a child of
 * it and the app connects to 127.0.0.1:5432.
 */
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = process.env.PGDATA_DIR ?? "/home/user/pgdata";
const PORT = Number(process.env.PGPORT ?? 5432);
const USER = "postgres";
const PASSWORD = "postgres";
const APP_DB = "app_db";

const log = (message) => process.stdout.write(`[pg] ${message}\n`);

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: USER,
  password: PASSWORD,
  persistent: true,
  onLog: (message) => log(String(message).trim()),
  onError: (error) => process.stderr.write(`[pg:error] ${error instanceof Error ? error.message : String(error)}\n`),
});

if (!existsSync(`${DATA_DIR}/PG_VERSION`)) {
  log(`initialising a new cluster in ${DATA_DIR}`);
  await pg.initialise();
} else {
  log(`using the existing cluster in ${DATA_DIR}`);
}

await pg.start();
log(`listening on 127.0.0.1:${PORT}`);

try {
  await pg.createDatabase(APP_DB);
  log(`created database ${APP_DB}`);
} catch (error) {
  if (String(error?.message ?? error).includes("already exists")) log(`database ${APP_DB} already exists`);
  else throw error;
}

// Verify with a real connection before declaring readiness.
const client = pg.getPgClient(APP_DB);
await client.connect();
const { rows } = await client.query("select version() as version, current_database() as db");
await client.end();
log(`${rows[0].db}: ${String(rows[0].version).split(",")[0]}`);

const shutdown = async (signal) => {
  log(`received ${signal}; stopping the cluster`);
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Keep the wrapper alive so postgres keeps running.
setInterval(() => {}, 1 << 30);
