import { FieldValue } from 'firebase-admin/firestore';
import { DEMO_BATCH_SIZE, DEMO_COMPANY_ID, DEMO_MANIFEST_COLLECTION, DEMO_MANIFEST_ID } from './config.ts';
import { assertMutationCeiling, assertNoForeignCollision, assertNoForbiddenFields, assertSafeDeleteDocument } from './guards.ts';
import { buildManifest, assertManifestConsistent } from './manifest.ts';
import { assertPlanVerified, verifyPersistedPlan } from './verify.ts';
import type { DemoDocument, DemoSeedPlan } from './types.ts';

export async function validatePlanCollisions(db:any, plan:DemoSeedPlan){
 assertMutationCeiling(plan.documents.length); assertNoForbiddenFields(plan.documents); assertPlanVerified(plan);
 for(const document of plan.documents){const snap=await db.collection(document.collection).doc(document.id).get();assertNoForeignCollision(document,{exists:snap.exists,data:snap.exists?snap.data():undefined})}
}
export function summarizePlan(plan:DemoSeedPlan){return plan.documents.reduce<Record<string,number>>((a,d)=>{a[d.collection]=(a[d.collection]||0)+1;return a},{})}
export async function writeDocuments(db:any,documents:DemoDocument[]){
 for(let i=0;i<documents.length;i+=DEMO_BATCH_SIZE){const batch=db.batch();for(const d of documents.slice(i,i+DEMO_BATCH_SIZE)){batch.set(db.collection(d.collection).doc(d.id),{...d.data,updatedAt:FieldValue.serverTimestamp(),createdAt:d.data.createdAt||FieldValue.serverTimestamp()},{merge:true})}await batch.commit()}
}
export async function applySeedPlan(db:any,plan:DemoSeedPlan){
 await validatePlanCollisions(db,plan);await writeDocuments(db,plan.documents);await verifyPersistedPlan(db,plan);
 const manifest=buildManifest(plan);assertManifestConsistent(manifest,plan);
 await db.collection(DEMO_MANIFEST_COLLECTION).doc(DEMO_MANIFEST_ID).set({...manifest,finalizedAt:FieldValue.serverTimestamp()},{merge:false});
 return manifest;
}
export async function loadManifest(db:any){const snap=await db.collection(DEMO_MANIFEST_COLLECTION).doc(DEMO_MANIFEST_ID).get();if(!snap.exists)throw new Error('Verified demo manifest does not exist; refusing destructive operation.');const data=snap.data();if(data.companyId!==DEMO_COMPANY_ID||data.isDemo!==true||data.verified!==true)throw new Error('Demo manifest identity is invalid.');return data}
export async function deleteDocuments(db:any,documents:DemoDocument[]){
 for(let i=0;i<documents.length;i+=DEMO_BATCH_SIZE){const batch=db.batch();for(const d of documents.slice(i,i+DEMO_BATCH_SIZE))batch.delete(db.collection(d.collection).doc(d.id));await batch.commit()}
}
export async function loadSafeDeletionDocuments(db:any, documents:DemoDocument[]):Promise<DemoDocument[]> {
 const safe:DemoDocument[]=[];
 for(const planned of documents){
  const snap=await db.collection(planned.collection).doc(planned.id).get();
  if(!snap.exists)continue;
  const actual={...planned,data:snap.data()||{}};
  if(planned.collection==='user_auth_maps'){
   if(actual.data.userId!==planned.data.userId||actual.data.companyId!==DEMO_COMPANY_ID||actual.data.email!==planned.data.email)throw new Error('Unsafe persisted mapping '+planned.id);
  }else assertSafeDeleteDocument(actual);
  safe.push(actual);
 }
 return safe;
}

/** Content-based sweep, not ID-based: catches any document in a resettable
 * collection whose companyId is the demo tenant, REGARDLESS of whether its
 * id is part of the current canonical plan. loadSafeDeletionDocuments()
 * above only ever looks up the plan's OWN ids — a stale record left behind
 * by an older generator version, or one created by a user's own demo-mode
 * CRUD testing, has an id the current plan never mentions and was
 * therefore never reachable by that lookup, meaning it could never be
 * deleted by a reset no matter how many times the reset ran. This closes
 * that gap the same way api/demo-reset.ts's deleteDemoData() already does
 * for the client/login-triggered reset path — a plain companyId match is
 * the real tenant-isolation boundary (DEMO_COMPANY_ID is a unique constant
 * that can never coincide with a real company), so no isDemo/demoSeedId
 * exact-match is required here the way assertSafeDeleteDocument demands
 * for the planned-id path above; requiring an exact seed-version match on
 * DELETE would be actively wrong — a doc from an OLDER seed version is
 * exactly what a full reset exists to remove. */
export async function loadStaleCompanyScopedDocuments(db:any, resettableCollections:readonly string[], companyId:string, alreadyIncludedKeys:Set<string>):Promise<DemoDocument[]> {
 const stale:DemoDocument[]=[];
 for(const collection of resettableCollections){
  const snap=await db.collection(collection).where('companyId','==',companyId).get();
  for(const doc of snap.docs){
   const key=`${collection}/${doc.id}`;
   if(alreadyIncludedKeys.has(key))continue;
   stale.push({collection,id:doc.id,data:doc.data()||{}});
  }
 }
 return stale;
}
