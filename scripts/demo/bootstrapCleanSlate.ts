/**
 * bootstrapCleanSlate.ts — ONE-TIME live bootstrap unblock.
 *
 * Root cause discovered by actually attempting the live reset (Phase 22):
 * seedDemoData.ts's validatePlanCollisions() refuses to {merge:true}-write
 * over any existing document unless it's already marked with the CURRENT
 * DEMO_SEED_ID (isAuthorizedDemoRecord() in guards.ts checks an exact
 * demoSeedId match, by design — a real safety feature, not a bug).
 * resetDemoData.ts/cleanupDemoData.ts both additionally require a
 * pre-existing "verified manifest" document that only a successful
 * applySeedPlan() run ever creates. The live company-demo-neozy tenant
 * predates all of this tooling (its documents carry demoSeedId:'DEMO_V1',
 * with no manifest ever written) — so every entry point deadlocks: seed
 * refuses to overwrite unmarked-for-this-version data, and reset/cleanup
 * refuse to run without a manifest only seed can create.
 *
 * This script breaks that deadlock exactly once, using only ALREADY
 * REVIEWED, ALREADY TESTED primitives from runner.ts (no new deletion
 * logic invented here) — loadStaleCompanyScopedDocuments() does a plain
 * companyId sweep (the same safe, tenant-isolated pattern already proven
 * in api/demo-reset.ts and wired into resetDemoData.ts/cleanupDemoData.ts
 * in Phase 20), extended here to also cover the identity/foundation
 * collections (companies, roles, users, settings) that a from-scratch
 * seed needs to freely overwrite. user_auth_maps is deliberately excluded
 * — its own collision check already passes (matches on userId/companyId/
 * email, not demoSeedId), and it anchors the live Firebase Auth UID
 * mapping, so it is never touched here.
 *
 * After this runs once successfully, the live tenant is genuinely empty
 * of demo data (identity collections included), and the normal, permanent
 * pipeline (npm run demo:seed --apply, then npm run demo:reset --apply
 * going forward) works exactly as designed, with a real manifest in place.
 * This script is not part of that permanent pipeline and is not meant to
 * be run again.
 */
import { isMainModule } from './cli.ts';
import { DEMO_COMPANY_ID, DEMO_RESETTABLE_COLLECTIONS } from './config.ts';
import { assertDeletionCeiling, assertDestructiveConfirmation, assertProjectAllowed, parseDemoCliOptions, redactForLog } from './guards.ts';
import { createDemoAdminContext } from './firebaseAdmin.ts';
import { deleteDocuments, loadStaleCompanyScopedDocuments } from './runner.ts';

const BOOTSTRAP_EXTRA_COLLECTIONS = ['companies', 'roles', 'users', 'settings'] as const;

export async function runBootstrapCleanSlate(argv = process.argv.slice(2)) {
  const options = parseDemoCliOptions(argv);
  const context = createDemoAdminContext();
  assertProjectAllowed(context.projectId, options.allowedProjects);

  const allCollections = [...DEMO_RESETTABLE_COLLECTIONS, ...BOOTSTRAP_EXTRA_COLLECTIONS];
  const stale = await loadStaleCompanyScopedDocuments(context.db, allCollections, DEMO_COMPANY_ID, new Set());

  const byCollection: Record<string, number> = {};
  for (const doc of stale) byCollection[doc.collection] = (byCollection[doc.collection] || 0) + 1;

  assertDeletionCeiling(stale.length);
  console.log(redactForLog({
    mode: options.apply ? 'apply' : 'dry-run',
    operation: 'bootstrap-clean-slate',
    projectId: context.projectId,
    deleteCount: stale.length,
    byCollection,
  }));

  if (!options.apply) {
    console.log('Dry run complete. Re-run with --apply --confirm=RESET-company-demo-neozy to actually delete.');
    return;
  }
  assertDestructiveConfirmation('reset', options);
  await deleteDocuments(context.db, stale);
  console.log(`Bootstrap clean slate complete — ${stale.length} stale documents removed across ${Object.keys(byCollection).length} collections. Run "npm run demo:seed -- --apply" next.`);
}

if (isMainModule(import.meta.url)) {
  runBootstrapCleanSlate().catch((e) => {
    console.error(`[demo-bootstrap-clean-slate] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
