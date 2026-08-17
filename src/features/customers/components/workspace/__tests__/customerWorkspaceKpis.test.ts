import { describe, expect, it } from 'vitest';
import { buildCustomerKpiValues, mostRecentByDate, sumField, ACTIVE_ORDER_STATUSES_EXCLUDED } from '../CustomerWorkspaceKpis';

describe('sumField', () => {
  it('sums a numeric field across rows, coercing non-numeric to 0', () => {
    expect(sumField([{ total: 100 }, { total: 250 }, { total: 'not a number' }, {}], 'total')).toBe(350);
  });
  it('returns 0 for an empty array', () => {
    expect(sumField([], 'total')).toBe(0);
  });
});

describe('mostRecentByDate', () => {
  it('returns the row with the latest date', () => {
    const rows = [
      { id: 'a', date: '2026-01-01' },
      { id: 'b', date: '2026-03-01' },
      { id: 'c', date: '2026-02-01' },
    ];
    expect(mostRecentByDate(rows, 'date')?.id).toBe('b');
  });
  it('returns null for an empty array', () => {
    expect(mostRecentByDate([], 'date')).toBeNull();
  });
  it('treats a missing date field as the epoch, not a crash', () => {
    const rows = [{ id: 'no-date' }, { id: 'has-date', date: '2026-01-01' }];
    expect(mostRecentByDate(rows, 'date')?.id).toBe('has-date');
  });
});

describe('ACTIVE_ORDER_STATUSES_EXCLUDED', () => {
  it('excludes exactly Delivered and Cancelled — every other ORDER_STATUSES value counts as active', () => {
    // Mirrors config/company.ts's ORDER_STATUSES exactly, so this test breaks
    // loudly if that vocabulary ever changes without this KPI being revisited.
    const ORDER_STATUSES = ['Pending', 'Processing', 'Confirmed', 'Dispatched', 'Partial Dispatch', 'Delivered', 'Cancelled'];
    const active = ORDER_STATUSES.filter((s) => !ACTIVE_ORDER_STATUSES_EXCLUDED.has(s));
    expect(active).toEqual(['Pending', 'Processing', 'Confirmed', 'Dispatched', 'Partial Dispatch']);
  });
});

describe('buildCustomerKpiValues — B2B', () => {
  const baseInput = {
    isB2B: true,
    orders: [] as any[], ordersLoading: false,
    quotations: [] as any[], quotationsLoading: false,
    registrations: [] as any[], registrationsLoading: false,
    projects: [] as any[], projectsLoading: false,
    relationshipAgeDays: 42,
  };

  it('returns exactly 6 KPI cells, all B2B-specific keys', () => {
    const kpis = buildCustomerKpiValues(baseInput);
    expect(kpis).toHaveLength(6);
    expect(kpis.map((k) => k.key)).toEqual([
      'order-count', 'active-orders', 'order-value', 'last-order', 'last-quotation', 'relationship-age',
    ]);
  });

  it('computes order count, active orders, total value, and last order date from real order data', () => {
    const kpis = buildCustomerKpiValues({
      ...baseInput,
      orders: [
        { total: 1000, status: 'Delivered', date: '2026-01-01' },
        { total: 500, status: 'Pending', date: '2026-03-15' },
        { total: 250, status: 'Cancelled', date: '2026-02-01' },
      ],
    });
    expect(kpis.find((k) => k.key === 'order-count')?.value).toBe('3');
    expect(kpis.find((k) => k.key === 'active-orders')?.value).toBe('1'); // only the Pending one
    expect(kpis.find((k) => k.key === 'order-value')?.value).toContain('1,750');
    expect(kpis.find((k) => k.key === 'last-order')?.value).not.toBe('—');
  });

  it('shows an em-dash for a customer with zero orders/quotations (empty state, not an error)', () => {
    const kpis = buildCustomerKpiValues(baseInput);
    expect(kpis.find((k) => k.key === 'order-count')?.value).toBe('0');
    expect(kpis.find((k) => k.key === 'last-order')?.value).toBe('—');
    expect(kpis.find((k) => k.key === 'last-quotation')?.value).toBe('—');
  });

  it('shows a loading ellipsis while the underlying query is in flight, not a stale/zero value', () => {
    const kpis = buildCustomerKpiValues({ ...baseInput, ordersLoading: true, quotationsLoading: true });
    expect(kpis.find((k) => k.key === 'order-count')?.value).toBe('…');
    expect(kpis.find((k) => k.key === 'last-quotation')?.value).toBe('…');
  });

  it('shows an em-dash for relationship age when the customer has no createdAt', () => {
    const kpis = buildCustomerKpiValues({ ...baseInput, relationshipAgeDays: null });
    expect(kpis.find((k) => k.key === 'relationship-age')?.value).toBe('—');
  });
});

describe('buildCustomerKpiValues — B2C', () => {
  const baseInput = {
    isB2B: false,
    orders: [] as any[], ordersLoading: false,
    quotations: [] as any[], quotationsLoading: false,
    registrations: [] as any[], registrationsLoading: false,
    projects: [] as any[], projectsLoading: false,
    relationshipAgeDays: 10,
  };

  it('returns exactly 6 KPI cells, all B2C-specific keys — a genuinely different set from B2B, not a relabeled copy', () => {
    const kpis = buildCustomerKpiValues(baseInput);
    expect(kpis).toHaveLength(6);
    expect(kpis.map((k) => k.key)).toEqual([
      'current-stage', 'loan-application-status', 'project-size', 'project-count', 'loan-application-count', 'relationship-age',
    ]);
  });

  it('reads current stage and project size from the most recently updated project', () => {
    const kpis = buildCustomerKpiValues({
      ...baseInput,
      projects: [
        { currentStage: 'Survey', capacityKw: 3, updatedAt: '2026-01-01' },
        { currentStage: 'Installation', capacityKw: 5, updatedAt: '2026-03-01' },
      ],
    });
    expect(kpis.find((k) => k.key === 'current-stage')?.value).toBe('Installation');
    expect(kpis.find((k) => k.key === 'project-size')?.value).toBe('5 kW');
    expect(kpis.find((k) => k.key === 'project-count')?.value).toBe('2');
  });

  it('shows "No Project Yet" / "Not Started" for a customer with no projects/loan applications, not an em-dash or error', () => {
    const kpis = buildCustomerKpiValues(baseInput);
    expect(kpis.find((k) => k.key === 'current-stage')?.value).toBe('No Project Yet');
    expect(kpis.find((k) => k.key === 'loan-application-status')?.value).toBe('Not Started');
  });

  it('reads loan application status from the most recently updated loan application', () => {
    const kpis = buildCustomerKpiValues({
      ...baseInput,
      registrations: [
        { status: 'Draft', updatedAt: '2026-01-01' },
        { status: 'Approved', updatedAt: '2026-02-01' },
      ],
    });
    expect(kpis.find((k) => k.key === 'loan-application-status')?.value).toBe('Approved');
  });
});
