import "dotenv/config";
import { pool } from "../src/db";
import { seedDefaultProposalForm } from "../src/server/services/forms";

/**
 * Seeds the default proposal form definition (version 1, published) when no
 * `proposal` definition exists yet. Idempotent: an existing definition is left
 * untouched, so administrator edits are never overwritten.
 */
async function main() {
  const result = await seedDefaultProposalForm(null);
  console.log(JSON.stringify({ ok: true, step: "seed-forms", ...result }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "seed-forms", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
