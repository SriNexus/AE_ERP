/**
 * orderTypeBackfill — Phase 3 data-migration logic for historically-mistyped
 * Orders (created before this phase fixed `convertQuotationToOrder()`'s
 * hardcoded `orderType: 'B2C'`).
 *
 * Pure planning logic only — mirrors the existing `projectBackfill.ts` /
 * `scripts/backfill-projectIds.ts` pattern (compute a plan here, execute it
 * from a thin CLI script with real Firestore access). Never guesses: an Order
 * whose Customer cannot be resolved to a real `type` is reported as
 * AMBIGUOUS, never silently corrected or left silently wrong.
 */

export const ORDER_TYPE_BACKFILL_COLLECTIONS = {
  ORDERS: 'orders',
  CUSTOMERS: 'customers',
} as const;

export type OrderTypeBackfillOrderRecord = {
  id: string;
  companyId?: string;
  customerId?: string;
  orderType?: string;
  isDeleted?: boolean;
};

export type OrderTypeBackfillCustomerRecord = {
  id: string;
  type?: string;
};

export type OrderTypeBackfillInput = {
  orders: OrderTypeBackfillOrderRecord[];
  customers: OrderTypeBackfillCustomerRecord[];
};

export type OrderTypeBackfillOptions = {
  /** Restrict the plan to a single company. Omit to scan every company. */
  companyId?: string;
};

export type OrderTypeCorrection = {
  orderId: string;
  companyId: string;
  customerId: string;
  /** The order's current (wrong) value — '' if the field was entirely absent. */
  fromOrderType: string;
  /** The correct value, deterministically derived from the linked Customer.type. */
  toOrderType: 'B2B' | 'B2C';
};

export type OrderTypeAmbiguousReason = 'missing_customer_id' | 'customer_not_found' | 'customer_type_invalid';

export type OrderTypeAmbiguousRecord = {
  orderId: string;
  companyId: string;
  customerId: string;
  reason: OrderTypeAmbiguousReason;
};

export type OrderTypeBackfillSummary = {
  ordersScanned: number;
  alreadyCorrect: number;
  corrected: number;
  ambiguous: number;
  byReason: Record<OrderTypeAmbiguousReason, number>;
};

export type OrderTypeBackfillPlan = {
  corrections: OrderTypeCorrection[];
  ambiguous: OrderTypeAmbiguousRecord[];
  summary: OrderTypeBackfillSummary;
};

/**
 * Deterministically compares every Order's `orderType` against its linked
 * Customer's real `type`. Never guesses: an Order with no `customerId`, an
 * unresolvable Customer, or a Customer with no valid B2B/B2C type is placed
 * in `ambiguous`, not `corrections` — those records must be reviewed
 * manually, never silently overwritten.
 */
export function buildOrderTypeBackfillPlan(input: OrderTypeBackfillInput, options: OrderTypeBackfillOptions = {}): OrderTypeBackfillPlan {
  const companyFilter = String(options.companyId || '').trim();
  const customerById = new Map(input.customers.map((customer) => [customer.id, customer]));

  const corrections: OrderTypeCorrection[] = [];
  const ambiguous: OrderTypeAmbiguousRecord[] = [];
  const byReason: OrderTypeBackfillSummary['byReason'] = {
    missing_customer_id: 0,
    customer_not_found: 0,
    customer_type_invalid: 0,
  };
  let ordersScanned = 0;
  let alreadyCorrect = 0;

  for (const order of input.orders) {
    if (order.isDeleted) continue;
    const companyId = String(order.companyId || '').trim();
    if (companyFilter && companyFilter !== companyId) continue;
    ordersScanned += 1;

    const customerId = String(order.customerId || '').trim();
    if (!customerId) {
      ambiguous.push({ orderId: order.id, companyId, customerId: '', reason: 'missing_customer_id' });
      byReason.missing_customer_id += 1;
      continue;
    }

    const customer = customerById.get(customerId);
    if (!customer) {
      ambiguous.push({ orderId: order.id, companyId, customerId, reason: 'customer_not_found' });
      byReason.customer_not_found += 1;
      continue;
    }

    const correctType = customer.type === 'B2B' || customer.type === 'B2C' ? customer.type : null;
    if (!correctType) {
      ambiguous.push({ orderId: order.id, companyId, customerId, reason: 'customer_type_invalid' });
      byReason.customer_type_invalid += 1;
      continue;
    }

    if (order.orderType === correctType) {
      alreadyCorrect += 1;
      continue;
    }

    corrections.push({
      orderId: order.id,
      companyId,
      customerId,
      fromOrderType: order.orderType || '',
      toOrderType: correctType,
    });
  }

  return {
    corrections,
    ambiguous,
    summary: {
      ordersScanned,
      alreadyCorrect,
      corrected: corrections.length,
      ambiguous: ambiguous.length,
      byReason,
    },
  };
}

export function formatOrderTypeBackfillSummary(summary: OrderTypeBackfillSummary): string {
  return [
    `Orders scanned: ${summary.ordersScanned}`,
    `Already correct: ${summary.alreadyCorrect}`,
    `Corrections needed: ${summary.corrected}`,
    `Ambiguous (cannot safely migrate, left untouched): ${summary.ambiguous}`,
    `  - missing customerId: ${summary.byReason.missing_customer_id}`,
    `  - customer not found: ${summary.byReason.customer_not_found}`,
    `  - customer has no valid B2B/B2C type: ${summary.byReason.customer_type_invalid}`,
  ].join('\n');
}
