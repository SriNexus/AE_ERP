import { isMainModule } from './cli.ts';
import { assertProjectAllowed, parseDemoCliOptions, redactForLog } from './guards.ts';
import { createDemoAdminContext } from './firebaseAdmin.ts';
import { resolveOfficialDemoAuthUser } from './identity.ts';
import { buildCompleteDemoPlan } from './datasets/complete.ts';
import { applySeedPlan, summarizePlan, validatePlanCollisions } from './runner.ts';

export async function runSeed(argv=process.argv.slice(2)){
 const options=parseDemoCliOptions(argv);const context=createDemoAdminContext();assertProjectAllowed(context.projectId,options.allowedProjects);
 const authUser=await resolveOfficialDemoAuthUser(context.auth);const plan=buildCompleteDemoPlan(authUser.uid);
 await validatePlanCollisions(context.db,plan);
 console.log(redactForLog({mode:options.apply?'apply':'dry-run',projectId:context.projectId,authUid:'[REDACTED]',counts:summarizePlan(plan)}));
 if(!options.apply){console.log('Dry run complete. Re-run with --apply to write.');return}
 const manifest=await applySeedPlan(context.db,plan);console.log(redactForLog({status:'seeded-and-verified',checksum:manifest.checksum,counts:manifest.counts}));
}
if(isMainModule(import.meta.url))runSeed().catch(e=>{console.error(`[demo-seed] ${e instanceof Error?e.message:String(e)}`);process.exitCode=1});
