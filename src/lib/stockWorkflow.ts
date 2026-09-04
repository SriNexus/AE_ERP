import { updateDocById, genId, getAll, getOne } from './firestore';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { applyStockMovement, applyStockMovements, resolveStockSummaryDocumentId } from './inventory/stockMovementEngine';
import { isReservationsEnabled } from './inventory/reservationConfig';
import { buildCancelReleaseInputs, fetchOrderReservations, reservationUpdateParticipant } from './inventory/reservations';
import type { MovementType } from './inventory/types';
import {
  logActivity,
  notifyUsers,
  resolveWorkflowCompanyId,
  usersByRole,
  type WorkflowRecord,
} from './workflow';

export { resolveStockSummaryDocumentId };

/** Legacy `stockIn` sourceType → movement engine movement type (all IN). */
const STOCK_IN_MOVEMENT: Record<'purchase' | 'return' | 'adjustment', MovementType> = {
  purchase: 'PURCHASE_RECEIPT',
  return: 'SALES_RETURN_IN',
  adjustment: 'ADJUSTMENT_IN',
};

/**
 * INVENTORY-05d: `stockIn` is now a thin wrapper over the movement engine — the
 * single stock writer (P1-4). It carries no transaction of its own.
 *
 * `stockIn` has NEVER been idempotent (INVENTORY-00 baseline) — a fresh
 * idempotency key is minted on every call unless the caller passes an explicit
 * `sourceId` to key on. Callers that need engine idempotency (order cancel)
 * call `applyStockMovement` directly with a deterministic key.
 */
export async function stockIn(payload: {
  productId: string;
  warehouseId: string;
  qty: number;
  unit: string;
  sourceType: 'purchase' | 'return' | 'adjustment';
  sourceId?: string;
  notes?: string;
}) {
  const qty = Number(payload.qty);
  if (!payload.productId) throw new Error('Product is required');
  if (!payload.warehouseId) throw new Error('Warehouse is required');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');

  const movementType = STOCK_IN_MOVEMENT[payload.sourceType] || 'ADJUSTMENT_IN';
  const sourceId = String(payload.sourceId || '').trim();
  const idempotencyKey = `${movementType}:${payload.sourceType}:${sourceId || genId.generic('STK')}`;

  const result = await applyStockMovement({
    movementType,
    productId: payload.productId,
    warehouseId: payload.warehouseId,
    qty,
    unit: payload.unit,
    sourceType: payload.sourceType,
    sourceId: sourceId || idempotencyKey,
    idempotencyKey,
    notes: payload.notes,
    ...(movementType === 'ADJUSTMENT_IN'
      ? { reasonCode: String(payload.notes || '').trim() || `Manual stock ${payload.sourceType}` }
      : {}),
  });

  const companyId = resolveWorkflowCompanyId();
  await logActivity('Stock', 'Stock In', result.ledgerId, {
    productId: payload.productId, warehouseId: payload.warehouseId,
    sourceType: payload.sourceType, sourceId: payload.sourceId,
    entityName: payload.productId, actionLabel: 'Added stock',
  });
  notifyUsers(
    await usersByRole('Warehouse'),
    NotificationType.INVENTORY_UPDATED,
    'Inventory updated',
    `Stock increased by ${qty} ${payload.unit} for ${payload.productId}.`,
    'stock', result.ledgerId, companyId,
  );

  return {
    stockId: result.stockId, ledgerId: result.ledgerId, transactionId: '',
    beforeQty: result.onHandBefore, afterQty: result.onHandAfter,
  };
}

function dispatchedQty(item: WorkflowRecord) {
  return Number(item.verifiedQty ?? item.dispatchedQty ?? item.qty) || 0;
}

export async function cancelOrder(orderId: string, reason = '') {
  const state = useAppStore.getState();
  const order = await getOne<WorkflowRecord & { id: string; items?: WorkflowRecord[] }>(COLLECTIONS.ORDERS, orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (String(order.status || '').toLowerCase() === 'cancelled') {
    throw new Error('Order is already cancelled');
  }

  const companyId = String(order.companyId || resolveWorkflowCompanyId());
  const dispatches = (await getAll<WorkflowRecord & { id: string; items?: WorkflowRecord[] }>(COLLECTIONS.DISPATCH))
    .filter((dispatch) => dispatch.orderId === orderId && dispatch.isDeleted !== true);
  const restoredItems: Array<{ dispatchId: string; productId: string; qty: number; unit: string }> = [];

  // INVENTORY-05d: dispatched stock is restored through the movement engine —
  // one SALES_RETURN_IN movement per (dispatch, product), keyed
  // `SALES_RETURN_IN:order_cancel:{orderId}:{dispatchId}:{productId}`. The
  // engine's in-transaction idempotency check makes a re-run a no-op (replacing
  // the old manual "scan existing CANCEL: ledgers" guard). `result.applied`
  // tells us whether this call actually restored stock.
  for (const dispatch of dispatches) {
    const status = String(dispatch.status || '');
    const shouldRestore = ['Dispatched', 'Delivered', 'Closed', 'Returned'].includes(status);
    if (!shouldRestore) continue;
    for (const item of dispatch.items || []) {
      const qty = dispatchedQty(item);
      const productId = String(item.productId || '');
      const warehouseId = String(dispatch.warehouseId || '');
      if (!productId || !warehouseId || qty <= 0) continue;
      const result = await applyStockMovement({
        movementType: 'SALES_RETURN_IN',
        productId,
        warehouseId,
        qty,
        unit: String(item.unit || 'PCS'),
        sourceType: 'order_cancel',
        sourceId: `${orderId}:${dispatch.id}:${productId}`,
        companyId,
        notes: reason || `Stock restored for cancelled order ${orderId}`,
        ledgerExtra: { referenceType: 'OrderCancel', referenceId: orderId, dispatchId: dispatch.id },
      });
      if (result.applied) {
        restoredItems.push({ dispatchId: dispatch.id, productId, qty, unit: String(item.unit || 'PCS') });
      }
    }
  }

  const now = new Date().toISOString();
  const actorId = state.user?.id || 'system';

  // INVENTORY-07 (Plan §07 H): release the UNCONSUMED remainder of every active
  // reservation on this order via SALES_RELEASE. Physical stock already
  // dispatched is restored by the SALES_RETURN_IN loop above — this only
  // un-earmarks what was never shipped (no double count). Idempotent + stale-safe
  // (`clampToStock`); a no-reservation (pre-07) order releases nothing.
  const releasedReservations: Array<{ productId: string; qty: number }> = [];
  if (isReservationsEnabled()) {
    try {
      const reservations = await fetchOrderReservations(orderId);
      const releaseInputs = buildCancelReleaseInputs({ companyId, actorId, orderId, reservations, reason });
      if (releaseInputs.length) {
        const relBatch = await applyStockMovements(
          releaseInputs,
          reservationUpdateParticipant({ reservations, mode: 'release', matchSourceType: 'order_cancel', actorId, nowIso: now }),
        );
        for (const r of relBatch.results) {
          if (r.applied) releasedReservations.push({ productId: r.productId, qty: r.qty });
        }
      }
    } catch (err) {
      console.error(`[cancelOrder] reservation release failed for order ${orderId}:`, err);
    }
  }

  const paidAmount = Number(order.paidAmount ?? order.amountPaid) || 0;
  const cancelledItems = (order.items || []).map((item) => ({
    ...item,
    dispatchedQty: 0,
    pendingQty: 0,
  }));

  // INVENTORY-04 (P2-2): the invoices this cancellation affects — information
  // only. NO financial reversal, NO invoice-amount change, NO GST change here.
  const generatedPIs = Array.isArray(order.generatedPIs) ? order.generatedPIs.map(String) : [];
  const [allPIs, allTaxInvoices] = await Promise.all([
    getAll<WorkflowRecord & { id: string }>(COLLECTIONS.PROFORMA_INVOICES).catch(() => []),
    getAll<WorkflowRecord & { id: string }>(COLLECTIONS.TAX_INVOICES).catch(() => []),
  ]);
  const piIds = Array.from(new Set([
    ...generatedPIs,
    ...allPIs.filter((pi) => pi.orderId === orderId || pi.sourceOrderId === orderId || generatedPIs.includes(pi.id)).map((pi) => pi.id),
  ]));
  const taxInvoiceIds = allTaxInvoices.filter((ti) => ti.orderId === orderId || ti.sourceOrderId === orderId).map((ti) => ti.id);
  const reversalInvoiceIds = Array.from(new Set([...piIds, ...taxInvoiceIds]));
  const piReversalRequired = reversalInvoiceIds.length > 0;

  const dispatchStatusPatch = {
    status: 'Returned',
    cancellationOrderId: orderId,
    cancellationReason: reason || '',
    returnedAt: now,
    updatedBy: actorId,
  };
  const orderStatusPatch = {
    status: 'Cancelled',
    cancellationReason: reason || '',
    cancelledAt: now,
    cancelledBy: actorId,
    cancellationStockRestored: restoredItems.length > 0,
    refundRequired: paidAmount > 0,
    paymentReconciliationPending: paidAmount > 0,
    // INVENTORY-04 additive flags — later flow handles the actual reversal.
    piReversalRequired,
    reversalInvoiceIds,
    items: cancelledItems,
    updatedBy: actorId,
  };

  // INVENTORY-04 (P2-2): order status + every affected dispatch status flip in
  // ONE transaction that re-reads each document — no half-applied state. (The
  // stock restore above stays as sequential stockIn calls; it migrates to the
  // movement engine in Plan Phase 05d, not here.)
  if (firebaseEnv.isConfigured) {
    const { db } = await import('./firebase');
    const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
    const orderRef = doc(db, COLLECTIONS.ORDERS, orderId);
    const dispatchRefs = dispatches.map((dispatch) => ({ id: dispatch.id, ref: doc(db, COLLECTIONS.DISPATCH, dispatch.id) }));
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error(`Order ${orderId} not found`);
      if (String((orderSnap.data() as WorkflowRecord).status || '').toLowerCase() === 'cancelled') {
        throw new Error('Order is already cancelled');
      }
      const dispatchSnaps = await Promise.all(dispatchRefs.map(async (entry) => ({ ...entry, snap: await transaction.get(entry.ref) })));
      transaction.set(orderRef, sanitizeFirestoreData({ ...orderStatusPatch, updatedAt: serverTimestamp() }), { merge: true });
      for (const entry of dispatchSnaps) {
        if (!entry.snap.exists()) continue;
        transaction.set(entry.ref, sanitizeFirestoreData({ ...dispatchStatusPatch, updatedAt: serverTimestamp() }), { merge: true });
      }
    });
  } else {
    // Demo / non-configured branch: sequential, best-effort.
    await Promise.all(dispatches.map((dispatch) => updateDocById(COLLECTIONS.DISPATCH, dispatch.id, sanitizeFirestoreData(dispatchStatusPatch))));
    await updateDocById(COLLECTIONS.ORDERS, orderId, sanitizeFirestoreData(orderStatusPatch));
  }

  await logActivity('Orders', 'Cancelled Order', orderId, {
    entityName: order.customer || order.customerName || orderId,
    actionLabel: 'Cancelled order',
    reason,
    restoredItems,
    ...(releasedReservations.length ? { releasedReservations } : {}),
  });
  notifyUsers(
    [
      ...(await usersByRole('Accounts')),
      ...(await usersByRole('Warehouse')),
      ...(await usersByRole('Operations')),
      ...(order.createdBy ? [{ id: String(order.createdBy) }] : []),
    ],
    NotificationType.ORDER_UPDATED,
    'Order cancelled',
    `Order ${orderId} was cancelled${restoredItems.length ? ' and dispatched stock was restored.' : '.'}`,
    'order',
    orderId,
    companyId
  );

  return { orderId, restoredItems, releasedReservations, refundRequired: paidAmount > 0 };
}
