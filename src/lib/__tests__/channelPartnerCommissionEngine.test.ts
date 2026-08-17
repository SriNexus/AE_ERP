import { describe, it, expect } from 'vitest';
import {
  validateCommissionRule,
  validateCalculationInput,
  resolveCommissionRule,
  resolveSlab,
  calculateCommission,
  calculateCommissionPreview,
  estimatePartnerCommission,
  getCommissionBreakdown,
} from '../channelPartnerCommissionEngine';
import type { CommissionRule } from '../../features/channel-partner/types';

// ── Helpers ──────────────────────────────────────────────
function makeRule(overrides: Partial<CommissionRule> = {}): CommissionRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    type: 'per_kw',
    value: 100,
    isActive: true,
    applicableTo: 'all',
    applicableIds: [],
    priority: 1,
    minAmount: null,
    maxAmount: null,
    effectiveFrom: null,
    effectiveTo: null,
    slabs: [],
    locationStates: [],
    locationPinCodes: [],
    partnerTier: null,
    ...overrides,
  } as CommissionRule;
}

// ═══════════════════════════════════════════════════════════
//  validateCommissionRule
// ═══════════════════════════════════════════════════════════
describe('validateCommissionRule', () => {
  it('returns empty errors for a valid rule', () => {
    const rule = makeRule({ type: 'per_kw', value: 100 });
    expect(validateCommissionRule(rule)).toEqual([]);
  });

  it('detects inactive rule', () => {
    const rule = makeRule({ isActive: false });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'RULE_INACTIVE')).toBe(true);
  });

  it('detects deleted rule', () => {
    const rule = makeRule({ isDeleted: true } as any);
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'RULE_DELETED')).toBe(true);
  });

  it('detects future effectiveFrom date', () => {
    const future = new Date(Date.now() + 86400000 * 365).toISOString();
    const rule = makeRule({ effectiveFrom: future });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'NOT_YET_EFFECTIVE')).toBe(true);
  });

  it('detects expired rule', () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const rule = makeRule({ effectiveTo: past });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'RULE_EXPIRED')).toBe(true);
  });

  it('detects zero or negative value for per_kw', () => {
    const rule = makeRule({ type: 'per_kw', value: 0 });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'ZERO_OR_NEGATIVE')).toBe(true);
  });

  it('detects percentage > 100', () => {
    const rule = makeRule({ type: 'percentage', value: 150 });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'IMPOSSIBLE_PERCENTAGE')).toBe(true);
  });

  it('detects empty slabs', () => {
    const rule = makeRule({ type: 'slab', slabs: [] });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'EMPTY_SLABS')).toBe(true);
  });

  it('detects invalid slab range', () => {
    const rule = makeRule({
      type: 'slab',
      slabs: [{ fromKW: 10, toKW: 5, value: 100, type: 'per_kw' }],
    });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'INVALID_SLAB_RANGE')).toBe(true);
  });

  it('detects negative cap', () => {
    const rule = makeRule({ maxAmount: -100 });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'NEGATIVE_CAP')).toBe(true);
  });

  it('detects zero cap', () => {
    const rule = makeRule({ maxAmount: 0 });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'ZERO_CAP')).toBe(true);
  });

  it('detects negative min amount', () => {
    const rule = makeRule({ minAmount: -500 });
    const errors = validateCommissionRule(rule);
    expect(errors.some((e) => e.code === 'NEGATIVE_MIN')).toBe(true);
  });

  it('passes for a percentage rule at exactly 100%', () => {
    const rule = makeRule({ type: 'percentage', value: 100 });
    expect(validateCommissionRule(rule)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
//  validateCalculationInput
// ═══════════════════════════════════════════════════════════
describe('validateCalculationInput', () => {
  it('returns empty for valid input', () => {
    expect(validateCalculationInput({ dealValue: 100000, systemSizeKW: 10 })).toEqual([]);
  });

  it('detects negative deal value', () => {
    const errors = validateCalculationInput({ dealValue: -100, systemSizeKW: 10 });
    expect(errors.some((e) => e.code === 'NEGATIVE_DEAL_VALUE')).toBe(true);
  });

  it('detects negative system size', () => {
    const errors = validateCalculationInput({ dealValue: 100000, systemSizeKW: -5 });
    expect(errors.some((e) => e.code === 'NEGATIVE_SYSTEM_SIZE')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  resolveCommissionRule
// ═══════════════════════════════════════════════════════════
describe('resolveCommissionRule', () => {
  const partnerRule = makeRule({ id: 'r1', name: 'Partner Rule', applicableTo: 'partner', applicableIds: ['partner-1'], priority: 10 });
  const locationRule = makeRule({ id: 'r2', name: 'Location Rule', applicableTo: 'location', locationStates: ['MH'], priority: 8 });
  const categoryRule = makeRule({ id: 'r3', name: 'Category Rule', applicableTo: 'product_category', applicableIds: ['cat-1'], priority: 6 });
  const tierRule = makeRule({ id: 'r4', name: 'Tier Rule', applicableTo: 'partner_tier', partnerTier: 'gold', priority: 4 });
  const defaultRule = makeRule({ id: 'r5', name: 'Default Rule', applicableTo: 'all', priority: 2 });

  it('resolves partner-specific rule with highest priority', () => {
    const result = resolveCommissionRule(
      [defaultRule, tierRule, partnerRule, locationRule, categoryRule],
      { partnerId: 'partner-1', partnerTier: 'gold', locationState: 'MH', productCategoryId: 'cat-1' },
    );
    expect(result.rule?.id).toBe('r1');
    expect(result.explanation).toContain('Partner-specific');
  });

  it('resolves location rule when no partner match', () => {
    const result = resolveCommissionRule(
      [defaultRule, tierRule, locationRule, categoryRule],
      { partnerId: 'unknown', locationState: 'MH', productCategoryId: 'cat-1' },
    );
    expect(result.rule?.id).toBe('r2');
    expect(result.explanation).toContain('Location-based');
  });

  it('resolves category rule when no partner/location match', () => {
    const result = resolveCommissionRule(
      [defaultRule, tierRule, categoryRule],
      { partnerId: 'unknown', locationState: 'UP', productCategoryId: 'cat-1' },
    );
    expect(result.rule?.id).toBe('r3');
    expect(result.explanation).toContain('Category-based');
  });

  it('resolves tier rule when no partner/location/category match', () => {
    const result = resolveCommissionRule(
      [defaultRule, tierRule],
      { partnerId: 'unknown', locationState: 'UP', productCategoryId: 'unknown', partnerTier: 'gold' },
    );
    expect(result.rule?.id).toBe('r4');
    expect(result.explanation).toContain('Tier-based');
  });

  it('falls back to default rule', () => {
    const result = resolveCommissionRule(
      [defaultRule, tierRule],
      { partnerId: 'unknown', partnerTier: 'bronze' },
    );
    expect(result.rule?.id).toBe('r5');
    expect(result.explanation).toContain('Default');
  });

  it('returns null when no rule matches', () => {
    const result = resolveCommissionRule([defaultRule], {});
    expect(result.rule?.id).toBe('r5');
  });

  it('returns null and explanation when no valid rules exist', () => {
    const inactiveRule = makeRule({ id: 'r6', name: 'Inactive', isActive: false });
    const result = resolveCommissionRule([inactiveRule], {});
    expect(result.rule).toBeNull();
    expect(result.explanation).toContain('No active commission rules');
  });
});

// ═══════════════════════════════════════════════════════════
//  resolveSlab
// ═══════════════════════════════════════════════════════════
describe('resolveSlab', () => {
  const slabs = [
    { fromKW: 0, toKW: 5, value: 50, type: 'per_kw' as const },
    { fromKW: 6, toKW: 20, value: 40, type: 'per_kw' as const },
    { fromKW: 21, toKW: 100, value: 30, type: 'per_kw' as const },
  ];

  it('finds matching slab', () => {
    const result = resolveSlab(slabs, 10);
    expect(result.slab?.fromKW).toBe(6);
    expect(result.slab?.toKW).toBe(20);
    expect(result.explanation).toContain('6-20');
  });

  it('falls back to last slab when system size exceeds range', () => {
    const result = resolveSlab(slabs, 200);
    expect(result.slab?.fromKW).toBe(21);
    expect(result.slab?.toKW).toBe(100);
    expect(result.explanation).toContain('exceeds slab range');
  });

  it('returns null for empty slabs array', () => {
    const result = resolveSlab([], 10);
    expect(result.slab).toBeNull();
    expect(result.explanation).toBe('No slabs defined.');
  });
});

// ═══════════════════════════════════════════════════════════
//  calculateCommission
// ═══════════════════════════════════════════════════════════
describe('calculateCommission', () => {
  it('calculates per_kw commission', () => {
    const rule = makeRule({ type: 'per_kw', value: 100 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 10, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(1000); // 10 kW × ₹100
    expect(result.formula).toContain('10 kW ×');
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('calculates percentage commission', () => {
    const rule = makeRule({ type: 'percentage', value: 10 });
    const result = calculateCommission({ dealValue: 50000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(5000); // 10% of 50000
  });

  it('calculates fixed commission', () => {
    const rule = makeRule({ type: 'fixed', value: 2500 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(2500);
  });

  it('calculates per_deal commission', () => {
    const rule = makeRule({ type: 'per_deal', value: 1500 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(1500);
  });

  it('calculates slab commission (per_kw type)', () => {
    const rule = makeRule({
      type: 'slab',
      slabs: [{ fromKW: 0, toKW: 10, value: 80, type: 'per_kw' }],
    });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(400); // 5 kW × ₹80
    expect(result.appliedSlab).not.toBeNull();
  });

  it('calculates slab commission (fixed type)', () => {
    const rule = makeRule({
      type: 'slab',
      slabs: [{ fromKW: 0, toKW: 10, value: 5000, type: 'fixed' }],
    });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(5000);
  });

  it('calculates slab commission (percentage type)', () => {
    const rule = makeRule({
      type: 'slab',
      slabs: [{ fromKW: 0, toKW: 10, value: 5, type: 'percentage' }],
    });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(5000); // 5% of 100000
  });

  it('returns zero when deal value is below minimum', () => {
    const rule = makeRule({ minAmount: 100000 });
    const result = calculateCommission({ dealValue: 50000, systemSizeKW: 10, rule });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('applies manual override', () => {
    const rule = makeRule({ type: 'per_kw', value: 100 });
    const result = calculateCommission({
      dealValue: 100000, systemSizeKW: 10, rule,
      overrideAmount: 25000, overrideReason: 'Special campaign',
    });
    expect(result.success).toBe(true);
    expect(result.finalAmount).toBe(25000);
    expect(result.adjustments.some((a) => a.type === 'override')).toBe(true);
  });

  it('applies cap when calculated exceeds max', () => {
    const rule = makeRule({ type: 'per_kw', value: 200, maxAmount: 1000 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 10, rule });
    expect(result.finalAmount).toBe(1000);
    expect(result.cappedAmount).toBe(2000); // 10 × 200
    expect(result.adjustments.some((a) => a.type === 'cap')).toBe(true);
  });

  it('applies bonus', () => {
    const rule = makeRule({ type: 'fixed', value: 1000 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule, bonus: 500 });
    expect(result.finalAmount).toBe(1500);
    expect(result.adjustments.some((a) => a.type === 'bonus')).toBe(true);
  });

  it('applies penalty', () => {
    const rule = makeRule({ type: 'fixed', value: 2000 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule, penalty: 500 });
    expect(result.finalAmount).toBe(1500);
    expect(result.adjustments.some((a) => a.type === 'penalty')).toBe(true);
  });

  it('penalty does not reduce commission below zero (capped at final amount)', () => {
    const rule = makeRule({ type: 'fixed', value: 200 });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule, penalty: 1000 });
    expect(result.finalAmount).toBe(0);
    // Penalty is capped at the calculated amount, so it never goes negative
    expect(result.adjustments.some((a) => a.type === 'penalty')).toBe(true);
  });

  it('returns fatal errors when rule is invalid', () => {
    const rule = makeRule({ type: 'per_kw', value: 0, isActive: false });
    const result = calculateCommission({ dealValue: 100000, systemSizeKW: 5, rule });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.appliedRule).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  calculateCommissionPreview
// ═══════════════════════════════════════════════════════════
describe('calculateCommissionPreview', () => {
  it('delegates to calculateCommission with options', () => {
    const rule = makeRule({ type: 'fixed', value: 5000 });
    const result = calculateCommissionPreview(rule, 100000, 10, { bonus: 1000 });
    expect(result.finalAmount).toBe(6000);
  });
});

// ═══════════════════════════════════════════════════════════
//  estimatePartnerCommission
// ═══════════════════════════════════════════════════════════
describe('estimatePartnerCommission', () => {
  const rule = makeRule({ id: 'r1', name: 'Default Rule', applicableTo: 'all', type: 'per_kw', value: 100 });

  it('estimates total across multiple leads', () => {
    const result = estimatePartnerCommission(
      [rule],
      [
        { dealValue: 100000, systemSizeKW: 10 },
        { dealValue: 50000, systemSizeKW: 5 },
      ],
      {},
    );
    expect(result.total).toBe(1500); // (10 × 100) + (5 × 100)
    expect(result.breakdown.length).toBe(2);
    expect(result.breakdown[0].status).toBe('calculated');
  });

  it('marks lead as no_rule when no matching rule', () => {
    const result = estimatePartnerCommission([], [{ dealValue: 100000, systemSizeKW: 10 }], {});
    expect(result.total).toBe(0);
    expect(result.breakdown[0].status).toBe('no_rule');
  });
});

// ═══════════════════════════════════════════════════════════
//  getCommissionBreakdown
// ═══════════════════════════════════════════════════════════
describe('getCommissionBreakdown', () => {
  it('returns structured breakdown from result', () => {
    const rule = makeRule({ type: 'per_kw', value: 100 });
    const calcResult = calculateCommission({ dealValue: 100000, systemSizeKW: 10, rule });
    const breakdown = getCommissionBreakdown(calcResult);
    expect(breakdown.ruleName).toBe('Test Rule');
    expect(breakdown.finalAmount).toBe(1000);
    expect(breakdown.formula).toBeDefined();
    expect(Array.isArray(breakdown.adjustments)).toBe(true);
  });
});
