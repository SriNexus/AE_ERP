import {DEMO_ERP_USER_ID,isOfficialDemoCompany} from '../config/demo';

// Demo-to-Group conversion (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md):
// Neozy Demo is a real Group with demo@neozy.in as its GroupAdmin. There is
// no capability-gating layer here anymore — business CRUD, external
// communication (email/phone/WhatsApp), and storage uploads all run through
// the exact same production code path and the exact same Firestore/Storage
// rules every other Group's GroupAdmin gets. What remains is a pure identity
// check, used only for the informational "Demo Mode" badge (TopBar/
// PartnerLayout) that tells a human tester which Group they're viewing.
export type DemoIdentity={companyId?:unknown;userId?:unknown;id?:unknown;isDemo?:unknown;role?:unknown};

/** Check if a value matches the canonical demo identity. */
export function isCanonicalDemoIdentity(value:DemoIdentity|undefined){return Boolean(value&&isOfficialDemoCompany(value.companyId)&&String(value.userId??value.id??'')===DEMO_ERP_USER_ID&&value.isDemo!==false)}

/** Check if the current user is the demo user (convenience for AppUser). */
export function isDemoUser(user:{companyId?:string;id?:string;role?:string}|null|undefined):boolean{return isCanonicalDemoIdentity(user as DemoIdentity|undefined)}
