import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(JSON.stringify({ ok: true, step: "migrate" }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "migrate", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
