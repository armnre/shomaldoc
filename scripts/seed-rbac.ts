import "dotenv/config";
import { pool } from "../src/db";
import { seedRbac } from "../src/server/rbac/service";
import { seedWorkflows } from "../src/server/workflows/seed";

Promise.all([seedRbac(), seedWorkflows()])
  .then(([rbac, wf]) => console.log(JSON.stringify({ ok: true, step: "seed", rolesCreated: rbac.rolesCreated, workflowsCreated: wf.created })))
  .catch((error: unknown) => {
    console.error(JSON.stringify({ ok: false, step: "seed-rbac", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
