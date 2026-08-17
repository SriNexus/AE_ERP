import {DEMO_COMPANY_ID,DEMO_ERP_USER_ID,DEMO_HIDDEN_MODULES,isOfficialDemoCompany} from '../config/demo';

export type DemoCapability='business-crud'|'company-admin'|'user-admin'|'role-admin'|'integration-secrets'|'external-side-effect'|'owner-ai'|'system-counter'|'audit-mutation'|'stock-ledger-mutation'|'demo-reset'|'company-scoped-upload';
const ALLOWED=new Set<DemoCapability>(['business-crud','company-scoped-upload']);
export type DemoIdentity={companyId?:unknown;userId?:unknown;id?:unknown;isDemo?:unknown;role?:unknown};

/** Check if a value matches the canonical demo identity. */
export function isCanonicalDemoIdentity(value:DemoIdentity|undefined){return Boolean(value&&isOfficialDemoCompany(value.companyId)&&String(value.userId??value.id??'')===DEMO_ERP_USER_ID&&value.isDemo!==false)}

/** Check if the current user is the demo user (convenience for AppUser). */
export function isDemoUser(user:{companyId?:string;id?:string;role?:string}|null|undefined):boolean{return isCanonicalDemoIdentity(user as DemoIdentity|undefined)}

/** Returns true if a module is hidden for demo users. */
export function isDemoHiddenModule(moduleName:string):boolean{return (DEMO_HIDDEN_MODULES as readonly string[]).includes(moduleName)}

export function isDemoCapabilityAllowed(companyId:unknown,capability:DemoCapability){return !isOfficialDemoCompany(companyId)||ALLOWED.has(capability)}
export function assertDemoCapability(companyId:unknown,capability:DemoCapability,message?:string){if(!isDemoCapabilityAllowed(companyId,capability))throw new Error(message||`This operation is unavailable in the public demo (${capability}).`)}
export function demoPolicySummary(){const hiddenModules=[...DEMO_HIDDEN_MODULES];return{companyId:DEMO_COMPANY_ID,allowed:[...ALLOWED].sort(),blocked:['company-admin','user-admin','role-admin','integration-secrets','external-side-effect','owner-ai','system-counter','audit-mutation','stock-ledger-mutation','demo-reset',...hiddenModules].sort()}}
