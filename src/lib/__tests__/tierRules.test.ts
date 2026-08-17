import { describe, it, expect } from 'vitest';
import {
  checkCondition,
  evaluateRule,
  tierIndex,
  findApplicableRules,
  evaluatePartnerTier,
  nextTier,
  prevTier,
  TIER_ORDER,
  TIER_LABELS,
  TIER_COLORS,
  TIER_PROGRESS_COLORS,
  DEFAULT_TIER_RULES,
} from '../tierRules';
import type { TierRule, TierEvaluationInput } from '../../features/channel-partner/types';

// ═══════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════
describe('Tier Constants', () => {
  it('TIER_ORDER has correct order', () => {
    expect(TIER_ORDER).toEqual(['bronze', 'silver', 'gold', 'platinum']);
  });

  it('TIER_LABELS has labels for all tiers', () => {
    TIER_ORDER.forEach((tier) => {
      expect(TIER_LABELS[tier]).toBeDefined();
      expect(typeof TIER_LABELS[tier]).toBe('string');
    });
  });

  it('TIER_COLORS has colors for all tiers', () => {
    TIER_ORDER.forEach((tier) => {
      expect(TIER_COLORS[tier]).toBeDefined();
    });
  });

  it('TIER_PROGRESS_COLORS has colors for all tiers', () => {
    TIER_ORDER.forEach((tier) => {
      expect(TIER_PROGRESS_COLORS[tier]).toBeDefined();
    });
  });

  it('DEFAULT_TIER_RULES has 5 rules', () => {
    expect(DEFAULT_TIER_RULES.length).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════
//  checkCondition
// ═══════════════════════════════════════════════════════════
describe('checkCondition', () => {
  const metrics: TierEvaluationInput['metrics'] = {
    totalRevenue: 1000000,
    totalCommissionEarned: 50000,
    totalLeadsCreated: 20,
    totalLeadsConverted: 10,
    conversionRate: 25,
    performanceScore: 85,
    activeMonths: 8,
    successfulSettlements: 3,
  };

  it('evaluates >= operator correctly', () => {
    const cond = { field: 'totalRevenue' as const, operator: '>=' as const, value: 500000, label: 'Revenue ≥ ₹5L' };
    expect(checkCondition(cond, metrics)).toBe(true);
    expect(checkCondition({ ...cond, value: 2000000 }, metrics)).toBe(false);
  });

  it('evaluates <= operator correctly', () => {
    const cond = { field: 'totalRevenue' as const, operator: '<=' as const, value: 2000000, label: '' };
    expect(checkCondition(cond, metrics)).toBe(true);
    expect(checkCondition({ ...cond, value: 500000 }, metrics)).toBe(false);
  });

  it('evaluates > operator correctly', () => {
    const cond = { field: 'conversionRate' as const, operator: '>' as const, value: 20, label: '' };
    expect(checkCondition(cond, metrics)).toBe(true);
    expect(checkCondition({ ...cond, value: 30 }, metrics)).toBe(false);
  });

  it('evaluates < operator correctly', () => {
    const cond = { field: 'totalRevenue' as const, operator: '<' as const, value: 2000000, label: '' };
    expect(checkCondition(cond, metrics)).toBe(true);
    expect(checkCondition({ ...cond, value: 500000 }, metrics)).toBe(false);
  });

  it('evaluates == operator correctly', () => {
    const cond = { field: 'conversionRate' as const, operator: '==' as const, value: 25, label: '' };
    expect(checkCondition(cond, metrics)).toBe(true);
    expect(checkCondition({ ...cond, value: 30 }, metrics)).toBe(false);
  });

  it('returns false for unknown operator', () => {
    const cond = { field: 'totalRevenue' as const, operator: '!=' as any, value: 500000, label: '' };
    expect(checkCondition(cond, metrics)).toBe(false);
  });

  it('handles missing metric field as 0', () => {
    const cond = { field: 'successfulSettlements' as const, operator: '>=' as const, value: 5, label: '' };
    const emptyMetrics = {
      totalRevenue: 0, totalCommissionEarned: 0, totalLeadsCreated: 0,
      totalLeadsConverted: 0, conversionRate: 0, performanceScore: 0,
      activeMonths: 0, successfulSettlements: 0,
    };
    expect(checkCondition(cond, emptyMetrics)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  evaluateRule
// ═══════════════════════════════════════════════════════════
describe('evaluateRule', () => {
  const rule: TierRule = {
    fromTier: 'bronze', toTier: 'silver', direction: 'upgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '>=', value: 500000, label: 'Revenue ≥ ₹5L' },
      { field: 'totalLeadsCreated', operator: '>=', value: 10, label: 'Leads ≥ 10' },
      { field: 'activeMonths', operator: '>=', value: 3, label: 'Active Months ≥ 3' },
    ],
  };

  it('returns passed when all conditions met', () => {
    const input: TierEvaluationInput = {
      partnerId: 'p1',
      currentTier: 'bronze',
      metrics: { totalRevenue: 1000000, totalCommissionEarned: 50000, totalLeadsCreated: 20, totalLeadsConverted: 10, conversionRate: 25, performanceScore: 80, activeMonths: 6, successfulSettlements: 2 },
    };
    const result = evaluateRule(rule, input);
    expect(result.passed).toBe(true);
    expect(result.passedConditions.length).toBe(3);
    expect(result.failedConditions.length).toBe(0);
  });

  it('returns failed when some conditions not met', () => {
    const input: TierEvaluationInput = {
      partnerId: 'p1',
      currentTier: 'bronze',
      metrics: { totalRevenue: 100000, totalCommissionEarned: 5000, totalLeadsCreated: 5, totalLeadsConverted: 1, conversionRate: 10, performanceScore: 40, activeMonths: 1, successfulSettlements: 0 },
    };
    const result = evaluateRule(rule, input);
    expect(result.passed).toBe(false);
    expect(result.failedConditions.length).toBeGreaterThan(0);
    expect(result.failedConditions[0].required).toBeDefined();
    expect(result.failedConditions[0].actual).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
//  tierIndex
// ═══════════════════════════════════════════════════════════
describe('tierIndex', () => {
  it('returns 0 for bronze', () => expect(tierIndex('bronze')).toBe(0));
  it('returns 1 for silver', () => expect(tierIndex('silver')).toBe(1));
  it('returns 2 for gold', () => expect(tierIndex('gold')).toBe(2));
  it('returns 3 for platinum', () => expect(tierIndex('platinum')).toBe(3));
  it('returns -1 for unknown tier', () => expect(tierIndex('diamond' as any)).toBe(-1));
});

// ═══════════════════════════════════════════════════════════
//  findApplicableRules
// ═══════════════════════════════════════════════════════════
describe('findApplicableRules', () => {
  it('finds upgrade rules for bronze', () => {
    const rules = findApplicableRules('bronze', 'upgrade');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.fromTier === 'bronze' && r.direction === 'upgrade')).toBe(true);
  });

  it('finds downgrade rules for gold', () => {
    const rules = findApplicableRules('gold', 'downgrade');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.fromTier === 'gold' && r.direction === 'downgrade')).toBe(true);
  });

  it('returns empty array when no matching direction for platinum upgrade', () => {
    const rules = findApplicableRules('platinum', 'upgrade');
    expect(rules).toEqual([]);
  });

  it('finds downgrade rule for platinum', () => {
    const rules = findApplicableRules('platinum', 'downgrade');
    expect(rules.length).toBe(1);
    expect(rules[0].toTier).toBe('gold');
  });
});

// ═══════════════════════════════════════════════════════════
//  evaluatePartnerTier
// ═══════════════════════════════════════════════════════════
describe('evaluatePartnerTier', () => {
  const strongInput: TierEvaluationInput = {
    partnerId: 'p1',
    currentTier: 'bronze',
    metrics: { totalRevenue: 1000000, totalCommissionEarned: 100000, totalLeadsCreated: 20, totalLeadsConverted: 10, conversionRate: 30, performanceScore: 90, activeMonths: 6, successfulSettlements: 3 },
  };

  const weakInput: TierEvaluationInput = {
    partnerId: 'p2',
    currentTier: 'gold',
    metrics: { totalRevenue: 500000, totalCommissionEarned: 10000, totalLeadsCreated: 5, totalLeadsConverted: 1, conversionRate: 10, performanceScore: 30, activeMonths: 3, successfulSettlements: 0 },
  };

  it('recommends upgrade when all conditions met', () => {
    const result = evaluatePartnerTier(strongInput);
    expect(result.direction).toBe('upgrade');
    expect(result.recommendedTier).toBe('silver');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('recommends downgrade when downgrade conditions met', () => {
    const result = evaluatePartnerTier(weakInput);
    expect(result.direction).toBe('downgrade');
    expect(result.recommendedTier).toBe('silver');
  });

  it('recommends stay when current tier is platinum (cannot upgrade)', () => {
    const input: TierEvaluationInput = {
      ...strongInput,
      currentTier: 'platinum',
    };
    const result = evaluatePartnerTier(input);
    expect(result.direction).toBe('stay');
    expect(result.recommendedTier).toBe('platinum');
  });

  it('calculates confidence score for upgrade recommendation', () => {
    const result = evaluatePartnerTier(strongInput);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════
//  nextTier / prevTier
// ═══════════════════════════════════════════════════════════
describe('nextTier', () => {
  it('returns silver for bronze', () => expect(nextTier('bronze')).toBe('silver'));
  it('returns null for platinum (highest tier)', () => expect(nextTier('platinum')).toBeNull());
});

describe('prevTier', () => {
  it('returns gold for platinum', () => expect(prevTier('platinum')).toBe('gold'));
  it('returns null for bronze (lowest tier)', () => expect(prevTier('bronze')).toBeNull());
});
