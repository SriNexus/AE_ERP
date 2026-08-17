import { describe, expect, it } from 'vitest';
import { calculateRelationshipHealth } from '../relationshipHealth';

const NOW = new Date('2026-06-01T00:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

describe('calculateRelationshipHealth — healthy', () => {
  it('is healthy for an old customer with recent activity, no overdue follow-up', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(2) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.level).toBe('healthy');
    expect(result.riskPoints).toBe(0);
  });

  it('is healthy for a brand-new customer (<14 days old) even with zero activity — too new to judge', () => {
    const customer = { createdAt: daysAgo(3) };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.level).toBe('healthy');
    expect(result.signals.isNewCustomer).toBe(true);
  });
});

describe('calculateRelationshipHealth — needs attention', () => {
  it('flags 30-60 days of inactivity as needs-attention (1 risk point)', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(40) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.level).toBe('attention');
    expect(result.riskPoints).toBe(1);
  });

  it('flags an old customer with completely unknown activity (no activityLog/updatedAt/createdAt fallback) as needs-attention', () => {
    const customer = {}; // no createdAt at all -> customerAgeDays null -> not new
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.level).toBe('attention');
    expect(result.signals.daysSinceLastActivity).toBeNull();
  });
});

describe('calculateRelationshipHealth — at risk', () => {
  it('flags >60 days of inactivity AND an overdue follow-up as at-risk (4 risk points)', () => {
    const customer = {
      createdAt: daysAgo(400),
      activityLog: [{ type: 'Note', date: daysAgo(90) }],
      next_date: daysAgo(5), // 5 days ago = overdue
    };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.level).toBe('risk');
    expect(result.signals.hasOverdueFollowup).toBe(true);
  });

  it('an overdue follow-up alone (2 points) plus stale activity (1 point) crosses into risk (3 points)', () => {
    const customer = {
      createdAt: daysAgo(400),
      activityLog: [{ type: 'Note', date: daysAgo(35) }],
      next_date: daysAgo(1),
    };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.riskPoints).toBe(3);
    expect(result.level).toBe('risk');
  });
});

describe('calculateRelationshipHealth — follow-up signal correctness', () => {
  it('a future next_date is "open", not overdue', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }], next_date: new Date(NOW + 5 * 86400000).toISOString() };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.signals.hasOpenFollowup).toBe(true);
    expect(result.signals.hasOverdueFollowup).toBe(false);
  });

  it('no next_date at all means neither open nor overdue', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.signals.hasOpenFollowup).toBe(false);
    expect(result.signals.hasOverdueFollowup).toBe(false);
  });
});

describe('calculateRelationshipHealth — B2B order recency', () => {
  it('penalizes a B2B customer whose most recent order is >90 days old', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [{ date: daysAgo(120) }] }, NOW);
    expect(result.signals.daysSinceLastOrder).toBe(120);
    expect(result.riskPoints).toBe(1);
    expect(result.level).toBe('attention');
  });

  it('does not penalize a B2B customer with zero orders ever — not applicable, not automatically bad', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [] }, NOW);
    expect(result.signals.daysSinceLastOrder).toBeNull();
    expect(result.riskPoints).toBe(0);
  });

  it('does not penalize a B2B customer whose most recent order is recent', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: true, orders: [{ date: daysAgo(10) }] }, NOW);
    expect(result.riskPoints).toBe(0);
  });
});

describe('calculateRelationshipHealth — B2C behavior where order recency does not apply', () => {
  it('never computes daysSinceLastOrder for a B2C customer, regardless of orders array contents', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(1) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: false, orders: [{ date: daysAgo(500) }] }, NOW);
    expect(result.signals.daysSinceLastOrder).toBeNull();
  });

  it('B2C health is driven purely by activity/follow-up signals — 60+ days inactive alone is "attention" (2 points), not yet "risk"', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(90) }] };
    const result = calculateRelationshipHealth(customer, { isB2B: false, orders: [] }, NOW);
    expect(result.riskPoints).toBe(2);
    expect(result.level).toBe('attention');
  });

  it('B2C reaches "risk" when stale activity combines with an overdue follow-up', () => {
    const customer = { createdAt: daysAgo(400), activityLog: [{ type: 'Note', date: daysAgo(90) }], next_date: daysAgo(3) };
    const result = calculateRelationshipHealth(customer, { isB2B: false, orders: [] }, NOW);
    expect(result.riskPoints).toBe(4);
    expect(result.level).toBe('risk');
  });
});
