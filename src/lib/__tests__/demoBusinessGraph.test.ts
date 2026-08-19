import {describe,expect,it} from 'vitest';
import {buildCompleteDemoPlan} from '../../../scripts/demo/datasets/complete.ts';
import {buildBusinessGraphPlan} from '../../../scripts/demo/datasets/businessGraph.ts';
import {DEMO_COMPANY_ID,DEMO_RESETTABLE_COLLECTIONS,DEMO_SEED_ID} from '../../../scripts/demo/config.ts';
import {buildManifest} from '../../../scripts/demo/manifest.ts';
import {verifyPlan} from '../../../scripts/demo/verify.ts';
import {findForbiddenFields} from '../../../scripts/demo/guards.ts';
const plan=()=>buildCompleteDemoPlan('TEST-AUTH-UID');const docs=(collection:string)=>plan().documents.filter(d=>d.collection===collection);
describe('complete deterministic Demo business graph',()=>{
 it('is deterministic and manifest-stable',()=>{const a=plan(),b=plan();expect(a).toEqual(b);expect(buildManifest(a).checksum).toBe(buildManifest(b).checksum)});
 it('has unique IDs and exact tenant ownership',()=>{const p=plan();const keys=p.documents.map(d=>`${d.collection}/${d.id}`);expect(new Set(keys).size).toBe(keys.length);expect(p.documents.filter(d=>d.collection!=='user_auth_maps'&&d.collection!=='groups').every(d=>d.data.companyId===DEMO_COMPANY_ID&&d.data.demoSeedId===DEMO_SEED_ID)).toBe(true)});
 it('builds the intended portfolio volume',()=>{expect(docs('leads')).toHaveLength(29);expect(docs('customers')).toHaveLength(24);expect(docs('projects')).toHaveLength(18);expect(docs('surveys')).toHaveLength(10);expect(docs('quotations')).toHaveLength(11);expect(docs('orders')).toHaveLength(12);expect(docs('proforma_invoices')).toHaveLength(12);expect(docs('payments')).toHaveLength(13);expect(docs('scheme_registrations')).toHaveLength(8)});
 it('Phase 3/17: includes genuine B2B material-sales examples proving Quotation->Order conversion derives orderType from the real Customer.type — B2B customers with NO Project, distinct from the 10 Project-attached B2C customers',()=>{
   const customers=docs('customers');
   const b2b=customers.filter((d:any)=>d.data.type==='B2B');
   const b2c=customers.filter((d:any)=>d.data.type==='B2C');
   // Phase 17: rebuilt to 6 realistic B2B customers spanning the full
   // quotation-first/direct-order/quotation-only/payment-pending/dispatch-
   // pending/delivered/closed variety the task explicitly asked for — the
   // original 10 Project-attached B2C customers are unchanged.
   expect(b2b).toHaveLength(6);
   expect(b2c).toHaveLength(18);
   const b2bCustomerIds=new Set(b2b.map((d:any)=>d.id));
   expect(docs('projects').some((d:any)=>b2bCustomerIds.has(d.data.customerId))).toBe(false);
   for(const b2bCustomerId of b2bCustomerIds){
     const b2bOrders=docs('orders').filter((d:any)=>d.data.customerId===b2bCustomerId);
     for(const order of b2bOrders){
       expect(order.data.orderType).toBe('B2B');
       expect(order.data.projectId).toBeUndefined();
     }
   }
   // Exactly one B2B customer (the quotation-only example) has no Order yet.
   const b2bWithoutOrder=[...b2bCustomerIds].filter((cid)=>!docs('orders').some((d:any)=>d.data.customerId===cid));
   expect(b2bWithoutOrder).toHaveLength(1);
   expect(docs('orders').filter((d:any)=>!b2bCustomerIds.has(d.data.customerId)).every((d:any)=>d.data.orderType==='B2C')).toBe(true);
 });
 it('Phase 15/17: B2B examples exercise BOTH the quotation-first and the direct-Order-without-Quotation (no quotationId field at all) paths, among the customers that actually have an order',()=>{
   const customers=docs('customers');
   const b2b=customers.filter((d:any)=>d.data.type==='B2B');
   expect(b2b).toHaveLength(6);
   const ordersByCustomer=(customerId:string)=>docs('orders').filter((d:any)=>d.data.customerId===customerId);
   const b2bOrders=b2b.flatMap((c:any)=>ordersByCustomer(c.id));
   const withQuotation=b2bOrders.filter((o:any)=>o?.data.quotationId);
   const withoutQuotation=b2bOrders.filter((o:any)=>!o?.data.quotationId);
   expect(withQuotation.length).toBeGreaterThanOrEqual(2);
   expect(withoutQuotation.length).toBeGreaterThanOrEqual(3);
 });
 it('Phase 4: every demo Project carries a valid, non-empty projectType (Residential/Commercial/Industrial)',()=>{const valid=new Set(['Residential','Commercial','Industrial']);expect(docs('projects').every((d:any)=>valid.has(d.data.projectType))).toBe(true)});
 it('Phase 6: every Approved demo Survey has a real engineeringDesignId pointing at an actual engineering_designs doc (matching the real approveSurvey() invariant); at least one Survey represents the Pending (awaiting-review) state',()=>{
   const surveys=docs('surveys');const designIds=new Set(docs('engineering_designs').map((d:any)=>d.id));
   const approved=surveys.filter((d:any)=>d.data.approvalStatus==='Approved');
   expect(approved.length).toBeGreaterThan(0);
   expect(approved.every((d:any)=>typeof d.data.engineeringDesignId==='string'&&designIds.has(d.data.engineeringDesignId))).toBe(true);
   expect(surveys.some((d:any)=>d.data.approvalStatus==='Pending')).toBe(true);
 });
 it('Phase 9: demo Dispatch records use only real status/approvalStatus enum values (no invented "Verified" status) and at least one reaches the real Closed terminal state',()=>{
   const validStatus=new Set(['Pending Verification','Dispatched','Delivered','Closed']);
   const dispatches=docs('dispatch');
   expect(dispatches.every((d:any)=>validStatus.has(d.data.status))).toBe(true);
   expect(dispatches.every((d:any)=>['Pending','Approved'].includes(d.data.approvalStatus))).toBe(true);
   expect(dispatches.some((d:any)=>d.data.status==='Closed'&&d.data.closedAt)).toBe(true);
   expect(dispatches.some((d:any)=>d.data.status==='Delivered'&&d.data.deliveredAt)).toBe(true);
 });
 it('Phase 10: every demo QC check references a real installations doc, which in turn references a real Project — restoring the qc_checks -> installations -> projects caseId propagation chain for the demo dataset',()=>{
   const installations=docs('installations');const projectIds=new Set(docs('projects').map((d:any)=>d.id));
   expect(installations.length).toBeGreaterThan(0);
   expect(installations.every((d:any)=>typeof d.data.projectId==='string'&&projectIds.has(d.data.projectId))).toBe(true);
   const installationIds=new Set(installations.map((d:any)=>d.id));
   const qcChecks=docs('qc_checks');
   expect(qcChecks.some((d:any)=>d.data.installationId)).toBe(true);
   expect(qcChecks.filter((d:any)=>d.data.installationId).every((d:any)=>installationIds.has(d.data.installationId))).toBe(true);
 });
 it('Phase 11: Commissioning/NetMetering/Subsidy/Handover/AMC/Service demo records carry the real workflow-schema fields their own UI reads (projectName/customerName/statusHistory/etc.), not invented field names',()=>{
   const projectIds=new Set(docs('projects').map((d:any)=>d.id));
   for(const c of docs('commissioning_records')){expect(typeof c.data.projectName).toBe('string');expect(typeof c.data.customerName).toBe('string');expect(['pending','completed']).toContain(c.data.status);expect(projectIds.has(c.data.projectId as string)).toBe(true)}
   for(const nm of docs('net_metering_applications')){expect(typeof nm.data.discomName).toBe('string');expect((nm.data.discomName as string).length).toBeGreaterThan(0);expect(typeof nm.data.applicationNumber).toBe('string');expect(Array.isArray(nm.data.statusHistory)).toBe(true);expect((nm.data.statusHistory as unknown[]).length).toBeGreaterThan(0);expect(projectIds.has(nm.data.projectId as string)).toBe(true)}
   for(const sub of docs('subsidy_applications')){expect(typeof sub.data.schemeName).toBe('string');expect((sub.data.schemeName as string).length).toBeGreaterThan(0);expect(typeof sub.data.applicationNumber).toBe('string');expect(Array.isArray(sub.data.disbursements)).toBe(true);expect(projectIds.has(sub.data.projectId as string)).toBe(true)}
   for(const h of docs('project_handovers')){expect(typeof h.data.projectName).toBe('string');expect(typeof h.data.customerName).toBe('string');expect(typeof h.data.handoverNumber).toBe('string');expect(typeof h.data.handoverDate).toBe('string');expect(Array.isArray(h.data.statusHistory)).toBe(true);expect((h.data.statusHistory as unknown[]).length).toBeGreaterThan(0)}
   for(const a of docs('amc_contracts')){expect(typeof a.data.projectName).toBe('string');expect(typeof a.data.customerName).toBe('string');expect(typeof a.data.contractNumber).toBe('string');expect(typeof a.data.contractValue).toBe('number');expect((a.data.contractValue as number)).toBeGreaterThan(0);expect(Array.isArray(a.data.statusHistory)).toBe(true)}
   const amcIds=new Set(docs('amc_contracts').map((d:any)=>d.id));
   for(const s of docs('service_tickets')){expect(typeof s.data.projectName).toBe('string');expect(typeof s.data.customerName).toBe('string');expect(typeof s.data.ticketNumber).toBe('string');expect(typeof s.data.issueType).toBe('string');expect((s.data.issueType as string).length).toBeGreaterThan(0);expect(typeof s.data.reportedDate).toBe('string');expect(Array.isArray(s.data.statusHistory)).toBe(true);if(s.data.amcContractId)expect(amcIds.has(s.data.amcContractId as string)).toBe(true)}
 });
 it('resolves every graph reference',()=>expect(verifyPlan(plan()).filter(x=>x.code.includes('REFERENCE'))).toEqual([]));
 it('reconciles all financial values',()=>expect(verifyPlan(plan()).filter(x=>['FINANCIAL_TOTAL','INVOICE_BALANCE','PAYMENT_ALLOCATION'].includes(x.code))).toEqual([]));
 it('keeps inventory balanced',()=>{expect(docs('stock').every(d=>Number(d.data.availableQty)>=0&&Number(d.data.reservedQty)>=0&&Number(d.data.onHandQty)===Number(d.data.availableQty)+Number(d.data.reservedQty))).toBe(true);expect(verifyPlan(plan()).filter(x=>x.code==='STOCK_BALANCE')).toEqual([])});
 it('covers deliberate lifecycle boundaries',()=>{expect(new Set(docs('projects').map(d=>d.data.currentStage))).toEqual(new Set(['New','SchemeRegistration','Survey','Engineering','Quotation','Procurement','Dispatch','QC','NetMetering','Subsidy','Handover','Service']));expect(verifyPlan(plan()).filter(x=>x.code.includes('CHRONOLOGY')||x.code.includes('COMMISSIONING'))).toEqual([])});
 it('contains no external delivery or binary side effects',()=>{const text=JSON.stringify(buildBusinessGraphPlan());expect(text).not.toMatch(/https?:\/\//);expect(buildBusinessGraphPlan().documents.flatMap(d=>findForbiddenFields(d.data))).toEqual([]);expect(docs('notifications').every(d=>(d.data.deliveryChannels as any).email===false&&(d.data.deliveryChannels as any).sms===false)).toBe(true)});
 it('plans reverse dependency reset while preserving identity',()=>{const resettable=new Set<string>(DEMO_RESETTABLE_COLLECTIONS);const deletions=plan().documents.filter(d=>resettable.has(d.collection)&&!d.preserveOnReset).reverse();expect(deletions.length).toBeGreaterThan(150);expect(deletions.some(d=>['companies','roles','users','user_auth_maps','settings'].includes(d.collection))).toBe(false);expect(deletions[0].collection).toBe('tax_invoices')});
 it('is idempotent by construction',()=>{const a=plan(),b=plan();expect(new Set(a.documents.map(d=>`${d.collection}/${d.id}`))).toEqual(new Set(b.documents.map(d=>`${d.collection}/${d.id}`)))})
 it('Phase 13: seeds soft-deleted records in multiple ages for Leads and Orders, each stamped with deletedBy/deletedAt, proving "show inactive" + restore is demonstrable in Demo Mode',()=>{
   const deletedLeads=docs('leads').filter((d:any)=>d.data.isDeleted===true);
   expect(deletedLeads.length).toBeGreaterThanOrEqual(2);
   for(const lead of deletedLeads){expect(typeof lead.data.deletedAt).toBe('string');expect((lead.data.deletedAt as string).length).toBeGreaterThan(0);expect(typeof lead.data.deletedBy).toBe('string');expect((lead.data.deletedBy as string).length).toBeGreaterThan(0)}
   // "various states (recently deleted, long-deleted)" — assert the two ages genuinely differ, not just present twice.
   const deletedAts=deletedLeads.map((d:any)=>d.data.deletedAt as string).sort();
   expect(deletedAts[0]).not.toBe(deletedAts[deletedAts.length-1]);

   const deletedOrders=docs('orders').filter((d:any)=>d.data.isDeleted===true);
   expect(deletedOrders.length).toBeGreaterThanOrEqual(1);
   for(const order of deletedOrders){expect(typeof order.data.deletedAt).toBe('string');expect(typeof order.data.deletedBy).toBe('string')}

   // Every other Lead/Order stays active by default — this must be a small, deliberate minority, not a bulk change.
   expect(docs('leads').filter((d:any)=>d.data.isDeleted!==true).length).toBeGreaterThan(deletedLeads.length);
   expect(docs('orders').filter((d:any)=>d.data.isDeleted!==true).length).toBeGreaterThan(deletedOrders.length);
 })
 it('Phase 14: seeds a real Document against each of the five newly-covered entities (Order/Quotation/ProformaInvoice/Dispatch/Payment), scoped correctly and resolvable from EntityDocumentsPanel',()=>{
   const documents=docs('documents');
   const bySourceType=(t:string)=>documents.filter((d:any)=>d.data.sourceEntityType===t);
   for(const t of ['order','quotation','invoice','dispatch','payment']){
     expect(bySourceType(t).length).toBeGreaterThanOrEqual(1);
   }
   for(const d of documents){
     expect(typeof d.data.name).toBe('string');
     expect((d.data.name as string).length).toBeGreaterThan(0);
     expect(typeof d.data.url).toBe('string');
     expect(d.data.url as string).toMatch(/^demo:\/\//); // never a real fetchable URL in demo data
     expect(typeof d.data.uploadedBy).toBe('string');
   }
   // Every document's scope field(s) resolve to a real document in this same plan (not a dangling reference).
   const byKey=new Set(plan().documents.map((d)=>`${d.collection}/${d.id}`));
   const scopeFieldTargets:[string,string][]=[['orderId','orders'],['quotationId','quotations'],['invoiceId','proforma_invoices'],['dispatchId','dispatch'],['paymentId','payments'],['customerId','customers'],['projectId','projects']];
   for(const d of documents){
     for(const [field,collection] of scopeFieldTargets){
       const value=(d.data as any)[field];
       if(value)expect(byKey.has(`${collection}/${value}`)).toBe(true);
     }
   }
 })
 it('Phase 14: "documents" is included in DEMO_RESETTABLE_COLLECTIONS now that it genuinely has demo data — otherwise seeded documents would survive every demo reset',()=>{
   expect(DEMO_RESETTABLE_COLLECTIONS as readonly string[]).toContain('documents');
 })
});