/**
 * tierRules — Pure Tier Rule Engine
 *
 * Completely pure logic for evaluating partner tiers against configurable rules.
 * No side effects, no Firestore access — imports anywhere.
 *
 * Supports:
 *   - Configurable tier thresholds per condition field
 *   - Comparison operators (>=, <=, >, <, ==)
 *   - Upgrade / downgrade / stay detection
 *   - Confidence scoring
 *   - Human-readable reasons
 *
 * Reuses the centralized analytics utility for performance score.
 */

import type {
  PartnerTier,
  TierRule,
  TierCondition,
  TierConditionField,
  TierEvaluationInput,
  TierEvaluationResult,
} from '../features/channel-partner/types';

// ── Default Tier Rules ─────────────────────────────────────

export const TIER_ORDER: PartnerTier[] = ['bronze', 'silver', 'gold', 'platinum'];

export const TIER_LABELS: Record<PartnerTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export const TIER_COLORS: Record<PartnerTier, string> = {
  bronze: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  silver: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  gold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  platinum: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};

export const TIER_PROGRESS_COLORS: Record<PartnerTier, string> = {
  bronze: '#d97706',
  silver: '#6b7280',
  gold: '#eab308',
  platinum: '#6366f1',
};

// ── Default Rules ──────────────────────────────────────────

export const DEFAULT_TIER_RULES: TierRule[] = [
  // Bronze → Silver
  {
    fromTier: 'bronze', toTier: 'silver', direction: 'upgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '>=', value: 500000, label: 'Revenue ≥ ₹5L' },
      { field: 'totalLeadsCreated', operator: '>=', value: 10, label: 'Leads ≥ 10' },
      { field: 'activeMonths', operator: '>=', value: 3, label: 'Active Months ≥ 3' },
    ],
  },
  // Silver → Gold
  {
    fromTier: 'silver', toTier: 'gold', direction: 'upgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '>=', value: 5000000, label: 'Revenue ≥ ₹50L' },
      { field: 'totalCommissionEarned', operator: '>=', value: 150000, label: 'Commission Earned ≥ ₹1.5L' },
      { field: 'conversionRate', operator: '>=', value: 20, label: 'Conversion Rate ≥ 20%' },
      { field: 'performanceScore', operator: '>=', value: 80, label: 'Performance Score ≥ 80' },
      { field: 'activeMonths', operator: '>=', value: 6, label: 'Active Months ≥ 6' },
    ],
  },
  // Gold → Platinum
  {
    fromTier: 'gold', toTier: 'platinum', direction: 'upgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '>=', value: 25000000, label: 'Revenue ≥ ₹2.5Cr' },
      { field: 'totalCommissionEarned', operator: '>=', value: 800000, label: 'Commission Earned ≥ ₹8L' },
      { field: 'conversionRate', operator: '>=', value: 30, label: 'Conversion Rate ≥ 30%' },
      { field: 'performanceScore', operator: '>=', value: 90, label: 'Performance Score ≥ 90' },
      { field: 'activeMonths', operator: '>=', value: 12, label: 'Active Months ≥ 12' },
      { field: 'successfulSettlements', operator: '>=', value: 5, label: 'Settlements ≥ 5' },
    ],
  },
  // Gold → Silver (downgrade)
  {
    fromTier: 'gold', toTier: 'silver', direction: 'downgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '<', value: 1500000, label: 'Revenue < ₹15L (6 months)' },
      { field: 'performanceScore', operator: '<', value: 50, label: 'Performance Score < 50' },
    ],
  },
  // Platinum → Gold (downgrade)
  {
    fromTier: 'platinum', toTier: 'gold', direction: 'downgrade', enabled: true,
    conditions: [
      { field: 'totalRevenue', operator: '<', value: 5000000, label: 'Revenue < ₹50L (6 months)' },
      { field: 'performanceScore', operator: '<', value: 60, label: 'Performance Score < 60' },
      { field: 'activeMonths', operator: '<', value: 6, label: 'Active Months < 6 (consecutive)' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
//  PURE EVALUATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Check if a single condition is met.
 * Pure function — no side effects.
 */
export function checkCondition(
  condition: TierCondition,
  metrics: TierEvaluationInput['metrics'],
): boolean {
  const actualValue = metrics[condition.field] ?? 0;

  switch (condition.operator) {
    case '>=': return actualValue >= condition.value;
    case '<=': return actualValue <= condition.value;
    case '>':  return actualValue > condition.value;
    case '<':  return actualValue < condition.value;
    case '==': return actualValue === condition.value;
    default:   return false;
  }
}

/**
 * Evaluate a single tier rule against partner metrics.
 * Pure function.
 */
export function evaluateRule(
  rule: TierRule,
  input: TierEvaluationInput,
): { passed: boolean; passedConditions: { label: string }[]; failedConditions: { label: string; required: number; actual: number }[] } {
  const passedConditions: { label: string }[] = [];
  const failedConditions: { label: string; required: number; actual: number }[] = [];

  for (const condition of rule.conditions) {
    const met = checkCondition(condition, input.metrics);
    if (met) {
      passedConditions.push({ label: condition.label });
    } else {
      failedConditions.push({
        label: condition.label,
        required: condition.value,
        actual: input.metrics[condition.field] ?? 0,
      });
    }
  }

  return {
    passed: failedConditions.length === 0,
    passedConditions,
    failedConditions,
  };
}

/**
 * Determine the tier index in the tier ordering.
 */
export function tierIndex(tier: PartnerTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Find applicable rules for a given current tier and direction.
 * Pure function.
 */
export function findApplicableRules(
  currentTier: PartnerTier,
  direction: 'upgrade' | 'downgrade',
  rules: TierRule[] = DEFAULT_TIER_RULES,
): TierRule[] {
  return rules.filter(
    (r) => r.enabled && r.fromTier === currentTier && r.direction === direction,
  );
}

/**
 * Evaluate a partner's current tier and determine if they should
 * be upgraded, downgraded, or stay.
 *
 * Pure function — no side effects, no Firestore access.
 */
export function evaluatePartnerTier(
  input: TierEvaluationInput,
  rules: TierRule[] = DEFAULT_TIER_RULES,
): TierEvaluationResult {
  const currentIdx = tierIndex(input.currentTier);

  // Check upgrade rules first
  const upgradeRules = findApplicableRules(input.currentTier, 'upgrade', rules);
  for (const rule of upgradeRules) {
    const result = evaluateRule(rule, input);
    if (result.passed && rule.toTier) {
      const score = calculateConfidenceScore(result, input);
      return {
        recommendedTier: rule.toTier,
        direction: 'upgrade',
        passedConditions: result.passedConditions,
        failedConditions: [],
        reasons: [
          `All ${result.passedConditions.length} upgrade condition(s) met`,
          ...result.passedConditions.map((c) => `✓ ${c.label}`),
          `Target: ${TIER_LABELS[rule.toTier]}`,
        ],
        score,
      };
    }
  }

  // Check downgrade rules
  const downgradeRules = findApplicableRules(input.currentTier, 'downgrade', rules);
  for (const rule of downgradeRules) {
    const result = evaluateRule(rule, input);
    if (result.passed && rule.toTier) {
      return {
        recommendedTier: rule.toTier,
        direction: 'downgrade',
        passedConditions: [],
        failedConditions: result.failedConditions,
        reasons: [
          `Downgrade conditions triggered`,
          ...result.passedConditions.map((c) => `✓ ${c.label}`),
          `Target: ${TIER_LABELS[rule.toTier]}`,
        ],
        score: 70,
      };
    }
  }

  return {
    recommendedTier: input.currentTier,
    direction: 'stay',
    passedConditions: [],
    failedConditions: [],
    reasons: ['No upgrade or downgrade conditions met — current tier maintained'],
    score: 100,
  };
}

/**
 * Calculate confidence score for an upgrade recommendation.
 * Higher = more confident.
 */
function calculateConfidenceScore(
  ruleResult: ReturnType<typeof evaluateRule>,
  input: TierEvaluationInput,
): number {
  const totalConditions = ruleResult.passedConditions.length + ruleResult.failedConditions.length;
  if (totalConditions === 0) return 50;

  // Base score from pass rate
  const passRate = ruleResult.passedConditions.length / totalConditions;
  let score = passRate * 80;

  // Bonus for having >= 3 conditions passed
  if (ruleResult.passedConditions.length >= 3) score += 10;
  if (ruleResult.passedConditions.length >= 5) score += 10;

  // Boost for performance score
  if (input.metrics.performanceScore >= 80) score += 5;
  if (input.metrics.performanceScore >= 90) score += 5;

  return Math.min(Math.round(score), 100);
}

/**
 * Get the next higher tier.
 */
export function nextTier(current: PartnerTier): PartnerTier | null {
  const idx = tierIndex(current);
  if (idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

/**
 * Get the next lower tier.
 */
export function prevTier(current: PartnerTier): PartnerTier | null {
  const idx = tierIndex(current);
  if (idx <= 0) return null;
  return TIER_ORDER[idx - 1];
}

export default {
  evaluatePartnerTier,
  evaluateRule,
  checkCondition,
  findApplicableRules,
  tierIndex,
  nextTier,
  prevTier,
  DEFAULT_TIER_RULES,
  TIER_ORDER,
  TIER_LABELS,
  TIER_COLORS,
  TIER_PROGRESS_COLORS,
};
