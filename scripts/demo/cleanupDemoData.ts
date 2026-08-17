import { isMainModule } from './cli.ts';
import { DEMO_COMPANY_ID, DEMO_MANIFEST_COLLECTION, DEMO_MANIFEST_ID, DEMO_RESETTABLE_COLLECTIONS } from './config.ts';
import { assertDeletionCeiling, assertDestructiveConfirmation, assertProjectAllowed, assertSafeDeleteDocument, parseDemoCliOptions, redactForLog } from './guards.ts';
import { createDemoAdminContext } from './firebaseAdmin.ts';
import { resolveOfficialDemoAuthUser } from './identity.ts';
import { buildCompleteDemoPlan } from './datasets/complete.ts';
import { buildManifest } from './manifest.ts';
import { deleteDocuments, loadManifest, loadSafeDeletionDocuments, loadStaleCompanyScopedDocuments } from './runner.ts';
// Phase 20: same fix as resetDemoData.ts — loadSafeDeletionDocuments() only
// ever looks up the current plan's own ids, so a stale record with a
// different id would survive even a full cleanup. Adding the same
// content-based companyId sweep here for consistency.
export async function runCleanup(argv=process.argv.slice(2)){const o=parseDemoCliOptions(argv);const c=createDemoAdminContext();assertProjectAllowed(c.projectId,o.allowedProjects);const u=await resolveOfficialDemoAuthUser(c.auth);const p=buildCompleteDemoPlan(u.uid);const storedManifest=await loadManifest(c.db);if(storedManifest.checksum!==buildManifest(p).checksum)throw new Error('Verified manifest does not match the deterministic complete Demo plan.');for(const d of p.documents)if(d.collection!=='user_auth_maps')assertSafeDeleteDocument(d);const candidates=await loadSafeDeletionDocuments(c.db,p.documents);const candidateKeys=new Set(candidates.map(d=>`${d.collection}/${d.id}`));const stale=await loadStaleCompanyScopedDocuments(c.db,DEMO_RESETTABLE_COLLECTIONS,DEMO_COMPANY_ID,candidateKeys);const allDeletions=[...candidates,...stale];assertDeletionCeiling(allDeletions.length+1);console.log(redactForLog({mode:o.apply?'apply':'dry-run',operation:'cleanup-including-firestore-identity',deleteCount:allDeletions.length+1,plannedDeleteCount:candidates.length,staleDeleteCount:stale.length,firebaseAuthAccount:'preserved'}));if(!o.apply)return;assertDestructiveConfirmation('cleanup',o);await c.auth.revokeRefreshTokens(u.uid);await deleteDocuments(c.db,[...allDeletions].reverse());await c.db.collection(DEMO_MANIFEST_COLLECTION).doc(DEMO_MANIFEST_ID).delete();console.log('Demo Firestore identity and data removed. Firebase Auth account was preserved.')}
if(isMainModule(import.meta.url))runCleanup().catch(e=>{console.error(`[demo-cleanup] ${e instanceof Error?e.message:String(e)}`);process.exitCode=1});
