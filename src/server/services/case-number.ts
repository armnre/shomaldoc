import { sql } from "drizzle-orm";
import type { DbTx } from "@/db";

/**
 * Generates a unique thesis case number using the PostgreSQL sequence.
 *
 * Format: `TH-{jalali_year}-{sequence}`
 * Example: `TH-1405-00001`
 *
 * The sequence is atomic and concurrent-safe. Each year starts a new
 * visual grouping but the sequence itself is global and monotonic.
 *
 * The function executes a single SQL statement inside the caller's
 * transaction, so the number is never double-issued.
 */
export async function generateCaseNumber(tx: DbTx): Promise<string> {
  const result = await tx.execute<{ value: number }>(sql`SELECT nextval('case_number_seq') AS value`);
  const value = result.rows[0].value;
  // Persian calendar year; strip any non-digit suffix (e.g., " AP")
  const raw = new Date().toLocaleDateString("en-US-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
  });
  const jalaliYear = raw.replace(/[^\d]/g, "").slice(0, 4);
  const seq = String(value).padStart(5, "0");
  return `TH-${jalaliYear}-${seq}`;
}