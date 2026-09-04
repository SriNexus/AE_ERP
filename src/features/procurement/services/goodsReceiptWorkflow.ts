import { COLLECTIONS, firebaseEnv } from '../../../lib/firebase';
import { createDocWithId, getAll, getOne, resolveWriteCompanyId, resolveWriteGroupId } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { sanitizeFirestoreData } from '../../../lib/sanitizer';
import { useAppStore } from '../../../store/useAppStore';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { NotificationType } from '../../../types';
import { applyStockMovements } from '../../../lib/inventory/stockMovementEngine';
import type { MovementParticipant, MovementPlanEntry, StockMovementInput } from '../../../lib/inventory/types';
import { logActivity, notifyUsers, resolveWorkflowCompanyId, usersByRole, type WorkflowRecord } from '../../../lib/workflow';
import type { Warehouse } from '../../warehouses/types';
import type { GoodsReceiptFormValues, GoodsReceiptItem, GoodsReceiptRecord, PurchaseOrderItem, PurchaseOrderRecord, PurchaseOrderStatus } from '../types';

const RECEIPT_EPSILON = 1e-6;
const RECEIVABLE_PO_STATUSES: PurchaseOrderStatus[] = ['Sent', 'PartiallyReceived'];

const encPart = (value: string) => encodeURIComponent(String(value || '').trim());

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * INVENTORY-03 (P1-1): deterministic goods-receipt document id, derived from
 * the PO plus the exact set of line receipts (index / receivedBefore / qty).
 * Two submissions built from the SAME PO snapshot compute the SAME id — the
 * second finds the existing GRN doc and is a no-op. Two genuinely different
 * receipts get different ids and both persist.
 */
export function goodsReceiptDeterministicId(
  poId: string,
  lines: Array<{ lineIndex: number; previouslyReceivedQty: number; qty: number }>,
): string {
  const token = lines
    .map((line) => `L${line.lineIndex}:B${line.previouslyReceivedQty}:Q${line.qty}`)
    .sort()
    .join('|');
  return `GRN-${encPart(poId)}-${djb2(`${poId}#${token}`)}`;
}

export function calculateReceiptState(order: PurchaseOrderRecord, quantities: Record<number, string>) {
  const receivedItems: GoodsReceiptItem[] = [];
  const items = order.items.map((item, lineIndex) => {
    const previous = Number(item.receivedQty) || 0;
    const receiptQty = Number(quantities[lineIndex] || 0);
    const remainingBefore = Math.max(0, item.qty - previous);
    if (!Number.isFinite(receiptQty) || receiptQty < 0) throw new Error(`Invalid receipt quantity for ${item.product}`);
    if (receiptQty > remainingBefore + RECEIPT_EPSILON) throw new Error(`Receipt quantity exceeds remaining quantity for ${item.product}`);
    if (receiptQty > 0) receivedItems.push({ lineIndex, productId: item.productId, product: item.product, qty: receiptQty, unit: item.unit, orderedQty: item.qty, previouslyReceivedQty: previous });
    const receivedQty = previous + receiptQty;
    return { ...item, receivedQty, remainingQty: Math.max(0, item.qty - receivedQty) };
  });
  if (!receivedItems.length) throw new Error('Enter a received quantity for at least one item');
  const status: PurchaseOrderStatus = items.every((item) => (item.remainingQty || 0) <= RECEIPT_EPSILON) ? 'Received' : 'PartiallyReceived';
  return { items, receivedItems, status };
}

/**
 * INVENTORY-03 (P1-2 / INV-13): re-derive PO line `receivedQty` by INCREMENTING
 * the authoritative (transaction-read) value — never a stale client array — and
 * re-check `Σ received ≤ ordered` per line. `over` names the offending product
 * if the increment would breach the ordered quantity.
 */
function applyReceiptToPoItems(
  poItems: PurchaseOrderItem[],
  appliedByLine: Map<number, number>,
): { items: PurchaseOrderItem[]; status: PurchaseOrderStatus; over: string | null } {
  let over: string | null = null;
  const items = (poItems || []).map((item, index) => {
    const orderedQty = Number(item.qty) || 0;
    const prev = Number(item.receivedQty) || 0;
    const receivedQty = prev + (appliedByLine.get(index) || 0);
    if (receivedQty > orderedQty + RECEIPT_EPSILON) over = item.product || `line ${index + 1}`;
    return { ...item, receivedQty, remainingQty: Math.max(0, orderedQty - receivedQty) };
  });
  const status: PurchaseOrderStatus = items.every((item) => (item.remainingQty || 0) <= RECEIPT_EPSILON) ? 'Received' : 'PartiallyReceived';
  return { items, status, over };
}

/**
 * INVENTORY-03 (J9 / J12): does `requestLines` exactly describe a receipt that
 * `grn` already recorded AND that is fully reflected in the CURRENT PO state?
 * i.e. for every requested (line, qty): `grn` has a matching line of that qty
 * whose `previouslyReceivedQty + qty` equals the PO line's current
 * `receivedQty`, and `grn` has no other lines. True => this call is a retry of
 * an already-completed receipt and `grn` should be returned unchanged.
 */
function requestMatchesCompletedGrn(
  grn: GoodsReceiptRecord,
  order: PurchaseOrderRecord,
  requestLines: Array<{ lineIndex: number; qty: number }>,
): boolean {
  const grnItems = grn.receivedItems || [];
  if (!requestLines.length || grnItems.length !== requestLines.length) return false;
  for (const req of requestLines) {
    const gi = grnItems.find((it) => it.lineIndex === req.lineIndex);
    if (!gi || Math.abs(gi.qty - req.qty) > RECEIPT_EPSILON) return false;
    const poReceived = Number((order.items || [])[req.lineIndex]?.receivedQty) || 0;
    if (Math.abs((Number(gi.previouslyReceivedQty) || 0) + gi.qty - poReceived) > RECEIPT_EPSILON) return false;
  }
  return true;
}

function buildGrnRecord(args: {
  grnId: string;
  order: PurchaseOrderRecord;
  warehouse: Warehouse;
  input: GoodsReceiptFormValues;
  receivedBy: string;
  receivedItems: GoodsReceiptItem[];
  stockEntries: Array<{ productId: string; stockId: string; ledgerId: string; transactionId: string }>;
  stockApplied: string[];
  companyId: string;
  groupId: string;
}) {
  const { grnId, order, warehouse, input, receivedBy, receivedItems, stockEntries, stockApplied, companyId, groupId } = args;
  return {
    id: grnId, goodsReceiptId: grnId,
    companyId, ...(groupId ? { groupId } : {}),
    purchaseOrderId: order.id,
    vendorId: order.vendorId, vendorName: order.vendorName,
    projectId: order.projectId,
    projectName: order.projectName,
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    receivedDate: input.receivedDate, receivedBy,
    notes: input.notes.trim(),
    receivedItems, stockEntries,
    // INVENTORY-03: the per-line idempotency markers this GRN owns.
    stockApplied,
  };
}

interface GrnApplyContext {
  companyId: string; groupId: string; receivedBy: string;
  warehouse: { id: string; name: string }; poId: string; notes: string; nowIso: string;
}

/** Σ of the APPLIED (non-idempotent-no-op) movement quantity per PO line index. */
function appliedQtyByLine(plan: readonly MovementPlanEntry[]): Map<number, number> {
  const byLine = new Map<number, number>();
  for (const entry of plan) {
    if (!entry.applied) continue;
    const idx = Number(entry.input.lineKey);
    byLine.set(idx, (byLine.get(idx) || 0) + entry.qty);
  }
  return byLine;
}

/**
 * INVENTORY-05b: the `purchase_orders` side of a goods receipt, run as a
 * `MovementParticipant` INSIDE the movement engine's single `runTransaction`
 * (alongside every line's `stock` + `stock_ledger` write).
 *
 *  - `read` re-fetches the authoritative PO inside the transaction.
 *  - `validate` (before any write) re-checks `Σ received + applied ≤ ordered`
 *    per line against that fresh PO → INV-13. Concurrent receipts contend on
 *    the PO doc and serialize, so an over-receipt aborts the WHOLE transaction
 *    with zero partial mutation (P1-2). It also re-checks the PO is still
 *    receivable (P1-5).
 *  - `commit` INCREMENTS `items[].receivedQty` off the fresh PO (never a stale
 *    client array) and recomputes the PO status — all in the same transaction
 *    as the stock movement (P1-5). The engine's `MovementWriter` forwards this
 *    to `transaction.set`, and rejects any `stock` / `stock_ledger` write.
 */
function grnPurchaseOrderParticipant(
  ctx: GrnApplyContext,
  capture: { status: PurchaseOrderStatus },
): MovementParticipant<PurchaseOrderRecord | null> {
  return {
    async read(rc) {
      return rc.get<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, ctx.poId);
    },
    validate(po, plan) {
      if (!po) throw new Error('Purchase order not found');
      if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
        throw new Error('Goods can only be received against Sent or Partially Received purchase orders');
      }
      const byLine = appliedQtyByLine(plan);
      for (const [idx, add] of byLine) {
        const item = (po.items || [])[idx] as PurchaseOrderItem | undefined;
        const orderedQty = Number(item?.qty) || 0;
        const dbReceived = Number(item?.receivedQty) || 0;
        if (dbReceived + add > orderedQty + RECEIPT_EPSILON) {
          throw new Error(`Over-receipt rejected for ${item?.product || `line ${idx + 1}`}: ${dbReceived} already received + ${add} exceeds ordered ${orderedQty}`);
        }
      }
      // Report the resulting PO status even for a full idempotent no-op receipt.
      capture.status = applyReceiptToPoItems(po.items || [], byLine).status;
    },
    commit(po, plan, writer) {
      if (!po) return;
      const byLine = appliedQtyByLine(plan);
      const { items, status, over } = applyReceiptToPoItems(po.items || [], byLine);
      if (over) throw new Error(`Over-receipt rejected for ${over}`);
      capture.status = status;
      writer.set(COLLECTIONS.PURCHASE_ORDERS, ctx.poId, {
        items, status,
        statusHistory: [...((po.statusHistory as unknown[]) || []), { status, changedAt: ctx.nowIso, changedBy: ctx.receivedBy }],
        updatedBy: ctx.receivedBy,
      }, { merge: true });
    },
  };
}

/** Build the `PURCHASE_RECEIPT` movement input for each received line. */
function receiptMovementInputs(grnId: string, receivedItems: GoodsReceiptItem[], ctx: GrnApplyContext): StockMovementInput[] {
  return receivedItems.map((line) => ({
    movementType: 'PURCHASE_RECEIPT' as const,
    productId: line.productId,
    warehouseId: ctx.warehouse.id,
    qty: line.qty,
    unit: line.unit,
    sourceType: 'goods_receipt',
    sourceId: grnId,                    // deterministic — encodes each line's (before, qty)
    lineKey: line.lineIndex,
    companyId: ctx.companyId,
    actorId: ctx.receivedBy,
    notes: ctx.notes || `Goods receipt ${grnId} against ${ctx.poId}`,
    // legacy-consumer + reconciliation compatibility (INVENTORY-03 shape)
    ledgerExtra: {
      referenceType: 'GoodsReceipt',
      referenceId: grnId,
      purchaseOrderId: ctx.poId,
      product: line.product,
      warehouse: ctx.warehouse.name,
      grnLineIndex: line.lineIndex,
      grnPreviouslyReceivedQty: line.previouslyReceivedQty,
    },
  }));
}

/**
 * INVENTORY-05b (P1-1 / P1-2 / P1-5 / INV-13): apply ONE goods receipt through
 * the shared movement engine. `applyStockMovements` runs a SINGLE
 * `runTransaction` over every line's `stock` + `stock_ledger` write PLUS the
 * `purchase_orders` participant (receivedQty increment + status + INV-13
 * re-check). Behaviour-equivalent to the INVENTORY-03 local transaction; the
 * engine is now the single stock writer (P1-4).
 */
async function applyGrnReceipt(
  grnId: string,
  receivedItems: GoodsReceiptItem[],
  ctx: GrnApplyContext,
): Promise<{ status: PurchaseOrderStatus; stockEntries: Array<{ productId: string; stockId: string; ledgerId: string; transactionId: string }>; applied: boolean }> {
  const capture: { status: PurchaseOrderStatus } = { status: 'PartiallyReceived' };
  const batch = await applyStockMovements(
    receiptMovementInputs(grnId, receivedItems, ctx),
    grnPurchaseOrderParticipant(ctx, capture),
  );
  const stockEntries = batch.results.map((r) => ({
    productId: r.productId, stockId: r.stockId, ledgerId: r.ledgerId, transactionId: '',
  }));
  return { status: capture.status, stockEntries, applied: batch.applied };
}

/**
 * INVENTORY-03 (J12): a receipt whose atomic stock+PO transaction committed but
 * whose subsequent GRN-doc write failed leaves reliable `stock_ledger` rows
 * (`referenceType:'GoodsReceipt'`, `referenceId` = the GRN id, `purchaseOrderId`
 * set). Rebuild the missing GRN docs from those rows so the audit record is
 * never permanently lost and a retry is not blocked. Returns every GRN doc
 * (existing + rebuilt) for this PO.
 */
async function reconcileMissingGrnDocs(order: PurchaseOrderRecord, warehouse: Warehouse, receivedBy: string, groupId: string): Promise<GoodsReceiptRecord[]> {
  const { where } = await import('firebase/firestore');
  const [existingDocs, ledgerAll] = await Promise.all([
    getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, [where('purchaseOrderId', '==', order.id)]),
    getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK_LEDGER, [where('purchaseOrderId', '==', order.id)]),
  ]);
  const ledgerRows = ledgerAll.filter((row) => row.referenceType === 'GoodsReceipt');
  const known = new Set(existingDocs.map((entry) => entry.id));
  const byGrn = new Map<string, Array<WorkflowRecord & { id: string }>>();
  for (const row of ledgerRows) {
    const grnId = String(row.referenceId || '');
    if (!grnId || known.has(grnId)) continue;
    const bucket = byGrn.get(grnId) || [];
    bucket.push(row);
    byGrn.set(grnId, bucket);
  }
  const rebuilt: GoodsReceiptRecord[] = [];
  for (const [grnId, rows] of byGrn) {
    const receivedItems: GoodsReceiptItem[] = rows.map((row) => {
      // INVENTORY-05b: engine rows carry grnLineIndex / grnPreviouslyReceivedQty
      // directly (ledgerExtra); INVENTORY-03 rows encoded them in sourceId / the key.
      const idx = Number(row.grnLineIndex ?? String(row.sourceId || '').split(':line:')[1]);
      const before = Number(row.grnPreviouslyReceivedQty ?? String(row.idempotencyKey || '').split(':')[4]);
      return {
        lineIndex: Number.isFinite(idx) ? idx : 0,
        productId: String(row.productId || ''), product: String(row.product || ''),
        qty: Number(row.qty) || 0, unit: String(row.unit || ''),
        orderedQty: Number((order.items || [])[Number.isFinite(idx) ? idx : 0]?.qty) || 0,
        previouslyReceivedQty: Number.isFinite(before) ? before : 0,
      };
    }).sort((a, b) => a.lineIndex - b.lineIndex);
    if (!receivedItems.length) continue;
    const stockEntries = rows.map((row) => ({ productId: String(row.productId || ''), stockId: String(row.stockId || ''), ledgerId: row.id, transactionId: String(row.transactionId || '') }));
    const record = buildGrnRecord({
      grnId, order, warehouse,
      input: { purchaseOrderId: order.id, projectId: '', projectName: '', warehouseId: warehouse.id, receivedDate: String(rows[0]?.date || new Date().toISOString()), notes: '', quantities: {} },
      receivedBy: String(rows[0]?.createdBy || receivedBy), receivedItems, stockEntries,
      stockApplied: rows.map((row) => row.id), companyId: String(order.companyId || ''), groupId,
    }) as GoodsReceiptRecord;
    await createDocWithId(COLLECTIONS.GOODS_RECEIPTS, grnId, sanitizeFirestoreData(record)).catch(() => undefined);
    rebuilt.push(record);
  }
  return [...existingDocs, ...rebuilt];
}

export async function createGoodsReceipt(input: GoodsReceiptFormValues) {
  if (!canDo('create', 'stock') || !canDo('edit', 'purchase_orders')) throw new Error('You do not have permission to receive purchase-order stock');
  const order = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, input.purchaseOrderId);
  if (!order) throw new Error('Purchase order not found');
  if (!RECEIVABLE_PO_STATUSES.includes(order.status)) throw new Error('Goods can only be received against Sent or Partially Received purchase orders');
  const warehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, input.warehouseId);
  if (!warehouse) throw new Error('Select a valid warehouse');
  const warehouseMeta = warehouse as unknown as { isDeleted?: boolean; companyId?: string };
  if (warehouseMeta.isDeleted === true) throw new Error('Selected warehouse has been removed');
  if (!input.receivedDate) throw new Error('Received date is required');

  const companyId = String(order.companyId || resolveWorkflowCompanyId() || resolveWriteCompanyId() || '');
  const warehouseCompanyId = String(warehouseMeta.companyId || '');
  if (companyId && warehouseCompanyId && warehouseCompanyId !== companyId) {
    throw new Error('Selected warehouse belongs to a different company');
  }

  const state = useAppStore.getState();
  const receivedBy = state.user?.id || 'system';
  const groupId = resolveWriteGroupId(companyId);
  const nowIso = new Date().toISOString();
  const notes = input.notes.trim();
  const requestLines = Object.entries(input.quantities || {})
    .map(([lineIndex, value]) => ({ lineIndex: Number(lineIndex), qty: Number(value) || 0 }))
    .filter((entry) => entry.qty > 0);

  const applyCtx: GrnApplyContext = { companyId, groupId, receivedBy, warehouse: { id: warehouse.id, name: warehouse.name }, poId: order.id, notes, nowIso };

  // ---- RESUME / DEDUPE (configured branch only — needs collection queries):
  //      rebuild any GRN doc whose atomic stock+PO transaction committed but
  //      whose doc write failed (J12), then decide whether this request is a
  //      genuine retry of an already-recorded receipt.
  let priorGrns: GoodsReceiptRecord[] = [];
  if (firebaseEnv.isConfigured) {
    priorGrns = await reconcileMissingGrnDocs(order, warehouse, receivedBy, groupId);
  }

  let receipt: ReturnType<typeof calculateReceiptState>;
  try {
    receipt = calculateReceiptState(order, input.quantities);
  } catch (err) {
    // The client's PO snapshot is stale — often because a prior attempt of THIS
    // exact receipt already committed. If a recorded GRN exactly accounts for
    // this request against the CURRENT PO state, it IS that completed attempt:
    // return it (idempotent). Otherwise the error stands.
    const completed = priorGrns.find((grn) => requestMatchesCompletedGrn(grn, order, requestLines));
    if (completed) return completed;
    throw err;
  }

  const grnId = goodsReceiptDeterministicId(order.id, receipt.receivedItems);
  const alreadyRecorded = priorGrns.find((grn) => grn.id === grnId)
    || (firebaseEnv.isConfigured ? undefined : await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, grnId).catch(() => null));
  if (alreadyRecorded) return alreadyRecorded;

  for (const line of receipt.receivedItems) {
    const product = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, line.productId).catch(() => null);
    if (!product || product.isDeleted === true) throw new Error(`Product ${line.product} does not exist or has been removed`);
    if (companyId && product.companyId && product.companyId !== companyId) throw new Error(`Product ${line.product} belongs to a different company`);
  }

  // ---- ATOMIC (INV-13, P1-1/2/5): every line's stock + stock_ledger write PLUS
  //      the PO receivedQty/status increment, in ONE runTransaction, through the
  //      shared movement engine (INVENTORY-05b — engine is the single writer).
  const applied = await applyGrnReceipt(grnId, receipt.receivedItems, applyCtx);
  const stockApplied = applied.stockEntries.map((entry) => entry.ledgerId);

  // ---- GRN doc (deterministic id; overwrite-safe). Written after the atomic
  //      transaction; a failure here is recovered by reconcileMissingGrnDocs.
  const record = buildGrnRecord({
    grnId, order, warehouse, input, receivedBy,
    receivedItems: receipt.receivedItems, stockEntries: applied.stockEntries, stockApplied, companyId, groupId,
  }) as GoodsReceiptRecord;
  await createDocWithId(COLLECTIONS.GOODS_RECEIPTS, grnId, sanitizeFirestoreData(record));

  void propagateCaseIdFromChain('goods_receipts', grnId);
  await logActivity('Goods Receipts', 'Received', grnId, { purchaseOrderId: order.id, warehouseId: warehouse.id, entityName: grnId, actionLabel: `Received goods against ${order.id}` });
  notifyUsers(
    [...(await usersByRole('Procurement')), ...(await usersByRole('Warehouse'))],
    NotificationType.INVENTORY_UPDATED, 'Goods received',
    `${grnId} received against ${order.id}; purchase order is ${applied.status}.`,
    'goods_receipt', grnId, resolveWriteCompanyId() || order.companyId || '',
  );
  return record;
}
