import {DEMO_COMPANY_ID,DEMO_ERP_USER_ID,DEMO_ID_PREFIX,DEMO_ROLE_ID,DEMO_SEED_ID,OFFICIAL_DEMO_EMAIL,demoDocumentId} from '../../src/config/demo.ts';
export {DEMO_COMPANY_ID,DEMO_ERP_USER_ID,DEMO_ID_PREFIX,DEMO_ROLE_ID,DEMO_SEED_ID,OFFICIAL_DEMO_EMAIL,demoDocumentId};
export const DEMO_MANIFEST_COLLECTION='demo_manifests';
export const DEMO_MANIFEST_ID=DEMO_SEED_ID;
export const DEMO_MAX_MUTATIONS=450;
export const DEMO_MAX_DELETIONS=420;
export const DEMO_BATCH_SIZE=350;
export const DEMO_RESET_CONFIRMATION=`RESET-${DEMO_COMPANY_ID}`;
export const DEMO_CLEANUP_CONFIRMATION=`CLEANUP-${DEMO_COMPANY_ID}-INCLUDING-IDENTITY`;
// Phase 21: cross-checked against every collection constant actually
// declared in src/lib/firebase.ts's COLLECTIONS map (not merely this
// list's own prior contents). Three real, actively-written collections
// were missing entirely: 'cases' (written by CaseEngine.createCase() —
// fires on every real Lead creation via createCaseForLead(), including
// from ordinary demo-mode CRUD), 'settlements' (written by
// channelPartnerSettlement.ts's settlement workflows), and 'audit_logs'
// (written by workflow.ts's logActivity() — called on nearly every
// create/update action anywhere in the app). None of the three could ever
// have been cleaned by any prior reset, regardless of the id-vs-content
// sweep fix in runner.ts, because the collection itself was never even
// queried. ('activity' was checked and found to be dead — the only
// reference anywhere in src/ is a stale code comment, no real writer
// exists, so it needed no fix.)
export const DEMO_RESETTABLE_COLLECTIONS=['documents','commission_records','commission_rules','channel_partners','notifications','tasks','entity_relationships','generation_readings','service_tickets','amc_contracts','project_handovers','subsidy_applications','net_metering_applications','commissioning_records','qc_checks','installations','dispatch','transport','partner_wallet_transactions','commission_records','payments','tax_invoices','proforma_invoices','orders','quotations','engineering_designs','surveys','projects','followups','customer_phone_locks','customers','leads','goods_receipts','purchase_orders','stock_ledger','stock','serial_numbers','vendors','products','product_categories','warehouses','attendance','payroll','employees','entities','banks','registrations','scheme_registrations','cases','settlements','audit_logs'] as const;
export const DEMO_FORBIDDEN_FIELD_PATTERN=/(password|private[_-]?key|service[_-]?account|refresh[_-]?token|access[_-]?token|api[_-]?key|smtp[_-]?pass|client[_-]?secret|aadhar|aadhaar|kyc|signature)/i;
export function configuredProjectAllowlist(env=process.env){return String(env.DEMO_ALLOWED_FIREBASE_PROJECTS||'').split(',').map(v=>v.trim()).filter(Boolean)}
