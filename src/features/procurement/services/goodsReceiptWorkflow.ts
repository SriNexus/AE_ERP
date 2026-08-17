import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, genId, getOne, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { stockIn } from '../../../lib/stockWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { NotificationType } from '../../../types';
import { logActivity, notifyUsers, usersByRole } from '../../../lib/workflow';
import type { Warehouse } from '../../warehouses/types';
import type { GoodsReceiptFormValues, GoodsReceiptItem, GoodsReceiptRecord, PurchaseOrderRecord, PurchaseOrderStatus } from '../types';

export function calculateReceiptState(order: PurchaseOrderRecord, quantities: Record<number, string>) {
  const receivedItems: GoodsReceiptItem[] = [];
  const items = order.items.map((item, lineIndex) => {
    const previous = Number(item.receivedQty) || 0;
    const receiptQty = Number(quantities[lineIndex] || 0);
    const remainingBefore = Math.max(0, item.qty - previous);
    if (!Number.isFinite(receiptQty) || receiptQty < 0) throw new Error(`Invalid receipt quantity for ${item.product}`);
    if (receiptQty > remainingBefore) throw new Error(`Receipt quantity exceeds remaining quantity for ${item.product}`);
    if (receiptQty > 0) receivedItems.push({ lineIndex, productId: item.productId, product: item.product, qty: receiptQty, unit: item.unit, orderedQty: item.qty, previouslyReceivedQty: previous });
    const receivedQty = previous + receiptQty;
    return { ...item, receivedQty, remainingQty: Math.max(0, item.qty - receivedQty) };
  });
  if (!receivedItems.length) throw new Error('Enter a received quantity for at least one item');
  const status: PurchaseOrderStatus = items.every((item) => item.remainingQty === 0) ? 'Received' : 'PartiallyReceived';
  return { items, receivedItems, status };
}

export async function createGoodsReceipt(input: GoodsReceiptFormValues) {
  if (!canDo('create', 'stock') || !canDo('edit', 'purchase_orders')) throw new Error('You do not have permission to receive purchase-order stock');
  const order = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, input.purchaseOrderId);
  if (!order) throw new Error('Purchase order not found');
  if (!['Sent', 'PartiallyReceived'].includes(order.status)) throw new Error('Goods can only be received against Sent or Partially Received purchase orders');
  const warehouse = await getOne<Warehouse>(COLLECTIONS.WAREHOUSES, input.warehouseId);
  if (!warehouse) throw new Error('Select a valid warehouse');
  if (!input.receivedDate) throw new Error('Received date is required');
  const receipt = calculateReceiptState(order, input.quantities);
  const state = useAppStore.getState(); const id = genId.generic('GRN'); const receivedBy = state.user?.id || 'system';
  const stockEntries = [];
  for (const item of receipt.receivedItems) {
    const movement = await stockIn({ productId: item.productId, warehouseId: warehouse.id, qty: item.qty, unit: item.unit, sourceType: 'purchase', sourceId: `purchase_order:${order.id}:goods_receipt:${id}:line:${item.lineIndex}`, notes: input.notes.trim() || `Goods receipt ${id} against ${order.id}` });
    stockEntries.push({ productId: item.productId, stockId: movement.stockId, ledgerId: movement.ledgerId, transactionId: movement.transactionId });
  }
  const record = {
    id, goodsReceiptId: id,
    purchaseOrderId: order.id,
    vendorId: order.vendorId, vendorName: order.vendorName,
    projectId: order.projectId,
    projectName: order.projectName,
    warehouseId: warehouse.id, warehouseName: warehouse.name,
    receivedDate: input.receivedDate, receivedBy,
    notes: input.notes.trim(),
    receivedItems: receipt.receivedItems, stockEntries,
  };
  await createDocWithId(COLLECTIONS.GOODS_RECEIPTS, id, record);
  const changedAt = new Date().toISOString();
  await updateDocById(COLLECTIONS.PURCHASE_ORDERS, order.id, { items: receipt.items, status: receipt.status, statusHistory: [...(order.statusHistory || []), { status: receipt.status, changedAt, changedBy: receivedBy }] });
  // Phase 3B: Propagate caseId from purchase order to goods receipt
  void propagateCaseIdFromChain('goods_receipts', id);

  await logActivity('Goods Receipts', 'Received', id, { purchaseOrderId: order.id, warehouseId: warehouse.id, entityName: id, actionLabel: `Received goods against ${order.id}` });
  notifyUsers([...(await usersByRole('Procurement')), ...(await usersByRole('Warehouse'))], NotificationType.INVENTORY_UPDATED, 'Goods received', `${id} received against ${order.id}; purchase order is ${receipt.status}.`, 'goods_receipt', id, resolveWriteCompanyId() || order.companyId || '');
  return record as GoodsReceiptRecord;
}
