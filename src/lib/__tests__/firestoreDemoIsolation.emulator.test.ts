import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, collection, setDoc, updateDoc, where } from 'firebase/firestore';

const PROJECT='neozy-demo-isolation-test';
const DEMO_UID='demo-auth-uid';
const DEMO_COMPANY='company-demo-neozy';
let env:RulesTestEnvironment;

async function seed(){
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'companies',DEMO_COMPANY),{id:DEMO_COMPANY,companyId:DEMO_COMPANY,name:'Demo',isDemo:true,groupId:'group-demo-neozy'});
  await setDoc(doc(db,'companies','company-production'),{id:'company-production',companyId:'company-production',name:'Production',groupId:'group-prod-neozy'});
  // Phase 2 (§9.6): sameCompany() requires the owning Group to exist and be
  // Active — seed both Groups (the demo Group mirrors the demo dataset seed).
  await setDoc(doc(db,'groups','group-demo-neozy'),{id:'group-demo-neozy',name:'Demo Group',shortName:'DEMO',status:'Active',isDemo:true});
  await setDoc(doc(db,'groups','group-prod-neozy'),{id:'group-prod-neozy',name:'Prod Group',shortName:'PROD',status:'Active'});
  await setDoc(doc(db,'users','MUSR-DEMO-0001'),{id:'MUSR-DEMO-0001',companyId:DEMO_COMPANY,email:'demo@neozy.in',role:'Demo Operator',status:'Active',isSuperAdmin:false,isDeleted:false});
  await setDoc(doc(db,'user_auth_maps',DEMO_UID),{authUid:DEMO_UID,userId:'MUSR-DEMO-0001',companyId:DEMO_COMPANY,email:'demo@neozy.in'});
  await setDoc(doc(db,'leads','DEMO-LEAD'),{id:'DEMO-LEAD',companyId:DEMO_COMPANY,groupId:'group-demo-neozy',name:'Demo Lead',createdBy:'MUSR-DEMO-0001',isDeleted:false});
  await setDoc(doc(db,'leads','PROD-LEAD'),{id:'PROD-LEAD',companyId:'company-production',groupId:'group-prod-neozy',name:'Secret Production Lead',createdBy:'prod-user',isDeleted:false});
  await setDoc(doc(db,'settings','company-demo-neozy_settings_general'),{companyId:DEMO_COMPANY,section:'general',data:{}});
  await setDoc(doc(db,'settings','company-production_settings_general'),{companyId:'company-production',section:'general',data:{}});
  await setDoc(doc(db,'customer_phone_locks','company-demo-neozy_0000000001'),{id:'company-demo-neozy_0000000001',companyId:DEMO_COMPANY,phone:'0000000001',customerId:'DEMO-CUSTOMER',isDeleted:false});
  await setDoc(doc(db,'customer_phone_locks','company-production_9999999999'),{id:'company-production_9999999999',companyId:'company-production',phone:'9999999999',customerId:'PROD-CUSTOMER',isDeleted:false});
  await setDoc(doc(db,'stock_ledger','DEMO-LEDGER'),{id:'DEMO-LEDGER',companyId:DEMO_COMPANY,transactionId:'T1',movementAt:new Date(),qty:1});
 });
}
function demoDb(){return env.authenticatedContext(DEMO_UID,{email:'demo@neozy.in'}).firestore()}

beforeAll(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:readFileSync('firestore.rules','utf8')}})});
beforeEach(async()=>{await env.clearFirestore();await seed()});
afterAll(async()=>{await env.cleanup()});

describe('official demo Firestore isolation',()=>{
 it('reads own company metadata and demo records',async()=>{const db=demoDb();await assertSucceeds(getDoc(doc(db,'companies',DEMO_COMPANY)));await assertSucceeds(getDoc(doc(db,'leads','DEMO-LEAD')))});
 it('denies production company metadata and known document IDs',async()=>{const db=demoDb();await assertFails(getDoc(doc(db,'companies','company-production')));await assertFails(getDoc(doc(db,'leads','PROD-LEAD')))});
 it('denies production list queries but allows a company-proven demo query',async()=>{const db=demoDb();await assertFails(getDocs(query(collection(db,'leads'),where('companyId','==','company-production'))));await assertSucceeds(getDocs(query(collection(db,'leads'),where('companyId','==',DEMO_COMPANY))))});
 it('denies forged production creates',async()=>{const db=demoDb();await assertFails(setDoc(doc(db,'leads','FORGED'),{id:'FORGED',companyId:'company-production',createdBy:'MUSR-DEMO-0001',isDeleted:false}))});
 it('denies changing companyId and self-promoting to super-admin',async()=>{const db=demoDb();await assertFails(updateDoc(doc(db,'leads','DEMO-LEAD'),{companyId:'company-production'}));await assertFails(updateDoc(doc(db,'users','MUSR-DEMO-0001'),{isSuperAdmin:true}))});
 it('isolates settings and customer phone locks',async()=>{const db=demoDb();await assertSucceeds(getDoc(doc(db,'settings','company-demo-neozy_settings_general')));await assertFails(getDoc(doc(db,'settings','company-production_settings_general')));await assertSucceeds(getDoc(doc(db,'customer_phone_locks','company-demo-neozy_0000000001')));await assertFails(getDoc(doc(db,'customer_phone_locks','company-production_9999999999')))});
 it('prevents cross-company phone-lock creation and identity mutation',async()=>{const db=demoDb();await assertFails(setDoc(doc(db,'customer_phone_locks','company-production_0000000002'),{id:'company-production_0000000002',companyId:'company-production',phone:'0000000002',customerId:'X'}));await assertFails(updateDoc(doc(db,'customer_phone_locks','company-demo-neozy_0000000001'),{customerId:'OTHER'}))});
 it('cannot read or mutate trusted reset operational records',async()=>{const db=demoDb();await assertFails(getDoc(doc(db,'demo_operations','company-demo-neozy-reset')));await assertFails(setDoc(doc(db,'demo_operations','company-demo-neozy-reset'),{companyId:DEMO_COMPANY,status:'complete'}))});
 it('keeps immutable ledger entries immutable',async()=>{await assertFails(updateDoc(doc(demoDb(),'stock_ledger','DEMO-LEDGER'),{qty:2}))});
 it('fails closed when mapping and profile companies mismatch',async()=>{await env.withSecurityRulesDisabled(async ctx=>updateDoc(doc(ctx.firestore(),'user_auth_maps',DEMO_UID),{companyId:'company-production'}));await assertFails(getDoc(doc(demoDb(),'leads','DEMO-LEAD')))});
 it('preserves owner cross-company company access',async()=>{const owner=env.authenticatedContext('owner-uid',{email:'shreeniwas.tripathi0@gmail.com'}).firestore();await assertSucceeds(getDoc(doc(owner,'companies','company-production')));await assertSucceeds(getDoc(doc(owner,'leads','PROD-LEAD')))});
});
