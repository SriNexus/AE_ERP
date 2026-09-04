/**
 * scripts/inventory/backfill-onhand.ts — INVENTORY-07 (Plan §07 "Migration
 * strategy" / "Backfill script").
 *
 * ONE-TIME, REVIEWED migration to prepare `stock` summaries for the reservation
 * lifecycle:
 *
 *   1. `onHandQty` absent  → set it from the trusted PHYSICAL basis
 *      (`availableQty` — the pre-07 stored quantity is the physical on-hand).
 *   2. `reservedQty` absent → initialise to 0 (start clean — Plan §07 decision 6:
 *      NO retro-reservation of historical paid orders).
 *   3. `availableQty` → recompute as `onHandQty − reservedQty`.
 *
 * SAFETY:
 *   - DRY-RUN by default. `--apply` performs the writes.
 *   - Reports every proposed change before doing anything.
 *   - NEVER deletes a document. NEVER touches `stock_ledger`.
 *   - NEVER silently overwrites a KNOWN reconciliation mismatch: a summary whose
 *     ledger-complete `computed` on-hand disagrees with its stored quantity is
 *     FLAGGED and SKIPPED — that is a Phase-06 human-approved RECONCILE_ADJUST
 *     decision, not a migration.
 *   - Idempotent: re-running finds nothing left to change.
 *
 * Usage:
 *   TOKEN=$(gcloud auth application-default print-access-token) \
 *     node --experimental-strip-types scripts/inventory/backfill-onhand.ts [--company <id>] [--apply] [--json]
 */
import https from 'node:https';
import { computeReconciliation, RECON_EPSILON, type StockLedgerRowLike } from '../../src/engines/stockReconciliationMath.ts';
import { reservationRemainder, type StockReservationRecord } from '../../src/lib/inventory/reservationConfig.ts';

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
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('mapValue' in field) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((field.mapValue.fields as Record<string, unknown>) || {})) out[k] = fieldValue(v);
    return out;
  }
  if ('arrayValue' in field) return ((field.arrayValue.values as unknown[]) || []).map(fieldValue);
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
const numOr = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

async function patchSummary(id: string, patch: { onHandQty: number; reservedQty: number; availableQty: number }): Promise<void> {
  const mask = 'updateMask.fieldPaths=onHandQty&updateMask.fieldPaths=reservedQty&updateMask.fieldPaths=availableQty';
  const res = await req('PATCH', `stock/${encodeURIComponent(id)}?${mask}`, {
    fields: {
      onHandQty: { doubleValue: patch.onHandQty },
      reservedQty: { doubleValue: patch.reservedQty },
      availableQty: { doubleValue: patch.availableQty },
    },
  });
  if (res.error) throw new Error(`patch ${id}: ${res.error.message || JSON.stringify(res.error)}`);
}

(async () => {
  console.error(`PROJECT: ${PROJECT}   MODE: ${doApply ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);

  const [summaries, ledger, reservations] = await Promise.all([
    readAll('stock'), readAll('stock_ledger'), readAll('stock_reservations').catch(() => []),
  ]);
  const active = summaries.filter((s) => s.isDeleted !== true && (!companyFilter || s.companyId === companyFilter));

  const key = (pid: unknown, wid: unknown) => `${String(pid || '')} ${String(wid || '')}`;
  const ledgerByKey = new Map<string, StockLedgerRowLike[]>();
  for (const row of ledger) {
    if (companyFilter && row.companyId !== companyFilter) continue;
    const k = key(row.productId, row.warehouseId);
    (ledgerByKey.get(k) || ledgerByKey.set(k, []).get(k)!).push(row as StockLedgerRowLike);
  }
  const rsvByKey = new Map<string, StockReservationRecord[]>();
  for (const r of reservations) {
    if (r.isDeleted === true) continue;
    if (companyFilter && r.companyId !== companyFilter) continue;
    const k = key(r.productId, r.warehouseId);
    (rsvByKey.get(k) || rsvByKey.set(k, []).get(k)!).push(r as unknown as StockReservationRecord);
  }

  const plan: Array<Record<string, unknown>> = [];
  for (const s of active) {
    const k = key(s.productId, s.warehouseId);
    const storedAvailable = numOr(s.availableQty ?? s.available);
    const hasOnHand = s.onHandQty !== undefined && s.onHandQty !== null;
    const onHandNow = hasOnHand ? numOr(s.onHandQty) : storedAvailable;
    const reservedNow = numOr(s.reservedQty ?? s.reserved);
    const activeRemainder = (rsvByKey.get(k) || []).reduce((n, r) => n + reservationRemainder(r), 0);

    const recon = computeReconciliation({
      summaryId: s.id, companyId: String(s.companyId || ''),
      productId: String(s.productId || ''), warehouseId: String(s.warehouseId || ''),
      productName: String(s.product || s.productId || ''), warehouseName: String(s.warehouse || s.warehouseId || ''),
      unit: String(s.unit || 'unit'),
      storedOnHand: onHandNow,
      ledgerRows: ledgerByKey.get(k) || [],
      storedReserved: reservedNow, activeReservationRemainder: activeRemainder,
    });

    // Never overwrite a KNOWN, ledger-complete mismatch — that is a Phase-06
    // RECONCILE_ADJUST decision, not a migration.
    const knownMismatch = !recon.reconciled && recon.ledgerComplete;

    const targetOnHand = onHandNow;                       // physical basis, unchanged
    const targetReserved = reservedNow;                   // start clean — no retro-reserve
    const targetAvailable = Math.round((targetOnHand - targetReserved) * 1e6) / 1e6;

    const needsOnHand = !hasOnHand;
    const needsReserved = s.reservedQty === undefined || s.reservedQty === null;
    const needsAvailable = Math.abs(storedAvailable - targetAvailable) > RECON_EPSILON;

    if (knownMismatch) {
      plan.push({ summaryId: s.id, product: recon.productName, warehouse: recon.warehouseName, action: 'SKIP_FLAGGED_MISMATCH', stored: recon.stored, computed: recon.computed, delta: recon.delta });
      continue;
    }
    if (!needsOnHand && !needsReserved && !needsAvailable) {
      plan.push({ summaryId: s.id, product: recon.productName, warehouse: recon.warehouseName, action: 'NO_CHANGE' });
      continue;
    }
    plan.push({
      summaryId: s.id, product: recon.productName, warehouse: recon.warehouseName, action: 'UPDATE',
      set: { onHandQty: targetOnHand, reservedQty: targetReserved, availableQty: targetAvailable },
      from: { onHandQty: hasOnHand ? onHandNow : null, reservedQty: needsReserved ? null : reservedNow, availableQty: storedAvailable },
    });
  }

  const updates = plan.filter((p) => p.action === 'UPDATE');
  const flagged = plan.filter((p) => p.action === 'SKIP_FLAGGED_MISMATCH');

  if (doApply) {
    for (const u of updates) {
      await patchSummary(String(u.summaryId), u.set as { onHandQty: number; reservedQty: number; availableQty: number });
    }
  }

  const report = {
    project: PROJECT, company: companyFilter || 'ALL', mode: doApply ? 'APPLY' : 'DRY_RUN',
    totalSummaries: active.length,
    noChange: plan.filter((p) => p.action === 'NO_CHANGE').length,
    toUpdate: updates.length,
    flaggedMismatch: flagged.length,
    updates, flagged,
    generatedAt: new Date().toISOString(),
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('');
  console.log(`Backfill onHandQty / reservedQty — ${report.company}   (${report.mode})`);
  console.log(`  summaries          : ${report.totalSummaries}`);
  console.log(`  no change          : ${report.noChange}`);
  console.log(`  ${doApply ? 'updated' : 'to update'}          : ${report.toUpdate}`);
  console.log(`  flagged (skipped)  : ${report.flaggedMismatch}  (ledger-complete mismatch — resolve via app RECONCILE_ADJUST)`);
  for (const u of updates) {
    console.log(`   • ${String(u.product).slice(0, 30).padEnd(32)} ${JSON.stringify(u.from)} -> ${JSON.stringify(u.set)}`);
  }
  for (const f of flagged) {
    console.log(`   ! ${String(f.product).slice(0, 30).padEnd(32)} stored ${f.stored} vs ledger ${f.computed} (delta ${f.delta}) — NOT migrated`);
  }
  console.log('');
  console.log(doApply ? '  Applied. Stock_ledger untouched; nothing deleted.' : '  DRY-RUN only. Re-run with --apply to write.');
})().catch((err) => { console.error('backfill failed:', err); process.exit(1); });
