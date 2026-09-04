/**
 * scripts/inventory/backfill-dispatch-serials.ts — INVENTORY-11 (§11a)
 *
 * ONE-TIME, REVIEWED analysis + backfill for `dispatch_serials`. Every NEW
 * dispatch verification going through `dispatchWorkflow.executeAndVerifyDispatch`
 * claims its serial locks going forward (§11a — the movement-engine
 * transaction, deterministic `{companyId}_{normalizedSerial}` doc id); this
 * script catches up serials recorded on dispatches verified BEFORE §11a, so
 * the new transactional uniqueness guard also covers historical data —
 * without it, a NEW verification could re-claim a serial that was already
 * used on an OLD, pre-§11a dispatch (the old `getAll(DISPATCH)` full-scan
 * checked ALL history; the new lock collection starts EMPTY and only
 * protects what it has actually seen).
 *
 *   - a normalized serial recorded on exactly ONE dispatch, no lock yet ->
 *     report, `--apply` creates the lock.
 *   - a normalized serial recorded on TWO OR MORE distinct dispatches
 *     (pre-existing bad data — a real physical serial typed onto more than
 *     one dispatch before this guard existed) -> REPORT ONLY. NO AUTO-PICK,
 *     NO AUTO-MERGE, NO SILENT WINNER — a human resolves which dispatch
 *     legitimately owns the serial; the script creates NO lock for an
 *     ambiguous serial even in --apply mode.
 *   - blank serials -> skipped, never locked (matches the live workflow).
 *   - already-locked serials -> left untouched (idempotent).
 *   - a lock whose `dispatchId` no longer resolves to an existing dispatch
 *     (stale) -> flagged, never auto-repaired.
 *
 * SAFETY: DRY-RUN by default; `--apply` writes ONLY new locks for serials
 * with a unique, currently-unlocked historical owner. Never deletes, never
 * merges, never silently picks an ambiguous serial's winner. Never touches
 * `dispatch` documents themselves (items[].serials is left exactly as-is —
 * this only populates the NEW lock collection).
 *
 * Usage:
 *   TOKEN=$(gcloud auth application-default print-access-token) \
 *     node --experimental-strip-types scripts/inventory/backfill-dispatch-serials.ts [--company <id>] [--apply] [--json]
 */
import https from 'node:https';
import { normalizeSerial, dispatchSerialLockId } from '../../src/lib/inventory/serialLock.ts';

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
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fieldValue);
  if ('mapValue' in field) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) out[k] = fieldValue(v);
    return out;
  }
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

async function createLock(lockId: string, companyId: string, serial: string, dispatchId: string, productId: string, warehouseId: string): Promise<void> {
  const res = await req('PATCH', `dispatch_serials/${encodeURIComponent(lockId)}`, {
    fields: {
      id: { stringValue: lockId }, companyId: { stringValue: companyId }, serial: { stringValue: serial },
      dispatchId: { stringValue: dispatchId }, productId: { stringValue: productId },
      warehouseId: { stringValue: warehouseId }, status: { stringValue: 'assigned' }, isDeleted: { booleanValue: false },
      backfilled: { booleanValue: true },
    },
  });
  if (res.error) throw new Error(`create lock ${lockId}: ${res.error.message || JSON.stringify(res.error)}`);
}

interface SerialOwner { dispatchId: string; productId: string; companyId: string; warehouseId: string; }

(async () => {
  console.error(`PROJECT: ${PROJECT}   MODE: ${doApply ? 'APPLY (writes new locks only)' : 'DRY-RUN (no writes)'}`);

  const [dispatches, locks] = await Promise.all([readAll('dispatch'), readAll('dispatch_serials').catch(() => [])]);
  const relevantDispatches = dispatches.filter((d) => !companyFilter || d.companyId === companyFilter);
  const activeLocks = locks.filter((l) => l.isDeleted !== true);
  const lockedKeys = new Set(activeLocks.map((l) => String(l.id)));

  // Group every (companyId, normalizedSerial) occurrence across ALL dispatch
  // history — the same grouping key the live transactional guard uses.
  const bySerialKey = new Map<string, SerialOwner[]>();
  let totalSerialOccurrences = 0;
  for (const d of relevantDispatches) {
    const dispatchId = String(d.id);
    const companyId = String(d.companyId || '');
    const warehouseId = String(d.warehouseId || '');
    const items = Array.isArray(d.items) ? (d.items as any[]) : [];
    for (const item of items) {
      const productId = String(item?.productId || '');
      const serials = Array.isArray(item?.serials) ? item.serials : [];
      for (const raw of serials) {
        const serial = String(raw || '').trim();
        if (!serial) continue;
        totalSerialOccurrences += 1;
        const normalized = normalizeSerial(serial);
        const key = `${companyId}::${normalized}`;
        const arr = bySerialKey.get(key) || [];
        // De-dup by dispatchId within the SAME key (a serial repeated twice
        // in one dispatch's own items is one "owner", not two).
        if (!arr.some((o) => o.dispatchId === dispatchId)) {
          arr.push({ dispatchId, productId, companyId, warehouseId });
        }
        bySerialKey.set(key, arr);
      }
    }
  }

  const ambiguous: Array<{ serial: string; companyId: string; dispatches: SerialOwner[] }> = [];
  const toLock: Array<{ lockId: string; serial: string; companyId: string; dispatchId: string; productId: string; warehouseId: string }> = [];
  const alreadyLocked: string[] = [];

  for (const [key, owners] of bySerialKey) {
    const [companyId, normalizedSerial] = key.split('::');
    const lockId = dispatchSerialLockId(companyId, normalizedSerial);
    if (owners.length > 1) {
      ambiguous.push({ serial: normalizedSerial, companyId, dispatches: owners });
      continue; // REPORT ONLY — never lock an ambiguous serial automatically.
    }
    if (lockedKeys.has(lockId)) { alreadyLocked.push(lockId); continue; }
    const [owner] = owners;
    toLock.push({ lockId, serial: normalizedSerial, companyId, dispatchId: owner.dispatchId, productId: owner.productId, warehouseId: owner.warehouseId });
  }

  // Stale lock detection: a lock whose dispatchId no longer resolves to an existing dispatch.
  const dispatchIds = new Set(dispatches.map((d) => d.id));
  const staleLocks = activeLocks.filter((l) => !dispatchIds.has(String(l.dispatchId || '')));

  if (doApply) {
    for (const t of toLock) await createLock(t.lockId, t.companyId, t.serial, t.dispatchId, t.productId, t.warehouseId);
  }

  const report = {
    project: PROJECT, company: companyFilter || 'ALL', mode: doApply ? 'APPLY' : 'DRY_RUN',
    totalDispatchesScanned: relevantDispatches.length,
    totalSerialOccurrences,
    distinctSerialKeys: bySerialKey.size,
    alreadyLockedCount: alreadyLocked.length,
    toLockCount: toLock.length,
    ambiguousSerialCount: ambiguous.length,
    staleLockCount: staleLocks.length,
    toLock, ambiguous, staleLocks: staleLocks.map((l) => ({ lockId: l.id, serial: l.serial, dispatchId: l.dispatchId })),
    generatedAt: new Date().toISOString(),
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('');
  console.log(`Dispatch serial lock backfill — ${report.company}   (${report.mode})`);
  console.log(`  dispatches scanned       : ${report.totalDispatchesScanned}`);
  console.log(`  serial occurrences       : ${report.totalSerialOccurrences}`);
  console.log(`  distinct (company,serial): ${report.distinctSerialKeys}`);
  console.log(`  already locked           : ${report.alreadyLockedCount}`);
  console.log(`  ${doApply ? 'locked now' : 'to lock'}               : ${report.toLockCount}`);
  console.log(`  AMBIGUOUS serials        : ${report.ambiguousSerialCount}  (report only — resolve by hand, never auto-merged)`);
  console.log(`  stale locks (no dispatch): ${report.staleLockCount}`);
  for (const a of ambiguous) {
    console.log(`   ! AMBIGUOUS serial="${a.serial}" company=${a.companyId}: dispatches ${a.dispatches.map((o) => o.dispatchId).join(' vs ')}`);
  }
  for (const s of staleLocks) console.log(`   ! stale lock ${s.id} (serial=${s.serial}) references missing dispatch ${s.dispatchId}`);
  console.log('');
  console.log(doApply
    ? '  Applied — only unique, currently-unlocked historical serials were locked. Ambiguous serials require human resolution first.'
    : '  DRY-RUN only. Re-run with --apply to create locks for unique unlocked historical serials.');
})().catch((err) => { console.error('backfill failed:', err); process.exit(1); });
