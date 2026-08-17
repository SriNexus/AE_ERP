import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID, DEMO_ERP_USER_ID, DEMO_SEED_ID, OFFICIAL_DEMO_EMAIL, DEMO_MAX_DELETIONS, demoDocumentId } from '../../../scripts/demo/config.ts';
import { assertDeletionCeiling, assertDestructiveConfirmation, assertNoForeignCollision, assertNoForbiddenFields, assertProjectAllowed, parseDemoCliOptions } from '../../../scripts/demo/guards.ts';
import { buildFoundationPlan, buildIdentityDocuments, buildSafeSettingsDocuments } from '../../../scripts/demo/datasets/foundation.ts';
import { buildManifest, assertManifestConsistent } from '../../../scripts/demo/manifest.ts';
import { verifyPlan } from '../../../scripts/demo/verify.ts';

describe('trusted Demo Mode tooling',()=>{
 it('uses immutable official identities and deterministic IDs',()=>{expect(DEMO_COMPANY_ID).toBe('company-demo-neozy');expect(DEMO_ERP_USER_ID).toBe('MUSR-DEMO-0001');expect(DEMO_SEED_ID).toBe('DEMO_V3');expect(OFFICIAL_DEMO_EMAIL).toBe('demo@neozy.in');expect(demoDocumentId('prd',1)).toBe('DEMO-V1-PRD-001')});
 it('is dry-run by default and requires explicit destructive confirmation',()=>{const dry=parseDemoCliOptions([],{} as NodeJS.ProcessEnv);expect(dry.apply).toBe(false);expect(()=>assertDestructiveConfirmation('reset',dry)).toThrow('Dry-run');const apply=parseDemoCliOptions(['--apply'],{} as NodeJS.ProcessEnv);expect(()=>assertDestructiveConfirmation('reset',apply)).toThrow('--confirm=')});
 it('requires an exact non-empty project allowlist',()=>{expect(()=>assertProjectAllowed('project-a',[])).toThrow('allowlisted');expect(()=>assertProjectAllowed('project-a',['project-b'])).toThrow('allowlisted');expect(()=>assertProjectAllowed('project-a',['project-a'])).not.toThrow()});
 it('builds an idempotent unique foundation plan',()=>{const a=buildFoundationPlan('auth-uid');const b=buildFoundationPlan('auth-uid');expect(a).toEqual(b);expect(a.documents).toHaveLength(90);expect(new Set(a.documents.map(d=>`${d.collection}/${d.id}`)).size).toBe(90);expect(verifyPlan(a)).toEqual([]);expect(()=>assertNoForbiddenFields(a.documents)).not.toThrow()});
 // Phase 12: each demo Employee now links to a real demo User (Employee.userId),
 // matching EmployeeDomainService.create()'s real resolveOrCreateMasterUser()
 // behavior — previously these 10 documents had no linked User at all, so
 // "which warehouse does this employee work at" / "who is their reporting
 // manager" were structurally unanswerable in Demo Mode.
 it('links every demo Employee to a real demo User carrying warehouseId/managerId, with an uneven warehouse split and a genuine 2-level manager chain',()=>{
   const plan=buildFoundationPlan('auth-uid');
   const employees=plan.documents.filter(d=>d.collection==='employees');
   const users=plan.documents.filter(d=>d.collection==='users');
   const warehouses=plan.documents.filter(d=>d.collection==='warehouses');
   const usersById=new Map(users.map(u=>[u.id,u]));
   const warehouseIds=new Set(warehouses.map(w=>w.id));
   expect(employees).toHaveLength(10);
   expect(employees.every(e=>typeof e.data.userId==='string'&&usersById.has(e.data.userId as string))).toBe(true);
   const linkedUsers=employees.map(e=>usersById.get(e.data.userId as string)!);
   expect(linkedUsers.every(u=>typeof u.data.warehouseId==='string'&&warehouseIds.has(u.data.warehouseId as string))).toBe(true);
   const warehouseCounts=new Map<string,number>();
   linkedUsers.forEach(u=>warehouseCounts.set(u.data.warehouseId as string,(warehouseCounts.get(u.data.warehouseId as string)||0)+1));
   expect(new Set(warehouseCounts.values()).size).toBeGreaterThan(1); // genuinely uneven, not a flat split
   const topLevelManagerIds=new Set(linkedUsers.filter(u=>u.data.managerId&&!linkedUsers.some(m=>m.id===u.data.managerId)).map(u=>u.data.managerId));
   expect(topLevelManagerIds.size).toBeGreaterThan(0); // at least one report chains up to an outside (assignee) manager -> genuine 2nd level
 });
 it('refuses unmarked collisions while accepting marked demo records',()=>{const d=buildFoundationPlan('auth-uid').documents.find(x=>x.collection==='products')!;expect(()=>assertNoForeignCollision(d,{exists:true,data:{companyId:'production'}})).toThrow('Unmarked');expect(()=>assertNoForeignCollision(d,{exists:true,data:{companyId:DEMO_COMPANY_ID,isDemo:true,demoSeedId:DEMO_SEED_ID}})).not.toThrow()});
 it('validates canonical identity and prevents demo super-admin',()=>{const docs=buildIdentityDocuments('auth-uid');const user=docs.find(d=>d.id===DEMO_ERP_USER_ID)!;expect(user.data.isSuperAdmin).toBe(false);const map=docs.find(d=>d.collection==='user_auth_maps')!;expect(map.data).toMatchObject({authUid:'auth-uid',userId:DEMO_ERP_USER_ID,companyId:DEMO_COMPANY_ID,email:OFFICIAL_DEMO_EMAIL})});
 it('keeps company and personal settings in their canonical scopes',()=>{const docs=buildSafeSettingsDocuments();expect(docs).toHaveLength(6);expect(docs.filter(d=>d.id.startsWith(DEMO_COMPANY_ID))).toHaveLength(4);expect(docs.filter(d=>d.id.startsWith(DEMO_ERP_USER_ID))).toHaveLength(2);expect(JSON.stringify(docs)).not.toMatch(/smtpPassword|apiKey|accessToken|refreshToken/i)});
 it('builds a consistent stable manifest',()=>{const p=buildFoundationPlan('auth-uid');const a=buildManifest(p);const b=buildManifest(p);expect(a.checksum).toBe(b.checksum);expect(a.counts.products).toBe(15);expect(()=>assertManifestConsistent(a,p)).not.toThrow()});
 it('enforces maximum deletion ceilings',()=>{expect(()=>assertDeletionCeiling(DEMO_MAX_DELETIONS)).not.toThrow();expect(()=>assertDeletionCeiling(DEMO_MAX_DELETIONS+1)).toThrow('ceiling')});
});
