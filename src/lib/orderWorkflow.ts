import { createDocWithId, genId } from './firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from './documentNumbering';
import { COLLECTIONS } from './firebase';
import { NotificationType } from '../types';
import { notifyRoleUsers } from './notifications';

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
