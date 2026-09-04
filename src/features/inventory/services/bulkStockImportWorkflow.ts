/**
 * INVENTORY-10 (§10c) — Bulk stock import / bulk adjust. CSV rows → validated
 * → one `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` movement-engine call per row (never
 * a second stock writer, never one giant multi-document transaction across
 * unrelated rows/products — each row's OWN movement is atomic via the
 * engine's own per-movement transaction). A shared `importRunId` makes the
 * WHOLE run idempotent: re-submitting the SAME run (same id, same row
 * numbers) is a benign no-op row-by-row — the engine's own existing-ledger-
 * row check, not app-layer deduplication — so a retried/partially-failed
 * import can always be safely resubmitted as-is.
 */
import { getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { logActivity, resolveWorkflowCompanyId, stockSummaryId, type WorkflowRecord } from '../../../lib/workflow';
import { applyStockMovement } from '../../../lib/inventory/stockMovementEngine';
import { buildIdempotencyKey, movementLedgerId } from '../../../lib/inventory/idempotency';
import type { MovementResult, MovementType } from '../../../lib/inventory/types';

export interface BulkAdjustRow {
  /** 1-based row number as it appeared in the source CSV — the idempotency
   *  line key. Reruns of the SAME import MUST submit the SAME row numbers
   *  for the SAME products/warehouses to stay idempotent; a genuinely
   *  different file gets a new `importRunId`. */
  rowNumber: number;
  productId: string;
  warehouseId: string;
  /** Signed: positive → ADJUSTMENT_IN, negative → ADJUSTMENT_OUT. Never zero. */
  qty: number;
  unit: string;
  reasonCode: string;
  notes?: string;
}

export interface BulkAdjustRowOutcome {
  rowNumber: number;
  productId: string;
  warehouseId: string;
  qty: number;
  ok: boolean;
  error?: string;
  /** true = this row's ledger row already existed (a prior attempt of the
   *  SAME run already applied it) — reported, not re-applied, not double-counted. */
  alreadyApplied?: boolean;
  applied?: boolean;
  onHandBefore?: number;
  onHandAfter?: number;
}

export interface BulkAdjustReport {
  importRunId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: BulkAdjustRowOutcome[];
}

function rowMovementType(row: BulkAdjustRow): Extract<MovementType, 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'> {
  return row.qty >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
}
function rowIdempotencyKey(importRunId: string, row: BulkAdjustRow): string {
  return buildIdempotencyKey(rowMovementType(row), 'bulk_import', importRunId, row.rowNumber);
}

async function validateRow(companyId: string, row: BulkAdjustRow): Promise<string | null> {
  if (!row.productId) return 'Product is required';
  if (!row.warehouseId) return 'Warehouse is required';
  if (!Number.isFinite(row.qty) || row.qty === 0) return 'Quantity must be a non-zero number';
  if (!row.unit) return 'Unit is required';
  if (!row.reasonCode || !row.reasonCode.trim()) return 'A reason is required for every adjustment';
  const [product, warehouse] = await Promise.all([
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, row.productId),
    getOne<WorkflowRecord & { id: string }>(COLLECTIONS.WAREHOUSES, row.warehouseId),
  ]);
  if (!product || product.isDeleted === true) return `Product ${row.productId} does not exist or has been removed`;
  if (companyId && product.companyId && product.companyId !== companyId) return `Product ${row.productId} belongs to a different company`;
  if (!warehouse || warehouse.isDeleted === true) return `Warehouse ${row.warehouseId} does not exist or has been removed`;
  if (companyId && warehouse.companyId && warehouse.companyId !== companyId) return `Warehouse ${row.warehouseId} belongs to a different company`;
  return null;
}

/**
 * DRY RUN — validates every row (product/warehouse existence + tenant, qty,
 * reason), checks whether it was ALREADY applied by a prior attempt of this
 * same `importRunId`, and simulates the cumulative on-hand effect of the
 * still-pending rows on top of the CURRENT summary (so N rows touching the
 * same product+warehouse preview correctly together). Writes NOTHING — the
 * authoritative check happens again, transactionally, inside the engine at
 * apply time, so this preview is advisory (a concurrent change between
 * preview and apply is still caught there, never silently allowed here).
 */
export async function previewBulkAdjust(rows: BulkAdjustRow[], importRunId: string): Promise<BulkAdjustReport> {
  if (!importRunId) throw new Error('An import run id is required');
  const companyId = resolveWorkflowCompanyId();
  const outcomes: BulkAdjustRowOutcome[] = [];
  const runningOnHand = new Map<string, number>();

  for (const row of rows) {
    const base = { rowNumber: row.rowNumber, productId: row.productId, warehouseId: row.warehouseId, qty: row.qty };
    const error = await validateRow(companyId, row);
    if (error) { outcomes.push({ ...base, ok: false, error }); continue; }

    const key = `${row.productId}|${row.warehouseId}`;
    if (!runningOnHand.has(key)) {
      const summary = await getOne<WorkflowRecord>(COLLECTIONS.STOCK, stockSummaryId(companyId, row.productId, row.warehouseId)).catch(() => null);
      runningOnHand.set(key, Number(summary?.onHandQty ?? summary?.availableQty) || 0);
    }
    const onHandBefore = runningOnHand.get(key) as number;

    const already = await getOne<WorkflowRecord>(COLLECTIONS.STOCK_LEDGER, movementLedgerId(rowIdempotencyKey(importRunId, row))).catch(() => null);
    if (already) {
      // Already reflected in the CURRENT summary read above — no further delta.
      outcomes.push({ ...base, ok: true, alreadyApplied: true, onHandBefore, onHandAfter: onHandBefore });
      continue;
    }

    const onHandAfter = onHandBefore + row.qty;
    if (onHandAfter < 0) {
      outcomes.push({ ...base, ok: false, error: `Insufficient stock: on-hand would go to ${onHandAfter}`, onHandBefore, onHandAfter });
      continue;
    }
    runningOnHand.set(key, onHandAfter);
    outcomes.push({ ...base, ok: true, alreadyApplied: false, onHandBefore, onHandAfter });
  }

  return {
    importRunId, totalRows: rows.length,
    validRows: outcomes.filter((o) => o.ok).length, invalidRows: outcomes.filter((o) => !o.ok).length,
    rows: outcomes,
  };
}

/**
 * APPLY — re-validates then applies each valid row through the movement
 * engine, one ADJUSTMENT_IN/OUT call per row. An invalid row is skipped and
 * reported (never guessed/auto-corrected); one row's engine-side rejection
 * (e.g. a concurrent change made it insufficient) does not abort the rest
 * of the run — every row's outcome is independently reported.
 */
export async function applyBulkAdjust(rows: BulkAdjustRow[], importRunId: string): Promise<BulkAdjustReport> {
  if (!importRunId) throw new Error('An import run id is required');
  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const actorId = state.user?.id || 'system';
  const outcomes: BulkAdjustRowOutcome[] = [];

  for (const row of rows) {
    const base = { rowNumber: row.rowNumber, productId: row.productId, warehouseId: row.warehouseId, qty: row.qty };
    const error = await validateRow(companyId, row);
    if (error) { outcomes.push({ ...base, ok: false, error }); continue; }

    try {
      const result: MovementResult = await applyStockMovement({
        movementType: rowMovementType(row),
        productId: row.productId, warehouseId: row.warehouseId,
        qty: Math.abs(row.qty), unit: row.unit,
        sourceType: 'bulk_import', sourceId: importRunId, lineKey: row.rowNumber,
        companyId, actorId, reasonCode: row.reasonCode, notes: row.notes || `Bulk import ${importRunId}`,
        ledgerExtra: { referenceType: 'BulkImport', referenceId: importRunId, rowNumber: row.rowNumber },
      });
      outcomes.push({
        ...base, ok: true, applied: result.applied, alreadyApplied: !result.applied,
        onHandBefore: result.onHandBefore, onHandAfter: result.onHandAfter,
      });
    } catch (err) {
      outcomes.push({ ...base, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const appliedCount = outcomes.filter((o) => o.ok && o.applied).length;
  await logActivity('Stock', 'Bulk Stock Import', importRunId, {
    entityName: `Import ${importRunId}`,
    actionLabel: `Applied ${appliedCount}/${rows.length} row${rows.length === 1 ? '' : 's'} (run ${importRunId})`,
  });

  return {
    importRunId, totalRows: rows.length,
    validRows: outcomes.filter((o) => o.ok).length, invalidRows: outcomes.filter((o) => !o.ok).length,
    rows: outcomes,
  };
}
