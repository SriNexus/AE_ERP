/**
 * scripts/inventory/reconcile.ts — INVENTORY-06 (P2-1)
 *
 * READ-ONLY stock <-> ledger reconciliation report. Performs ZERO writes.
 * Reuses the shared pure reconciliation math (src/engines/stockReconciliationMath.ts)
 * — there is no second reconciliation implementation.
 *
 * Usage:
 *   TOKEN=$(gcloud auth application-default print-access-token) \
 *     node --experimental-strip-types scripts/inventory/reconcile.ts [--company <companyId>] [--json]
 *
 * Env:
 *   TOKEN              required — a Firestore access token
 *   FIRESTORE_PROJECT  optional — defaults to ae-erp-d933d
 *
 * Exit code is 0 even when mismatches are found (findings are the point of the
 * report, not a failure). Non-zero only on an unexpected script error.
 */
import https from 'node:https';
import { computeReconciliation, type StockLedgerRowLike } from '../../src/engines/stockReconciliationMath.ts';
import { reservationRemainder, type StockReservationRecord } from '../../src/lib/inventory/reservationConfig.ts';

const PROJECT = process.env.FIRESTORE_PROJECT || 'ae-erp-d933d';
const TOKEN = process.env.TOKEN;
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const companyFilter = (() => {
  const i = args.indexOf('--company');
  return i >= 0 ? args[i + 1] : undefined;
})();

if (!TOKEN) {
  console.error('TOKEN env var required (gcloud auth application-default print-access-token)');
  process.exit(2);
}

function get(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`bad JSON from ${path}: ${body.slice(0, 200)}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
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
    const page: any = await get(`${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (page.error) throw new Error(`${collection}: ${page.error.message || JSON.stringify(page.error)}`);
    for (const d of page.documents || []) rows.push(toRecord(d));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return rows;
}

(async () => {
  console.error(`PROJECT: ${PROJECT}`);
  console.error('Mode: READ-ONLY reconciliation — zero writes performed by this script.');

  const [summaries, ledger, reservations] = await Promise.all([
    readAll('stock'), readAll('stock_ledger'), readAll('stock_reservations').catch(() => []),
  ]);
  const activeSummaries = summaries.filter((s) => s.isDeleted !== true && (!companyFilter || s.companyId === companyFilter));

  const key = (pid: unknown, wid: unknown) => `${String(pid || '')} ${String(wid || '')}`;
  const ledgerByKey = new Map<string, StockLedgerRowLike[]>();
  for (const row of ledger) {
    if (companyFilter && row.companyId !== companyFilter) continue;
    const k = key(row.productId, row.warehouseId);
    const arr = ledgerByKey.get(k) || [];
    arr.push(row as StockLedgerRowLike);
    ledgerByKey.set(k, arr);
  }
  // INVENTORY-07 — active reservation remainders per product+warehouse.
  const rsvRemainderByKey = new Map<string, number>();
  for (const r of reservations) {
    if (r.isDeleted === true) continue;
    if (companyFilter && r.companyId !== companyFilter) continue;
    const k = key(r.productId, r.warehouseId);
    rsvRemainderByKey.set(k, (rsvRemainderByKey.get(k) || 0) + reservationRemainder(r as unknown as StockReservationRecord));
  }

  const results = activeSummaries.map((s) => computeReconciliation({
    summaryId: s.id,
    companyId: String(s.companyId || ''),
    productId: String(s.productId || ''),
    warehouseId: String(s.warehouseId || ''),
    productName: String(s.product || s.productId || ''),
    warehouseName: String(s.warehouse || s.warehouseId || ''),
    unit: String(s.unit || 'unit'),
    storedOnHand: Number(s.onHandQty ?? s.availableQty ?? s.available) || 0,
    ledgerRows: ledgerByKey.get(key(s.productId, s.warehouseId)) || [],
    storedReserved: Number(s.reservedQty ?? s.reserved) || 0,
    activeReservationRemainder: rsvRemainderByKey.get(key(s.productId, s.warehouseId)) || 0,
  }));

  const mismatches = results.filter((r) => !r.reconciled);
  const reservedMismatches = results.filter((r) => !r.reservedReconciled);
  const report = {
    project: PROJECT,
    company: companyFilter || 'ALL',
    totalSummariesChecked: results.length,
    reconciledCount: results.length - mismatches.length,
    mismatchCount: mismatches.length,
    reservedMismatchCount: reservedMismatches.length,
    realDriftCount: mismatches.filter((r) => r.ledgerComplete).length,
    likelyOpeningBalanceCount: mismatches.filter((r) => !r.ledgerComplete).length,
    totalAbsoluteDrift: mismatches.reduce((n, r) => n + Math.abs(r.delta), 0),
    netDrift: mismatches.reduce((n, r) => n + r.delta, 0),
    mismatches: mismatches
      .slice()
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .map((r) => ({
        summaryId: r.summaryId, product: r.productName, warehouse: r.warehouseName,
        stored: r.stored, computed: r.computed, delta: r.delta,
        ledgerRowCount: r.ledgerRowCount, ledgerComplete: r.ledgerComplete,
        firstMovementAt: r.firstMovementAt, lastMovementAt: r.lastMovementAt, note: r.note,
      })),
    generatedAt: new Date().toISOString(),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(`Stock reconciliation — ${report.company}`);
  console.log(`  summaries checked : ${report.totalSummariesChecked}`);
  console.log(`  reconciled        : ${report.reconciledCount}`);
  console.log(`  mismatches        : ${report.mismatchCount}  (real drift ${report.realDriftCount}, likely opening balance ${report.likelyOpeningBalanceCount})`);
  console.log(`  reserved mismatch : ${report.reservedMismatchCount}  (reservedQty vs Σ active reservation remainders)`);
  console.log(`  total abs. drift  : ${report.totalAbsoluteDrift}`);
  console.log(`  net drift         : ${report.netDrift}`);
  if (mismatches.length) {
    console.log('');
    console.log('  product'.padEnd(30) + 'warehouse'.padEnd(20) + 'stored'.padStart(10) + 'computed'.padStart(10) + 'delta'.padStart(10) + '  assessment');
    for (const m of report.mismatches) {
      console.log(
        `  ${String(m.product).slice(0, 27).padEnd(28)}${String(m.warehouse).slice(0, 17).padEnd(18)}` +
        `${String(m.stored).padStart(10)}${String(m.computed).padStart(10)}${String(m.delta).padStart(10)}  ` +
        `${m.ledgerComplete ? 'POST-ENGINE DRIFT' : 'likely opening balance'}`,
      );
    }
  }
  console.log('');
  console.log('  No data was modified. Corrections are applied only through the app (human-approved RECONCILE_ADJUST).');
})().catch((err) => {
  console.error('reconcile script failed:', err);
  process.exit(1);
});
