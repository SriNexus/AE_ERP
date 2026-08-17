import {randomUUID} from 'node:crypto';
import { isMainModule } from './cli.ts';
import { DEMO_COMPANY_ID, DEMO_RESETTABLE_COLLECTIONS } from './config.ts';
import { assertDeletionCeiling, assertDestructiveConfirmation, assertProjectAllowed, assertSafeDeleteDocument, parseDemoCliOptions, redactForLog } from './guards.ts';
import { createDemoAdminContext } from './firebaseAdmin.ts';
import { resolveOfficialDemoAuthUser } from './identity.ts';
import { buildCompleteDemoPlan } from './datasets/complete.ts';
import { buildManifest } from './manifest.ts';
import { applySeedPlan, deleteDocuments, loadManifest, loadSafeDeletionDocuments, loadStaleCompanyScopedDocuments } from './runner.ts';
import {acquireResetLease,finishResetLease,firestoreResetLeaseStore,type ResetLease} from './resetLease.ts';
// Phase 20: the CLI/GitHub-Actions reset path used to only ever delete
// documents whose id is part of the CURRENT canonical plan (loadSafeDeletionDocuments
// looks each planned id up individually) — a record left behind by an older
// generator version, or created by a user's own demo-mode CRUD testing, has
// an id the current plan never mentions and was therefore never reachable,
// no matter how many resets ran. api/demo-reset.ts (the client/login-triggered
// path) never had this gap — it already does a plain companyId sweep per
// collection. loadStaleCompanyScopedDocuments() below closes the same gap
// here, so the scheduled/manual GitHub Actions reset is a genuine complete
// wipe of the demo tenant, not merely a refresh of records the plan already
// knows about.
export async function runReset(argv=process.argv.slice(2)){const o=parseDemoCliOptions(argv);const c=createDemoAdminContext();assertProjectAllowed(c.projectId,o.allowedProjects);const u=await resolveOfficialDemoAuthUser(c.auth);const p=buildCompleteDemoPlan(u.uid);const storedManifest=await loadManifest(c.db);if(storedManifest.checksum!==buildManifest(p).checksum)throw new Error('Verified manifest does not match the deterministic complete Demo plan.');const resettable=new Set<string>(DEMO_RESETTABLE_COLLECTIONS);const planned=p.documents.filter(d=>resettable.has(d.collection)&&!d.preserveOnReset).reverse();for(const d of planned)assertSafeDeleteDocument(d);const candidates=await loadSafeDeletionDocuments(c.db,planned);const candidateKeys=new Set(candidates.map(d=>`${d.collection}/${d.id}`));const stale=await loadStaleCompanyScopedDocuments(c.db,DEMO_RESETTABLE_COLLECTIONS,DEMO_COMPANY_ID,candidateKeys);const allDeletions=[...candidates,...stale];assertDeletionCeiling(allDeletions.length);console.log(redactForLog({mode:o.apply?'apply':'dry-run',operation:'reset',deleteCount:allDeletions.length,plannedDeleteCount:candidates.length,staleDeleteCount:stale.length}));if(!o.apply)return;assertDestructiveConfirmation('reset',o);const store=firestoreResetLeaseStore(c.db);let lease:ResetLease|undefined;try{lease=await acquireResetLease(store,randomUUID());await c.auth.revokeRefreshTokens(u.uid);await deleteDocuments(c.db,allDeletions);await applySeedPlan(c.db,p);await finishResetLease(store,lease,'complete');console.log('Complete Demo baseline reset, persisted verification, and manifest finalization succeeded.')}catch(error){if(lease)await finishResetLease(store,lease,'failed',error instanceof Error?error.message:String(error)).catch(()=>undefined);throw error}}
if(isMainModule(import.meta.url))runReset().catch(e=>{console.error(`[demo-reset] ${e instanceof Error?e.message:String(e)}`);process.exitCode=1});