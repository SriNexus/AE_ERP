import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, genId, getOne, updateDocById, resolveWriteCompanyId } from '../../../lib/firestore';
import { canDo } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { propagateCaseIdFromChain } from '../../../lib/casePropagation';
import { NotificationType } from '../../../types';
import { logActivity, notifyUsers, usersByRole } from '../../../lib/workflow';
import { buildProjectStageAdvancePatch, isProjectStageAtOrPast } from '../../../lib/projectLifecycle';
import type { PurchaseOrderFormValues, PurchaseOrderItem, PurchaseOrderRecord, PurchaseOrderStatus, VendorRecord } from '../types';

export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ['Sent', 'Cancelled'],
  Sent: ['PartiallyReceived', 'Received', 'Cancelled'],
  PartiallyReceived: ['Received', 'Cancelled'],
  Received: [],
  Cancelled: [],
};

const money = (value: number) => Math.round(value * 100) / 100;

export function projectProcurementPatch(project: any, purchaseOrderId: string, userId: string, now = new Date().toISOString()) {
  const linkedPurchaseOrderIds = Array.from(new Set([...(project?.linkedPurchaseOrderIds || []), purchaseOrderId]));
  if (isProjectStageAtOrPast(project?.currentStage, 'Procurement')) return { linkedPurchaseOrderIds };
  return {
    linkedPurchaseOrderIds,
    ...buildProjectStageAdvancePatch(project, 'Procurement', userId, `Purchase order ${purchaseOrderId} created`, now),
  };
}

export function calculatePurchaseOrderTotals(items: PurchaseOrderFormValues['items']) {
  if (!items.length) throw new Error('Add at least one line item');
  const normalized: PurchaseOrderItem[] = items.map((item, index) => {
    const qty = Number(item.qty); const price = Number(item.price); const tax = Number(item.tax); const discount = Number(item.discount);
    if (!item.productId || !item.product.trim()) throw new Error(`Select a product for line ${index + 1}`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantity must be greater than zero for line ${index + 1}`);
    if (!Number.isFinite(price) || price < 0) throw new Error(`Price cannot be negative for line ${index + 1}`);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error(`Tax must be between 0 and 100 for line ${index + 1}`);
    if (!Number.isFinite(discount) || discount < 0 || discount > qty * price) throw new Error(`Invalid discount for line ${index + 1}`);
    const taxableValue = money(qty * price - discount); const taxAmount = money(taxableValue * tax / 100);
    return { productId: item.productId, product: item.product.trim(), description: item.description.trim(), hsn: item.hsn.trim(), qty, unit: item.unit.trim() || 'Nos', price, tax, discount, taxableValue, taxAmount, total: money(taxableValue + taxAmount) };
  });
  return {
    items: normalized,
    subtotal: money(normalized.reduce((sum, item) => sum + item.taxableValue, 0)),
    taxTotal: money(normalized.reduce((sum, item) => sum + item.taxAmount, 0)),
    discountTotal: money(normalized.reduce((sum, item) => sum + item.discount, 0)),
    total: money(normalized.reduce((sum, item) => sum + item.total, 0)),
  };
}

function validateDates(input: PurchaseOrderFormValues) {
  if (!input.orderDate) throw new Error('Order date is required');
  if (!input.expectedDeliveryDate) throw new Error('Expected delivery date is required');
  if (input.expectedDeliveryDate < input.orderDate) throw new Error('Expected delivery date cannot be before the order date');
}

export async function createPurchaseOrder(input: PurchaseOrderFormValues) {
  if (!canDo('create', 'purchase_orders')) throw new Error('You do not have permission to create purchase orders');
  validateDates(input);
  const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, input.vendorId);
  if (!vendor) throw new Error('Select a valid vendor');
  const totals = calculatePurchaseOrderTotals(input.items);
  const state = useAppStore.getState(); const id = genId.generic('PO'); const now = new Date().toISOString();
  let projectName: string | undefined;
  let linkedProject: Record<string, any> | null = null;
  if (input.projectId) {
    linkedProject = await getOne<Record<string, any>>(COLLECTIONS.PROJECTS, input.projectId);
    projectName = linkedProject ? String(linkedProject.name || linkedProject.projectId || '') : undefined;
  }
  const record: PurchaseOrderRecord = {
    id, purchaseOrderId: id, companyId: resolveWriteCompanyId() || vendor.companyId || '',
    vendorId: vendor.id, vendorName: vendor.name, vendorGstin: vendor.gstin || '',
    projectId: input.projectId || undefined,
    projectName,
    status: 'Draft' as const,
    orderDate: input.orderDate, expectedDeliveryDate: input.expectedDeliveryDate, notes: input.notes.trim(),
    ...totals,
    statusHistory: [{ status: 'Draft' as const, changedAt: now, changedBy: state.user?.id || 'system' }],
  };
  await createDocWithId(COLLECTIONS.PURCHASE_ORDERS, id, record);
  if (input.projectId && linkedProject) {
    await updateDocById(COLLECTIONS.PROJECTS, input.projectId, projectProcurementPatch(linkedProject, id, state.user?.id || 'system', now));
  }
  // Phase 3B: Propagate caseId from project to purchase order
  void propagateCaseIdFromChain('purchase_orders', id);

  await logActivity('Purchase Orders', 'Created', id, { vendorId: vendor.id, entityName: id, actionLabel: `Created purchase order for ${vendor.name}${projectName ? ` (Project: ${projectName})` : ''}` });
  if (input.projectId) {
    await logActivity('Projects', 'Linked Purchase Order', input.projectId, { purchaseOrderId: id, entityName: projectName || input.projectId, actionLabel: `Linked purchase order ${id} to project` });
  }
  return record;
}

export async function updatePurchaseOrder(id: string, input: PurchaseOrderFormValues) {
  if (!canDo('edit', 'purchase_orders')) throw new Error('You do not have permission to edit purchase orders');
  const existing = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, id);
  if (!existing) throw new Error('Purchase order not found');
  if (existing.status !== 'Draft') throw new Error('Only Draft purchase orders can be edited');
  validateDates(input);
  const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, input.vendorId);
  if (!vendor) throw new Error('Select a valid vendor');
  let projectName: string | undefined;
  let linkedProject: Record<string, any> | null = null;
  if (input.projectId) {
    linkedProject = await getOne<Record<string, any>>(COLLECTIONS.PROJECTS, input.projectId);
    projectName = linkedProject ? String(linkedProject.name || linkedProject.projectId || '') : undefined;
  }
  const patch: Record<string, unknown> = {
    vendorId: vendor.id, vendorName: vendor.name, vendorGstin: vendor.gstin || '',
    orderDate: input.orderDate, expectedDeliveryDate: input.expectedDeliveryDate, notes: input.notes.trim(),
    ...calculatePurchaseOrderTotals(input.items),
  };
  if (input.projectId) {
    patch.projectId = input.projectId;
    patch.projectName = projectName;
  } else {
    patch.projectId = '';
    patch.projectName = '';
  }
  await updateDocById(COLLECTIONS.PURCHASE_ORDERS, id, patch);
  const oldProjectId = existing.projectId;
  if (oldProjectId !== (input.projectId || undefined)) {
    if (oldProjectId) {
      await logActivity('Projects', 'Unlinked Purchase Order', oldProjectId, { purchaseOrderId: id, entityName: id, actionLabel: `Unlinked purchase order ${id} from project` });
    }
    if (input.projectId) {
      await logActivity('Projects', 'Linked Purchase Order', input.projectId, { purchaseOrderId: id, entityName: projectName || input.projectId, actionLabel: `Linked purchase order ${id} to project` });
    }
  }
  await logActivity('Purchase Orders', 'Updated', id, { vendorId: vendor.id, entityName: id, actionLabel: 'Updated purchase order draft' });
  return { ...existing, ...patch };
}

export async function transitionPurchaseOrder(id: string, nextStatus: PurchaseOrderStatus) {
  if (!canDo('approve', 'purchase_orders')) throw new Error('You do not have permission to transition purchase orders');
  const existing = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, id);
  if (!existing) throw new Error('Purchase order not found');
  if (!PURCHASE_ORDER_TRANSITIONS[existing.status].includes(nextStatus)) throw new Error(`Cannot transition purchase order from ${existing.status} to ${nextStatus}`);
  const state = useAppStore.getState(); const changedAt = new Date().toISOString();
  await updateDocById(COLLECTIONS.PURCHASE_ORDERS, id, { status: nextStatus, statusHistory: [...(existing.statusHistory || []), { status: nextStatus, changedAt, changedBy: state.user?.id || 'system' }] });
  await logActivity('Purchase Orders', `Status: ${nextStatus}`, id, { vendorId: existing.vendorId, entityName: id, actionLabel: `Changed purchase order status to ${nextStatus}` });
  notifyUsers(await usersByRole('Warehouse'), NotificationType.TASK_STATUS_CHANGED, 'Purchase order status updated', `${id} is now ${nextStatus}.`, 'purchase_order', id, resolveWriteCompanyId() || existing.companyId || '');
  return { ...existing, status: nextStatus };
}
