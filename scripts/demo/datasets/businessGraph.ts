import type {DemoDocument,DemoSeedPlan} from '../types.ts';
import {DEMO_COMPANY_ID,DEMO_ERP_USER_ID,DEMO_SEED_ID,demoDocumentId} from '../config.ts';
import {demoAt,demoDate} from './timeline.ts';
import {warehouseNames,vendorNames,demoGstin,employeeUserIds as foundationEmployeeUserIds,assigneeIds} from './foundation.ts';
import {SCHEME_REGISTRATION_REQUIRED_DOCUMENTS} from '../../../src/features/scheme-registration/types.ts';

const base={companyId:DEMO_COMPANY_ID,isDemo:true,demoSeedId:DEMO_SEED_ID,isDeleted:false};
const audit={createdBy:DEMO_ERP_USER_ID,updatedBy:DEMO_ERP_USER_ID};
const doc=(collection:string,id:string,data:Record<string,unknown>):DemoDocument=>({collection,id,data:{...base,...audit,id,...data}});
const refs:DemoSeedPlan['references']=[];
const ref=(source:DemoDocument,field:string,targetCollection:string,targetId:string)=>{refs.push({collection:source.collection,id:source.id,field,targetCollection,targetId});return source};
const id=(kind:string,n:number)=>demoDocumentId(kind,n);
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
type Line={productId:string;product:string;qty:number;unit:string;price:number;tax:number;discount:number;taxableValue:number;taxAmount:number;total:number};
const products:Record<string,[string,number]>={PANEL:['575 W Mono PERC Solar Module',14250],INV5:['5 kW On-grid Inverter',69000],INV25:['25 kW Three-phase Inverter',188000],HYBRID:['10 kW Hybrid Inverter',245000],STRUCT:['Aluminium Rooftop Structure Set',3850],GI:['GI Elevated Structure per kW',7200],DC:['Solar DC Cable 6 sq mm',68],AC:['AC Cable 16 sq mm',395],DCDB:['DC Distribution Box',12500],ACDB:['AC Distribution Box',18500],METER:['Bidirectional Energy Meter',9800],MON:['Remote Monitoring Gateway',14500],BAT:['51.2 V LFP Battery Bank',315000]};
const productIds:Record<string,string>={PANEL:id('PRD',1),INV5:id('PRD',3),INV25:id('PRD',4),HYBRID:id('PRD',5),STRUCT:id('PRD',6),GI:id('PRD',7),DC:id('PRD',8),AC:id('PRD',10),DCDB:id('PRD',11),ACDB:id('PRD',12),METER:id('PRD',13),MON:id('PRD',14),BAT:id('PRD',15)};
function line(key:string,qty:number,discount=0):Line{const [product,price]=products[key];const gross=qty*price;const taxableValue=money(gross-discount);const taxAmount=money(taxableValue*.18);return{productId:productIds[key],product,qty,unit:key==='DC'||key==='AC'?'Mtr':'Nos',price,tax:18,discount,taxableValue,taxAmount,total:money(taxableValue+taxAmount)}}
function totals(lines:Line[]){return{subtotal:money(lines.reduce((s,x)=>s+x.taxableValue,0)),taxTotal:money(lines.reduce((s,x)=>s+x.taxAmount,0)),discountTotal:money(lines.reduce((s,x)=>s+x.discount,0)),total:money(lines.reduce((s,x)=>s+x.total,0))}}
// Realistic Indian identity data — task: "Demo Mode — Final Business-Flow
// Data Rebuild & Realistic ERP Demo Validation" (remediation log item 1).
// scenarioNames now holds realistic PROJECT/site names (was an internal
// stage-label, e.g. "Survey Pending Residence" — a code smell in its own
// right, baking a status into a display name); customerDisplayNames holds
// the actual Customer/Lead person-or-business name, kept as a SEPARATE
// array so a customer's name never again encodes its own workflow stage.
// Every other structural array (capacities/cities/stages) is unchanged.
const scenarioNames=['Deshmukh Residence Rooftop Solar','Nashik Precision Tools Solar Plant','Vidarbha Trade Centre Solar Canopy','Kulkarni Residence Rooftop Solar','Kolhapur Foundry Works Solar Plant','Surat Diamond Plaza Solar Canopy','Agarwal Farmhouse Solar Plant','Vadodara Auto Components Solar Plant','Thane Business Hub Solar Canopy','Joshi Residence Rooftop Solar'];
const customerDisplayNames=['Rajesh Deshmukh','Nashik Precision Tools Pvt Ltd','Vidarbha Trade Centre','Sunita Kulkarni','Kolhapur Foundry Works','Surat Diamond Plaza Association','Prakash Agarwal','Vadodara Auto Components Ltd','Thane Business Hub Pvt Ltd','Meenal Joshi'];
const pipelineProspectNames=['Anjali Mehta','Rohan Kapoor','Deepak Verma','Priya Nair','Karan Malhotra'];
const capacities=[5,8,25,15,30,50,40,20,10,10];
const cities=['Pune','Nashik','Nagpur','Aurangabad','Kolhapur','Surat','Indore','Vadodara','Thane','Pune'];
const cityStates=['Maharashtra','Maharashtra','Maharashtra','Maharashtra','Maharashtra','Gujarat','Madhya Pradesh','Gujarat','Maharashtra','Maharashtra'];
const cityPincodes=['411038','422010','440010','431005','416012','395007','452001','390007','400601','411030'];
const streetAddresses=['Flat 302, Kumar Residency, Kothrud','Plot 14, MIDC Industrial Area, Satpur','221, Wardha Road','House 45, Samarth Nagar','Gala 8, Shivaji Udyamnagar','4th Floor, Diamond Bourse, Katargam','Survey No. 112, AB Road','Plot 27, GIDC Estate, Makarpura','3rd Floor, Ghodbunder Road','Flat 12, Sinhagad Road'];
const stages=['Survey','Engineering','Quotation','Procurement','Dispatch','QC','NetMetering','Subsidy','Handover','Service'];
function systemLines(i:number){const kw=capacities[i];const panels=Math.ceil(kw*1000/575);const inv=kw<=10?(i===9?'HYBRID':'INV5'):'INV25';const ls=[line('PANEL',panels),line(inv,Math.max(1,Math.ceil(kw/(inv==='INV5'?5:25)))),line(kw>15?'GI':'STRUCT',kw>15?kw:Math.ceil(panels/4)),line('DC',kw*18),line('AC',kw*4),line('DCDB',1),line('ACDB',1),line('METER',1),line('MON',1)];if(i===9)ls.push(line('BAT',1));return ls}

function buildCrm():DemoDocument[]{const out:DemoDocument[]=[];
  // Phase 10: leads 7-11 are the ones whose linked Project (PRJ-6..PRJ-10)
  // reaches Installation/QC in buildExecution() below — these are the only
  // demo leads with real installation progress, so only they legitimately
  // carry the Lead-side installation fields installationEngine.ts still
  // writes (mirrored, going forward, onto the real installations doc).
  const installDoneCounts=[9,8,10,10,10],installStatuses=['quality_inspection','quality_inspection','quality_inspection','completed','completed'];
  for(let i=1;i<=15;i++){const converted=i>=2&&i<=11;const n=i<=10?customerDisplayNames[i-1]:pipelineProspectNames[i-11];const instIdx=i>=7&&i<=11?i-6:0;const lead=doc('leads',id('LEAD',i),{leadId:id('LEAD',i),name:n,phone:`000000${String(1000+i).padStart(4,'0')}`,email:`${n.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,city:cities[(i-1)%cities.length],state:cityStates[(i-1)%cityStates.length],source:i===4||i===5?'Partner':['Website','Referral','Partner','Walk-in','Campaign'][i%5],...(i===4?{partnerId:id('PART',1),partnerName:channelPartnerFirms[0]}:i===5?{partnerId:id('PART',2),partnerName:channelPartnerFirms[1]}:{}),segment:i%3?'Residential':'Commercial',capacityKw:i<=10?capacities[i-1]:[3,12,18,60,7][i-11],priority:['Low','Medium','High'][i%3],status:converted?'Converted':i===1?'New':i===12?'Qualified':i===13?'Lost':'Contacted',assignedTo:id('USR',((i-1)%5)+1),followUpDate:demoDate(128+i),createdAt:demoAt(i),updatedAt:demoAt(90+i),notes:'Fictional demo inquiry; no external contact is permitted.',
    // Phase 13: two soft-deleted Leads (never referenced as a target by any
    // other builder in this file — safe to remove without corrupting any
    // cross-entity FK) proving the "show inactive" + restore capability in
    // Demo Mode with two genuinely different ages, per the Blueprint's own
    // demo-data requirement (§13 Phase 13 Demo Data Correction).
    ...(i===13?{isDeleted:true,deletedAt:demoAt(95),deletedBy:DEMO_ERP_USER_ID}:{}),
    ...(i===14?{isDeleted:true,deletedAt:demoAt(135),deletedBy:DEMO_ERP_USER_ID}:{}),
    ...(converted?{customerId:id('CUS',i-1),projectId:id('PRJ',i-1),convertedAt:demoAt(10+i)}:{}),...(instIdx?{installationStatus:installStatuses[instIdx-1],installationChecklist:installationChecklist(installDoneCounts[instIdx-1]),capturedSerialNumbers:instIdx>=4?[{serialNumber:`DEMO-SN-${1000+instIdx}`,productId:productIds['INV5'],product:products['INV5'][0],capturedAt:demoAt(92+instIdx),capturedBy:id('USR',4)}]:[],assignedEngineerId:id('USR',4),assignedEngineerName:'Meera Pillai',assignedEngineerPhone:'0000005004'}:{})});out.push(lead);if(converted){ref(lead,'customerId','customers',id('CUS',i-1));ref(lead,'projectId','projects',id('PRJ',i-1))}if(i<=10)out.push(ref(doc('followups',id('FUP',i),{leadId:lead.id,assignedTo:lead.data.assignedTo,status:i<4?'Open':'Completed',type:'Call',dueAt:demoAt(5+i),completedAt:i<4?null:demoAt(6+i),notes:'Demo lifecycle follow-up.'}),'leadId','leads',lead.id))}return out}
function buildCustomersProjects():DemoDocument[]{const out:DemoDocument[]=[];for(let i=1;i<=10;i++){const partnerOwner=i===3?{partnerId:id('PART',1),partnerName:channelPartnerFirms[0]}:i===4?{partnerId:id('PART',2),partnerName:channelPartnerFirms[1]}:{};const customer=doc('customers',id('CUS',i),{customerId:id('CUS',i),name:customerDisplayNames[i-1],phone:`000000${String(2000+i).padStart(4,'0')}`,email:`${customerDisplayNames[i-1].toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,address:`${streetAddresses[i-1]}, ${cities[i-1]}`,city:cities[i-1],state:cityStates[i-1],pincode:cityPincodes[i-1],type:'B2C',projectType:i%3?'Residential':'Commercial',leadId:id('LEAD',i+1),createdAt:demoAt(12+i),...(i===3||i===4?{...partnerOwner,sourceLeadId:id('LEAD',i+1)}:{})});out.push(ref(customer,'leadId','leads',id('LEAD',i+1)));out.push(doc('customer_phone_locks',`${DEMO_COMPANY_ID}_${customer.data.phone}`,{customerId:customer.id,phone:customer.data.phone,createdAt:demoAt(12+i)}));const project=doc('projects',id('PRJ',i),{projectId:id('PRJ',i),name:scenarioNames[i-1],customerId:customer.id,leadId:id('LEAD',i+1),capacityKw:capacities[i-1],systemType:i===10?'Hybrid':'On-grid',projectType:i%3===0?'Commercial':i%3===1?'Residential':'Industrial',siteAddress:`${streetAddresses[i-1]}, ${cities[i-1]}`,city:cities[i-1],currentStage:stages[i-1],status:i>=9?'Active':'In Progress',assignedSurveyor:id('USR',2),assignedInstaller:id('USR',4),salesOwner:id('USR',1),stageHistory:stages.slice(0,i).map((stage,j)=>({stage,changedAt:demoAt(18+i+j*7),changedBy:DEMO_ERP_USER_ID})),createdAt:demoAt(14+i),updatedAt:demoAt(85+i),...(i===3||i===4?partnerOwner:{})});out.push(ref(ref(project,'customerId','customers',customer.id),'leadId','leads',id('LEAD',i+1)))}return out}
function buildTechnical():DemoDocument[]{const out:DemoDocument[]=[];const surveyLatLng:[number,number][]=[[18.5204,73.8567],[19.9975,73.7898],[21.1458,79.0882],[19.8762,75.3433],[16.7050,74.2433],[21.1702,72.8311],[22.7196,75.8577],[22.3072,73.1812],[19.2183,72.9781],[18.5204,73.8567]];for(let i=1;i<=10;i++){const completed=true;
  // Phase 15.1 (post-Phase-15 stage/downstream-coherence correction): every
  // Project i>=2 is, by buildCustomersProjects()'s own currentStage
  // assignment, AT OR PAST the 'Engineering' stage — meaning its Survey must
  // already be Completed+Approved and a real Engineering Design must exist,
  // full stop, for every one of them, not just i=2..7. The previous version
  // capped this loop at i<=7 (and hasDesign at i<=7), leaving PRJ-8/9/10 —
  // whose currentStage is 'Subsidy'/'Handover'/'Service', i.e. deep into the
  // downstream chain — with NO Survey/Engineering record at all: a Project
  // cannot genuinely reach Subsidy/Handover/Service without Survey and
  // Engineering having happened first. This is exactly the "Project at a
  // late stage while its required preceding records are missing" defect
  // class flagged during this correction pass. i=1 (PRJ-1, currentStage=
  // 'Survey') is the one project genuinely still AT the Survey stage: its
  // site visit is complete (a real, reachable 'Completed' survey status) but
  // hasDesign stays false, so approvalStatus lands on the real, reachable
  // 'Pending' (awaiting-review) state — the project hasn't advanced to
  // Engineering precisely because that review/handoff hasn't happened yet.
  // This keeps the "Pending" status demonstration coherent instead of
  // dropping it (as an unsubmitted-survey version of PRJ-1 would have).
  const hasDesign=i>=2;const roofType=i%2?'RCC':'Metal Sheet';const roofAreaSqm=Math.round(capacities[i-1]*10.7);const shadingNotes=i%3?'Minimal morning shadow from an adjacent structure.':'Roof is shadow-free through the day.';const structuralNotes=capacities[i-1]>15?'Roof can bear an elevated GI structure; verified with a structural walk-through.':'Standard flush-mounted aluminium structure is sufficient.';const survey=doc('surveys',id('SRV',i),{surveyId:id('SRV',i),projectId:id('PRJ',i),surveyorId:id('USR',2),assignedSurveyor:id('USR',2),scheduledDate:demoDate(22+i),completedDate:completed?demoDate(24+i):'',completedBy:completed?id('USR',2):'',status:completed?'Completed':'Scheduled',approvalStatus:!completed?'NotSubmitted':hasDesign?'Approved':'Pending',roofType,roofAreaSqm,shadingNotes,structuralNotes,notes:'Fictional demo survey; no physical site was visited.',photos:[],...(completed?{location:{latitude:surveyLatLng[i-1][0],longitude:surveyLatLng[i-1][1],accuracy:12,capturedAt:demoDate(24+i),address:`Near ${streetAddresses[i-1]}, ${cities[i-1]}, ${cityStates[i-1]}`}}:{}),...(hasDesign?{engineeringDesignId:id('ENG',i-1),engineeringHandoffAt:demoAt(30+i)}:{}),createdAt:demoAt(22+i)});out.push(hasDesign?ref(ref(survey,'projectId','projects',id('PRJ',i)),'engineeringDesignId','engineering_designs',id('ENG',i-1)):ref(survey,'projectId','projects',id('PRJ',i)))}for(let i=2;i<=10;i++){const approved=i>2;const roofType=i%2?'RCC':'Metal Sheet';const roofAreaSqm=Math.round(capacities[i-1]*10.7);const shadingNotes=i%3?'Minimal morning shadow from an adjacent structure.':'Roof is shadow-free through the day.';const structuralNotes=capacities[i-1]>15?'Roof can bear an elevated GI structure; verified with a structural walk-through.':'Standard flush-mounted aluminium structure is sufficient.';const eng=doc('engineering_designs',id('ENG',i-1),{designId:id('ENG',i-1),projectId:id('PRJ',i),surveyId:id('SRV',i),designerId:id('USR',3),assignedSurveyor:id('USR',2),assignedInstaller:id('USR',4),salesOwner:id('USR',1),status:i===2?'InReview':'Approved',systemCapacityKw:capacities[i-1],panelCount:Math.ceil(capacities[i-1]*1000/575),panelWattage:575,inverterSpec:capacities[i-1]<=10?'5 kW string inverter':'25 kW three-phase inverter',singleLineDiagramUrl:'',structuralDrawingUrl:'',documents:[],revisionNumber:1,revisionHistory:[],surveySnapshot:{roofType,roofAreaSqm,shadingNotes,structuralNotes,photos:[],capturedAt:demoDate(24+i)},handoffCreatedAt:demoAt(30+i),handoffCreatedBy:id('USR',3),submittedAt:demoAt(31+i),approvedAt:approved?demoAt(33+i):'',approvedBy:approved?id('USR',3):'',approvalNote:approved?'Design reviewed and cleared for quotation.':'',createdAt:demoAt(32+i)});out.push(ref(ref(eng,'projectId','projects',id('PRJ',i)),'surveyId','surveys',id('SRV',i)))}return out}
function buildSalesFinance():DemoDocument[]{
  const out:DemoDocument[]=[];
  for(let i=3;i<=10;i++){
    const qn=i-2;
    const items=systemLines(i-1);
    const sum=totals(items);
    const customer=customerDisplayNames[i-1];
    const q=doc('quotations',id('QUO',qn),{
      quotationId:id('QUO',qn),quotationNumber:`DQT-${String(qn).padStart(4,'0')}`,
      projectId:id('PRJ',i),customerId:id('CUS',i),customer,customerName:customer,
      customerAddress:`${streetAddresses[i-1]}, ${cities[i-1]}`,customerPhone:`000000${String(2000+i).padStart(4,'0')}`,
      customerEmail:`${customer.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,customerState:cityStates[i-1],leadId:id('LEAD',i+1),
      date:demoDate(40+i),items,...sum,status:i===3?'Sent':'Accepted',validUntil:demoDate(80+i),
      terms:'Fictional demonstration quotation. No commercial validity.',createdAt:demoAt(40+i)
    });
    out.push(ref(ref(q,'projectId','projects',id('PRJ',i)),'customerId','customers',id('CUS',i)));
    if(i>=4){
      const on=i-3;
      const order=doc('orders',id('ORD',on),{
        orderId:id('ORD',on),orderNumber:`DORD-${String(on).padStart(4,'0')}`,quotationId:q.id,
        projectId:id('PRJ',i),customerId:id('CUS',i),customer,customerName:customer,items,...sum,
        // Phase 3: every demo Customer this loop attaches an Order to is B2C
        // (buildCustomersProjects() gives each one a Project) — orderType must
        // agree, matching what the fixed convertQuotationToOrder() now derives
        // from the real Customer.type instead of a hardcoded default.
        orderType:'B2C',
        status:i<6?'Confirmed':i<8?'Partial Dispatch':'Delivered',paymentStatus:i===4?'Partial':i>=9?'Paid':'Pending',
        orderDate:demoDate(50+i),createdAt:demoAt(50+i),
        // Phase 13: one soft-deleted Order (not referenced as a dispatch/
        // entity_relationship target elsewhere in this file — safe to remove)
        // proving "show inactive" + restore for Orders in Demo Mode.
        ...(on===1?{isDeleted:true,deletedAt:demoAt(96),deletedBy:DEMO_ERP_USER_ID}:{}),
      });
      out.push(ref(ref(ref(order,'quotationId','quotations',q.id),'projectId','projects',id('PRJ',i)),'customerId','customers',id('CUS',i)));
      const inv=doc('proforma_invoices',id('INV',on),{
        invoiceId:id('INV',on),piNumber:`DINV-${String(on).padStart(4,'0')}`,invoiceNumber:`DINV-${String(on).padStart(4,'0')}`,
        orderId:order.id,sourceOrderId:order.id,projectId:id('PRJ',i),customerId:id('CUS',i),customer,customerName:customer,
        items,...sum,paidAmount:i===4?money(sum.total*.35):i>=9?sum.total:i===8?money(sum.total*.6):money(sum.total*.2),
        balanceAmount:0,paymentStatus:i===4||i===8?'Partial':i>=9?'Paid':'Pending',issueDate:demoDate(52+i),
        dueDate:demoDate(75+i),createdAt:demoAt(52+i)
      });
      inv.data.balanceAmount=money(sum.total-Number(inv.data.paidAmount));
      out.push(ref(ref(ref(inv,'orderId','orders',order.id),'projectId','projects',id('PRJ',i)),'customerId','customers',id('CUS',i)));
      const paid=Number(inv.data.paidAmount);
      if(paid>0){
        const parts=paid===sum.total?[money(paid*.4),money(paid-paid*.4)]:[paid];
        parts.forEach((amount,k)=>{
          const p=doc('payments',id('PAY',(on-1)*2+k+1),{
            paymentId:id('PAY',(on-1)*2+k+1),invoiceId:inv.id,orderId:order.id,projectId:id('PRJ',i),customerId:id('CUS',i),
            amount,mode:k?'Bank Transfer':'UPI',status:'Received',paymentDate:demoDate(56+i+k*8),
            referenceNumber:`DEMO-PAY-${on}-${k+1}`,notes:'Fictional payment record; no provider transaction.',createdAt:demoAt(56+i+k*8)
          });
          out.push(ref(ref(p,'invoiceId','proforma_invoices',inv.id),'orderId','orders',order.id));
        });
      }
    }
  }
  return out;
}
// Task: "Demo Mode — Final Business-Flow Data Rebuild & Realistic ERP Demo
// Validation" (remediation log items 2/3). The B2B material-sales workflow
// is: Lead -> B2B Customer -> Quotation OR direct Order -> PI -> Payment ->
// Mark PI Paid -> Dispatch (loading, quantity verification, serial capture,
// price hidden from warehouse) -> Delivery Challan -> Accounts -> Bill.
// Previously only 2 B2B customers existed and BOTH stopped at Order — no PI,
// Payment, Dispatch, serial capture, or Bill ever existed for either, even
// though buildTaxInvoices() below already assumed a fuller chain existed
// around ORD-8. Six B2B customers now cover the full range the task
// explicitly asks for: quotation-first vs direct-order, quotation-only
// (not yet converted), a repeat/second order, payment pending/partial/paid,
// dispatch pending/delivered-not-closed/closed, with/without a Bill, and
// serial capture on serialized line items (matching the real Dispatch
// serial-capture workflow — never at Installation, which is B2C-only).
// Every status value used is a real one the corresponding *Workflow.ts file
// already declares — never invented. IDs (LEAD-16..21, CUS-11..16, QUO-9..11,
// ORD-8..12, INV-8..12, PAY-21..24, DSP-7..10) are chosen to never
// collide with the B2C i<=15/i<=10/qn<=8/on<=7 numbering above.
function buildB2BExamples():DemoDocument[]{
  const out:DemoDocument[]=[];
  const leadPhone=(n:number)=>`000000900${n}`;
  // Real B2B serial capture (confirmed via
  // src/features/dispatch/components/DispatchWorkspaceParts.tsx) lives on
  // the dispatch's OWN item lines — `items[].serials`/`verifiedQty`, derived
  // from `trackingType` — NOT a standalone serial_numbers collection
  // document (that collection is Installation/B2C-only, per
  // installationEngine.ts's captureSerial()). Matches foundation.ts's own
  // per-product trackingType assignment (`i<5||i===14?'serial':'none'` on
  // its 15-item catalog) — PANEL/INV5/INV25/HYBRID/BAT are serial-tracked.
  const SERIAL_TRACKED_KEYS=new Set(['PANEL','INV5','INV25','HYBRID','BAT']);
  function dispatchLine(key:string,qty:number,serialPrefix:string,verified=true){
    const tracked=SERIAL_TRACKED_KEYS.has(key);
    return{productId:productIds[key],product:products[key][0],quantity:qty,unit:'Nos',trackingType:tracked?'serial':'none',requestedQty:qty,verifiedQty:verified?qty:0,...(tracked&&verified?{serials:Array.from({length:qty},(_,k)=>`${serialPrefix}-${String(k+1).padStart(3,'0')}`)}:{})};
  }
  function makeLeadCustomer(n:number,name:string,city:string,state:string,gstStateCode:string,source:string,priority:string,leadDay:number,convertDay:number){
    const leadId=id('LEAD',15+n),customerId=id('CUS',10+n),phone=leadPhone(n);
    const lead=doc('leads',leadId,{leadId,name,phone,email:`${name.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,city,state,source,segment:'B2B',capacityKw:0,priority,status:'Converted',assignedTo:n%2?id('USR',1):foundationEmployeeUserIds[0],followUpDate:demoDate(leadDay+8),createdAt:demoAt(leadDay),updatedAt:demoAt(leadDay+1),notes:'Fictional demo B2B material-distribution inquiry; no external contact is permitted.',customerId,convertedAt:demoAt(convertDay)});
    out.push(lead);ref(lead,'customerId','customers',customerId);
    // +30 offset keeps B2B customer GSTINs out of vendors' own 1..8 range
    // (foundation.ts's buildVendorDocuments()) — two different real
    // entities must never be seeded with the identical GSTIN value.
    const customer=doc('customers',customerId,{customerId,name,type:'B2B',company:name,phone,email:lead.data.email,gst:demoGstin(n+30,gstStateCode),address:`${streetAddresses[(n+3)%streetAddresses.length]}, ${city}`,city,state,pincode:cityPincodes[(n+3)%cityPincodes.length],leadId,createdAt:demoAt(convertDay)});
    out.push(ref(customer,'leadId','leads',leadId));
    out.push(doc('customer_phone_locks',`${DEMO_COMPANY_ID}_${phone}`,{customerId,phone,createdAt:demoAt(convertDay)}));
    return{leadId,customerId,name,city,state};
  }

  // CUS-11 "Sundar Solar Distributors" (Pune) — quotation-first, full happy
  // path through a Closed, serial-captured Dispatch to an Issued Bill.
  {
    const {customerId,name}=makeLeadCustomer(1,'Sundar Solar Distributors','Pune','Maharashtra','27','Referral','High',140,142);
    const items=[line('PANEL',60),line('INV25',2),line('STRUCT',15)];const sum=totals(items);
    const q=doc('quotations',id('QUO',9),{quotationId:id('QUO',9),quotationNumber:'DQT-0009',customerId,customer:name,customerName:name,customerAddress:`${streetAddresses[4]}, Pune`,customerPhone:leadPhone(1),customerEmail:`${name.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,customerState:'Maharashtra',customerGst:demoGstin(31,'27'),leadId:id('LEAD',16),date:demoDate(143),items,...sum,status:'Accepted',validUntil:demoDate(200),terms:'Fictional demonstration quotation. No commercial validity.',createdAt:demoAt(143)});
    out.push(ref(q,'customerId','customers',customerId));
    const order=doc('orders',id('ORD',8),{orderId:id('ORD',8),orderNumber:'DORD-0008',quotationId:q.id,customerId,customer:name,customerName:name,items,...sum,orderType:'B2B',status:'Confirmed',paymentStatus:'Paid',orderDate:demoDate(144),createdAt:demoAt(144)});
    out.push(ref(ref(order,'quotationId','quotations',q.id),'customerId','customers',customerId));
    const inv=doc('proforma_invoices',id('INV',8),{invoiceId:id('INV',8),piNumber:'DINV-0008',invoiceNumber:'DINV-0008',orderId:order.id,sourceOrderId:order.id,customerId,customer:name,customerName:name,items,...sum,paidAmount:sum.total,balanceAmount:0,paymentStatus:'Paid',issueDate:demoDate(145),dueDate:demoDate(150),createdAt:demoAt(145)});
    out.push(ref(ref(inv,'orderId','orders',order.id),'customerId','customers',customerId));
    const pay=doc('payments',id('PAY',21),{paymentId:id('PAY',21),invoiceId:inv.id,orderId:order.id,customerId,amount:sum.total,mode:'Bank Transfer',status:'Received',paymentDate:demoDate(146),referenceNumber:'DEMO-PAY-B2B-1',notes:'Fictional payment record; no provider transaction.',createdAt:demoAt(146)});
    out.push(ref(ref(pay,'invoiceId','proforma_invoices',inv.id),'orderId','orders',order.id));
    const dispItems=[dispatchLine('PANEL',60,'DEMO-SN-B2B1-PNL'),dispatchLine('INV25',2,'DEMO-SN-B2B1-INV'),dispatchLine('STRUCT',15,'DEMO-SN-B2B1-STR')];
    const dsp=doc('dispatch',id('DSP',7),{dispatchId:id('DSP',7),dispatchNumber:'DDSP-0007',orderId:order.id,customerId,warehouseId:id('WH',1),items:dispItems,status:'Closed',approvalStatus:'Approved',dispatchDate:demoDate(147),deliveryDate:demoDate(148),deliveryConfirmed:true,deliveredAt:demoAt(148),deliveredBy:DEMO_ERP_USER_ID,closedAt:demoAt(149),closedBy:DEMO_ERP_USER_ID,vehicleNo:'MH12DM1007',driverName:'Sandeep Waghmare',notes:'No external transport operation.',createdAt:demoAt(147)});
    out.push(ref(ref(ref(dsp,'orderId','orders',order.id),'customerId','customers',customerId),'warehouseId','warehouses',id('WH',1)));
  }

  // CUS-12 "Bright Grid Traders" (Nashik) — direct order (no quotation),
  // Partial payment, Dispatch still in progress (Pending Verification) —
  // demonstrates the "no Quotation in the chain at all" direct-create path
  // AND the payment-partial/dispatch-pending states together.
  {
    const {customerId,name}=makeLeadCustomer(2,'Bright Grid Traders','Nashik','Maharashtra','27','Website','Medium',146,148);
    const items=[line('PANEL',40),line('INV5',3),line('STRUCT',10)];const sum=totals(items);
    const order=doc('orders',id('ORD',9),{orderId:id('ORD',9),orderNumber:'DORD-0009',customerId,customer:name,customerName:name,items,...sum,orderType:'B2B',status:'Confirmed',paymentStatus:'Partial',orderDate:demoDate(149),createdAt:demoAt(149)});
    out.push(ref(order,'customerId','customers',customerId));
    const partial=money(sum.total*.4);
    const inv=doc('proforma_invoices',id('INV',9),{invoiceId:id('INV',9),piNumber:'DINV-0009',invoiceNumber:'DINV-0009',orderId:order.id,sourceOrderId:order.id,customerId,customer:name,customerName:name,items,...sum,paidAmount:partial,balanceAmount:money(sum.total-partial),paymentStatus:'Partial',issueDate:demoDate(150),dueDate:demoDate(160),createdAt:demoAt(150)});
    out.push(ref(ref(inv,'orderId','orders',order.id),'customerId','customers',customerId));
    const pay=doc('payments',id('PAY',22),{paymentId:id('PAY',22),invoiceId:inv.id,orderId:order.id,customerId,amount:partial,mode:'UPI',status:'Received',paymentDate:demoDate(151),referenceNumber:'DEMO-PAY-B2B-2',notes:'Fictional payment record; no provider transaction.',createdAt:demoAt(151)});
    out.push(ref(ref(pay,'invoiceId','proforma_invoices',inv.id),'orderId','orders',order.id));
    const dispItems=[dispatchLine('PANEL',40,'DEMO-SN-B2B2-PNL',false),dispatchLine('INV5',3,'DEMO-SN-B2B2-INV',false),dispatchLine('STRUCT',10,'DEMO-SN-B2B2-STR',false)];
    const dsp=doc('dispatch',id('DSP',8),{dispatchId:id('DSP',8),dispatchNumber:'DDSP-0008',orderId:order.id,customerId,warehouseId:id('WH',3),items:dispItems,status:'Pending Verification',approvalStatus:'Pending',dispatchDate:demoDate(152),deliveryDate:'',vehicleNo:'MH12DM1008',driverName:'Ganesh Pawar',notes:'No external transport operation.',createdAt:demoAt(152)});
    out.push(ref(ref(ref(dsp,'orderId','orders',order.id),'customerId','customers',customerId),'warehouseId','warehouses',id('WH',3)));
  }

  // CUS-13 "Om Sai Solar Traders" (Nagpur) — direct order (repeat customer:
  // "if previous order is completed, subsequent order can be created
  // directly" — this order stands in for that second/repeat transaction),
  // fully paid, Dispatch Delivered but not yet Closed (the real, persistent
  // post-confirmDelivery() state) — no Bill yet, since Accounts only bills
  // once a dispatch closes.
  {
    const {customerId,name}=makeLeadCustomer(3,'Om Sai Solar Traders','Nagpur','Maharashtra','27','Partner','Medium',153,154);
    const items=[line('PANEL',50),line('INV25',2),line('GI',15)];const sum=totals(items);
    const order=doc('orders',id('ORD',10),{orderId:id('ORD',10),orderNumber:'DORD-0010',customerId,customer:name,customerName:name,items,...sum,orderType:'B2B',status:'Confirmed',paymentStatus:'Paid',orderDate:demoDate(155),createdAt:demoAt(155)});
    out.push(ref(order,'customerId','customers',customerId));
    const inv=doc('proforma_invoices',id('INV',10),{invoiceId:id('INV',10),piNumber:'DINV-0010',invoiceNumber:'DINV-0010',orderId:order.id,sourceOrderId:order.id,customerId,customer:name,customerName:name,items,...sum,paidAmount:sum.total,balanceAmount:0,paymentStatus:'Paid',issueDate:demoDate(156),dueDate:demoDate(161),createdAt:demoAt(156)});
    out.push(ref(ref(inv,'orderId','orders',order.id),'customerId','customers',customerId));
    const pay=doc('payments',id('PAY',23),{paymentId:id('PAY',23),invoiceId:inv.id,orderId:order.id,customerId,amount:sum.total,mode:'Bank Transfer',status:'Received',paymentDate:demoDate(157),referenceNumber:'DEMO-PAY-B2B-3',notes:'Fictional payment record; no provider transaction.',createdAt:demoAt(157)});
    out.push(ref(ref(pay,'invoiceId','proforma_invoices',inv.id),'orderId','orders',order.id));
    const dispItems=[dispatchLine('PANEL',50,'DEMO-SN-B2B3-PNL'),dispatchLine('INV25',2,'DEMO-SN-B2B3-INV'),{productId:productIds['GI'],product:products['GI'][0],quantity:15,unit:'KW',trackingType:'none',requestedQty:15,verifiedQty:15}];
    const dsp=doc('dispatch',id('DSP',9),{dispatchId:id('DSP',9),dispatchNumber:'DDSP-0009',orderId:order.id,customerId,warehouseId:id('WH',1),items:dispItems,status:'Delivered',approvalStatus:'Approved',dispatchDate:demoDate(158),deliveryDate:demoDate(159),deliveryConfirmed:true,deliveredAt:demoAt(159),deliveredBy:DEMO_ERP_USER_ID,vehicleNo:'MH12DM1009',driverName:'Ramesh Jadhav',notes:'No external transport operation.',createdAt:demoAt(158)});
    out.push(ref(ref(ref(dsp,'orderId','orders',order.id),'customerId','customers',customerId),'warehouseId','warehouses',id('WH',1)));
  }

  // CUS-14 "Shakti Energy Systems" (Nashik) — quotation-first, Order
  // created from the quotation, PI raised but payment still Pending — no
  // Dispatch yet (the real flow gates Dispatch on "Mark PI as Paid").
  {
    const {customerId,name}=makeLeadCustomer(4,'Shakti Energy Systems','Nashik','Maharashtra','27','Referral','Medium',159,160);
    const items=[line('PANEL',30),line('INV5',2),line('STRUCT',8)];const sum=totals(items);
    const q=doc('quotations',id('QUO',10),{quotationId:id('QUO',10),quotationNumber:'DQT-0010',customerId,customer:name,customerName:name,customerAddress:`${streetAddresses[0]}, Nashik`,customerPhone:leadPhone(4),customerEmail:`${name.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,customerState:'Maharashtra',customerGst:demoGstin(34,'27'),leadId:id('LEAD',19),date:demoDate(161),items,...sum,status:'Accepted',validUntil:demoDate(210),terms:'Fictional demonstration quotation. No commercial validity.',createdAt:demoAt(161)});
    out.push(ref(q,'customerId','customers',customerId));
    const order=doc('orders',id('ORD',11),{orderId:id('ORD',11),orderNumber:'DORD-0011',quotationId:q.id,customerId,customer:name,customerName:name,items,...sum,orderType:'B2B',status:'Confirmed',paymentStatus:'Pending',orderDate:demoDate(162),createdAt:demoAt(162)});
    out.push(ref(ref(order,'quotationId','quotations',q.id),'customerId','customers',customerId));
    const inv=doc('proforma_invoices',id('INV',11),{invoiceId:id('INV',11),piNumber:'DINV-0011',invoiceNumber:'DINV-0011',orderId:order.id,sourceOrderId:order.id,customerId,customer:name,customerName:name,items,...sum,paidAmount:0,balanceAmount:sum.total,paymentStatus:'Pending',issueDate:demoDate(163),dueDate:demoDate(173),createdAt:demoAt(163)});
    out.push(ref(ref(inv,'orderId','orders',order.id),'customerId','customers',customerId));
  }

  // CUS-15 "Varanasi Solar Traders" — quotation sent, NOT yet converted to
  // an Order at all: the "first transaction, quotation-only-so-far" branch
  // point the task's own §2 names explicitly. Zero downstream records.
  {
    const {customerId,name}=makeLeadCustomer(5,'Varanasi Solar Traders','Varanasi','Uttar Pradesh','09','Website','Low',163,164);
    const items=[line('PANEL',25),line('INV5',2)];const sum=totals(items);
    const q=doc('quotations',id('QUO',11),{quotationId:id('QUO',11),quotationNumber:'DQT-0011',customerId,customer:name,customerName:name,customerAddress:`Nagwa Naria Road, Varanasi`,customerPhone:leadPhone(5),customerEmail:`${name.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`,customerState:'Uttar Pradesh',customerGst:demoGstin(35,'09'),leadId:id('LEAD',20),date:demoDate(165),items,...sum,status:'Sent',validUntil:demoDate(215),terms:'Fictional demonstration quotation. No commercial validity.',createdAt:demoAt(165)});
    out.push(ref(q,'customerId','customers',customerId));
  }

  // CUS-16 "Suresh Electricals" (Indore) — direct order, full happy path
  // again but ending in a DRAFT Bill (not yet Issued) with serial capture,
  // demonstrating the Bill's own pre-issue state distinctly from CUS-11's
  // already-Issued example.
  {
    const {customerId,name}=makeLeadCustomer(6,'Suresh Electricals','Indore','Madhya Pradesh','23','Walk-in','High',166,167);
    const items=[line('PANEL',45),line('INV5',4),line('HYBRID',1),line('STRUCT',12)];const sum=totals(items);
    const order=doc('orders',id('ORD',12),{orderId:id('ORD',12),orderNumber:'DORD-0012',customerId,customer:name,customerName:name,items,...sum,orderType:'B2B',status:'Confirmed',paymentStatus:'Paid',orderDate:demoDate(168),createdAt:demoAt(168)});
    out.push(ref(order,'customerId','customers',customerId));
    const inv=doc('proforma_invoices',id('INV',12),{invoiceId:id('INV',12),piNumber:'DINV-0012',invoiceNumber:'DINV-0012',orderId:order.id,sourceOrderId:order.id,customerId,customer:name,customerName:name,items,...sum,paidAmount:sum.total,balanceAmount:0,paymentStatus:'Paid',issueDate:demoDate(169),dueDate:demoDate(174),createdAt:demoAt(169)});
    out.push(ref(ref(inv,'orderId','orders',order.id),'customerId','customers',customerId));
    const pay=doc('payments',id('PAY',24),{paymentId:id('PAY',24),invoiceId:inv.id,orderId:order.id,customerId,amount:sum.total,mode:'Bank Transfer',status:'Received',paymentDate:demoDate(170),referenceNumber:'DEMO-PAY-B2B-4',notes:'Fictional payment record; no provider transaction.',createdAt:demoAt(170)});
    out.push(ref(ref(pay,'invoiceId','proforma_invoices',inv.id),'orderId','orders',order.id));
    const dispItems=[dispatchLine('PANEL',45,'DEMO-SN-B2B6-PNL'),dispatchLine('INV5',4,'DEMO-SN-B2B6-INV'),dispatchLine('HYBRID',1,'DEMO-SN-B2B6-HYB'),dispatchLine('STRUCT',12,'DEMO-SN-B2B6-STR')];
    const dsp=doc('dispatch',id('DSP',10),{dispatchId:id('DSP',10),dispatchNumber:'DDSP-0010',orderId:order.id,customerId,warehouseId:id('WH',2),items:dispItems,status:'Closed',approvalStatus:'Approved',dispatchDate:demoDate(171),deliveryDate:demoDate(172),deliveryConfirmed:true,deliveredAt:demoAt(172),deliveredBy:DEMO_ERP_USER_ID,closedAt:demoAt(173),closedBy:DEMO_ERP_USER_ID,vehicleNo:'MH12DM1010',driverName:'Sandeep Waghmare',notes:'No external transport operation.',createdAt:demoAt(171)});
    out.push(ref(ref(ref(dsp,'orderId','orders',order.id),'customerId','customers',customerId),'warehouseId','warehouses',id('WH',2)));
  }

  return out;
}
function poLines(i:number){return [line('PANEL',20+i*8),line(i<3?'INV5':'INV25',i<3?2:1),line('DC',120+i*20)]}
// Phase 15.1: every PO here feeds Projects PRJ-4..8, all of which are at
// Procurement or a LATER stage (Dispatch/QC/NetMetering/Subsidy) — none of
// them can still be genuinely mid-procurement with goods unreceived, so
// every PO is fully 'Received' with a matching Goods Receipt (previously
// PO-5/PRJ-8 stayed 'Sent' with zero receivedQty despite PRJ-8 supposedly
// already being at Subsidy, several stages past Procurement/Dispatch/
// Installation/QC/Commissioning/NetMetering — impossible without received
// stock).
function buildSupply():DemoDocument[]{const out:DemoDocument[]=[];for(let i=1;i<=5;i++){const items=poLines(i).map(x=>({...x,receivedQty:x.qty,remainingQty:0})),sum=totals(items),po=doc('purchase_orders',id('PO',i),{purchaseOrderId:id('PO',i),vendorId:id('VEN',i),vendorName:vendorNames[i-1],vendorGstin:demoGstin(i,'27'),projectId:id('PRJ',i+3),projectName:scenarioNames[i+2],status:'Received',orderDate:demoDate(56+i),expectedDeliveryDate:demoDate(66+i),items,...sum,notes:'Fictional demo procurement.',statusHistory:[{status:'Draft',changedAt:demoAt(56+i),changedBy:DEMO_ERP_USER_ID},{status:'Received',changedAt:demoAt(66+i),changedBy:DEMO_ERP_USER_ID}]});out.push(ref(ref(po,'vendorId','vendors',id('VEN',i)),'projectId','projects',id('PRJ',i+3)));{const grn=doc('goods_receipts',id('GRN',i),{goodsReceiptId:id('GRN',i),purchaseOrderId:po.id,vendorId:id('VEN',i),vendorName:vendorNames[i-1],projectId:id('PRJ',i+3),warehouseId:id('WH',((i-1)%3)+1),warehouseName:warehouseNames[(i-1)%3],receivedDate:demoDate(67+i),receivedBy:DEMO_ERP_USER_ID,notes:'Fictional receipt.',receivedItems:items.map((x,j)=>({lineIndex:j,productId:x.productId,product:x.product,qty:x.qty,unit:x.unit,orderedQty:x.qty,previouslyReceivedQty:0})),stockEntries:items.map((x,j)=>({productId:x.productId,stockId:id('STK',(i-1)*3+j+1),ledgerId:id('LED',(i-1)*3+j+1),transactionId:id('TX',(i-1)*3+j+1)}))});out.push(ref(ref(grn,'purchaseOrderId','purchase_orders',po.id),'warehouseId','warehouses',String(grn.data.warehouseId)))}}const stockKeys=['PANEL','INV5','INV25','HYBRID','STRUCT','GI','DC','AC','DCDB','ACDB','METER','MON','BAT'];stockKeys.forEach((k,j)=>{const warehouseId=id('WH',(j%3)+1),available=[90,8,5,2,45,120,700,180,12,10,14,9,2][j],reserved=j<8?Math.floor(available*.25):0;const stock=doc('stock',id('STK',j+1),{stockId:id('STK',j+1),productId:productIds[k],warehouseId,availableQty:available,reservedQty:reserved,onHandQty:available+reserved,reorderLevel:j<3?10:5,updatedAt:demoAt(100)});out.push(ref(ref(stock,'productId','products',productIds[k]),'warehouseId','warehouses',warehouseId));const ledger=doc('stock_ledger',id('LED',j+1),{ledgerId:id('LED',j+1),transactionId:id('TX',j+1),productId:productIds[k],warehouseId,movementType:'Opening',qty:available+reserved,direction:'IN',movementAt:demoAt(68+j),referenceType:'DemoOpening',referenceId:DEMO_SEED_ID,balanceAfter:available+reserved});out.push(ref(ref(ledger,'productId','products',productIds[k]),'warehouseId','warehouses',warehouseId))});
  // Phase 9: statuses/approvalStatus now mirror the real dispatchWorkflow.ts
  // enum exactly (previously used an invented 'Verified' status value that
  // the real code never writes, and never set approvalStatus at all, so the
  // Dispatch KPI's Scheduled/Verified buckets could never match any demo
  // record). i=1 pending approval; i=2 approved but not yet executed (the
  // real meaning of the "Verified" KPI bucket — approvalStatus:'Approved'
  // with status still 'Pending Verification'); i=3 in transit; i=4 delivered
  // but not yet closed (a real, persistent state as of this phase's
  // confirmDelivery() fix); i=5 fully closed — previously no demo dispatch
  // ever reached the real terminal state at all.
  // Phase 15.1: previously this loop only covered PRJ-6..10, leaving PRJ-5
  // (the Project genuinely AT the Dispatch stage) with NO Dispatch record at
  // all, while PRJ-6/7 (already past Dispatch, at QC/NetMetering) showed
  // Dispatch still 'Pending Verification' — an impossible sequence. Now
  // covers PRJ-5..10 (project=i+4): PRJ-5's own Dispatch is genuinely
  // in-progress ('Pending Verification'); PRJ-6..10 (all past Dispatch) each
  // show a resolved Dispatch ('Delivered' or 'Closed').
  for(let i=1;i<=6;i++){const project=i+4;const items=systemLines(project-1).slice(0,5).map(x=>({productId:x.productId,product:x.product,quantity:Math.min(x.qty,30),unit:x.unit}));const status=i===1?'Pending Verification':i<=4?'Delivered':'Closed';const delivered=i>=2;const closed=i>=5;const dispatch=doc('dispatch',id('DSP',i),{dispatchId:id('DSP',i),dispatchNumber:`DDSP-${String(i).padStart(4,'0')}`,projectId:id('PRJ',project),orderId:id('ORD',project-3),warehouseId:id('WH',((i-1)%3)+1),items,status,approvalStatus:i===1?'Pending':'Approved',dispatchDate:demoDate(78+i),deliveryDate:delivered?demoDate(81+i):'',...(delivered?{deliveryConfirmed:true,deliveredAt:demoAt(84+i),deliveredBy:DEMO_ERP_USER_ID}:{}),...(closed?{closedAt:demoAt(86+i),closedBy:DEMO_ERP_USER_ID}:{}),vehicleNo:`MH12DM${String(1000+i).slice(-4)}`,driverName:['Sandeep Waghmare','Ganesh Pawar','Ramesh Jadhav'][(i-1)%3],notes:'No external transport operation.',createdAt:demoAt(78+i)});out.push(ref(ref(ref(dispatch,'projectId','projects',id('PRJ',project)),'orderId','orders',id('ORD',project-3)),'warehouseId','warehouses',String(dispatch.data.warehouseId)))}return out}
function installationChecklist(doneCount:number){const items=['Site readiness verified','Mounting structure installed','Solar panels mounted','Inverter installed','DC wiring completed','AC wiring completed','Earthing / grounding verified','String connections verified','System powered on','Generation test passed'];return items.map((item,idx)=>({item,completed:idx<doneCount,...(idx<doneCount?{completedAt:demoAt(84+idx),completedBy:id('USR',4)}:{})}))}
function buildExecution():DemoDocument[]{const out:DemoDocument[]=[];
  // Phase 10: real, Project-scoped installations collection. Previously this
  // dataset never set installation fields on the Lead at all, and qc_checks
  // below had no installationId — permanently breaking the real
  // qc_checks -> installations -> projects caseId propagation chain for
  // every demo QC record. One installation doc per Project, keyed the same
  // way installationEngine.ts's ensureInstallationForLead() keys real ones.
  const installDoneCounts=[9,8,10,10,10],installStatuses=['quality_inspection','quality_inspection','quality_inspection','completed','completed'];
  const installations:DemoDocument[]=[];
  for(let i=1;i<=5;i++){const project=i+5,leadId=id('LEAD',project+1),inst=doc('installations',id('INST',i),{installationId:id('INST',i),projectId:id('PRJ',project),leadId,installationStatus:installStatuses[i-1],checklist:installationChecklist(installDoneCounts[i-1]),capturedSerialNumbers:i>=4?[{serialNumber:`DEMO-SN-${1000+i}`,productId:productIds['INV5'],product:products['INV5'][0],capturedAt:demoAt(92+i),capturedBy:id('USR',4)}]:[],assignedEngineerId:id('USR',4),assignedEngineerName:'Meera Pillai',assignedEngineerPhone:'0000005004'});installations.push(ref(ref(inst,'projectId','projects',id('PRJ',project)),'leadId','leads',leadId))}
  out.push(...installations);
  // Phase 15.1: the real serial-capture flow (installationEngine.ts's
  // captureSerial()) writes a standalone COLLECTIONS.SERIAL_NUMBERS document
  // for every captured serial, in addition to mirroring it onto the
  // Lead/Installation's own capturedSerialNumbers array — this dataset only
  // ever had the embedded array, never the standalone collection doc, so
  // serial_numbers was entirely empty despite being listed in
  // DEMO_RESETTABLE_COLLECTIONS. One doc per already-embedded serial (i=4,5
  // above), using the real field shape (no invented warehouseId/status —
  // the real schema has neither).
  for(let i=4;i<=5;i++){const project=i+5;out.push(ref(doc('serial_numbers',id('SRL',i-3),{serialNumber:`DEMO-SN-${1000+i}`,productId:productIds['INV5'],product:products['INV5'][0],installationId:installations[i-1].id,capturedAt:demoAt(92+i),capturedBy:id('USR',4)}),'installationId','installations',installations[i-1].id))}
  // Phase 15.1: QC/Commissioning/NetMetering/Subsidy status now agree with
  // each Project's own currentStage (buildCustomersProjects()) — a Project
  // cannot be genuinely "at" NetMetering/Subsidy/Handover/Service while its
  // own QC is still pending/failed or its Commissioning incomplete; every
  // STAGE BEFORE the project's current one must show a resolved/passed
  // outcome, and only the record matching the project's own current stage
  // may still be in-progress. PRJ-6 (currentStage='QC') is the sole project
  // still genuinely in QC — its record stays 'in_progress' (not yet
  // resolved either way), which is also *why* it hasn't advanced past QC
  // yet. PRJ-7..10 (currentStage NetMetering/Subsidy/Handover/Service, all
  // past QC) all show QC='passed'. This replaces the previous version's
  // 'failed' QC example, which was attached to PRJ-8 — a project the local
  // `stages` list claims has already reached 'Subsidy', several stages past
  // QC, which cannot be true if its QC genuinely failed and was never
  // resolved; the QC-fail/rework-regression guard this was meant to
  // demonstrate is unit-tested directly in qcWorkflow's own test suite, not
  // dependent on this demo fixture.
  for(let i=1;i<=5;i++){const project=i+5,resolved=i>=2,qc=doc('qc_checks',id('QC',i),{qcId:id('QC',i),projectId:id('PRJ',project),installationId:installations[i-1].id,installationName:`Installation for ${id('PRJ',project)}`,assignedTo:id('USR',4),status:resolved?'passed':'in_progress',scheduledAt:demoAt(88+i),completedAt:resolved?demoAt(90+i):null,checklist:[{key:'earthing',label:'Earthing continuity',status:resolved?'passed':'pending'},{key:'isolation',label:'DC/AC isolation',status:resolved?'passed':'pending'}],remarks:resolved?'Demo QC inspection — passed.':'Demo QC inspection in progress; awaiting sign-off.'});out.push(ref(ref(qc,'projectId','projects',id('PRJ',project)),'installationId','installations',installations[i-1].id))}// Phase 11: every record below now uses the REAL field names each
// workflow's own TypeScript interface declares (commissioningWorkflow.ts /
// netMeteringWorkflow.ts / subsidyWorkflow.ts / projectHandoverWorkflow.ts /
// amcWorkflow.ts / serviceTicketWorkflow.ts) — the previous version invented
// field names (referenceNumber/submittedAt/approvedAt/amount/subject/openedAt/
// amcId/handoverId/checklist/documents, etc.) that none of those interfaces
// declare and none of those workflows' UI (HandoverOverview.tsx,
// AmcContracts.tsx, etc.) ever reads, so demo records for these six modules
// rendered blank projectName/customerName/contractValue/statusHistory/etc.
// everywhere the real UI displays them. Required fields absent from the old
// shape (discomName, applicationNumber, schemeName, statusHistory,
// disbursements, handoverNumber, contractNumber, contractValue, ticketNumber,
// issueType, reportedDate) are now genuinely populated, not invented — every
// value is drawn from the same real enum/shape the workflow file declares.
const projName=(p:number)=>scenarioNames[p-1];
const custName=(p:number)=>customerDisplayNames[p-1];
// Phase 15.1: Commissioning must be 'completed' for every one of PRJ-7..10
// (project=i+6, i=1..4) — all four have already moved on to NetMetering,
// Subsidy, Handover, or Service in their own currentStage, none of which is
// reachable with Commissioning still 'pending' (Commissioning precedes all
// four in the canonical order). Previously only i>2 (PRJ-9,10) were marked
// completed, leaving PRJ-7/PRJ-8 (NetMetering-/Subsidy-stage projects) with
// an incomplete Commissioning despite being stages past it.
for(let i=1;i<=4;i++){const project=i+6,c=doc('commissioning_records',id('COM',i),{projectId:id('PRJ',project),projectName:projName(project),qcId:id('QC',i+1),status:'completed',isCompleted:true,commissionedDate:demoDate(96+i),commissionedBy:id('USR',4),commissionedByName:'Meera Pillai',customerName:custName(project),generationTestKwh:money(capacities[project-1]*.82),warrantyStartDate:demoDate(96+i),warrantyMonths:60,customerSignoff:true,customerSignoffUrl:'demo://signoff-placeholder',notes:'Fictional commissioning; no signature or certificate uploaded.'});out.push(ref(ref(c,'projectId','projects',id('PRJ',project)),'qcId','qc_checks',id('QC',i+1)))}
// NetMetering: only PRJ-7 (currentStage='NetMetering' — i.e. genuinely still
// in this stage) is left in-progress ('Submitted'); PRJ-8/9/10 (Subsidy/
// Handover/Service — all past NetMetering) show the fully-resolved
// 'MeterInstalled' state, each with its complete status history rather than
// a history trimmed to only what "i" happened to be.
for(let i=1;i<=4;i++){const project=i+6,resolved=i>=2,status=resolved?'MeterInstalled':'Submitted';const historyEntries:{status:string;changedAt:string}[]=[{status:'Submitted',changedAt:demoAt(100+i)}];if(resolved){historyEntries.push({status:'UnderReview',changedAt:demoAt(104+i)},{status:'Approved',changedAt:demoAt(108+i)},{status:'MeterInstalled',changedAt:demoAt(112+i)})}const nm=doc('net_metering_applications',id('NET',i),{projectId:id('PRJ',project),projectName:projName(project),discomName:`${['MPPKVVCL','PGVCL','MSEDCL','MSEDCL'][i-1]} (Demo)`,applicationNumber:`DEMO-NM-${String(i).padStart(4,'0')}`,status,submittedDate:demoDate(100+i),approvedDate:resolved?demoDate(108+i):'',meterInstalledDate:resolved?demoDate(112+i):'',expectedMeterInstallationDate:demoDate(116+i),statusHistory:historyEntries,notes:'Fictional authority workflow; no submission occurs.'});out.push(ref(nm,'projectId','projects',id('PRJ',project)));
  // Subsidy: PRJ-7 (NetMetering stage) has just filed ('Submitted', running
  // in parallel with net metering — realistic, since subsidy applications
  // are not gated on net metering completion in the real scheme). PRJ-8
  // (Subsidy stage) is genuinely in-progress ('UnderReview'). PRJ-9
  // (Handover stage) is 'Approved' but not yet 'Disbursed' — a deliberate,
  // real-world-realistic lag (disbursement can trail physical handover by
  // months; see Blueprint Appendix E's own policy note on this), not an
  // incoherence. PRJ-10 (Service stage) is fully 'Disbursed'.
  const subStatus=i===1?'Submitted':i===2?'UnderReview':i===3?'Approved':'Disbursed',sanctioned=capacities[project-1]<=10?78000:0,disbursed=subStatus==='Disbursed'?sanctioned:0;const subHistory:{status:string;changedAt:string}[]=[{status:'Submitted',changedAt:demoAt(102+i)}];if(i>=2)subHistory.push({status:'UnderReview',changedAt:demoAt(106+i)});if(i>=3)subHistory.push({status:'Approved',changedAt:demoAt(112+i)});if(i>=4)subHistory.push({status:'Disbursed',changedAt:demoAt(116+i)});const sub=doc('subsidy_applications',id('SUB',i),{projectId:id('PRJ',project),projectName:projName(project),schemeName:'PM Surya Ghar (Demo)',schemeType:'Central Scheme',applicationNumber:`DEMO-SUB-${String(i).padStart(4,'0')}`,status:subStatus,applicationDate:demoDate(101+i),submittedDate:demoDate(102+i),approvedDate:i>=3?demoDate(112+i):'',disbursedDate:subStatus==='Disbursed'?demoDate(116+i):'',totalSanctionedAmount:sanctioned,totalDisbursedAmount:disbursed,documentsSubmitted:[],statusHistory:subHistory,disbursements:subStatus==='Disbursed'?[{id:id('DISB',i),amount:disbursed,disbursedDate:demoDate(116+i),referenceNumber:`DEMO-DISB-${i}`,disbursedBy:DEMO_ERP_USER_ID,createdAt:demoAt(116+i)}]:[],notes:'Fictional subsidy workflow; no identity or bank data.'});out.push(ref(sub,'projectId','projects',id('PRJ',project)))}
for(let i=1;i<=2;i++){const project=i+8,h=doc('project_handovers',id('HND',i),{projectId:id('PRJ',project),projectName:projName(project),customerId:id('CUS',project),customerName:custName(project),handoverNumber:id('HND',i),handoverDate:demoDate(119+i),scheduledDate:demoDate(118+i),completedDate:demoDate(119+i),assignedEngineer:id('USR',4),assignedEngineerName:'Meera Pillai',status:'Completed',statusHistory:[{status:'Draft',changedAt:demoAt(117+i),changedBy:DEMO_ERP_USER_ID},{status:'Scheduled',changedAt:demoAt(118+i),changedBy:DEMO_ERP_USER_ID},{status:'Completed',changedAt:demoAt(119+i),changedBy:DEMO_ERP_USER_ID}],completedAt:demoAt(119+i),completedBy:DEMO_ERP_USER_ID,notes:'Fictional handover; no binary documents.'});out.push(ref(ref(h,'projectId','projects',id('PRJ',project)),'customerId','customers',id('CUS',project)))}
// Phase 15.1: an AMC contract is realistic for BOTH PRJ-9 (Handover stage —
// AMC is routinely set up as part of the handover paperwork itself) and
// PRJ-10 (Service stage). A Service Ticket, however, is only realistic for
// PRJ-10: an already Open/Resolved ticket implies the project has genuinely
// experienced post-handover service activity, i.e. has actually reached the
// Service stage — seeding one against PRJ-9 (still at Handover) would be
// exactly the "Project at Service merely because a ticket was seeded"
// incoherence this correction is required to avoid. So only ONE
// service_tickets doc exists now (was 2), scoped to PRJ-10/AMC-2.
const amcDocs:DemoDocument[]=[];
for(let i=1;i<=2;i++){const project=8+i,a=doc('amc_contracts',id('AMC',i),{projectId:id('PRJ',project),projectName:projName(project),customerId:id('CUS',project),customerName:custName(project),contractNumber:id('AMC',i),startDate:demoDate(120+i),endDate:demoDate(485+i),visitsPerYear:2,contractValue:capacities[project-1]*1200,assignedTo:id('USR',5),assignedToName:'Vihaan Kulkarni',status:'Active',statusHistory:[{status:'Draft',changedAt:demoAt(119+i),changedBy:DEMO_ERP_USER_ID},{status:'Active',changedAt:demoAt(120+i),changedBy:DEMO_ERP_USER_ID}],activatedAt:demoAt(120+i),activatedBy:DEMO_ERP_USER_ID,notes:'Fictional preventive-maintenance contract.'});amcDocs.push(a);out.push(ref(a,'projectId','projects',id('PRJ',project)));
  for(let m=0;m<4;m++)out.push(ref(doc('generation_readings',id('GEN',(i-1)*4+m+1),{projectId:id('PRJ',project),readingDate:demoDate(121+i+m*7),generationKwh:money(capacities[project-1]*4.1*(m+1)),readingKwh:money(capacities[project-1]*4.1*(m+1)),recordedBy:DEMO_ERP_USER_ID,recordedByName:'Neozy Demo Operator',source:'Manual Demo Reading',externalProviderId:''}),'projectId','projects',id('PRJ',project)))}
{const project=10,a=amcDocs[1],s=doc('service_tickets',id('SVC',1),{projectId:id('PRJ',project),projectName:projName(project),customerId:id('CUS',project),customerName:custName(project),ticketNumber:id('SVC',1),issueType:'Monitoring Fault',description:'Monitoring gateway lost connectivity; fictional demo issue.',priority:'Medium',reportedDate:demoDate(125),assignedTechnician:id('USR',5),assignedTechnicianName:'Vihaan Kulkarni',amcContractId:a.id,amcContractNumber:String(a.data.contractNumber),status:'Resolved',statusHistory:[{status:'Open',changedAt:demoAt(125),changedBy:DEMO_ERP_USER_ID},{status:'InProgress',changedAt:demoAt(126),changedBy:DEMO_ERP_USER_ID},{status:'Resolved',changedAt:demoAt(127),changedBy:DEMO_ERP_USER_ID}],resolvedDate:demoDate(127),resolvedAt:demoAt(127),resolvedBy:DEMO_ERP_USER_ID,notes:'Fictional service workflow; no external action.'});out.push(ref(ref(ref(s,'projectId','projects',id('PRJ',project)),'customerId','customers',id('CUS',project)),'amcContractId','amc_contracts',a.id))}
return out}
function buildOperations():DemoDocument[]{const out:DemoDocument[]=[];const taskKinds=[['Follow up with new lead','leads',id('LEAD',1)],['Complete site survey','projects',id('PRJ',1)],['Review engineering design','engineering_designs',id('ENG',1)],['Approve negotiated quotation','quotations',id('QUO',1)],['Collect staged payment','proforma_invoices',id('INV',1)],['Receive vendor material','purchase_orders',id('PO',5)],['Prepare project dispatch','dispatch',id('DSP',1)],['Close QC rework','qc_checks',id('QC',3)],['Submit net-metering response','net_metering_applications',id('NET',2)],['Schedule AMC visit','amc_contracts',id('AMC',2)]] as const;taskKinds.forEach((x,i)=>{const t=doc('tasks',id('TSK',i+1),{taskId:id('TSK',i+1),title:x[0],description:'Fictional demo operational task.',assignedTo:id('USR',(i%5)+1),assignedToId:id('USR',(i%5)+1),assignedToName:'Demo Assignee',createdBy:DEMO_ERP_USER_ID,status:i<3?'Open':i<7?'In Progress':'Done',priority:i%3?'Medium':'High',dueDate:demoDate(130+i),entityType:x[1],entityId:x[2],createdAt:demoAt(105+i)});out.push(ref(t,'entityId',x[1],x[2]));out.push(ref(doc('notifications',id('NOT',i+1),{notificationId:id('NOT',i+1),userId:id('USR',(i%5)+1),recipientUserId:id('USR',(i%5)+1),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:x[0],message:`Demo task requires attention: ${x[0]}.`,body:`Demo task requires attention: ${x[0]}.`,type:'task',read:i>=7,isRead:i>=7,entityType:x[1],entityId:x[2],createdAt:demoAt(106+i),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId',x[1],x[2]))});
  // Notifications repair: the task set above is task-only — add realistic
  // workflow notifications (payment, dispatch, assignment, document/action
  // required, order) linked to EXISTING demo entities so Demo Mode
  // demonstrates the full notification surface. All follow the canonical
  // shape sendNotification() writes (createdBy = demo operator, visibleTo =
  // [recipient, creator], real NotificationType values) and each is
  // graph-referenced to its source entity.
  const workflowNotifs:DemoDocument[]=[
    ref(doc('notifications',id('NOT',11),{notificationId:id('NOT',11),userId:id('USR',2),recipientUserId:id('USR',2),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'Payment received',message:'Staged payment recorded against proforma invoice DEMO-V1-INV-003.',body:'Staged payment recorded against proforma invoice DEMO-V1-INV-003.',type:'PAYMENT_RECORDED',read:false,isRead:false,entityType:'proforma_invoices',entityId:id('INV',3),createdAt:demoAt(66),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','proforma_invoices',id('INV',3)),
    ref(doc('notifications',id('NOT',12),{notificationId:id('NOT',12),userId:id('USR',3),recipientUserId:id('USR',3),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'Dispatch approval requested',message:'Dispatch DEMO-V1-DSP-002 is pending approval.',body:'Dispatch DEMO-V1-DSP-002 is pending approval.',type:'DISPATCH_REQUESTED',read:false,isRead:false,entityType:'dispatch',entityId:id('DSP',2),createdAt:demoAt(79),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','dispatch',id('DSP',2)),
    ref(doc('notifications',id('NOT',13),{notificationId:id('NOT',13),userId:id('USR',4),recipientUserId:id('USR',4),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'Customer assigned to you',message:'Customer DEMO-V1-CUS-006 was assigned to your pipeline.',body:'Customer DEMO-V1-CUS-006 was assigned to your pipeline.',type:'CUSTOMER_ASSIGNED',read:false,isRead:false,entityType:'customers',entityId:id('CUS',6),createdAt:demoAt(55),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','customers',id('CUS',6)),
    ref(doc('notifications',id('NOT',14),{notificationId:id('NOT',14),userId:id('USR',5),recipientUserId:id('USR',5),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'New lead assigned',message:'Lead DEMO-V1-LEAD-004 was assigned to your pipeline.',body:'Lead DEMO-V1-LEAD-004 was assigned to your pipeline.',type:'LEAD_ASSIGNED',read:true,isRead:true,entityType:'leads',entityId:id('LEAD',4),createdAt:demoAt(74),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','leads',id('LEAD',4)),
    ref(doc('notifications',id('NOT',15),{notificationId:id('NOT',15),userId:id('USR',2),recipientUserId:id('USR',2),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'Quotation documents required',message:'Signed quotation and KYC documents are pending for quotation DEMO-V1-QUO-002.',body:'Signed quotation and KYC documents are pending for quotation DEMO-V1-QUO-002.',type:'DOCUMENT_REQUIRED',read:false,isRead:false,entityType:'quotations',entityId:id('QUO',2),createdAt:demoAt(42),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','quotations',id('QUO',2)),
    ref(doc('notifications',id('NOT',16),{notificationId:id('NOT',16),userId:id('USR',3),recipientUserId:id('USR',3),visibleTo:[DEMO_ERP_USER_ID],createdBy:DEMO_ERP_USER_ID,title:'Order placed',message:'Order DEMO-V1-ORD-003 was placed for customer DEMO-V1-CUS-006.',body:'Order DEMO-V1-ORD-003 was placed for customer DEMO-V1-CUS-006.',type:'ORDER_PLACED',read:true,isRead:true,entityType:'orders',entityId:id('ORD',3),createdAt:demoAt(57),deliveryChannels:{inApp:true,email:false,sms:false,whatsapp:false}}),'entityId','orders',id('ORD',3)),
  ];
  out.push(...workflowNotifs);
  const chain:[string,string][]=[['leads','customers'],['customers','projects'],['projects','surveys'],['surveys','engineering_designs'],['projects','quotations'],['quotations','orders'],['orders','proforma_invoices'],['proforma_invoices','payments'],['orders','dispatch'],['projects','qc_checks'],['qc_checks','commissioning_records'],['projects','project_handovers'],['projects','amc_contracts'],['amc_contracts','service_tickets']];chain.forEach(([from,to],i)=>{const n=i+1,sourceId=from==='leads'?id('LEAD',4):from==='customers'?id('CUS',3):from==='projects'?id('PRJ',Math.min(10,3+Math.floor(i/2))):from==='surveys'?id('SRV',3):from==='engineering_designs'?id('ENG',2):from==='quotations'?id('QUO',2):from==='orders'?id('ORD',3):from==='proforma_invoices'?id('INV',3):from==='qc_checks'?id('QC',4):from==='amc_contracts'?id('AMC',1):id('PRJ',9);const targetId=to==='customers'?id('CUS',3):to==='projects'?id('PRJ',3):to==='surveys'?id('SRV',3):to==='engineering_designs'?id('ENG',2):to==='quotations'?id('QUO',2):to==='orders'?id('ORD',2):to==='proforma_invoices'?id('INV',3):to==='payments'?id('PAY',9):to==='dispatch'?id('DSP',2):to==='qc_checks'?id('QC',4):to==='commissioning_records'?id('COM',3):to==='project_handovers'?id('HND',1):to==='amc_contracts'?id('AMC',1):id('SVC',1);const rel=doc('entity_relationships',id('REL',n),{relationshipId:id('REL',n),sourceType:from,sourceId,targetType:to,targetId,relation:'linked_to',createdAt:demoAt(115+n)});out.push(ref(ref(rel,'sourceId',from,sourceId),'targetId',to,targetId))});return out}

// Phase 14 (Documents / Activities / Linked Records): real, persisted
// COLLECTIONS.DOCUMENTS entries scoped to the five newly-covered entities
// (Order/Quotation/ProformaInvoice/Dispatch/Payment) — the same shared
// caseDocuments.ts collection Lead/Customer/Project/Survey/Engineering
// already use (see EntityDocumentsPanel.tsx). Previously ZERO documents of
// any kind existed anywhere in Demo Mode's seed data, for any entity,
// including the five already-complete ones — Phase 14 is the first phase to
// seed this collection at all. URLs use the same non-fetchable `demo://`
// placeholder scheme already established for other demo-only file
// references (see commissioning_records.customerSignoffUrl above) — never a
// real http(s) URL, consistent with "no external delivery or binary side
// effects" (see demoBusinessGraph.test.ts).
const DOCUMENT_TARGET_COLLECTION:Record<string,string>={orderId:'orders',quotationId:'quotations',invoiceId:'proforma_invoices',dispatchId:'dispatch',paymentId:'payments',customerId:'customers',projectId:'projects'};
function buildPhase14Documents():DemoDocument[]{
  const out:DemoDocument[]=[];
  const entries:['order'|'quotation'|'invoice'|'dispatch'|'payment',Record<string,unknown>,string,string,string,unknown][]=[
    ['quotation',{quotationId:id('QUO',2)},'Signed Quotation.pdf','Quotation Approval',id('QUO',2),demoAt(41)],
    ['order',{orderId:id('ORD',3),customerId:id('CUS',6),projectId:id('PRJ',6)},'Purchase Order Confirmation.pdf','Order Confirmation',id('ORD',3),demoAt(56)],
    ['invoice',{invoiceId:id('INV',3),orderId:id('ORD',3),customerId:id('CUS',6)},'Signed Proforma Invoice.pdf','Invoice Copy',id('INV',3),demoAt(58)],
    ['dispatch',{dispatchId:id('DSP',2),orderId:id('ORD',4)},'Delivery Photo.jpg','Delivery Proof',id('DSP',2),demoAt(80)],
    ['payment',{paymentId:id('PAY',5),invoiceId:id('INV',3),orderId:id('ORD',3),customerId:id('CUS',6)},'Payment Receipt.pdf','Payment Receipt',id('PAY',5),demoAt(64)],
  ];
  entries.forEach(([sourceEntityType,scope,name,label,slug,uploadedAt],index)=>{
    const mimeType=name.endsWith('.pdf')?'application/pdf':'image/jpeg';
    const d=doc('documents',id('CDOC',index+1),{
      name,url:`demo://document-placeholder/${slug.toLowerCase()}`,mimeType,size:mimeType==='application/pdf'?248_000:612_000,
      uploadedAt,uploadedBy:DEMO_ERP_USER_ID,uploaderName:'Neozy Demo Operator',label,sourceEntityType,...scope,
    });
    let withRefs=d;
    for(const [field,value] of Object.entries(scope)){
      const targetCollection=DOCUMENT_TARGET_COLLECTION[field];
      if(targetCollection)withRefs=ref(withRefs,field,targetCollection,String(value));
    }
    out.push(withRefs);
  });
  return out;
}

const channelPartnerFirms=['GreenLeaf Solar Consultants','Sunrise Referral Associates'];
const channelPartnerContacts=['Alok Bansal','Ritu Chawla'];
function buildPartnerCommissions():DemoDocument[]{const out:DemoDocument[]=[];const partners=[1,2].map(i=>doc('channel_partners',id('PART',i),{userId:i===1?DEMO_ERP_USER_ID:'',managerId:assigneeIds[5],firmName:channelPartnerFirms[i-1],contactPerson:channelPartnerContacts[i-1],email:`${channelPartnerContacts[i-1].toLowerCase().replace(/\s+/g,'.')}@demo.example.invalid`,phone:`000000${String(5000+i).padStart(4,'0')}`,address:{line1:streetAddresses[(i+5)%streetAddresses.length],city:cities[(i+5)%cities.length],state:cityStates[(i+5)%cityStates.length],pincode:cityPincodes[(i+5)%cityPincodes.length],country:'India'},status:'active',statusHistory:[{status:'active',changedAt:demoAt(30),changedBy:DEMO_ERP_USER_ID}],tier:i===1?'silver':'bronze',tierHistory:[],walletBalance:i===1?18500:9000,pendingBalance:0,totalCommissionEarned:i===1?18500:9000,totalCommissionPaid:0,totalLeadsCreated:2,totalLeadsConverted:1,conversionRate:50,averageCommissionPerLead:i===1?18500:9000,assignedSalesPerson:id('USR',1),notes:'Fictional demo referral partner; no payout identity documents.'}));out.push(...partners);const rule=doc('commission_rules',id('CRULE',1),{name:'Residential Referral Commission',description:'Fictional demo percentage rule.',type:'percentage',isActive:true,value:1.5,applicableTo:'all',effectiveFrom:demoDate(1),priority:10});out.push(rule);[1,2].forEach(i=>{const amount=i===1?18500:9000,c=doc('commission_records',id('COMM',i),{leadId:id('LEAD',i+3),partnerId:id('PART',i),dealValue:money(amount/0.015),systemSizeKW:capacities[i+2],ruleId:rule.id,ruleName:String(rule.data.name),ruleType:'percentage',ruleValue:1.5,amount,status:'approved',generatedDate:demoAt(75+i),approvedBy:DEMO_ERP_USER_ID,approvedAt:demoAt(76+i),approvedAmount:amount,calculationBreakdown:{basis:'dealValue',ratePercent:1.5}});out.push(ref(ref(ref(c,'leadId','leads',String(c.data.leadId)),'partnerId','channel_partners',id('PART',i)),'ruleId','commission_rules',rule.id));
    // Phase 15.1: partner_wallet_transactions was listed in
    // DEMO_RESETTABLE_COLLECTIONS but never actually seeded anywhere — one
    // real commission_credit transaction per partner, exactly matching the
    // walletBalance/totalCommissionEarned already set on that partner's own
    // doc above (balanceBefore:0 -> balanceAfter:walletBalance), sourced
    // from this same commission_records doc.
    const wt=doc('partner_wallet_transactions',id('PWT',i),{partnerId:id('PART',i),type:'commission_credit',amount,balanceBefore:0,balanceAfter:amount,sourceType:'commission',sourceId:c.id,description:`Commission credited for ${String(c.data.leadId)} referral.`});out.push(ref(ref(wt,'partnerId','channel_partners',id('PART',i)),'sourceId','commission_records',c.id))
  });return out}

// Phase 15.1: Loan Applications (the real, distinct pre-Project financing
// module — src/features/loan-applications/services/loanApplicationWorkflow.ts,
// user-facing name "Loan Applications", Firestore collection 'registrations'
// retained unchanged for backward compatibility) was previously ONLY ever
// seeded by the removed duplicate api/demo-reset.ts dataset, whose hardcoded
// customerId/projectId references ('DEMO-V1-CUSTOMERS-001' etc.) never matched
// this generator's real IDs anyway (id('CUS',n) here yields 'DEMO-V1-CUS-00N',
// a different "kind" string).
// Six loan applications, each linked to a REAL existing B2C customer+project
// (CUS-1/PRJ-1, CUS-4/PRJ-4, CUS-7/PRJ-7, CUS-8/PRJ-8, CUS-9/PRJ-9,
// CUS-10/PRJ-10) and spread across six distinct real statuses — Draft /
// Digital Sign Pending / Under Review / Approved / Payment Received / Rejected
// — so every status value used is one the real loanApplicationWorkflow.ts
// itself keys STATUS_AUTO_TASKS/STATUS_NOTIFICATIONS on, never invented.
// bankName is a plain denormalized string (the real schema has no bankId FK),
// matching one of the seeded banks by name, and the Rejected record carries a
// real rejectionReason that LoanApplicationDetailModal renders.
// ── CP-15: Scheme Registrations (Vendor Lock / Portal Registration) ─────────
// Eight demo records across eight NEW partner-owned projects (PRJ-11..18,
// stages New / SchemeRegistration — the canonical Registration window),
// exercising ALL eight authoritative statuses with strictly legal
// statusHistory sequences (the 16-edge SCHEME_REGISTRATION_TRANSITIONS map
// from the real types module — never an invented transition), valid
// required-document states and the vendor-lock/survey-ready data contract.
// Ownership is the canonical chain — project.partnerId → partnerId, plus
// managerId (the partner's TL/Manager user) and userId (the partner's
// linked user), exactly as createSchemeRegistration derives them in
// production. Loan 'registrations' (buildLoanApplications) is untouched.
const schemeProjectNames=['Wagholi Farmhouse Solar Array','Hinjewadi Terrace Solar System','Sinhagad Road Rooftop Plant','Baner Hills Solar Canopy','Magarpatta Villa Solar System','Kothrud Bungalow Solar Array','Aundh Residence Solar Plant','Warje Heights Solar Rooftop'];
const schemeCustomerNames=['Anil Pawar','Geeta Kulkarni','Farhan Shaikh','Rekha Nair','Vikram Rathod','Sneha Deshpande','Manish Gupta','Kavita Sharma'];
// Partner per record (PART-1 owns 5, PART-2 owns 3) — each registration is
// filed against a project owned by the SAME partner (never a foreign graph).
// Only PART-1 has a linked demo user (channel_partners.userId), so records
// owned by PART-1 carry userId while PART-2 records intentionally do not —
// mirroring the canonical channel_partners doc, never inventing a link.
const schemePartnerByIndex=[1,1,1,2,2,1,1,2];
// [projectStage, status, portalDay] per record (statuses cover all 8).
const schemeStates:ReadonlyArray<[string,string,number]>=[
  ['New','Draft',131],
  ['SchemeRegistration','Submitted',132],
  ['SchemeRegistration','UnderVerification',133],
  ['SchemeRegistration','VendorLocked',134],
  ['SchemeRegistration','Completed',135],
  ['SchemeRegistration','Rejected',136],
  ['SchemeRegistration','Failed',137],
  ['New','Cancelled',138],
];
const SCHEME_PROJECT_TYPES=['Residential','Residential','Commercial','Residential','Residential','Commercial','Residential','Residential'];
const SCHEME_CAPACITIES=[5,8,10,15,25,20,6,12];
function buildSchemeRegistrations():DemoDocument[]{
  const out:DemoDocument[]=[];
  // Linked document records follow the Phase 14 convention: real `documents`
  // collection docs (demo:// URLs, never real Storage) so that
  // registrationShared.tsx's `documentId -> documents` lookup resolves and
  // the Registration detail UI shows linked (not broken) references. CDOC
  // ids continue after the 5 Phase 14 docs (CDOC-006+).
  let nextDocIndex = 6;
  for(let i=1;i<=8;i++){
    const projectId=id('PRJ',10+i),customerId=id('CUS',16+i),leadId=id('LEAD',21+i),regId=id('SREG',i);
    const partner=schemePartnerByIndex[i-1],partnerOwner={partnerId:id('PART',partner),partnerName:channelPartnerFirms[partner-1]};
    const [stage,status,portalDay]=schemeStates[i-1];
    const phone=`000000${String(3000+i).padStart(4,'0')}`,leadPhone=`000000${String(6000+i).padStart(4,'0')}`;
    const city=cities[(i+2)%cities.length],state=cityStates[(i+2)%cityStates.length],pincode=cityPincodes[(i+2)%cityPincodes.length],address=`${streetAddresses[(i+2)%streetAddresses.length]}, ${city}`;
    const email=(name:string)=>`${name.toLowerCase().replace(/[^a-z0-9]+/g,'.')}@demo.example.invalid`;
    // ── Lead (converted, partner-sourced) ──
    const lead=doc('leads',leadId,{leadId,name:schemeCustomerNames[i-1],phone:leadPhone,email:email(schemeCustomerNames[i-1]),city,state,source:'Partner',...partnerOwner,segment:'Residential',capacityKw:SCHEME_CAPACITIES[i-1],priority:'High',status:'Converted',assignedTo:id('USR',1),followUpDate:demoDate(126+i),customerId,projectId,convertedAt:demoAt(128+i),createdAt:demoAt(126+i),updatedAt:demoAt(130+i),notes:'Fictional demo inquiry; no external contact is permitted.'});
    out.push(ref(ref(lead,'customerId','customers',customerId),'projectId','projects',projectId));
    // ── Customer (B2C, partner-referred) ──
    const customer=doc('customers',customerId,{customerId,name:schemeCustomerNames[i-1],phone,email:email(schemeCustomerNames[i-1]),address,city,state,pincode,type:'B2C',projectType:'Residential',leadId,createdAt:demoAt(128+i),...partnerOwner,sourceLeadId:leadId});
    out.push(ref(customer,'leadId','leads',leadId));
    out.push(doc('customer_phone_locks',`${DEMO_COMPANY_ID}_${phone}`,{customerId,phone,createdAt:demoAt(128+i)}));
    // ── Project (New / SchemeRegistration — the Registration window) ──
    const stageHistory=[{stage:'New',changedAt:demoAt(129+i),changedBy:DEMO_ERP_USER_ID}];
    if(stage==='SchemeRegistration')stageHistory.push({stage:'SchemeRegistration',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID});
    const project=doc('projects',projectId,{projectId,name:schemeProjectNames[i-1],customerId,leadId,capacityKw:SCHEME_CAPACITIES[i-1],systemType:'On-grid',projectType:SCHEME_PROJECT_TYPES[i-1],siteAddress:address,city,currentStage:stage,status:'Active',assignedSurveyor:id('USR',2),assignedInstaller:id('USR',4),salesOwner:id('USR',1),stageHistory,createdAt:demoAt(127+i),updatedAt:demoAt(132+i),...partnerOwner});
    out.push(ref(ref(project,'customerId','customers',customerId),'leadId','leads',leadId));
    // ── Scheme Registration (the CP-15 record) ──
    const history:(Record<string,unknown>[])=[{status:'Draft',changedAt:demoAt(129+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Registration created'}];
    const submitted=!['Draft','Cancelled'].includes(status);
    const reg:Record<string,unknown>={id:regId,registrationId:regId,projectId,customerId,customerName:schemeCustomerNames[i-1],customerPhone:phone,leadId,companyId:DEMO_COMPANY_ID,...partnerOwner,managerId:assigneeIds[5],...(partner===1?{userId:DEMO_ERP_USER_ID}:{}),schemeName:'PM Surya Ghar (Demo)',portalType:'pmsuryaghar',discom:i%2?'MSEDCL (Demo)':'MPPKVVCL (Demo)',responsibleUserId:DEMO_ERP_USER_ID,responsibleUserName:'Neozy Demo Operator',notes:'Fictional demo scheme registration; no portal submission occurs.',createdBy:DEMO_ERP_USER_ID,createdByName:'Neozy Demo Operator',createdAt:demoAt(129+i),updatedAt:demoAt(133+i),isDeleted:false};
    if(status!=='Draft'&&status!=='Cancelled'){
      reg.registrationDate=demoDate(portalDay);reg.applicationNumber=`DEMO-PSG-${String(i).padStart(3,'0')}`;reg.portalReference=`DEMO-PORTAL-${String(i).padStart(3,'0')}`;
    }
    if(status==='Submitted'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Submitted for verification'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;}
    if(status==='UnderVerification'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'UnderVerification',changedAt:demoAt(131+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Portal verification started'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;reg.verificationStartedAt=demoAt(131+i);reg.verificationStartedBy=DEMO_ERP_USER_ID;}
    if(status==='VendorLocked'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'UnderVerification',changedAt:demoAt(131+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'VendorLocked',changedAt:demoAt(133+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Vendor confirmed on portal'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;reg.verificationStartedAt=demoAt(131+i);reg.verificationStartedBy=DEMO_ERP_USER_ID;reg.vendorId=id('VEN',1);reg.vendorName=vendorNames[0];reg.vendorLockDate=demoDate(133+i);reg.vendorLockedAt=demoAt(133+i);reg.vendorLockedBy=DEMO_ERP_USER_ID;}
    if(status==='Completed'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'UnderVerification',changedAt:demoAt(131+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'VendorLocked',changedAt:demoAt(133+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Vendor confirmed on portal'},{status:'Completed',changedAt:demoAt(135+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Registration closed'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;reg.verificationStartedAt=demoAt(131+i);reg.verificationStartedBy=DEMO_ERP_USER_ID;reg.vendorId=id('VEN',1);reg.vendorName=vendorNames[0];reg.vendorLockDate=demoDate(133+i);reg.vendorLockedAt=demoAt(133+i);reg.vendorLockedBy=DEMO_ERP_USER_ID;reg.completedAt=demoAt(135+i);reg.completedBy=DEMO_ERP_USER_ID;}
    if(status==='Rejected'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'Rejected',changedAt:demoAt(132+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Identity proof rejected'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;reg.rejectedAt=demoAt(132+i);reg.rejectedBy=DEMO_ERP_USER_ID;reg.rejectionReason='Identity proof did not match the scheme beneficiary records.';}
    if(status==='Failed'){history.push({status:'Submitted',changedAt:demoAt(130+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator'},{status:'Failed',changedAt:demoAt(131+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Portal submission failed'});reg.submittedAt=demoAt(130+i);reg.submittedBy=DEMO_ERP_USER_ID;reg.failedAt=demoAt(131+i);reg.failedBy=DEMO_ERP_USER_ID;reg.failureReason='Portal submission returned a validation error on the DISCOM side.';}
    if(status==='Cancelled'){history.push({status:'Cancelled',changedAt:demoAt(131+i),changedBy:DEMO_ERP_USER_ID,changedByName:'Neozy Demo Operator',note:'Applicant withdrew before submission.'});reg.cancelledAt=demoAt(131+i);reg.cancelledBy=DEMO_ERP_USER_ID;}
    reg.status=status;reg.statusHistory=history;
    const linked=status!=='Draft'&&status!=='Cancelled';
    const docIds:Record<string,string>={};
    if(linked){
      for(const cd of SCHEME_REGISTRATION_REQUIRED_DOCUMENTS){
        if(!cd.required)continue;
        const docId=id('CDOC',nextDocIndex++);
        docIds[cd.category]=docId;
        const d=doc('documents',docId,{
          name:`${cd.label}.pdf`,url:`demo://document-placeholder/scheme-registration/${regId.toLowerCase()}`,mimeType:'application/pdf',size:248_000,
          uploadedAt:demoAt(131+i),uploadedBy:DEMO_ERP_USER_ID,uploaderName:'Neozy Demo Operator',label:cd.label,
          sourceEntityType:'scheme_registration',projectId,customerId,
        });
        out.push(ref(ref(d,'projectId','projects',projectId),'customerId','customers',String(customerId)));
      }
    }
    reg.requiredDocuments=SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.map(cd=>({...cd,...(docIds[cd.category]?{documentId:docIds[cd.category]}:{})}));
    reg.documents=status==='Completed'?SCHEME_REGISTRATION_REQUIRED_DOCUMENTS.filter(d=>d.required).map(cd=>({documentId:docIds[cd.category],category:cd.category,uploadedByName:'Neozy Demo Operator',uploadedAt:demoAt(132+i)})):[];
    // Push the record exactly ONCE; each ref() only registers a relationship
    // in the plan's reference table and returns the same source document.
    const record=doc('scheme_registrations',regId,reg);
    out.push(record);
    ref(record,'projectId','projects',projectId);
    ref(record,'customerId','customers',customerId);
    ref(record,'partnerId','channel_partners',id('PART',partner));
    ref(record,'managerId','users',assigneeIds[5]);
    if(partner===1)ref(record,'userId','users',DEMO_ERP_USER_ID);
  }
  return out;
}
function buildLoanApplications():DemoDocument[]{
  const out:DemoDocument[]=[];
  const custNameFull=(n:number)=>customerDisplayNames[n-1];
  const seeds:[number,string,string,string,string,number][]=[
    [1,'Axis Bank','Axis Demo Branch, Pune','Draft','AXIS-DEMO-0001',110],
    [4,'Punjab National Bank','PNB Demo Branch, Aurangabad','Digital Sign Pending','PNB-DEMO-0001',116],
    [7,'State Bank of India','SBI Demo Branch, Indore','Under Review','SBI-DEMO-0001',130],
    [8,'HDFC Bank','HDFC Demo Branch, Vadodara','Approved','HDFC-DEMO-0001',131],
    [9,'ICICI Bank','ICICI Demo Branch, Thane','Payment Received','ICICI-DEMO-0001',132],
    [10,'Canara Bank','Canara Demo Branch, Pune','Rejected','CAN-DEMO-0001',144],
  ];
  seeds.forEach(([project,bankName,branch,status,applicationNumber,createdDay],i)=>{
    const n=i+1,custId=id('CUS',project),custName=custNameFull(project),loanAmount=capacities[project-1]*90000;
    const signed=['Digital Sign Completed','Bank Submission Pending','Submitted To Bank','Under Review','Approved','Payment Received','Rejected'].includes(status);
    const submitted=['Submitted To Bank','Under Review','Approved','Payment Received','Rejected'].includes(status);
    const approved=status==='Approved'||status==='Payment Received',paid=status==='Payment Received',rejected=status==='Rejected';
    const activityLog:{id:string;type:string;desc:string;date:string;userName:string}[]=[
      {id:id('RLOG',n*10+1),type:'Creation',desc:'Loan application created',date:demoAt(createdDay),userName:'Neozy Demo Operator'},
    ];
    if(status==='Digital Sign Pending')activityLog.push({id:id('RLOG',n*10+2),type:'Status Update',desc:'Digital signature pending',date:demoAt(createdDay+2),userName:'Neozy Demo Operator'});
    else if(signed)activityLog.push({id:id('RLOG',n*10+2),type:'Status Update',desc:'Digital sign completed',date:demoAt(createdDay+2),userName:'Neozy Demo Operator'});
    if(submitted)activityLog.push({id:id('RLOG',n*10+3),type:'Status Update',desc:`Submitted to ${bankName}`,date:demoAt(createdDay+4),userName:'Neozy Demo Operator'});
    if(approved)activityLog.push({id:id('RLOG',n*10+4),type:'Approval',desc:`Approved by ${bankName}`,date:demoAt(createdDay+6),userName:'System'});
    if(paid)activityLog.push({id:id('RLOG',n*10+5),type:'Payment',desc:`Payment of ${loanAmount} recorded`,date:demoAt(createdDay+8),userName:'Neozy Demo Operator'});
    if(rejected)activityLog.push({id:id('RLOG',n*10+6),type:'Rejection',desc:`Rejected by ${bankName}`,date:demoAt(createdDay+7),userName:'System'});
    const reg=doc('registrations',id('REG',n),{
      registrationId:id('REG',n),customerId:custId,customerName:custName,customerPhone:`000000${String(2000+project).padStart(4,'0')}`,
      customerAddress:`${streetAddresses[project-1]}, ${cities[project-1]}`,projectId:id('PRJ',project),
      bankName,branch,loanAmount,applicationNumber,digitalSignStatus:signed?'completed':'pending',
      submissionDate:submitted?demoDate(createdDay+4):'',approvalDate:approved?demoDate(createdDay+6):'',
      ...(paid?{paymentDate:demoDate(createdDay+8),paymentAmount:loanAmount,paymentMode:'Bank Transfer'}:{}),
      ...(rejected?{rejectionReason:'Income documentation incomplete — resubmission recommended.'}:{}),
      assignedToId:id('USR',1),assignedToName:'Aarav Demo',status,
      notes:'Fictional demo loan application; no real bank submission occurs.',activityLog,
      createdAt:demoAt(createdDay),updatedAt:demoAt(createdDay+8),
    });
    out.push(ref(ref(reg,'customerId','customers',custId),'projectId','projects',id('PRJ',project)));
  });
  return out;
}

// Phase 15.1/17: Tax Invoices (src/lib/taxInvoiceWorkflow.ts) — a real,
// mature, GST-fiscal-year-aware module the Blueprint itself already
// documented as "a manual, disconnected action" from closeDispatch() —
// were previously ONLY ever seeded by the removed duplicate
// api/demo-reset.ts dataset. Three examples using the REAL
// TaxInvoiceRecord/TaxInvoiceLineItem field shapes
// (src/features/tax-invoices/types.ts): one B2C (Issued, against the fully
// Delivered/Paid ORD-7 / PRJ-10), two B2B — one Issued (CUS-11's Closed
// Dispatch, directly demonstrating the B2B flow's own "Accounts -> Bill
// Generated" step) and one still Draft (CUS-16's, also past a Closed
// Dispatch — demonstrating Accounts not yet having issued it, a realistic
// lag distinct from CUS-11's already-issued example). Company/customer
// states now vary realistically (Maharashtra/Madhya Pradesh) instead of a
// single hardcoded 'Demo State', and taxLine() applies the same intra- vs
// inter-state rule the real calculateGstBreakdown() does: CGST+SGST when
// company and customer share a state (TAX-1/TAX-2, both Maharashtra), IGST
// when they don't (TAX-3, Maharashtra company billing a Madhya Pradesh
// customer) — never a fixed CGST+SGST assumption regardless of state.
function buildTaxInvoices():DemoDocument[]{
  const out:DemoDocument[]=[];
  // Matches calculateGstBreakdown's real rule: CGST+SGST when the company
  // and customer are in the same state, IGST when they're not.
  const taxLine=(product:string,hsn:string,quantity:number,rate:number,interstate=false)=>{
    const taxableValue=money(quantity*rate),half=money(taxableValue*.09),full=money(taxableValue*.18);
    return interstate
      ?{product,hsn,quantity,rate,taxRate:18,taxableValue,cgstRate:0,sgstRate:0,igstRate:18,cgst:0,sgst:0,igst:full,totalTax:full,lineTotal:money(taxableValue+full)}
      :{product,hsn,quantity,rate,taxRate:18,taxableValue,cgstRate:9,sgstRate:9,igstRate:0,cgst:half,sgst:half,igst:0,totalTax:money(half*2),lineTotal:money(taxableValue+half*2)};
  };
  const seeds:[string,'order'|'proforma_invoice',string,string,string,string,string,'Draft'|'Issued',ReturnType<typeof taxLine>[]][]=[
    ['TAX-1','order',id('ORD',7),id('CUS',10),custNameForTax(10),'Maharashtra',demoDate(96),'Issued',[taxLine('575 W Mono PERC Solar Module','85414300',18,14250)]],
    ['TAX-2','order',id('ORD',8),id('CUS',11),'Sundar Solar Distributors','Maharashtra',demoDate(149),'Issued',[taxLine('575 W Mono PERC Solar Module','85414300',60,14250)]],
    ['TAX-3','order',id('ORD',12),id('CUS',16),'Suresh Electricals','Madhya Pradesh',demoDate(173),'Draft',[taxLine('575 W Mono PERC Solar Module','85414300',45,14250,true)]],
  ];
  seeds.forEach(([slug,sourceType,orderId,customerId,customerName,customerState,date,status,items])=>{
    const subtotal=money(items.reduce((s,x)=>s+x.taxableValue,0)),cgst=money(items.reduce((s,x)=>s+x.cgst,0)),sgst=money(items.reduce((s,x)=>s+x.sgst,0)),igst=money(items.reduce((s,x)=>s+x.igst,0)),totalTax=money(cgst+sgst+igst),total=money(subtotal+totalTax);
    const invoiceNumber=`TINV-DEMO-${slug}`;
    const inv=doc('tax_invoices',invoiceNumber,{
      invoiceNumber,serialNumber:Number(slug.split('-')[1]),fiscalYear:'26-27',sourceType,sourceId:orderId,orderId,
      date,status,companyName:'Neozy Solar EPC Demo',companyGst:demoGstin(0,'27'),companyState:'Maharashtra',
      customerId,customerName,customerGst:'',customerState,placeOfSupply:customerState,items,
      subtotal,cgst,sgst,igst,totalTax,total,notes:'Fictional demo tax invoice; no real GST filing occurs.',
      ...(status==='Issued'?{issuedAt:demoAt(96)}:{}),
    });
    out.push(ref(ref(inv,'orderId','orders',orderId),'customerId','customers',customerId));
  });
  return out;
}
const custNameForTax=(n:number)=>customerDisplayNames[n-1];

export function buildBusinessGraphPlan():DemoSeedPlan{refs.length=0;const documents=[...buildCrm(),...buildCustomersProjects(),...buildTechnical(),...buildSalesFinance(),...buildB2BExamples(),...buildSupply(),...buildExecution(),...buildOperations(),...buildPhase14Documents(),...buildPartnerCommissions(),...buildSchemeRegistrations(),...buildLoanApplications(),...buildTaxInvoices()];return{documents,references:[...refs]}}
export const demoFinancial={line,totals};

