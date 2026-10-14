import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  __shomaldocPool?: Pool;
};

export const pool =
  globalForDb.__shomaldocPool ??
  new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__shomaldocPool = pool;
}

export const db = drizzle(pool, { schema });
export type Db = typeof db;
/** Transaction handle type; helpers accept `DbLike` so they work with both `db` and `tx`. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Pick<DbTx, "select" | "insert" | "update" | "delete">;
