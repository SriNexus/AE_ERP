import {buildCompleteDemoPlan} from './datasets/complete.ts';
import {buildManifest} from './manifest.ts';
import {summarizePlan} from './runner.ts';
import {assertPlanVerified} from './verify.ts';
const plan=buildCompleteDemoPlan('DRY-RUN-PLAN-ONLY-AUTH-UID');assertPlanVerified(plan);const manifest=buildManifest(plan);console.log(JSON.stringify({mode:'plan-only',writes:false,companyId:manifest.companyId,seedVersion:manifest.seedVersion,total:plan.documents.length,counts:summarizePlan(plan),checksum:manifest.checksum},null,2));