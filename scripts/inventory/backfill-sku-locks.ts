/**
 * scripts/inventory/backfill-sku-locks.ts — INVENTORY-09 (§9)
 *
 * ONE-TIME, REVIEWED analysis + backfill for `product_sku_locks`. Every
 * product create/edit going through `useInventory.ts` (or the REST API — see
 * `api/_lib/productSkuLock.ts`) claims its lock going forward; this script
 * catches up pre-existing products that were written before INVENTORY-09.
 *
 *   - products with a valid (non-blank) SKU and NO lock yet -> report,
 *     `--apply` creates the lock (only when unique — see below).
 *   - duplicate normalized SKUs (2+ products, same company, same normalized
 *     SKU) -> REPORT ONLY. NO AUTO-MERGE, NO AUTO-DELETE, NO SILENT WINNER —
 *     a human resolves which product keeps the SKU; the script creates NO
 *     lock for a duplicated SKU even in --apply mode.
 *   - blank SKUs -> listed for completeness, never locked (blank is allowed).
 *   - already-valid locks -> left untouched (idempotent).
 *   - a lock whose `productId` no longer resolves to an existing product
 *     (stale) -> flagged, never auto-repaired.
 *
 * SAFETY: DRY-RUN by default; `--apply` writes ONLY new locks for products
 * with a unique, currently-unlocked SKU. Never deletes, never merges, never
 * silently picks a duplicate's winner.
 *
 * Usage:
 *   TOKEN=$(gcloud auth application-default print-access-token) \
 *     node --experimental-strip-types scripts/inventory/backfill-sku-locks.ts [--company <id>] [--apply] [--json]
 */
import https from 'node:https';
import { normalizeSku, productSkuLockId } from '../../src/lib/inventory/skuLock.ts';

const PROJECT = process.env.FIRESTORE_PROJECT || 'ae-erp-d933d';
const TOKEN = process.env.TOKEN;
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const doApply = args.includes('--apply');
const companyFilter = (() => {
  const i = args.indexOf('--company');
  return i >= 0 ? args[i + 1] : undefined;
})();

if (!TOKEN) {
  console.error('TOKEN env var required (gcloud auth application-default print-access-token)');
  process.exit(2);
}

function req(method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const r = https.request(
      {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 30000,
      },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(new Error(`bad JSON from ${path}: ${b.slice(0, 200)}`)); } });
      },
    );
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (payload) r.write(payload);
    r.end();
  });
}

function fieldValue(field: any): unknown {
  if (!field || typeof field !== 'object') return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('nullValue' in field) return null;
  return undefined;
}
function toRecord(doc: { name: string; fields?: Record<string, any> }): Record<string, unknown> & { id: string } {
  const id = (doc.name || '').split('/').pop() || '';
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fieldValue(v);
  return out as Record<string, unknown> & { id: string };
}
async function readAll(collection: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  const rows: Array<Record<string, unknown> & { id: string }> = [];
  let pageToken = '';
  do {
    const page: any = await req('GET', `${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (page.error) throw new Error(`${collection}: ${page.error.message || JSON.stringify(page.error)}`);
    for (const d of page.documents || []) rows.push(toRecord(d));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return rows;
}

async function createLock(lockId: string, companyId: string, sku: string, productId: string): Promise<void> {
  const res = await req('PATCH', `product_sku_locks/${encodeURIComponent(lockId)}`, {
    fields: {
      id: { stringValue: lockId }, companyId: { stringValue: companyId }, sku: { stringValue: sku },
      productId: { stringValue: productId }, isDeleted: { booleanValue: false },
    },
  });
  if (res.error) throw new Error(`create lock ${lockId}: ${res.error.message || JSON.stringify(res.error)}`);
}

(async () => {
  console.error(`PROJECT: ${PROJECT}   MODE: ${doApply ? 'APPLY (writes new locks only)' : 'DRY-RUN (no writes)'}`);

  const [products, locks] = await Promise.all([readAll('products'), readAll('product_sku_locks').catch(() => [])]);
  const activeProducts = products.filter((p) => p.isDeleted !== true && (!companyFilter || p.companyId === companyFilter));
  const activeLocks = locks.filter((l) => l.isDeleted !== true);
  const lockedProductIds = new Set(activeLocks.map((l) => l.productId));

  const bySkuKey = new Map<string, Array<{ id: string; name: string; companyId: string }>>();
  const blank: string[] = [];
  for (const p of activeProducts) {
    const normalized = normalizeSku(p.sku);
    if (!normalized) { blank.push(p.id); continue; }
    const key = `${String(p.companyId || '')}::${normalized}`;
    const arr = bySkuKey.get(key) || [];
    arr.push({ id: p.id, name: String(p.name || p.id), companyId: String(p.companyId || '') });
    bySkuKey.set(key, arr);
  }

  const duplicates: Array<{ sku: string; companyId: string; products: Array<{ id: string; name: string }> }> = [];
  const toLock: Array<{ productId: string; product: string; companyId: string; sku: string; lockId: string }> = [];
  const alreadyLocked: string[] = [];

  for (const [key, group] of bySkuKey) {
    const [companyId, normalizedSku] = key.split('::');
    if (group.length > 1) {
      duplicates.push({ sku: normalizedSku, companyId, products: group.map((g) => ({ id: g.id, name: g.name })) });
      continue; // REPORT ONLY — never lock a duplicated SKU automatically.
    }
    const [product] = group;
    if (lockedProductIds.has(product.id)) { alreadyLocked.push(product.id); continue; }
    toLock.push({ productId: product.id, product: product.name, companyId, sku: normalizedSku, lockId: productSkuLockId(companyId, normalizedSku) });
  }

  // Stale lock detection: a lock whose productId no longer resolves to a live product.
  const productIds = new Set(activeProducts.map((p) => p.id));
  const staleLocks = activeLocks.filter((l) => !productIds.has(String(l.productId || '')));

  if (doApply) {
    for (const t of toLock) await createLock(t.lockId, t.companyId, t.sku, t.productId);
  }

  const report = {
    project: PROJECT, company: companyFilter || 'ALL', mode: doApply ? 'APPLY' : 'DRY_RUN',
    totalProducts: activeProducts.length,
    blankSkuCount: blank.length,
    alreadyLockedCount: alreadyLocked.length,
    toLockCount: toLock.length,
    duplicateSkuGroups: duplicates.length,
    staleLockCount: staleLocks.length,
    toLock, duplicates, staleLocks: staleLocks.map((l) => ({ lockId: l.id, sku: l.sku, productId: l.productId })),
    generatedAt: new Date().toISOString(),
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('');
  console.log(`SKU lock backfill — ${report.company}   (${report.mode})`);
  console.log(`  products                : ${report.totalProducts}`);
  console.log(`  blank SKU (no lock)      : ${report.blankSkuCount}`);
  console.log(`  already locked           : ${report.alreadyLockedCount}`);
  console.log(`  ${doApply ? 'locked now' : 'to lock'}               : ${report.toLockCount}`);
  console.log(`  DUPLICATE sku groups     : ${report.duplicateSkuGroups}  (report only — resolve by hand, never auto-merged)`);
  console.log(`  stale locks (no product) : ${report.staleLockCount}`);
  for (const d of duplicates) {
    console.log(`   ! DUPLICATE sku="${d.sku}" company=${d.companyId}: ${d.products.map((p) => `${p.name} (${p.id})`).join(' vs ')}`);
  }
  for (const s of staleLocks) console.log(`   ! stale lock ${s.id} (sku=${s.sku}) references missing product ${s.productId}`);
  console.log('');
  console.log(doApply
    ? '  Applied — only unique, currently-unlocked SKUs were locked. Duplicates require human resolution first.'
    : '  DRY-RUN only. Re-run with --apply to create locks for unique unlocked SKUs.');
})().catch((err) => { console.error('backfill failed:', err); process.exit(1); });
