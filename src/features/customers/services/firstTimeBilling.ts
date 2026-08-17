/**
 * firstTimeBilling — first-time-customer detection for the B2B Center Panel's
 * "create a quotation first?" suggestion (Customer Workspace Phase 2).
 *
 * Exact rule (documented, not guessed): a customer is "first-time" for
 * billing purposes if and only if they have ZERO Quotations AND ZERO Orders.
 * A customer with a Quotation but no Order is deliberately NOT first-time —
 * they already went through the quotation step (or a prior operator
 * explicitly skipped it), so re-showing "first billing transaction" language
 * would be factually wrong.
 *
 * Both checks are existence checks (`limit(1)`), not full counts — cheaper,
 * and all we need is "zero or not zero". Both use the same `getAll()` helper
 * already proven in Phase 1's KPI queries: company-scoped and soft-delete-
 * filtered automatically (verified in Phase 0 — no isDeleted clause needed
 * here, `getAll()` already excludes soft-deleted records).
 *
 * Deleted records never count (soft-delete exclusion is automatic). A
 * customer converted from a Lead is not special-cased — only real Quotation/
 * Order documents count; Lead-side call history is never counted as billing
 * history.
 */
import { limit, where } from 'firebase/firestore';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';

export interface FirstTimeBillingResult {
  isFirstTime: boolean;
  /** True if either existence check failed — caller should fail open
   * (skip the suggestion, proceed straight to Order creation) rather than
   * block a real business action over a non-critical check's error. */
  checkFailed: boolean;
}

export async function checkFirstTimeBilling(customerId: string): Promise<FirstTimeBillingResult> {
  try {
    const [quotations, orders] = await Promise.all([
      getAll<any>(COLLECTIONS.QUOTATIONS, [where('customerId', '==', customerId), limit(1)]),
      getAll<any>(COLLECTIONS.ORDERS, [where('customerId', '==', customerId), limit(1)]),
    ]);
    return { isFirstTime: quotations.length === 0 && orders.length === 0, checkFailed: false };
  } catch (error) {
    console.warn('[firstTimeBilling] Existence check failed, failing open:', error);
    return { isFirstTime: false, checkFailed: true };
  }
}
