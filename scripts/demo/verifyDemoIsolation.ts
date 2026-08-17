import { isMainModule } from './cli.ts';
import { assertProjectAllowed, parseDemoCliOptions, redactForLog } from './guards.ts';
import { createDemoAdminContext } from './firebaseAdmin.ts';
import { resolveOfficialDemoAuthUser } from './identity.ts';
import { buildCompleteDemoPlan } from './datasets/complete.ts';
import { buildManifest, assertManifestConsistent } from './manifest.ts';
import { loadManifest } from './runner.ts';
import { verifyPersistedPlan } from './verify.ts';
export async function runVerify(argv=process.argv.slice(2)){const o=parseDemoCliOptions(argv);const c=createDemoAdminContext();assertProjectAllowed(c.projectId,o.allowedProjects);const u=await resolveOfficialDemoAuthUser(c.auth);const p=buildCompleteDemoPlan(u.uid);await verifyPersistedPlan(c.db,p);const stored=await loadManifest(c.db);const expected=buildManifest(p);assertManifestConsistent(expected,p);if(stored.checksum!==expected.checksum)throw new Error('Stored demo manifest checksum differs from the deterministic plan.');console.log(redactForLog({status:'verified',projectId:c.projectId,counts:stored.counts,checksum:stored.checksum}))}
if(isMainModule(import.meta.url))runVerify().catch(e=>{console.error(`[demo-verify] ${e instanceof Error?e.message:String(e)}`);process.exitCode=1});
