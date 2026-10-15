import "dotenv/config";
import { writeFileSync } from "node:fs";
import { pool, db } from "../src/db";
import { thesisCases } from "../src/db/schema";
import { buildCasePdf } from "../src/server/pdf/case-report";
import { getCaseEvents, getCaseFiles, getCaseSupervisors } from "../src/server/services/case";

/**
 * Renders the visual-proof PDF from a REAL stored case: the same code path the
 * download route uses (`buildCasePdf`) over rows that exist in the database.
 * Nothing is invented here; if the database is empty the script says so instead
 * of printing a document with made-up content.
 *
 *   npx tsx scripts/pdf-sample.ts [case-id] [out-file]
 */
async function main() {
  const caseId = process.argv[2];
  const out = process.argv[3] ?? "docs/pdf-sample.pdf";
  const [row] = caseId
    ? await db.select().from(thesisCases).where(eq(thesisCases.id, caseId)).limit(1)
    : await db.select().from(thesisCases).limit(1);
  if (!row) throw new Error("no case in the database; run the acceptance script first (npm run acceptance)");
  const [events, files, supervisors] = await Promise.all([
    getCaseEvents(row.id),
    getCaseFiles(row.id),
    getCaseSupervisors(row.id),
  ]);
  const bytes = await buildCasePdf({ caseRow: row, events, files, supervisors });
  writeFileSync(out, Buffer.from(bytes));
  console.log(
    JSON.stringify({
      ok: true,
      step: "pdf-sample",
      caseNumber: row.caseNumber,
      events: events.length,
      files: files.length,
      supervisors: supervisors.length,
      bytes: bytes.length,
      out,
    }),
  );
}

import { eq } from "drizzle-orm";
main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "pdf-sample", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
