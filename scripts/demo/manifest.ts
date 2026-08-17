import { createHash } from 'node:crypto';
import { DEMO_COMPANY_ID, DEMO_MANIFEST_ID, DEMO_SEED_ID } from './config.ts';
import type { DemoDocument, DemoSeedPlan } from './types.ts';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function buildManifest(plan: DemoSeedPlan) {
  const documents = plan.documents.map(({collection,id})=>({collection,id})).sort((a,b)=>`${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`));
  const counts = documents.reduce<Record<string,number>>((acc,item)=>{acc[item.collection]=(acc[item.collection]||0)+1;return acc},{});
  return { id: DEMO_MANIFEST_ID, companyId: DEMO_COMPANY_ID, isDemo:true, demoSeedId:DEMO_SEED_ID, seedVersion:DEMO_SEED_ID, documents, counts, checksum:stableHash(plan.documents.map((d:DemoDocument)=>({collection:d.collection,id:d.id,data:d.data}))), verified:true };
}
export function assertManifestConsistent(manifest: ReturnType<typeof buildManifest>, plan: DemoSeedPlan) {
  if (manifest.companyId!==DEMO_COMPANY_ID||manifest.seedVersion!==DEMO_SEED_ID||manifest.documents.length!==plan.documents.length) throw new Error('Demo manifest identity/count mismatch.');
  if (manifest.checksum!==stableHash(plan.documents.map(d=>({collection:d.collection,id:d.id,data:d.data})))) throw new Error('Demo manifest checksum mismatch.');
}
