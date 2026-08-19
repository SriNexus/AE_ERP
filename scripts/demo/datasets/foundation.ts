import type { DemoDocument, DemoSeedPlan } from '../types.ts';
import {
  DEMO_COMPANY_ID,
  DEMO_ERP_USER_ID,
  DEMO_GROUP_ID,
  DEMO_ROLE_ID,
  DEMO_SEED_ID,
  OFFICIAL_DEMO_EMAIL,
  demoDocumentId,
} from '../config.ts';
import { demoAt, demoDate } from './timeline.ts';

// Phase 1 (Multi-Tenant): every demo business document carries the demo
// tenant's Group, exactly like companyId — the demo dataset is a fully
// self-contained tenant under its own demo Group (Master Plan §3.2
// denormalization; §10.3 step 1 isDemo: true).
const base = { companyId: DEMO_COMPANY_ID, groupId: DEMO_GROUP_ID, isDemo: true, demoSeedId: DEMO_SEED_ID, isDeleted: false };
// `roles` is EXCLUDED from the groupId denormalization (Master Plan §3.2 —
// roles are Company-scoped per §5.6, not Group-scoped), so the demo role doc
// must not carry groupId even though base does.
const roleBase = { companyId: DEMO_COMPANY_ID, isDemo: true, demoSeedId: DEMO_SEED_ID, isDeleted: false };
const audit = { createdBy: DEMO_ERP_USER_ID, updatedBy: DEMO_ERP_USER_ID };

const moduleNames = [
  'dashboard','projects','leads','customers','quotations','orders','dispatch','surveys','engineering',
  'installations','qc','commissioning','net_metering','subsidy','service_tickets','inventory','stock',
  'products','payments','invoices','employees','users','roles','reports','categories','warehouses',
  'attendance','payroll','companies','settings','partners','tax_invoices','vendors','purchase_orders',
  'loan_applications',
  // Phase 2 (Channel Partner): the demo role document carries the reserved
  // payout-request and Vendor Lock (scheme_registration) modules with full
  // demo access (not in `denied`), so the seeded role doc is genuinely
  // complete — the demo operator can demonstrate the full partner pipeline.
  'payouts',
  'scheme_registration',
] as const;
const denied = new Set(['users','roles','companies','settings']);
const readOnly = new Set(['reports']);
const permissions = Object.fromEntries(moduleNames.map((module) => [module, {
  view: module === 'settings' || !denied.has(module),
  create: !denied.has(module) && !readOnly.has(module),
  edit: !denied.has(module) && !readOnly.has(module),
  delete: !denied.has(module) && !readOnly.has(module),
  cancel: !denied.has(module) && !readOnly.has(module),
  approve: !denied.has(module) && !readOnly.has(module),
  export: !denied.has(module),
  import: false,
  view_pricing: !denied.has(module),
  visibility: 'all',
}]));

export function buildIdentityDocuments(authUid: string): DemoDocument[] {
  if (!authUid.trim()) throw new Error('Firebase Auth UID is required.');
  return [
    // Phase 1 (Multi-Tenant): the demo tenant's own Group (Master Plan §10.3
    // step 1 — the demo dataset gets a dedicated demo Group, isDemo: true,
    // never folded into a production default Group).
    { collection: 'groups', id: DEMO_GROUP_ID, preserveOnReset: true, data: {
      ...audit, id: DEMO_GROUP_ID, name: 'Neozy Demo Group', shortName: 'Demo',
      status: 'Active', isDefault: false, isDemo: true, settings: {},
    }},
    { collection: 'companies', id: DEMO_COMPANY_ID, preserveOnReset: true, data: {
      ...base, ...audit, id: DEMO_COMPANY_ID, name: 'Neozy Solar EPC Demo', shortName: 'Neozy Demo',
      companyCode: 'DEMO', tagline: 'Fictional Solar EPC demonstration workspace',
      address: 'Demo Renewable Energy Park, Sector D', city: 'Pune', state: 'Maharashtra',
      pincode: '000000', country: 'India', phone: '+91-0000000000', email: 'company@demo.example.invalid',
      website: 'demo.example.invalid', gst: 'DEMO-NOT-A-GSTIN', pan: 'DEMO-NOT-A-PAN',
      cin: 'DEMO-NOT-A-CIN', bankName: 'Demo Bank (Non-Transactional)', bankAccount: 'DEMO-NOT-AN-ACCOUNT',
      bankIfsc: 'DEMO0000000', bankBranch: 'Demo Branch', currency: 'INR', currencySymbol: '₹',
      timezone: 'Asia/Kolkata', fiscalYearStart: '04-01', invoicePrefix: 'DINV', orderPrefix: 'DORD',
      quotationPrefix: 'DQT', dispatchPrefix: 'DDSP', primaryColor: '#166534', accentColor: '#15803d',
      status: 'Active', isDefault: false,
      // Phase 15: the real, persisted companies/{DEMO_COMPANY_ID} document
      // never actually carried businessMode — only the static UI-fallback
      // DEMO_COMPANY config object (src/config/demoCompany.ts) did, which is
      // what useGlobalBoot.ts happens to use for the demo session's company
      // state today, masking the gap. Set here too so the seeded Firestore
      // document is genuinely correct on its own, not only via that
      // fallback. 'Both' (per Phase 1's own default, confirmed still the
      // right choice at Phase 15: this is the ONE public demo company and
      // must showcase every workflow, not just one) — see Phase 15 report
      // for why dedicated single-mode demo companies were not built.
      businessMode: 'Both',
    }},
    // Phase 1 (F-03 closure, Master Plan §5.6): role documents are
    // Company-scoped — the demo role doc is keyed `${companyId}_${roleName}`
    // (roleDocumentId(DEMO_COMPANY_ID, DEMO_ROLE_ID)), matching the
    // per-company system-role keying the app's role resolution expects.
    { collection: 'roles', id: `${DEMO_COMPANY_ID}_${DEMO_ROLE_ID}`, preserveOnReset: true, data: {
      ...roleBase, ...audit, id: `${DEMO_COMPANY_ID}_${DEMO_ROLE_ID}`, name: DEMO_ROLE_ID, schemaVersion: 1,
      description: 'Public demo business access without administration, secrets, counters, or owner AI.',
      permissions,
    }},
    { collection: 'users', id: DEMO_ERP_USER_ID, preserveOnReset: true, data: {
      ...base, ...audit, id: DEMO_ERP_USER_ID, name: 'Neozy Demo Operator', displayName: 'Demo Operator',
      email: OFFICIAL_DEMO_EMAIL, phone: '0000000000', role: DEMO_ROLE_ID, status: 'Active',
      // Phase 1 (Channel Partner identity): the demo operator is the linked
      // user for demo partner PART-1 — the canonical user-side link that lets
      // usePartnerSelf() resolve the partner record (users.channelPartnerId
      // → channel_partners/{id}). Partner-side mirror is set in businessGraph.
      channelPartnerId: demoDocumentId('PART', 1),
      linkedModules: moduleNames.filter((module) => !denied.has(module)), isSuperAdmin: false,
    }},
    { collection: 'user_auth_maps', id: authUid, preserveOnReset: true, data: {
      authUid, userId: DEMO_ERP_USER_ID, companyId: DEMO_COMPANY_ID,
      // Phase 1: user_auth_maps mirrors users.groupId (Master Plan §3.2).
      groupId: DEMO_GROUP_ID, email: OFFICIAL_DEMO_EMAIL,
    }},
  ];
}

const settings = [
  ['general', { language:'en', timezone:'Asia/Kolkata', dateFormat:'DD/MM/YYYY', numberFormat:'en-IN', firstDayOfWeek:1 }],
  ['theme-ui', { selectedTheme:'solar-green', borderRadius:'medium', cardStyle:'elevated', sidebarStyle:'default', kpiStyle:'bordered', density:'comfortable', animation:true, shadowStyle:'medium', font:'inter', chartPaletteId:'default', themeOverrides:{colors:{}} }],
  ['documents', { piValidityDays:7, defaultTerms:'For demonstration only. No commercial validity.', defaultNotes:'Fictional Demo Company document.', invoicePrefix:'DINV', quotationPrefix:'DQT', orderPrefix:'DORD', sequencePadding:4 }],
  ['email', { provider:'none', smtpHost:'', smtpPort:587, smtpUser:'', smtpSecure:false, fromAddress:'', fromName:'Neozy Demo', replyTo:'', templates:{} }],
] as const;
const personalSettings = [
  ['appearance', { themeMode:'system', highContrast:false, compactMode:false, reducedMotion:false, sidebarCollapsed:false, fontSize:'medium' }],
  ['notifications', { channels:{email:false,push:true,inApp:true}, events:{}, quietHoursEnabled:false, quietHoursStart:'22:00', quietHoursEnd:'08:00', digestFrequency:'realtime' }],
] as const;

export function buildSafeSettingsDocuments(): DemoDocument[] {
  return [
    ...settings.map(([section,data]) => ({ collection:'settings', id:`${DEMO_COMPANY_ID}_settings_${section}`, data:{...base,...audit,section,data} })),
    ...personalSettings.map(([section,data]) => ({ collection:'settings', id:`${DEMO_ERP_USER_ID}_settings_${section}`, data:{...base,...audit,section,data} })),
  ];
}

const categoryNames = ['Solar Modules','Inverters','Mounting Structures','DC & AC Cables','Protection Equipment','Meters & Monitoring','Batteries & Hybrid BOS'];
export const categoryIds = categoryNames.map((_,i)=>demoDocumentId('CAT',i+1));
export function buildCategoryDocuments():DemoDocument[]{return categoryNames.map((name,i)=>({collection:'product_categories',id:categoryIds[i],data:{...base,...audit,id:categoryIds[i],name,description:`Fictional ${name.toLowerCase()} catalog`,parentCategory:'',order:i+1,status:'Active',code:`DCAT-${i+1}`,searchName:name.toLowerCase()}}))}

const products = [
 ['N-Type TOPCon Solar Module 575 W',0,'DMOD-575',14250,18,'PCS','85414300',{wattage:575,technology:'N-Type TOPCon'}],
 ['Mono PERC Solar Module 550 W',0,'DMOD-550',12750,18,'PCS','85414300',{wattage:550,technology:'Mono PERC'}],
 ['On-Grid String Inverter 5 kW',1,'DINV-5K',69000,18,'PCS','85044090',{capacityKw:5,phase:'Single'}],
 ['On-Grid String Inverter 25 kW',1,'DINV-25K',188000,18,'PCS','85044090',{capacityKw:25,phase:'Three'}],
 ['Hybrid Inverter 10 kW',1,'DHYB-10K',245000,18,'PCS','85044090',{capacityKw:10,phase:'Three'}],
 ['Aluminium Rooftop Structure Set',2,'DSTR-AL',3850,18,'SET','76109090',{material:'Aluminium'}],
 ['GI Elevated Structure per kW',2,'DSTR-GI',7200,18,'KW','73089090',{material:'Hot-dip GI'}],
 ['Solar DC Cable 4 sq mm Red',3,'DCAB-4R',68,18,'MTR','85444999',{sizeSqMm:4,color:'Red'}],
 ['Solar DC Cable 4 sq mm Black',3,'DCAB-4B',68,18,'MTR','85444999',{sizeSqMm:4,color:'Black'}],
 ['AC Armoured Cable 4C 16 sq mm',3,'ACAB-16',395,18,'MTR','85446090',{cores:4,sizeSqMm:16}],
 ['DC Distribution Box 2-in 2-out',4,'DDB-22',12500,18,'PCS','85371000',{spd:'Type II'}],
 ['AC Distribution Box 25 kW',4,'DAB-25',18500,18,'PCS','85371000',{ratingKw:25}],
 ['Net Meter Compatible Energy Meter',5,'DMTR-NET',9800,18,'PCS','90283090',{meterType:'Bidirectional'}],
 ['Remote Generation Monitoring Gateway',5,'DMON-GW',14500,18,'PCS','85176290',{connectivity:'4G/Wi-Fi'}],
 ['LiFePO4 Battery 10 kWh',6,'DBAT-10',315000,18,'PCS','85076000',{capacityKwh:10,chemistry:'LiFePO4'}],
] as const;
export function buildProductDocuments():DemoDocument[]{return products.map((p,i)=>{const id=demoDocumentId('PRD',i+1);return{collection:'products',id,data:{...base,...audit,id,name:p[0],category:categoryNames[p[1]],categoryId:categoryIds[p[1]],sku:p[2],price:p[3],mrp:Math.round(p[3]*1.08),cost:Math.round(p[3]*0.82),discount:0,tax:p[4],unit:p[5],hsn:p[6],description:'Fictional demonstration catalog item',trackingType:i<5||i===14?'serial':'none',status:'Active',lowStockThreshold:5,specs:p[7],photos:[],searchName:String(p[0]).toLowerCase()}}})}

// Realistic Indian names throughout — task: "Demo Mode — Final Business-Flow
// Data Rebuild & Realistic ERP Demo Validation" (remediation log item 4).
// IDs/roles/relationships are unchanged; only display identity fields.
const assignees=[['Aarav Malhotra','Sales'],['Diya Sharma','Surveyor'],['Kabir Ansari','Engineer'],['Meera Pillai','InstallationLead'],['Vihaan Kulkarni','ServiceTechnician'],['Rohan Malhotra','Manager']];
export const assigneeIds=assignees.map((_,i)=>demoDocumentId('USR',i+1));
export function buildAssigneeDocuments():DemoDocument[]{return assignees.map((p,i)=>({collection:'users',id:assigneeIds[i],data:{...base,...audit,id:assigneeIds[i],name:p[0],displayName:p[0],email:`team${i+1}@demo.example.invalid`,phone:`00000010${String(i+1).padStart(2,'0')}`,role:p[1],status:'Active',linkedModules:[],isSuperAdmin:false,canAuthenticate:false}}))}

const warehouseAddresses=['Plot 4, Chakan MIDC, Pune','Gala 12, Bhiwandi Warehousing Cluster, Mumbai','Plot 9, Ambad Industrial Estate, Nashik'];
const warehouses=[['Central Distribution Warehouse','DWH-C','Pune'],['West Zone Service Depot','DWH-W','Mumbai'],['Project Staging Yard — Nashik','DWH-S','Nashik']];
export function buildWarehouseDocuments():DemoDocument[]{return warehouses.map((w,i)=>{const id=demoDocumentId('WH',i+1);return{collection:'warehouses',id,data:{...base,...audit,id,name:w[0],code:w[1],address:warehouseAddresses[i],city:w[2],state:'Maharashtra',pincode:['411019','421302','422010'][i],managerName:assignees[Math.min(i+2,4)][0],managerPhone:`00000020${String(i+1).padStart(2,'0')}`,capacity:`${500+i*250} pallet positions`,status:'Active',notes:'Demo warehouse; no physical location.',searchName:String(w[0]).toLowerCase()}}})}

// Exported so businessGraph.ts's B2B dispatch/PO fixtures can reference the
// SAME real warehouse/vendor names instead of maintaining a second,
// independently-drifting name list.
export const warehouseNames=warehouses.map((w)=>w[0]);
const vendors=['Suryoday Module Industries','GridTech Electronics Pvt Ltd','Sturdy Mount Systems','Konnect Solar Cables','Safeguard Electrical Protection','Precision Metering Labs','PowerCell Energy Storage','Swift Logistics Supply Co'];
const vendorAddresses=['MIDC Bhosari, Pune','Peenya Industrial Area, Bengaluru','Naroda Industrial Estate, Ahmedabad','Guindy Industrial Estate, Chennai','Okhla Industrial Area, New Delhi','Rakhial Industrial Estate, Ahmedabad','Electronic City, Bengaluru','Taloja MIDC, Navi Mumbai'];
export function buildVendorDocuments():DemoDocument[]{return vendors.map((name,i)=>{const id=demoDocumentId('VEN',i+1);return{collection:'vendors',id,data:{...base,...audit,id,vendorId:id,name,gstin:demoGstin(i+1),contactInfo:{contactPerson:`Vendor Contact ${i+1}`,phone:`00000030${String(i+1).padStart(2,'0')}`,email:`vendor${i+1}@demo.example.invalid`,address:vendorAddresses[i]},paymentTerms:i%2?'30 days':'Advance against demo PO',categoryTags:[categoryNames[i%categoryNames.length]],status:'Active',searchName:name.toLowerCase()}}})}
export const vendorNames=vendors;

// GSTIN-shaped (2-digit state code + 10-char PAN-like segment + entity code
// + 'Z' + checksum = 15 chars, matching the real format) but unmistakably
// fake — 'DEMO' is embedded in the PAN segment, which is not a real PAN
// prefix pattern, so this can never collide with or be mistaken for an
// actual registered business's GSTIN. Replaces the old, non-GSTIN-shaped
// 'DEMO-NOT-A-GSTIN' placeholder (remediation log item 5) while keeping the
// same "obviously fake" safety property.
// 15 chars total: 2 (state code) + 10 (PAN-like: 5 letters + 4 digits + 1
// letter) + 1 (entity code) + 1 ('Z') + 1 (checksum) — matches the real
// GSTIN length/shape exactly, so it reads as genuinely GSTIN-like, while
// 'DEMOA' as the 5-letter PAN prefix is not a real PAN pattern.
export function demoGstin(n:number,stateCode='27'):string{const entity=(n%9)+1;return `${stateCode}DEMOA${String(1000+n).slice(-4)}A${entity}Z${entity}`}

const employeeRoles=['Sales','Sales','Operations','Procurement','Accounts','Warehouse','HR','Surveyor','Engineer','ServiceTechnician'];
const employeeNames=['Rahul Bhatia','Ananya Iyer','Vikram Nair','Sneha Kapoor','Manoj Pillai','Ravi Chavan','Pooja Reddy','Arjun Menon','Kavya Rao','Suresh Yadav'];
const employeeAddresses=['Flat 6, Kothrud, Pune','204, Baner Road, Pune','12, Aundh, Pune','B-3, Viman Nagar, Pune','Flat 9, Kharadi, Pune','15, Hadapsar, Pune','Flat 4, Wakad, Pune','7, Deccan Gymkhana, Pune','Flat 2, Camp Area, Pune','21, Hinjewadi, Pune'];
export const employeeUserIds=employeeRoles.map((_,i)=>demoDocumentId('EUSR',i+1));
const warehouseIds=[0,1,2].map((i)=>demoDocumentId('WH',i+1));
// Phase 12: warehouseId/managerId live on the User record (Option A — link,
// not consolidate — matches the real EmployeeDomainService.create(), which
// already resolves/creates a linked master User and stores its id as
// Employee.userId). Previously this dataset's Employees had no userId at
// all and the linked Users it never created would have had no
// warehouseId/managerId either — so "warehouse-wise employee count" and
// "employee -> reporting manager" were both structurally unanswerable in
// Demo Mode. Distribution below is deliberately uneven (5/3/2 across the 3
// demo warehouses) with a genuine 2-level manager chain (assignee USR-1 ->
// two department leads -> their direct reports), per the Blueprint's own
// demo-data requirement.
const employeeWarehouseIdx=[0,0,0,1,1,2,0,1,2,0];
// Index into employeeUserIds for an in-company manager; null means "reports
// to assignee USR-1" (the level-0 manager — the existing 'Aarav Demo' Sales
// lead already used throughout businessGraph.ts as id('USR',1)).
const employeeManagerIdx:(number|null)[]=[6,6,6,4,null,6,null,6,6,4];
export function buildEmployeeUserDocuments():DemoDocument[]{return employeeRoles.map((role,i)=>({collection:'users',id:employeeUserIds[i],data:{...base,...audit,id:employeeUserIds[i],name:employeeNames[i],displayName:employeeNames[i],email:`${employeeNames[i].toLowerCase().replace(/\s+/g,'.')}@demo.example.invalid`,phone:`00000040${String(i+1).padStart(2,'0')}`,role,status:'Active',warehouseId:warehouseIds[employeeWarehouseIdx[i]],managerId:employeeManagerIdx[i]===null?assigneeIds[0]:employeeUserIds[employeeManagerIdx[i] as number],linkedModules:['employees'],isSuperAdmin:false,canAuthenticate:false}}))}
export function buildEmployeeDocuments():DemoDocument[]{return employeeRoles.map((role,i)=>{const id=demoDocumentId('EMP',i+1);return{collection:'employees',id,data:{...base,...audit,id,name:employeeNames[i],phone:`00000040${String(i+1).padStart(2,'0')}`,email:`${employeeNames[i].toLowerCase().replace(/\s+/g,'.')}@demo.example.invalid`,gender:i%2?'Female':'Male',department:role==='Accounts'?'Finance':role,designation:`${role} Specialist`,role,joinDate:'2025-04-01',salary:35000+i*2500,address:employeeAddresses[i],city:'Pune',state:'Maharashtra',status:'Active',emergencyContact:'Family Contact',emergencyPhone:`00000050${String(i+1).padStart(2,'0')}`,userId:employeeUserIds[i]}}})}

// Phase 15.1 (Demo Mode collection-coverage correction): Banks, Attendance
// and Payroll were previously ONLY ever seeded by the removed duplicate
// api/demo-reset.ts dataset — the canonical generator never covered them at
// all, despite all three already being listed in DEMO_RESETTABLE_COLLECTIONS
// (scripts/demo/config.ts), which expected them to exist. Added here using
// the real BankRecord shape (src/features/banks/hooks/useBanks.ts) and the
// real ATTENDANCE_FORM_DEFAULT/PAYROLL_FORM_DEFAULT shapes
// (src/features/hr/hooks/useHR.ts) — no invented fields, no invented status
// values (ATTENDANCE_STATUSES / the real 'Paid'|'Pending'|'Draft' payroll
// statuses the workspace UI itself offers).
const bankSeeds = [
  ['State Bank of India','SBI','SBI',1,'Public','SBIN'],
  ['HDFC Bank','HDFC','HDFC',2,'Private','HDFC'],
  ['ICICI Bank','ICICI','ICICI',3,'Private','ICIC'],
  ['Axis Bank','AXIS','Axis',4,'Private','UTIB'],
  ['Punjab National Bank','PNB','PNB',5,'Public','PUNB'],
  ['Canara Bank','CAN','Canara',6,'Public','CNRB'],
] as const;
const bankRelationshipManagers=['Nikhil Sarin','Pallavi Menon','Tarun Oberoi','Shalini Rao','Devendra Choudhary','Meghna Vora'];
export function buildBankDocuments():DemoDocument[]{return bankSeeds.map((b,i)=>{const id=demoDocumentId('BANK',i+1);return{collection:'banks',id,data:{...base,...audit,id,bankCode:b[1],bankName:b[0],displayName:b[2],status:'Active',priority:b[3],bankType:b[4],supportedSchemes:['PM Surya Ghar (Demo)','Fictional Solar Loan Scheme'],activeRegions:['Maharashtra','Gujarat','Madhya Pradesh'],contactPerson:bankRelationshipManagers[i],ifscPrefix:b[5]}}})}

const attendanceSeeds:[number,number,string,string,string][]=[
  // [employeeIdx (0-based into employeeRoles), dayOffset, status, inTime, outTime]
  [0,150,'Present','09:00','18:00'],[0,151,'Present','09:05','18:10'],[0,152,'Late','10:15','18:00'],
  [1,150,'Present','09:00','17:55'],[1,151,'On Leave','',''],[1,152,'Present','09:00','18:00'],
  [3,150,'Half Day','09:00','13:00'],[3,151,'Present','09:00','18:00'],
  [6,150,'Absent','',''],[6,151,'Present','09:10','18:00'],
];
export function buildAttendanceDocuments():DemoDocument[]{return attendanceSeeds.map(([empIdx,day,status,inTime,outTime],i)=>{const id=demoDocumentId('ATT',i+1),employeeId=demoDocumentId('EMP',empIdx+1);return{collection:'attendance',id,data:{...base,...audit,id,employeeId,employee:employeeNames[empIdx],date:demoDate(day),status,inTime,outTime,notes:'Fictional demo attendance record.',createdAt:demoAt(day)}}})}

const payrollSeeds:[number,string][]=[[0,'Paid'],[1,'Paid'],[2,'Pending'],[3,'Paid'],[6,'Draft']];
export function buildPayrollDocuments():DemoDocument[]{return payrollSeeds.map(([empIdx,status],i)=>{const id=demoDocumentId('PAYROLL',i+1),employeeId=demoDocumentId('EMP',empIdx+1),basicSalary=35000+empIdx*2500,hra=Math.round(basicSalary*0.4),allowances=Math.round(basicSalary*0.15),deductions=Math.round(basicSalary*0.06),tds=empIdx%2?Math.round(basicSalary*0.02):0,advance=0,netSalary=basicSalary+hra+allowances-deductions-tds-advance;return{collection:'payroll',id,data:{...base,...audit,id,employeeId,employee:employeeNames[empIdx],month:'July',year:'2026',basicSalary,hra,allowances,deductions,tds,advance,netSalary,mode:'Bank Transfer',status,notes:'Fictional demo payroll record.',createdAt:demoAt(150)}}})}

export function buildFoundationPlan(authUid:string):DemoSeedPlan{
 const documents=[...buildIdentityDocuments(authUid),...buildSafeSettingsDocuments(),...buildAssigneeDocuments(),...buildCategoryDocuments(),...buildProductDocuments(),...buildWarehouseDocuments(),...buildVendorDocuments(),...buildEmployeeUserDocuments(),...buildEmployeeDocuments(),...buildBankDocuments(),...buildAttendanceDocuments(),...buildPayrollDocuments()];
 const references=[
   ...products.map((_,i)=>({collection:'products',id:demoDocumentId('PRD',i+1),field:'categoryId',targetCollection:'product_categories',targetId:categoryIds[products[i][1]]})),
   ...employeeRoles.map((_,i)=>({collection:'employees',id:demoDocumentId('EMP',i+1),field:'userId',targetCollection:'users',targetId:employeeUserIds[i]})),
   ...employeeRoles.map((_,i)=>({collection:'users',id:employeeUserIds[i],field:'warehouseId',targetCollection:'warehouses',targetId:warehouseIds[employeeWarehouseIdx[i]]})),
   ...attendanceSeeds.map(([empIdx],i)=>({collection:'attendance',id:demoDocumentId('ATT',i+1),field:'employeeId',targetCollection:'employees',targetId:demoDocumentId('EMP',empIdx+1)})),
   ...payrollSeeds.map(([empIdx],i)=>({collection:'payroll',id:demoDocumentId('PAYROLL',i+1),field:'employeeId',targetCollection:'employees',targetId:demoDocumentId('EMP',empIdx+1)})),
 ];
 return{documents,references};
}
