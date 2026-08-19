import { DEMO_COMPANY_ID, DEMO_ERP_USER_ID, DEMO_SEED_ID, OFFICIAL_DEMO_EMAIL } from './config.ts';
import { findForbiddenFields } from './guards.ts';
import type { DemoDocument, DemoSeedPlan } from './types.ts';
export type VerificationIssue={code:string;document?:string;detail:string};
const num=(v:unknown)=>typeof v==='number'?v:Number(v||0);const close=(a:number,b:number)=>Math.abs(a-b)<.011;
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):undefined;
export function verifyPlan(plan:DemoSeedPlan):VerificationIssue[]{
 const issues:VerificationIssue[]=[];const byKey=new Map(plan.documents.map(d=>[`${d.collection}/${d.id}`,d]));const ids=new Set<string>();
 const issue=(code:string,d:DemoDocument|undefined,detail:string)=>issues.push({code,document:d?`${d.collection}/${d.id}`:undefined,detail});
 for(const d of plan.documents){const key=`${d.collection}/${d.id}`;if(ids.has(key))issue('DUPLICATE_ID',d,key);ids.add(key);
  if(d.collection==='user_auth_maps'){if(d.data.userId!==DEMO_ERP_USER_ID||d.data.companyId!==DEMO_COMPANY_ID||d.data.email!==OFFICIAL_DEMO_EMAIL)issue('IDENTITY_MAPPING',d,'Canonical mapping mismatch')}
  // Phase 1 (Multi-Tenant): `groups` is a platform-level collection (the demo
  // tenant's Group) — it carries no companyId by design; exempt it from the
  // tenant-scoped marker checks.
  else if(d.collection==='groups'){if(d.data.isDemo!==true)issue('DEMO_GROUP',d,'Demo Group must be marked isDemo: true')}
  else{if(d.data.companyId!==DEMO_COMPANY_ID)issue('COMPANY_SCOPE',d,'Wrong companyId');if(d.data.isDemo!==true||d.data.demoSeedId!==DEMO_SEED_ID)issue('MARKER',d,'Missing demo markers')}
  for(const path of findForbiddenFields(d.data))issue('FORBIDDEN_FIELD',d,path);if(d.data.isSuperAdmin===true)issue('SUPER_ADMIN',d,'Demo data may not grant super-admin');
  for(const value of Object.values(d.data)){if(typeof value==='string'&&/@(gmail|yahoo|outlook|hotmail)\./i.test(value)&&value!==OFFICIAL_DEMO_EMAIL)issue('REAL_EMAIL_DOMAIN',d,value);if(typeof value==='string'&&/^\+?91[6-9]\d{9}$/.test(value.replace(/[ -]/g,'')))issue('REAL_LOOKING_PHONE',d,value)}
  const items=Array.isArray(d.data.items)?d.data.items as Record<string,unknown>[]:[];
  if(['quotations','orders','proforma_invoices','purchase_orders'].includes(d.collection)&&items.length){const subtotal=items.reduce((s,x)=>s+num(x.taxableValue),0),tax=items.reduce((s,x)=>s+num(x.taxAmount),0),total=items.reduce((s,x)=>s+num(x.total),0);if(!close(subtotal,num(d.data.subtotal))||!close(tax,num(d.data.taxTotal))||!close(total,num(d.data.total)))issue('FINANCIAL_TOTAL',d,`computed ${subtotal}/${tax}/${total}`)}
  if(d.collection==='proforma_invoices'&&!close(num(d.data.total)-num(d.data.paidAmount),num(d.data.balanceAmount)))issue('INVOICE_BALANCE',d,'total - paidAmount != balanceAmount');
  if(d.collection==='stock'&&(num(d.data.availableQty)<0||num(d.data.reservedQty)<0||!close(num(d.data.availableQty)+num(d.data.reservedQty),num(d.data.onHandQty))))issue('STOCK_BALANCE',d,'Invalid stock quantities');
  if(items.length)for(const item of items){const productId=String(item.productId||'');if(productId&&!byKey.has('products/'+productId))issue('MISSING_PRODUCT',d,productId)}
  if(d.collection==='dispatch'){const warehouseId=String(d.data.warehouseId||'');if(!byKey.has('warehouses/'+warehouseId))issue('MISSING_WAREHOUSE',d,warehouseId);for(const item of items){const productId=String(item.productId||''),available=plan.documents.filter(x=>x.collection==='stock'&&x.data.productId===productId).reduce((sum,x)=>sum+num(x.data.onHandQty),0);if(num(item.quantity)>available)issue('DISPATCH_STOCK',d,productId+': '+item.quantity+' > '+available)}}
 }
 for(const r of plan.references){if(!byKey.has(`${r.collection}/${r.id}`))issues.push({code:'MISSING_REFERENCE_SOURCE',document:`${r.collection}/${r.id}`,detail:r.field});if(!byKey.has(`${r.targetCollection}/${r.targetId}`))issues.push({code:'MISSING_REFERENCE',document:`${r.collection}/${r.id}`,detail:`${r.field}->${r.targetCollection}/${r.targetId}`})}
 for(const invoice of plan.documents.filter(d=>d.collection==='proforma_invoices')){const paid=plan.documents.filter(d=>d.collection==='payments'&&d.data.invoiceId===invoice.id&&d.data.status==='Received').reduce((s,p)=>s+num(p.data.amount),0);if(!close(paid,num(invoice.data.paidAmount)))issue('PAYMENT_ALLOCATION',invoice,`payments ${paid} != paidAmount ${invoice.data.paidAmount}`)}
 for(const project of plan.documents.filter(d=>d.collection==='projects')){const history=Array.isArray(project.data.stageHistory)?project.data.stageHistory as Record<string,unknown>[]:[];for(let i=1;i<history.length;i++){const a=iso(history[i-1].changedAt),b=iso(history[i].changedAt);if(a!==undefined&&b!==undefined&&a>b)issue('LIFECYCLE_CHRONOLOGY',project,'stage history is not chronological')}}
 for(const commissioning of plan.documents.filter(d=>d.collection==='commissioning_records'&&d.data.status==='completed')){const qc=byKey.get(`qc_checks/${commissioning.data.qcId}`);if(!qc||qc.data.status!=='passed')issue('COMMISSIONING_WITHOUT_PASSED_QC',commissioning,'Completed commissioning requires passed QC')}
 return issues;
}
export function assertPlanVerified(plan:DemoSeedPlan){const i=verifyPlan(plan);if(i.length)throw new Error(`Demo verification failed: ${i.map(x=>`${x.code}:${x.document||''}:${x.detail}`).join('; ')}`)}
export async function verifyPersistedPlan(db:any,plan:DemoSeedPlan){assertPlanVerified(plan);for(const d of plan.documents){const snap=await db.collection(d.collection).doc(d.id).get();if(!snap.exists)throw new Error(`Missing persisted demo document ${d.collection}/${d.id}`);const data=snap.data()||{};if(d.collection==='user_auth_maps'){if(data.userId!==d.data.userId||data.companyId!==DEMO_COMPANY_ID)throw new Error(`Persisted mapping mismatch ${d.id}`)}else if(d.collection==='groups'){if(data.isDemo!==true)throw new Error(`Persisted Demo Group marker mismatch ${d.collection}/${d.id}`)}else if(data.companyId!==DEMO_COMPANY_ID||data.demoSeedId!==DEMO_SEED_ID||data.isDemo!==true)throw new Error(`Persisted demo marker mismatch ${d.collection}/${d.id}`)}}