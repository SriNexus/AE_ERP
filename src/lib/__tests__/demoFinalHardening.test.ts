import {describe,expect,it} from 'vitest';
import {isCanonicalDemoIdentity} from '../demoCapabilityPolicy';
import {DEMO_COMPANY_ID,DEMO_ERP_USER_ID} from '../../config/demo';
import {createLease,DEMO_RESET_LEASE_MS,type ResetLease} from '../../../scripts/demo/resetLease.ts';
import {buildCompleteDemoPlan} from '../../../scripts/demo/datasets/complete.ts';
import {verifyPlan} from '../../../scripts/demo/verify.ts';
import {readFileSync} from 'node:fs';

describe('final public Demo hardening',()=>{
 // Demo-to-Group conversion (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md):
 // Neozy Demo is a real Group now — the entire capability-gating mechanism
 // (business-crud/company-scoped-upload/external-side-effect and every
 // category before it) was removed, not narrowed. Business CRUD, storage
 // uploads, and external communication (email/phone/WhatsApp) all run
 // through the exact same production code path as any other Group; nothing
 // in this codebase branches on "is this the demo company" to restrict a
 // capability anymore. `isCanonicalDemoIdentity` survives only as a pure,
 // non-restrictive identity check for the informational "Demo Mode" badge.
 it('no capability-gating mechanism remains anywhere in the app', () => {
   const demoCapabilityPolicySrc = readFileSync('src/lib/demoCapabilityPolicy.ts', 'utf8');
   expect(demoCapabilityPolicySrc).not.toContain('isDemoCapabilityAllowed');
   expect(demoCapabilityPolicySrc).not.toContain('assertDemoCapability');
   expect(demoCapabilityPolicySrc).not.toContain('DemoCapability');
   const emailRuntimeSrc = readFileSync('src/features/settings/emailRuntime.ts', 'utf8');
   expect(emailRuntimeSrc).not.toContain('isDemoCapabilityAllowed');
   const firestoreSrc = readFileSync('src/lib/firestore.ts', 'utf8');
   expect(firestoreSrc).not.toContain('enforceDemoRecordLimit');
 });
 it('recognizes only the canonical Demo identity',()=>{expect(isCanonicalDemoIdentity({companyId:DEMO_COMPANY_ID,id:DEMO_ERP_USER_ID,isDemo:true})).toBe(true);expect(isCanonicalDemoIdentity({companyId:DEMO_COMPANY_ID,id:'OTHER'})).toBe(false)});
 it('refuses overlapping reset leases and recovers stale leases',()=>{const now=new Date('2026-07-13T00:00:00Z'),active=createLease('run-a',now);expect(Date.parse(active.expiresAt)-now.getTime()).toBe(DEMO_RESET_LEASE_MS);expect(()=>createLease('run-b',new Date(now.getTime()+1000),active)).toThrow('already running');const stale={...active,expiresAt:new Date(now.getTime()-1).toISOString()} as ResetLease;expect(createLease('run-b',now,stale).owner).toBe('run-b');expect(createLease('run-c',now,{...active,status:'failed'}).owner).toBe('run-c')});
 it('keeps the complete graph UI-compatible at high-risk boundaries',()=>{const plan=buildCompleteDemoPlan('AUTH');expect(verifyPlan(plan)).toEqual([]);for(const collection of ['leads','customers','projects','quotations','orders','proforma_invoices','payments','purchase_orders','stock','dispatch','qc_checks','commissioning_records','tasks','notifications'])expect(plan.documents.some(d=>d.collection===collection)).toBe(true);expect(plan.documents.filter(d=>d.collection==='projects').every(d=>Array.isArray(d.data.stageHistory)&&d.data.name&&d.data.customerId)).toBe(true);expect(plan.documents.filter(d=>d.collection==='engineering_designs').every(d=>d.data.systemCapacityKw&&d.data.revisionNumber===1)).toBe(true);expect(plan.documents.filter(d=>d.collection==='commissioning_records').every(d=>typeof d.data.generationTestKwh==='number')).toBe(true);expect(plan.documents.filter(d=>d.collection==='generation_readings').every(d=>typeof d.data.readingKwh==='number'&&d.data.recordedBy)).toBe(true);expect(plan.documents.filter(d=>d.collection==='tasks').every(d=>d.data.assignedToId&&d.data.createdBy)).toBe(true);expect(plan.documents.filter(d=>d.collection==='notifications').every(d=>Array.isArray(d.data.visibleTo)&&d.data.body&&typeof d.data.isRead==='boolean')).toBe(true)});
 // Demo-to-Group conversion: Neozy Demo is now the persistent real testing
 // Group — an automatic schedule would wipe real testing data, which no
 // normal Group's data is ever subject to. Reset stays available only as an
 // explicit, operator-triggered maintenance action (workflow_dispatch).
 it('keeps reset manual-only, guarded and non-concurrent — no automatic schedule',()=>{const workflow=readFileSync('.github/workflows/demo-reset.yml','utf8');expect(workflow).not.toMatch(/schedule:/);expect(workflow).toMatch(/workflow_dispatch/);expect(workflow).toMatch(/workload_identity_provider/);expect(workflow).toMatch(/concurrency:/);expect(workflow).toContain('npm run demo:seed');expect(workflow).toContain('--confirm=RESET-company-demo-neozy');expect(workflow).not.toMatch(/password/i)});
 it('protects reset operational records in Firestore rules',()=>{const rules=readFileSync('firestore.rules','utf8');expect(rules).toMatch(/match \/demo_operations\/\{documentId\}[\s\S]*allow read, write: if false/)});
});
