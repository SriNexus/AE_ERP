import { COLLECTIONS, firebaseEnv } from '../../../lib/firebase';
import { createDocWithId, genId, getAll, getOne, resolveWriteCompanyId, resolveWriteGroupId, updateDocById } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { sanitizeFirestoreData } from '../../../lib/sanitizer';
import { resolveStockSummaryDocumentId } from '../../../lib/stockWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { NotificationType } from '../../../types';
import { logActivity, notifyUsers, resolveWorkflowCompanyId, stockSummaryId, usersByRole, type WorkflowRecord } from '../../../lib/workflow';
import type { Warehouse } from '../../warehouses/types';
import type { GoodsReceiptFormValues, GoodsReceiptItem, GoodsReceiptRecord, PurchaseOrderItem, PurchaseOrderRecord, PurchaseOrderStatus } from '../types';

const RECEIPT_EPSILON = 1e-6;
const RECEIVABLE_PO_STATUSES: PurchaseOrderStatus[] = ['Sent', 'PartiallyReceived'];

const encPart = (value: string) => encodeURIComponent(String(value || '').trim());

/**
 * INVENTORY-03 (P1-1): deterministic `stock_ledger` document id for ONE goods
 * receipt line. Keyed on (PO, line index, the `receivedQty` the client saw
 * before this receipt, the quantity now being received). Reconstructable from a
 * persisted GRN doc or the ledger row itself, so a receipt whose atomic
 * stock+PO transaction committed but whose GRN-doc write did not can be
 * reconciled. `stock_ledger` `allow update: if false` is the backstop.
 */
export function grnReceiptLedgerId(poId: string, lineIndex: number, receivedBefore: number, qty: number): string {
  return `STKIN-GRN-${encPart(poId)}-L${lineIndex}-B${receivedBefore}-Q${qty}`;
}

/** INVENTORY-03: the ledger idempotency key mirrored onto the row itself (INV-8). */
export function grnReceiptIdempotencyKey(poId: string, lineIndex: number, receivedBefore: number, qty: number): string {
  return `PURCHASE_RECEIPT:goods_receipt:${poId}:${lineIndex}:${receivedBefore}:${qty}`;
}

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

interface LineMeta {
  line: GoodsReceiptItem;
  ledgerId: string;
  idempotencyKey: string;
}

function lineMetaFor(poId: string, items: GoodsReceiptItem[]): LineMeta[] {
  return items.map((line) => ({
    line,
    ledgerId: grnReceiptLedgerId(poId, line.lineIndex, line.previouslyReceivedQty, line.qty),
    idempotencyKey: grnReceiptIdempotencyKey(poId, line.lineIndex, line.previouslyReceivedQty, line.qty),
  }));
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

/**
 * INVENTORY-03 (P1-1 / P1-2 / P1-5 / INV-13): apply ONE goods receipt in a
 * single runTransaction over `stock` + `stock_ledger` + `purchase_orders`.
 *
 *  - Re-reads the PO inside the transaction and INCREMENTS `items[].receivedQty`
 *    (never a stale client array). Concurrent receipts contend on the PO doc
 *    and serialize, so `Σ received` can never pass `ordered` (INV-13); an
 *    over-receipt aborts the whole transaction with zero partial mutation.
 *  - Deterministic per-line `stock_ledger` id: a retried / concurrent-duplicate
 *    line finds its row already present and is a no-op (P1-1).
 *  - `purchase_orders` rules were made lean (INVENTORY-03) so this
 *    3-collection transaction stays under the 1000-expression budget, mirroring
 *    the INVENTORY-01 dispatch transaction.
 */
async function applyGrnReceipt(
  grnId: string,
  lines: LineMeta[],
  ctx: GrnApplyContext,
): Promise<{ status: PurchaseOrderStatus; stockEntries: Array<{ productId: string; stockId: string; ledgerId: string; transactionId: string }>; applied: boolean }> {
  const { db } = await import('../../../lib/firebase');
  const { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');

  const summaryIdByLine = new Map<number, string>();
  for (const meta of lines) {
    const canonical = stockSummaryId(ctx.companyId, meta.line.productId, ctx.warehouse.id);
    const matches = await getDocs(query(
      collection(db, COLLECTIONS.STOCK),
      where('companyId', '==', ctx.companyId),
      where('productId', '==', meta.line.productId),
      where('warehouseId', '==', ctx.warehouse.id),
    ));
    const active = matches.docs.filter((entry) => (entry.data() as WorkflowRecord).isDeleted !== true);
    if (active.length > 1) throw new Error(`Duplicate stock summaries exist for ${meta.line.product}`);
    summaryIdByLine.set(meta.line.lineIndex, active[0]?.id || canonical);
  }

  const poRef = doc(db, COLLECTIONS.PURCHASE_ORDERS, ctx.poId);
  const stockEntries: Array<{ productId: string; stockId: string; ledgerId: string; transactionId: string }> = [];

  const result = await runTransaction(db, async (transaction) => {
    const poSnap = await transaction.get(poRef);
    if (!poSnap.exists()) throw new Error('Purchase order not found');
    const poData = poSnap.data() as PurchaseOrderRecord;
    if (!RECEIVABLE_PO_STATUSES.includes(poData.status)) {
      throw new Error('Goods can only be received against Sent or Partially Received purchase orders');
    }
    const perLine: Array<{ meta: LineMeta; summaryRef: ReturnType<typeof doc>; ledgerRef: ReturnType<typeof doc>; ledgerExists: boolean; summary: WorkflowRecord | null; stockId: string }> = [];
    for (const meta of lines) {
      const stockId = summaryIdByLine.get(meta.line.lineIndex) as string;
      const summaryRef = doc(db, COLLECTIONS.STOCK, stockId);
      const ledgerRef = doc(db, COLLECTIONS.STOCK_LEDGER, meta.ledgerId);
      const ledgerSnap = await transaction.get(ledgerRef);
      const summarySnap = await transaction.get(summaryRef);
      perLine.push({ meta, summaryRef, ledgerRef, ledgerExists: ledgerSnap.exists(), summary: summarySnap.exists() ? summarySnap.data() as WorkflowRecord : null, stockId });
    }

    const appliedByLine = new Map<number, number>();
    let anythingToApply = false;
    for (const entry of perLine) {
      const idx = entry.meta.line.lineIndex;
      stockEntries.push({ productId: entry.meta.line.productId, stockId: entry.stockId, ledgerId: entry.meta.ledgerId, transactionId: '' });
      if (entry.ledgerExists) { appliedByLine.set(idx, 0); continue; }
      const poItem = (poData.items || [])[idx] as PurchaseOrderItem | undefined;
      const orderedQty = Number(poItem?.qty) || 0;
      const dbReceived = Number(poItem?.receivedQty) || 0;
      if (dbReceived + entry.meta.line.qty > orderedQty + RECEIPT_EPSILON) {
        throw new Error(`Over-receipt rejected for ${entry.meta.line.product}: ${dbReceived} already received + ${entry.meta.line.qty} exceeds ordered ${orderedQty}`);
      }
      appliedByLine.set(idx, entry.meta.line.qty);
      anythingToApply = true;
    }
    if (!anythingToApply) return { status: poData.status, applied: false };

    const { items: newPoItems, status: newStatus, over } = applyReceiptToPoItems(poData.items || [], appliedByLine);
    if (over) throw new Error(`Over-receipt rejected for ${over}`);

    for (const entry of perLine) {
      const applied = appliedByLine.get(entry.meta.line.lineIndex) || 0;
      if (entry.ledgerExists || applied <= 0) continue;
      const existing = entry.summary || {};
      const summaryBase = { ...existing };
      delete (summaryBase as WorkflowRecord).available;
      delete (summaryBase as WorkflowRecord).reserved;
      const beforeQty = Number((existing as WorkflowRecord).availableQty ?? (existing as WorkflowRecord).available) || 0;
      const reservedQty = Number((existing as WorkflowRecord).reservedQty ?? (existing as WorkflowRecord).reserved) || 0;
      const afterQty = beforeQty + applied;
      const transactionId = genId.generic('TXN');
      transaction.set(entry.summaryRef, sanitizeFirestoreData({
        ...summaryBase,
        id: entry.stockId, companyId: ctx.companyId, ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
        productId: entry.meta.line.productId, warehouseId: ctx.warehouse.id,
        availableQty: afterQty, reservedQty, unit: entry.meta.line.unit,
        updatedBy: ctx.receivedBy, updatedAt: serverTimestamp(),
        createdAt: (existing as WorkflowRecord).createdAt ?? serverTimestamp(),
        isDeleted: false,
      }));
      transaction.set(entry.ledgerRef, sanitizeFirestoreData({
        id: entry.meta.ledgerId, companyId: ctx.companyId, ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
        productId: entry.meta.line.productId, product: entry.meta.line.product,
        warehouseId: ctx.warehouse.id, warehouse: ctx.warehouse.name,
        type: 'IN', qty: applied, unit: entry.meta.line.unit, beforeQty, afterQty,
        transactionId, movementAt: serverTimestamp(),
        sourceType: 'purchase', sourceId: `purchase_order:${ctx.poId}:goods_receipt:${grnId}:line:${entry.meta.line.lineIndex}`,
        referenceType: 'GoodsReceipt', referenceId: grnId, purchaseOrderId: ctx.poId, stockId: entry.stockId,
        idempotencyKey: entry.meta.idempotencyKey,
        date: ctx.nowIso, notes: ctx.notes || `Goods receipt ${grnId} against ${ctx.poId}`,
        createdBy: ctx.receivedBy, createdAt: serverTimestamp(), isDeleted: false,
      }));
    }

    transaction.set(poRef, sanitizeFirestoreData({
      items: newPoItems, status: newStatus,
      statusHistory: [...((poData.statusHistory as unknown[]) || []), { status: newStatus, changedAt: ctx.nowIso, changedBy: ctx.receivedBy }],
      updatedBy: ctx.receivedBy,
    }), { merge: true });
    return { status: newStatus, applied: true };
  });

  return { status: result.status, stockEntries, applied: result.applied };
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
      const idx = Number(String(row.sourceId || '').split(':line:')[1]);
      const before = Number(String(row.idempotencyKey || '').split(':')[4]);
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

  if (firebaseEnv.isConfigured) {
    // ---- RESUME / DEDUPE: rebuild any GRN doc whose stock+PO transaction
    //      committed but whose doc write failed (J12), then decide whether this
    //      request is a genuine retry of an already-recorded receipt.
    const priorGrns = await reconcileMissingGrnDocs(order, warehouse, receivedBy, groupId);

    let receipt: ReturnType<typeof calculateReceiptState>;
    try {
      receipt = calculateReceiptState(order, input.quantities);
    } catch (err) {
      // The client's PO snapshot is stale — often because a prior attempt of
      // THIS exact receipt already committed. If a recorded GRN exactly
      // accounts for this request against the CURRENT PO state, it IS that
      // completed attempt: return it (idempotent). Otherwise the error stands.
      const completed = priorGrns.find((grn) => requestMatchesCompletedGrn(grn, order, requestLines));
      if (completed) return completed;
      throw err;
    }

    const grnId = goodsReceiptDeterministicId(order.id, receipt.receivedItems);
    const alreadyRecorded = priorGrns.find((grn) => grn.id === grnId);
    if (alreadyRecorded) return alreadyRecorded;

    for (const line of receipt.receivedItems) {
      const product = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, line.productId).catch(() => null);
      if (!product || product.isDeleted === true) throw new Error(`Product ${line.product} does not exist or has been removed`);
      if (companyId && product.companyId && product.companyId !== companyId) throw new Error(`Product ${line.product} belongs to a different company`);
    }

    const lineMeta = lineMetaFor(order.id, receipt.receivedItems);

    // ---- ATOMIC: stock summaries + ledgers + PO increment (INV-13, P1-1/2/5).
    const applied = await applyGrnReceipt(grnId, lineMeta, applyCtx);

    // ---- GRN doc (deterministic id; overwrite-safe). Written after the atomic
    //      transaction; a failure here is recovered by reconcileMissingGrnDocs
    //      on the next call.
    const record = buildGrnRecord({ grnId, order, warehouse, input, receivedBy, receivedItems: receipt.receivedItems, stockEntries: applied.stockEntries, stockApplied: lineMeta.map((m) => m.ledgerId), companyId, groupId }) as GoodsReceiptRecord;
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

  // ---- Demo / non-configured branch: same guards, sequential + idempotent
  //      (best-effort). Order: stock (summary + ledger) per line -> PO update ->
  //      GRN doc LAST as the "fully applied" marker (resumable on retry).
  const receipt = calculateReceiptState(order, input.quantities);
  for (const line of receipt.receivedItems) {
    const product = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.PRODUCTS, line.productId).catch(() => null);
    if (!product || product.isDeleted === true) throw new Error(`Product ${line.product} does not exist or has been removed`);
    if (companyId && product.companyId && product.companyId !== companyId) throw new Error(`Product ${line.product} belongs to a different company`);
  }
  const grnId = goodsReceiptDeterministicId(order.id, receipt.receivedItems);
  const lineMeta = lineMetaFor(order.id, receipt.receivedItems);

  const existingGrn = await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, grnId).catch(() => null);
  if (existingGrn) return existingGrn;

  const freshPo = (await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, order.id).catch(() => null)) || order;
  const poItems = (freshPo.items || order.items) as PurchaseOrderItem[];
  const appliedByLine = new Map<number, number>();
  const stockEntries: Array<{ productId: string; stockId: string; ledgerId: string; transactionId: string }> = [];
  const stockApplied: string[] = [];

  for (const meta of lineMeta) {
    const idx = meta.line.lineIndex;
    stockApplied.push(meta.ledgerId);
    const existingLedger = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK_LEDGER, meta.ledgerId).catch(() => null);
    if (existingLedger) {
      appliedByLine.set(idx, 0);
      stockEntries.push({ productId: meta.line.productId, stockId: '', ledgerId: meta.ledgerId, transactionId: '' });
      continue;
    }
    const poItem = poItems[idx] || ({} as PurchaseOrderItem);
    const orderedQty = Number(poItem.qty) || 0;
    const dbReceived = Number(poItem.receivedQty) || 0;
    if (dbReceived + meta.line.qty > orderedQty + RECEIPT_EPSILON) {
      throw new Error(`Over-receipt rejected for ${meta.line.product}: ${dbReceived} already received + ${meta.line.qty} exceeds ordered ${orderedQty}`);
    }
    const matchingStock = (await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK)).filter((row) =>
      row.companyId === companyId && row.productId === meta.line.productId && row.warehouseId === warehouse.id);
    const summaryId = resolveStockSummaryDocumentId(stockSummaryId(companyId, meta.line.productId, warehouse.id), matchingStock);
    const existing = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK, summaryId).catch(() => null);
    const beforeQty = Number((existing as WorkflowRecord | null)?.availableQty ?? (existing as WorkflowRecord | null)?.available) || 0;
    const reservedQty = Number((existing as WorkflowRecord | null)?.reservedQty ?? (existing as WorkflowRecord | null)?.reserved) || 0;
    const afterQty = beforeQty + meta.line.qty;
    const transactionId = genId.generic('TXN');
    await createDocWithId(COLLECTIONS.STOCK, summaryId, sanitizeFirestoreData({
      ...(existing || {}),
      id: summaryId, companyId, ...(groupId ? { groupId } : {}),
      productId: meta.line.productId, warehouseId: warehouse.id,
      availableQty: afterQty, reservedQty, unit: meta.line.unit,
      updatedBy: receivedBy, isDeleted: false,
    }));
    await createDocWithId(COLLECTIONS.STOCK_LEDGER, meta.ledgerId, sanitizeFirestoreData({
      id: meta.ledgerId, companyId, ...(groupId ? { groupId } : {}),
      productId: meta.line.productId, product: meta.line.product,
      warehouseId: warehouse.id, warehouse: warehouse.name,
      type: 'IN', qty: meta.line.qty, unit: meta.line.unit, beforeQty, afterQty,
      transactionId, movementAt: nowIso,
      sourceType: 'purchase', sourceId: `purchase_order:${order.id}:goods_receipt:${grnId}:line:${idx}`,
      referenceType: 'GoodsReceipt', referenceId: grnId, purchaseOrderId: order.id, stockId: summaryId,
      idempotencyKey: meta.idempotencyKey,
      date: nowIso, notes: notes || `Goods receipt ${grnId} against ${order.id}`,
      createdBy: receivedBy, isDeleted: false,
    }));
    appliedByLine.set(idx, meta.line.qty);
    stockEntries.push({ productId: meta.line.productId, stockId: summaryId, ledgerId: meta.ledgerId, transactionId });
  }

  const { items: newPoItems, status: newStatus, over } = applyReceiptToPoItems(poItems, appliedByLine);
  if (over) throw new Error(`Over-receipt rejected for ${over}`);
  await updateDocById(COLLECTIONS.PURCHASE_ORDERS, order.id, sanitizeFirestoreData({
    items: newPoItems, status: newStatus,
    statusHistory: [...((freshPo.statusHistory as unknown[]) || []), { status: newStatus, changedAt: nowIso, changedBy: receivedBy }],
  }));

  const record = buildGrnRecord({ grnId, order, warehouse, input, receivedBy, receivedItems: receipt.receivedItems, stockEntries, stockApplied, companyId, groupId }) as GoodsReceiptRecord;
  await createDocWithId(COLLECTIONS.GOODS_RECEIPTS, grnId, sanitizeFirestoreData(record));

  void propagateCaseIdFromChain('goods_receipts', grnId);
  await logActivity('Goods Receipts', 'Received', grnId, { purchaseOrderId: order.id, warehouseId: warehouse.id, entityName: grnId, actionLabel: `Received goods against ${order.id}` });
  notifyUsers(
    [...(await usersByRole('Procurement')), ...(await usersByRole('Warehouse'))],
    NotificationType.INVENTORY_UPDATED, 'Goods received',
    `${grnId} received against ${order.id}; purchase order is ${newStatus}.`,
    'goods_receipt', grnId, resolveWriteCompanyId() || order.companyId || '',
  );
  return record;
}
