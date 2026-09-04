import { createDocWithId, genId, getOne, updateDocById } from './firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from './documentNumbering';
import { COLLECTIONS } from './firebase';
import { NotificationType } from '../types';
import { notifyRoleUsers } from './notifications';

/**
 * INVENTORY-04 (P1-8 / INV-12): an order whose status has reached a
 * dispatch/terminal state, or any of whose lines has been dispatched.
 * Derived from `src/config/company.ts` ORDER_STATUSES + the values
 * `dispatchWorkflow` writes onto the order ('Dispatched' / 'Partial Dispatch');
 * 'Closed' is kept defensively (a dispatch-close flow that also flips the order).
 */
export const LOCKED_ORDER_STATUSES = ['Partial Dispatch', 'Dispatched', 'Closed', 'Cancelled'] as const;

/**
 * INVENTORY-04 (INV-12): the shared, workflow-authoritative order line-lock
 * predicate. `true` once `Σ order.items[].dispatchedQty > 0` OR the order status
 * is one of LOCKED_ORDER_STATUSES. Reusable by the workflow and the UI.
 */
export function isOrderLineLocked(order: any): boolean {
  if (!order) return false;
  const dispatchedTotal = (Array.isArray(order.items) ? order.items : [])
    .reduce((sum: number, item: any) => sum + (Number(item?.dispatchedQty) || 0), 0);
  if (dispatchedTotal > 0) return true;
  return (LOCKED_ORDER_STATUSES as readonly string[]).includes(String(order.status || ''));
}

/** The per-line fields whose change makes an edit an order-LINE edit. */
const ORDER_LINE_SIGNATURE_FIELDS = ['productId', 'product', 'qty', 'price', 'tax', 'discount', 'unit'];

function orderLineSignature(items: unknown): string {
  return (Array.isArray(items) ? items : [])
    .map((item: any) => ORDER_LINE_SIGNATURE_FIELDS.map((field) => `${field}=${item?.[field] ?? ''}`).join('|'))
    .join(';;');
}

/**
 * INVENTORY-04 (P1-8): the authoritative order-update path. Enforces the line
 * lock at the workflow layer so NO UI (desktop or mobile) can bypass it. A
 * locked order still accepts non-line edits (notes, customer contact, status,
 * assignment, …); only a change to the `items` line content — product, qty,
 * price, adding/removing a line — is rejected.
 */
export async function updateOrder(id: string, patch: Record<string, any>) {
  const existing = await getOne<any>(COLLECTIONS.ORDERS, id);
  if (!existing) throw new Error(`Order ${id} not found`);
  if (Object.prototype.hasOwnProperty.call(patch, 'items') && isOrderLineLocked(existing)) {
    if (orderLineSignature(patch.items) !== orderLineSignature(existing.items)) {
      throw new Error('This order has already been dispatched — its line items (product / quantity / price) can no longer be changed. Non-line fields such as notes and contact details can still be edited.');
    }
  }
  await updateDocById(COLLECTIONS.ORDERS, id, patch);
  return { ...existing, ...patch, id };
}

export interface CreateOrderInput {
  /** Raw form values. */
  form: any;
  items: any[];
  subtotal: number;
  taxTotal: number;
  discount: number;
  grandTotal: number;
  companyId: string;
  orderPrefix?: string;
  createdBy: string;
  /** Notification scoping — the active company, distinct from `companyId` (the
   * company record used for numbering/prefix), matching the source page's own
   * separate use of the two. */
  activeCompanyId: string;
}

/** Creates a new Order document. Extracted verbatim from the create branch of
 * `Orders.tsx`'s own `save` mutation (PRE-EXISTING BEHAVIOR, unchanged) so a
 * second caller (Customer Workspace) can create an order without duplicating
 * this logic. Editing an existing order is intentionally NOT covered here —
 * `Orders.tsx` keeps that branch inline, since only creation is embedded
 * elsewhere. `caseId` propagation (`propagateCaseIdFromChain`) stays the
 * caller's responsibility, exactly as it already is in `Orders.tsx`'s
 * mutation `onSuccess`, not part of this function. */
export async function createOrder(input: CreateOrderInput) {
  const payload = {
    ...input.form, items: input.items, subtotal: input.subtotal, taxTotal: input.taxTotal,
    discount: input.discount, total: input.grandTotal, createdBy: input.createdBy,
  };
  const documentDefaults = await resolveDocumentDefaults(input.companyId);
  const id = genId.order(input.orderPrefix);
  const { documentNumber } = await getNextDocumentNumber(input.companyId, 'order');
  const createdOrder = {
    ...payload, id, orderNumber: documentNumber, orderNo: documentNumber,
    notes: payload.notes || documentDefaults.settings.defaultNotes,
  };
  await createDocWithId(COLLECTIONS.ORDERS, id, createdOrder);
  await notifyRoleUsers(
    ['Accounts', 'Operations', 'Director'], NotificationType.ORDER_PLACED, 'Order placed',
    `Order ${documentNumber} was created for ${input.form.customer || 'customer'}.`,
    'order', id, input.activeCompanyId,
  );
  return createdOrder;
}
