import "dotenv/config";
import { pool } from "../src/db";
import { seedRbac } from "../src/server/rbac/service";
import { seedWorkflows } from "../src/server/workflows/seed";
import { seedDefaultProposalForm } from "../src/server/services/forms";
import { listSettings } from "../src/server/services/settings";

/**
 * Production seed: reference data only.
 *
 * It must be safe to run on every deploy and must never create demo accounts,
 * fake students or test passwords — production starts with exactly one
 * administrator, created by `admin:bootstrap` from a root-only bootstrap file.
 * Everything here is idempotent: existing rows win, nothing is overwritten.
 */
async function main() {
  const rbac = await seedRbac();
  const workflow = await seedWorkflows();
  // Settings are effective even without rows (defaults live in SETTING_DEFS); the
  // count is reported so an operator can see how many keys the deploy exposes.
  const settings = await listSettings();
  const form = await seedDefaultProposalForm(null);
  console.log(
    JSON.stringify({
      ok: true,
      step: "seed-prod",
      rolesCreated: rbac.rolesCreated,
      workflowsCreated: workflow.created,
      settingsAvailable: settings.length,
      proposalForm: form.created ? "created" : "kept",
      demoData: "none",
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({ ok: false, step: "seed-prod", message: error instanceof Error ? error.message : "unknown" }),
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
