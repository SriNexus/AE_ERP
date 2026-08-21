import { createDocWithId, updateDocById, genId, getAll, getOne, resolveWriteGroupId } from './firestore';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import {
  logActivity,
  notifyUsers,
  resolveWorkflowCompanyId,
  stockSummaryId,
  usersByRole,
  type WorkflowRecord,
} from './workflow';

export function resolveStockSummaryDocumentId(
  canonicalId: string,
  matches: Array<{ id?: string; isDeleted?: boolean }>,
) {
  const active = matches.filter((row) => row.isDeleted !== true && String(row.id || '').trim());
  if (active.length > 1) throw new Error('Duplicate stock summaries exist for the same company, product, and warehouse');
  return active[0]?.id || canonicalId;
}
export async function stockIn(payload: {
  productId: string;
  warehouseId: string;
  qty: number;
  unit: string;
  sourceType: 'purchase' | 'return' | 'adjustment';
  sourceId?: string;
  notes?: string;
}) {
  const state = useAppStore.getState();
  const companyId = resolveWorkflowCompanyId();
  const createdBy = state.user?.id || 'system';
  const qty = Number(payload.qty);
  if (!payload.productId) throw new Error('Product is required');
  if (!payload.warehouseId) throw new Error('Warehouse is required');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');
  let stockId = stockSummaryId(companyId, payload.productId, payload.warehouseId);
  const ledgerId = genId.generic('STK');
  const transactionId = genId.generic('TXN');
  let beforeQty = 0;
  let afterQty = 0;
  let reservedQty = 0;

  if (!firebaseEnv.isConfigured) {
    const matchingStock = (await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK)).filter((row) =>
      row.companyId === companyId && row.productId === payload.productId && row.warehouseId === payload.warehouseId
    );
    stockId = resolveStockSummaryDocumentId(stockId, matchingStock);
    const existing = await getOne<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK, stockId);
    beforeQty = Number(existing?.availableQty ?? existing?.available) || 0;
    reservedQty = Number(existing?.reservedQty ?? existing?.reserved) || 0;
    afterQty = beforeQty + qty;
    await createDocWithId(COLLECTIONS.STOCK, stockId, sanitizeFirestoreData({
      ...(existing || {}),
      id: stockId,
      companyId,
      productId: payload.productId,
      warehouseId: payload.warehouseId,
      availableQty: afterQty,
      reservedQty,
      unit: payload.unit,
      updatedBy: createdBy,
      isDeleted: false,
    }));
    await createDocWithId(COLLECTIONS.STOCK_LEDGER, ledgerId, sanitizeFirestoreData({
      id: ledgerId,
      companyId,
      productId: payload.productId,
      warehouseId: payload.warehouseId,
      type: 'IN',
      qty,
      unit: payload.unit,
      beforeQty,
      afterQty,
      transactionId,
      movementAt: new Date().toISOString(),
      sourceType: payload.sourceType,
      sourceId: payload.sourceId || '',
      notes: payload.notes || '',
      createdBy,
      isDeleted: false,
    }));
    return { stockId, ledgerId, transactionId, beforeQty, afterQty };
  }

  const { db } = await import('./firebase');
  const { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } = await import('firebase/firestore');
  // Group Admin "cannot add stock" root cause: this write goes through a raw
  // Firestore transaction, bypassing createDocWithId()/updateDocById()'s
  // automatic groupId stamping (Master Plan §3.4). Without a `groupId` field,
  // firestore.rules' groupAdminCanCreate()/groupAdminCanUpdate() (both
  // require hasGroupId(data)) can never match, so a Group Admin's otherwise
  // rules-supported stock write (warehouseActorCanCreate/Update() already OR
  // in groupAdminCanCreate/Update()) was denied at the rules layer even
  // though the UI showed "Add Stock" as available. Stamping it here — the
  // same value every other write path already derives — closes that gap.
  const groupId = resolveWriteGroupId(companyId);
  const matchingStock = await getDocs(query(
    collection(db, COLLECTIONS.STOCK),
    where('companyId', '==', companyId),
    where('productId', '==', payload.productId),
    where('warehouseId', '==', payload.warehouseId),
  ));
  stockId = resolveStockSummaryDocumentId(stockId, matchingStock.docs.map((entry) => ({ id: entry.id, ...entry.data() })));

  await runTransaction(db, async (transaction) => {
    const stockRef = doc(db, COLLECTIONS.STOCK, stockId);
    const ledgerRef = doc(db, COLLECTIONS.STOCK_LEDGER, ledgerId);
    const stockSnap = await transaction.get(stockRef);
    const existing = stockSnap.exists() ? stockSnap.data() : {};
    const summaryBase = { ...existing };
    delete summaryBase.available;
    delete summaryBase.reserved;
    beforeQty = Number(existing.availableQty ?? existing.available) || 0;
    reservedQty = Number(existing.reservedQty ?? existing.reserved) || 0;
    if (beforeQty < 0 || reservedQty < 0) {
      throw new Error('Stock summary is inconsistent');
    }
    afterQty = beforeQty + qty;
    if (afterQty < 0) {
      throw new Error('Stock cannot be negative');
    }

    transaction.set(stockRef, sanitizeFirestoreData({
      ...summaryBase,
      id: stockId,
      companyId,
      ...(groupId ? { groupId } : {}),
      productId: payload.productId,
      warehouseId: payload.warehouseId,
      availableQty: afterQty,
      reservedQty,
      unit: payload.unit,
      updatedBy: createdBy,
      updatedAt: serverTimestamp(),
      createdAt: stockSnap.exists() ? existing.createdAt : serverTimestamp(),
      isDeleted: false,
    }));

    transaction.set(ledgerRef, sanitizeFirestoreData({
      id: ledgerId,
      companyId,
      ...(groupId ? { groupId } : {}),
      productId: payload.productId,
      warehouseId: payload.warehouseId,
      type: 'IN',
      qty,
      unit: payload.unit,
      beforeQty,
      afterQty,
      transactionId,
      movementAt: serverTimestamp(),
      sourceType: payload.sourceType,
      sourceId: payload.sourceId || '',
      notes: payload.notes || '',
      createdBy,
      createdAt: serverTimestamp(),
      isDeleted: false,
    }));
  });

  await logActivity('Stock', 'Stock In', ledgerId, {
    productId: payload.productId,
    warehouseId: payload.warehouseId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    entityName: payload.productId,
    actionLabel: 'Added stock',
  });
  notifyUsers(
    await usersByRole('Warehouse'),
    NotificationType.INVENTORY_UPDATED,
    'Inventory updated',
    `Stock increased by ${qty} ${payload.unit} for ${payload.productId}.`,
    'stock',
    ledgerId,
    companyId
  );

  return { stockId, ledgerId, transactionId, beforeQty, afterQty };
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
  const existingReturnLedgers = (await getAll<WorkflowRecord & { id: string }>(COLLECTIONS.STOCK_LEDGER))
    .filter((ledger) => ledger.type === 'IN' && ledger.sourceType === 'return' && String(ledger.sourceId || '').startsWith(`CANCEL:${orderId}:`));
  const restoredSourceIds = new Set(existingReturnLedgers.map((ledger) => String(ledger.sourceId || '')));
  const restoredItems: Array<{ dispatchId: string; productId: string; qty: number; unit: string }> = [];

  for (const dispatch of dispatches) {
    const status = String(dispatch.status || '');
    const shouldRestore = ['Dispatched', 'Delivered', 'Closed', 'Returned'].includes(status);
    if (!shouldRestore) continue;
    for (const item of dispatch.items || []) {
      const qty = dispatchedQty(item);
      const productId = String(item.productId || '');
      const warehouseId = String(dispatch.warehouseId || '');
      if (!productId || !warehouseId || qty <= 0) continue;
      const sourceId = `CANCEL:${orderId}:${dispatch.id}:${productId}`;
      if (restoredSourceIds.has(sourceId)) continue;
      await stockIn({
        productId,
        warehouseId,
        qty,
        unit: String(item.unit || 'PCS'),
        sourceType: 'return',
        sourceId,
        notes: reason || `Stock restored for cancelled order ${orderId}`,
      });
      restoredSourceIds.add(sourceId);
      restoredItems.push({ dispatchId: dispatch.id, productId, qty, unit: String(item.unit || 'PCS') });
    }
  }

  await Promise.all(dispatches.map((dispatch) => updateDocById(COLLECTIONS.DISPATCH, dispatch.id, sanitizeFirestoreData({
    status: 'Returned',
    cancellationOrderId: orderId,
    cancellationReason: reason || '',
    returnedAt: new Date().toISOString(),
    updatedBy: state.user?.id || 'system',
  }))));

  const paidAmount = Number(order.paidAmount ?? order.amountPaid) || 0;
  const cancelledItems = (order.items || []).map((item) => ({
    ...item,
    dispatchedQty: 0,
    pendingQty: 0,
  }));
  await updateDocById(COLLECTIONS.ORDERS, orderId, sanitizeFirestoreData({
    status: 'Cancelled',
    cancellationReason: reason || '',
    cancelledAt: new Date().toISOString(),
    cancelledBy: state.user?.id || 'system',
    cancellationStockRestored: restoredItems.length > 0,
    refundRequired: paidAmount > 0,
    paymentReconciliationPending: paidAmount > 0,
    items: cancelledItems,
    updatedBy: state.user?.id || 'system',
  }));

  await logActivity('Orders', 'Cancelled Order', orderId, {
    entityName: order.customer || order.customerName || orderId,
    actionLabel: 'Cancelled order',
    reason,
    restoredItems,
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

  return { orderId, restoredItems, refundRequired: paidAmount > 0 };
}
