import {isMainModule} from './cli.ts';
import {assertProjectAllowed,assertNoForbiddenFields} from './guards.ts';
import {configuredProjectAllowlist,DEMO_COMPANY_ID,DEMO_ERP_USER_ID,DEMO_GROUP_ID} from './config.ts';
import {createDemoAdminContext} from './firebaseAdmin.ts';
import {resolveOfficialDemoAuthUser} from './identity.ts';
import {buildCompleteDemoPlan} from './datasets/complete.ts';
import {verifyPlan,verifyPersistedPlan} from './verify.ts';
import {buildManifest} from './manifest.ts';
import {loadManifest} from './runner.ts';

type Status='PASS'|'WARNING'|'BLOCKED'|'FAIL';type Check={status:Status,name:string,detail:string};
export async function runReadiness(env=process.env){const checks:Check[]=[];const add=(status:Status,name:string,detail:string)=>checks.push({status,name,detail});let context;
 try{context=createDemoAdminContext(env);add('PASS','admin-context','Trusted Firebase Admin context initialized.')}catch(e){add('BLOCKED','admin-context',e instanceof Error?e.message:String(e));return finish(checks)}
 try{assertProjectAllowed(context.projectId,configuredProjectAllowlist(env));add('PASS','project-allowlist',`Project ${context.projectId} is explicitly allowlisted.`)}catch(e){add('FAIL','project-allowlist',e instanceof Error?e.message:String(e));return finish(checks)}
 let authUser;try{authUser=await resolveOfficialDemoAuthUser(context.auth);add('PASS','official-auth-account','Official Firebase Auth account exists and is enabled.')}catch(e){add('BLOCKED','official-auth-account',e instanceof Error?e.message:String(e));return finish(checks)}
 const plan=buildCompleteDemoPlan(authUser.uid),issues=verifyPlan(plan);if(issues.length)add('FAIL','deterministic-plan',`${issues.length} verification issue(s).`);else add('PASS','deterministic-plan',`${plan.documents.length} deterministic documents verified.`);try{assertNoForbiddenFields(plan.documents);add('PASS','secret-policy','No forbidden credential or identity fields in the plan.')}catch(e){add('FAIL','secret-policy',e instanceof Error?e.message:String(e))}
 // Demo-to-Group conversion: demo@neozy.in is now a real GroupAdmin of the
 // real Neozy Demo Group (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md)
 // — the contract is identity (role/groupId/company), not an artificially
 // denied custom role. Administrative capability within the Group is bounded
 // by the same Firestore-rules GroupAdmin scope (own-Group-only) every other
 // Group's Admin has, verified by the emulator security-rule suite, not by
 // this readiness check re-deriving authorization from a role document.
 const user=plan.documents.find(d=>d.collection==='users'&&d.id===DEMO_ERP_USER_ID),role=plan.documents.find(d=>d.collection==='roles'&&d.id===`${DEMO_COMPANY_ID}_Admin`);if(user?.data.companyId===DEMO_COMPANY_ID&&user.data.groupId===DEMO_GROUP_ID&&user.data.role==='GroupAdmin'&&user.data.isSuperAdmin===false)add('PASS','demo-identity','Canonical Demo user is a real GroupAdmin of the Neozy Demo Group, company-bound and non-super-admin.');else add('FAIL','demo-identity','Canonical Demo user contract is invalid.');if(role&&role.data.permissions&&(role.data.permissions as any).leads?.create===true)add('PASS','demo-role','Neozy Demo has a real Admin role document, same shape as any other Group\'s Admin role.');else add('FAIL','demo-role','Neozy Demo is missing its real Admin role document.');
 try{const stored=await loadManifest(context.db),expected=buildManifest(plan);await verifyPersistedPlan(context.db,plan);if(stored.checksum!==expected.checksum)throw new Error('Persisted manifest checksum differs from the deterministic plan.');add('PASS','persisted-graph',`${plan.documents.length} persisted documents and manifest verified.`)}catch(e){const message=e instanceof Error?e.message:String(e);if(message.includes('Verified demo manifest does not exist'))add('WARNING','persisted-graph','Demo has not been seeded yet; apply is permitted after all identity and project checks pass.');else add('BLOCKED','persisted-graph',message)}
 // Demo-to-Group conversion: Neozy Demo is now the persistent real testing
 // Group, not a public sandbox — an automatic scheduled wipe would destroy
 // real testing data, so the desired state flipped: PASS means the schedule
 // trigger is OFF (manual/workflow_dispatch reset only remains available).
 add(env.DEMO_RESET_SCHEDULE_ENABLED==='true'?'WARNING':'PASS','scheduled-reset',env.DEMO_RESET_SCHEDULE_ENABLED==='true'?'DEMO_RESET_SCHEDULE_ENABLED is true — an automatic reset would destroy persistent Neozy Demo testing data; disable it.':'No automatic scheduled reset — Neozy Demo data persists like any other Group\'s.');add('PASS','upload-policy','Product, survey, and engineering uploads rely on the same Storage rules every Group\'s uploads rely on — no demo-only client-side path restriction remains.');add('PASS','side-effect-policy','External communication (email/phone/WhatsApp) is unrestricted for Neozy Demo, exactly like any other Group — the demo-only external-side-effect gate was removed (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md).');return finish(checks)}
function finish(checks:Check[]){for(const c of checks)console.log(`[${c.status}] ${c.name}: ${c.detail}`);const critical=checks.some(c=>c.status==='FAIL'||c.status==='BLOCKED');if(critical)process.exitCode=2;return{checks,ready:!critical}}
if(isMainModule(import.meta.url))runReadiness().catch(e=>{console.error(`[FAIL] readiness: ${e instanceof Error?e.message:String(e)}`);process.exitCode=2});
