/**
 * orderTypeBackfill.test.ts — Phase 3 migration-logic tests.
 *
 * Pure-function coverage for the historical-data reconciliation plan: every
 * Order's orderType compared against its linked Customer's real type.
 * Confirms the three-way split (already correct / needs correction /
 * ambiguous-never-guessed) the brief's Section 8 requires.
 */
import { describe, it, expect } from 'vitest';
import { buildOrderTypeBackfillPlan, formatOrderTypeBackfillSummary } from '../orderTypeBackfill';

describe('buildOrderTypeBackfillPlan', () => {
  const customers = [
    { id: 'CUST-B2B', type: 'B2B' },
    { id: 'CUST-B2C', type: 'B2C' },
    { id: 'CUST-BAD-TYPE', type: 'Commercial' }, // garbage value — never a valid classification
  ];

  it('identifies an Order whose orderType disagrees with its linked Customer.type as needing correction', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-1', companyId: 'C1', customerId: 'CUST-B2B', orderType: 'B2C' }],
      customers,
    });
    expect(plan.corrections).toEqual([
      { orderId: 'ORD-1', companyId: 'C1', customerId: 'CUST-B2B', fromOrderType: 'B2C', toOrderType: 'B2B' },
    ]);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.summary).toMatchObject({ ordersScanned: 1, alreadyCorrect: 0, corrected: 1, ambiguous: 0 });
  });

  it('leaves an already-correct Order untouched', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-2', companyId: 'C1', customerId: 'CUST-B2C', orderType: 'B2C' }],
      customers,
    });
    expect(plan.corrections).toEqual([]);
    expect(plan.summary.alreadyCorrect).toBe(1);
  });

  it('never guesses: an Order with no customerId is reported ambiguous, not corrected', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-3', companyId: 'C1', orderType: 'B2C' }],
      customers,
    });
    expect(plan.corrections).toEqual([]);
    expect(plan.ambiguous).toEqual([{ orderId: 'ORD-3', companyId: 'C1', customerId: '', reason: 'missing_customer_id' }]);
  });

  it('never guesses: an Order whose Customer cannot be resolved is reported ambiguous, not corrected', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-4', companyId: 'C1', customerId: 'CUST-GHOST', orderType: 'B2C' }],
      customers,
    });
    expect(plan.ambiguous).toEqual([{ orderId: 'ORD-4', companyId: 'C1', customerId: 'CUST-GHOST', reason: 'customer_not_found' }]);
  });

  it('never guesses: an Order whose Customer has no valid B2B/B2C type is reported ambiguous, not corrected', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-5', companyId: 'C1', customerId: 'CUST-BAD-TYPE', orderType: 'B2C' }],
      customers,
    });
    expect(plan.ambiguous).toEqual([{ orderId: 'ORD-5', companyId: 'C1', customerId: 'CUST-BAD-TYPE', reason: 'customer_type_invalid' }]);
  });

  it('skips soft-deleted orders entirely (neither corrected nor counted as ambiguous)', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [{ id: 'ORD-6', companyId: 'C1', customerId: 'CUST-B2B', orderType: 'B2C', isDeleted: true }],
      customers,
    });
    expect(plan.summary.ordersScanned).toBe(0);
    expect(plan.corrections).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
  });

  it('filters by companyId when provided', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [
        { id: 'ORD-7', companyId: 'C1', customerId: 'CUST-B2B', orderType: 'B2C' },
        { id: 'ORD-8', companyId: 'C2', customerId: 'CUST-B2B', orderType: 'B2C' },
      ],
      customers,
    }, { companyId: 'C1' });
    expect(plan.corrections.map((c) => c.orderId)).toEqual(['ORD-7']);
    expect(plan.summary.ordersScanned).toBe(1);
  });

  it('formatOrderTypeBackfillSummary produces a readable, complete report', () => {
    const plan = buildOrderTypeBackfillPlan({
      orders: [
        { id: 'ORD-1', companyId: 'C1', customerId: 'CUST-B2B', orderType: 'B2C' },
        { id: 'ORD-3', companyId: 'C1', orderType: 'B2C' },
      ],
      customers,
    });
    const text = formatOrderTypeBackfillSummary(plan.summary);
    expect(text).toContain('Orders scanned: 2');
    expect(text).toContain('Corrections needed: 1');
    expect(text).toContain('Ambiguous (cannot safely migrate, left untouched): 1');
  });
});
