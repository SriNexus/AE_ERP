/**
 * channelPartnerCommissionEngine — Pure Commission Calculation Engine
 *
 * This is the single source of truth for all commission calculations.
 * It has NO UI dependencies, NO React imports, NO Firestore SDK.
 * It can be used from services, hooks, admin pages, and partner portal.
 *
 * Responsibilities:
 *   - Rule resolution (priority-based)
 *   - Commission calculation (per_kw, percentage, fixed, per_deal, slab)
 *   - Adjustments (cap, min, bonus, penalty, override)
 *   - Validation (active, effective dates, zero/negative, impossible percentages)
 *   - Preview (calculate without saving)
 *   - Detailed breakdown + human-readable explanation
 *
 * Architecture:
 *   - Pure functions with no side effects
 *   - All inputs are passed explicitly (no global state)
 *   - Returns a detailed result object with every intermediate value
 *   - Errors and warnings are returned, not thrown
 */

import type { CommissionRule, CommissionSlab, CommissionRuleType } from '../features/channel-partner/types';

// ═════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════

export type { CommissionRuleType };

export interface CommissionAdjustment {
  type: 'bonus' | 'penalty' | 'cap' | 'minimum' | 'override';
  label: string;
  amount: number;
  description?: string;
}

export interface CommissionValidationError {
  field: string;
  message: string;
  code: string;
}

export interface CommissionCalculationInput {
  /** Deal value in INR */
  dealValue: number;
  /** System size in kW */
  systemSizeKW: number;
  /** The commission rule to apply */
  rule: CommissionRule;
  /** Optional manual bonuses */
  bonus?: number;
  /** Optional manual penalties */
  penalty?: number;
  /** Optional overrides (bypasses rule calculation) */
  overrideAmount?: number;
  /** Optional override explanation */
  overrideReason?: string;
}

export interface CommissionCalculationResult {
  /** Whether the calculation succeeded */
  success: boolean;
  /** Errors (calculation failed) */
  errors: CommissionValidationError[];
  /** Warnings (calculation succeeded but with concerns) */
  warnings: string[];

  // ── Rule info ──
  appliedRule: CommissionRule | null;
  ruleName: string;
  commissionType: CommissionRuleType;

  // ── Inputs ──
  dealValue: number;
  systemSizeKW: number;

  // ── Breakdown ──
  /** Base value from rule (e.g., rate per kW) */
  baseValue: number;
  /** Amount before adjustments */
  calculatedAmount: number;
  /** Amount after cap */
  cappedAmount: number | null;
  /** Applied adjustments (bonus, penalty, cap, min, override) */
  adjustments: CommissionAdjustment[];
  /** Final amount after all adjustments */
  finalAmount: number;

  // ── Explanation ──
  /** Human-readable formula */
  formula: string;
  /** Human-readable explanation */
  explanation: string[];
  /** Matching slab (if slab type) */
  appliedSlab: CommissionSlab | null;
}

// ═════════════════════════════════════════════════════════════
//  VALIDATION
// ═════════════════════════════════════════════════════════════

/**
 * Validates a commission rule and returns structured errors.
 * Does NOT throw — returns errors as data.
 */
export function validateCommissionRule(rule: CommissionRule): CommissionValidationError[] {
  const errors: CommissionValidationError[] = [];
  const now = new Date();

  // Active check
  if (!rule.isActive) {
    errors.push({ field: 'isActive', message: 'Rule is inactive', code: 'RULE_INACTIVE' });
  }

  // Deleted check
  if ((rule as any).isDeleted) {
    errors.push({ field: 'isDeleted', message: 'Rule has been deleted', code: 'RULE_DELETED' });
  }

  // Effective dates
  if (rule.effectiveFrom) {
    const from = new Date(rule.effectiveFrom);
    if (isNaN(from.getTime())) {
      errors.push({ field: 'effectiveFrom', message: 'Invalid effective from date', code: 'INVALID_DATE' });
    } else if (from > now) {
      errors.push({ field: 'effectiveFrom', message: 'Rule is not yet effective', code: 'NOT_YET_EFFECTIVE' });
    }
  }

  if (rule.effectiveTo) {
    const to = new Date(rule.effectiveTo);
    if (isNaN(to.getTime())) {
      errors.push({ field: 'effectiveTo', message: 'Invalid effective to date', code: 'INVALID_DATE' });
    } else if (to < now) {
      errors.push({ field: 'effectiveTo', message: 'Rule has expired', code: 'RULE_EXPIRED' });
    }
  }

  // Value validation
  switch (rule.type) {
    case 'per_kw':
    case 'fixed':
    case 'per_deal':
      if (rule.value <= 0) {
        errors.push({ field: 'value', message: 'Value must be greater than zero', code: 'ZERO_OR_NEGATIVE' });
      }
      break;
    case 'percentage':
      if (rule.value <= 0) {
        errors.push({ field: 'value', message: 'Percentage must be greater than zero', code: 'ZERO_OR_NEGATIVE' });
      } else if (rule.value > 100) {
        errors.push({ field: 'value', message: 'Percentage cannot exceed 100%', code: 'IMPOSSIBLE_PERCENTAGE' });
      }
      break;
    case 'slab':
      if (!rule.slabs || rule.slabs.length === 0) {
        errors.push({ field: 'slabs', message: 'Slab rule must have at least one slab', code: 'EMPTY_SLABS' });
      } else {
        rule.slabs.forEach((slab, idx) => {
          if (slab.fromKW < 0 || slab.toKW <= slab.fromKW) {
            errors.push({ field: `slabs[${idx}]`, message: `Invalid slab range: ${slab.fromKW}-${slab.toKW}`, code: 'INVALID_SLAB_RANGE' });
          }
          if (slab.value <= 0) {
            errors.push({ field: `slabs[${idx}]`, message: `Slab value must be greater than zero`, code: 'ZERO_OR_NEGATIVE' });
          }
        });
      }
      break;
  }

  // Cap validation
  if (rule.maxAmount !== undefined && rule.maxAmount !== null) {
    if (rule.maxAmount < 0) {
      errors.push({ field: 'maxAmount', message: 'Maximum cap cannot be negative', code: 'NEGATIVE_CAP' });
    } else if (rule.maxAmount === 0) {
      errors.push({ field: 'maxAmount', message: 'Maximum cap of zero means no commission', code: 'ZERO_CAP' });
    }
  }

  // Min deal value
  if (rule.minAmount !== undefined && rule.minAmount !== null && rule.minAmount < 0) {
    errors.push({ field: 'minAmount', message: 'Minimum deal value cannot be negative', code: 'NEGATIVE_MIN' });
  }

  return errors;
}

/**
 * Validates calculation inputs without requiring a rule.
 */
export function validateCalculationInput(input: {
  dealValue: number;
  systemSizeKW: number;
}): CommissionValidationError[] {
  const errors: CommissionValidationError[] = [];

  if (input.dealValue < 0) {
    errors.push({ field: 'dealValue', message: 'Deal value cannot be negative', code: 'NEGATIVE_DEAL_VALUE' });
  }
  if (input.systemSizeKW < 0) {
    errors.push({ field: 'systemSizeKW', message: 'System size cannot be negative', code: 'NEGATIVE_SYSTEM_SIZE' });
  }

  return errors;
}

// ═════════════════════════════════════════════════════════════
//  RULE RESOLUTION
// ═════════════════════════════════════════════════════════════

export interface RuleResolutionContext {
  /** Partner's tier for tier-based matching */
  partnerTier?: string;
  /** Partner ID for partner-specific rules */
  partnerId?: string;
  /** Product category for category-based matching */
  productCategoryId?: string;
  /** Location state for location-based matching */
  locationState?: string;
  /** Location pincode for location-based matching */
  locationPinCode?: string;
}

/**
 * Resolves the best matching commission rule from a list of rules.
 *
 * Priority (highest to lowest):
 *   1. Partner-specific (applicableTo = 'partner' + applicableIds contains partnerId)
 *   2. Location (applicableTo = 'location' + matching state/pincode)
 *   3. Category (applicableTo = 'product_category' + matching category)
 *   4. Partner Tier (applicableTo = 'partner_tier' + matching tier)
 *   5. Default (applicableTo = 'all')
 *
 * Within same priority, the rule with highest priority number wins.
 * If no rule matches, returns null.
 */
export function resolveCommissionRule(
  rules: CommissionRule[],
  context: RuleResolutionContext,
): { rule: CommissionRule | null; explanation: string } {
  const now = new Date();

  // Filter to only active, non-deleted, effective rules
  const validRules = rules.filter((r) => {
    if (!r.isActive) return false;
    if ((r as any).isDeleted) return false;
    if (r.effectiveFrom && new Date(r.effectiveFrom) > now) return false;
    if (r.effectiveTo && new Date(r.effectiveTo) < now) return false;
    return true;
  });

  if (validRules.length === 0) {
    return { rule: null, explanation: 'No active commission rules found.' };
  }

  // Sort by priority descending, then by name for determinism
  const sorted = [...validRules].sort((a, b) => {
    const pDiff = (b.priority || 0) - (a.priority || 0);
    if (pDiff !== 0) return pDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Priority 1: Partner-specific
  if (context.partnerId) {
    const partnerRule = sorted.find(
      (r) => r.applicableTo === 'partner' && r.applicableIds?.includes(context.partnerId!)
    );
    if (partnerRule) {
      return { rule: partnerRule, explanation: `Partner-specific rule: ${partnerRule.name}` };
    }
  }

  // Priority 2: Location
  if (context.locationState || context.locationPinCode) {
    const locationRule = sorted.find((r) => {
      if (r.applicableTo !== 'location') return false;
      if (context.locationState && r.locationStates?.includes(context.locationState)) return true;
      if (context.locationPinCode && r.locationPinCodes?.includes(context.locationPinCode)) return true;
      return false;
    });
    if (locationRule) {
      return { rule: locationRule, explanation: `Location-based rule: ${locationRule.name}` };
    }
  }

  // Priority 3: Product Category
  if (context.productCategoryId) {
    const categoryRule = sorted.find(
      (r) => r.applicableTo === 'product_category' && r.applicableIds?.includes(context.productCategoryId!)
    );
    if (categoryRule) {
      return { rule: categoryRule, explanation: `Category-based rule: ${categoryRule.name}` };
    }
  }

  // Priority 4: Partner Tier
  if (context.partnerTier) {
    const tierRule = sorted.find(
      (r) => r.applicableTo === 'partner_tier' && r.partnerTier === context.partnerTier
    );
    if (tierRule) {
      return { rule: tierRule, explanation: `Tier-based rule: ${tierRule.name} (${context.partnerTier})` };
    }
  }

  // Priority 5: Default (applicableTo = 'all')
  const defaultRule = sorted.find((r) => r.applicableTo === 'all');
  if (defaultRule) {
    return { rule: defaultRule, explanation: `Default rule: ${defaultRule.name}` };
  }

  return { rule: null, explanation: 'No matching commission rule found for any applicability level.' };
}

// ═════════════════════════════════════════════════════════════
//  SLAB RESOLUTION
// ═════════════════════════════════════════════════════════════

/**
 * Finds the matching slab for a given system size.
 * Falls back to the last slab if no exact match.
 */
export function resolveSlab(slabs: CommissionSlab[], systemSizeKW: number): {
  slab: CommissionSlab | null;
  explanation: string;
} {
  if (!slabs || slabs.length === 0) {
    return { slab: null, explanation: 'No slabs defined.' };
  }

  const sorted = [...slabs].sort((a, b) => a.fromKW - b.fromKW);
  const matching = sorted.find((s) => systemSizeKW >= s.fromKW && systemSizeKW <= s.toKW);

  if (matching) {
    return {
      slab: matching,
      explanation: `Slab ${matching.fromKW}-${matching.toKW} kW at ${matching.value}${matching.type === 'percentage' ? '%' : matching.type === 'fixed' ? ' fixed' : '/kW'}`,
    };
  }

  // Fallback: use last slab
  const last = sorted[sorted.length - 1];
  return {
    slab: last,
    explanation: `System size ${systemSizeKW}kW exceeds slab range. Using highest slab: ${last.fromKW}-${last.toKW} kW at ${last.value}/kW`,
  };
}

// ═════════════════════════════════════════════════════════════
//  CALCULATION
// ═════════════════════════════════════════════════════════════

/**
 * Core calculation engine.
 * Takes validated inputs and returns a detailed calculation result.
 * Pure function — no side effects.
 */
export function calculateCommission(input: CommissionCalculationInput): CommissionCalculationResult {
  const { dealValue, systemSizeKW, rule, bonus = 0, penalty = 0, overrideAmount, overrideReason } = input;

  // ── Step 1: Validate ──
  const ruleErrors = validateCommissionRule(rule);
  const inputErrors = validateCalculationInput({ dealValue, systemSizeKW });
  const allErrors = [...ruleErrors, ...inputErrors];
  const hasFatalErrors = allErrors.length > 0;
  const warnings: string[] = [];

  // ── Step 2: Check minimum deal value ──
  if (rule.minAmount && dealValue < rule.minAmount && !hasFatalErrors) {
    return {
      success: true,
      errors: [],
      warnings: [`Deal value (₹${dealValue.toLocaleString('en-IN')}) is below minimum (₹${rule.minAmount.toLocaleString('en-IN')}). Commission set to 0.`],
      appliedRule: rule,
      ruleName: rule.name || 'Unnamed Rule',
      commissionType: rule.type as CommissionRuleType,
      dealValue,
      systemSizeKW,
      baseValue: 0,
      calculatedAmount: 0,
      cappedAmount: null,
      adjustments: [],
      finalAmount: 0,
      formula: `Deal value below minimum threshold (₹${rule.minAmount.toLocaleString('en-IN')})`,
      explanation: [`Deal value ₹${dealValue.toLocaleString('en-IN')} is below the minimum of ₹${rule.minAmount.toLocaleString('en-IN')} required by rule "${rule.name}".`, 'Commission set to ₹0. Contact admin for a manual override.'],
      appliedSlab: null,
    };
  }

  // ── Step 3: Handle override ──
  if (overrideAmount !== undefined && overrideAmount !== null) {
    const adjustments: CommissionAdjustment[] = [
      { type: 'override', label: 'Manual Override', amount: overrideAmount, description: overrideReason || 'Manual override applied' },
    ];
    return {
      success: true,
      errors: [],
      warnings: ['Manual override applied — rule calculation bypassed.'],
      appliedRule: rule,
      ruleName: rule.name || 'Unnamed Rule',
      commissionType: rule.type as CommissionRuleType,
      dealValue,
      systemSizeKW,
      baseValue: 0,
      calculatedAmount: 0,
      cappedAmount: null,
      adjustments,
      finalAmount: overrideAmount,
      formula: 'Manual override',
      explanation: [`Commission manually set to ₹${overrideAmount.toLocaleString('en-IN')}.${overrideReason ? ` Reason: ${overrideReason}` : ''}`],
      appliedSlab: null,
    };
  }

  // ── Step 4: Calculate base amount ──
  let baseValue: number;
  let calculatedAmount: number;
  let formula: string;
  let explanationParts: string[] = [];
  let appliedSlab: CommissionSlab | null = null;

  switch (rule.type) {
    case 'per_kw': {
      baseValue = rule.value;
      calculatedAmount = systemSizeKW * rule.value;
      formula = `${systemSizeKW} kW × ₹${rule.value.toLocaleString('en-IN')}/kW = ₹${calculatedAmount.toLocaleString('en-IN')}`;
      explanationParts = [
        `Rule "${rule.name}" applies ₹${rule.value.toLocaleString('en-IN')} per kW.`,
        `System size: ${systemSizeKW} kW.`,
        `Base commission: ${systemSizeKW} × ₹${rule.value.toLocaleString('en-IN')} = ₹${calculatedAmount.toLocaleString('en-IN')}.`,
      ];
      break;
    }
    case 'percentage': {
      baseValue = rule.value;
      calculatedAmount = Math.round(dealValue * (rule.value / 100));
      formula = `₹${dealValue.toLocaleString('en-IN')} × ${rule.value}% = ₹${calculatedAmount.toLocaleString('en-IN')}`;
      explanationParts = [
        `Rule "${rule.name}" applies ${rule.value}% commission.`,
        `Deal value: ₹${dealValue.toLocaleString('en-IN')}.`,
        `Base commission: ${rule.value}% of ₹${dealValue.toLocaleString('en-IN')} = ₹${calculatedAmount.toLocaleString('en-IN')}.`,
      ];
      break;
    }
    case 'fixed': {
      baseValue = rule.value;
      calculatedAmount = rule.value;
      formula = `Fixed ₹${rule.value.toLocaleString('en-IN')}`;
      explanationParts = [
        `Rule "${rule.name}" pays a fixed commission of ₹${rule.value.toLocaleString('en-IN')} per deal.`,
      ];
      break;
    }
    case 'per_deal': {
      baseValue = rule.value;
      calculatedAmount = rule.value;
      formula = `₹${rule.value.toLocaleString('en-IN')} per deal`;
      explanationParts = [
        `Rule "${rule.name}" pays ₹${rule.value.toLocaleString('en-IN')} per deal.`,
      ];
      break;
    }
    case 'slab': {
      const slabResult = resolveSlab(rule.slabs || [], systemSizeKW);
      appliedSlab = slabResult.slab;
      if (appliedSlab) {
        if (appliedSlab.type === 'fixed') {
          baseValue = appliedSlab.value;
          calculatedAmount = appliedSlab.value;
          formula = `Slab ${appliedSlab.fromKW}-${appliedSlab.toKW} kW: ₹${appliedSlab.value.toLocaleString('en-IN')}`;
        } else if (appliedSlab.type === 'percentage') {
          baseValue = appliedSlab.value;
          calculatedAmount = Math.round(dealValue * (appliedSlab.value / 100));
          formula = `Slab ${appliedSlab.fromKW}-${appliedSlab.toKW} kW: ${appliedSlab.value}% of ₹${dealValue.toLocaleString('en-IN')} = ₹${calculatedAmount.toLocaleString('en-IN')}`;
        } else {
          // per_kw (default for slabs — per_deal not supported on slabs)
          baseValue = appliedSlab.value;
          calculatedAmount = systemSizeKW * appliedSlab.value;
          formula = `Slab ${appliedSlab.fromKW}-${appliedSlab.toKW} kW: ${systemSizeKW} × ₹${appliedSlab.value.toLocaleString('en-IN')}/kW = ₹${calculatedAmount.toLocaleString('en-IN')}`;
        }
        explanationParts = [
          `Rule "${rule.name}" uses slab-based calculation.`,
          slabResult.explanation,
          formula,
        ];
      } else {
        baseValue = 0;
        calculatedAmount = 0;
        formula = 'No matching slab found';
        explanationParts = [`Rule "${rule.name}" has no matching slab for ${systemSizeKW} kW system.`];
        warnings.push(`No slab matches ${systemSizeKW} kW system size.`);
      }
      break;
    }
    default: {
      baseValue = 0;
      calculatedAmount = 0;
      formula = 'Unknown rule type';
      explanationParts = [`Rule type "${rule.type}" is not supported.`];
      warnings.push(`Unsupported commission type: ${rule.type}`);
    }
  }

  // ── Step 5: Apply cap ──
  const adjustments: CommissionAdjustment[] = [];
  let cappedAmount: number | null = null;
  let finalAmount = calculatedAmount;

  if (rule.maxAmount !== undefined && rule.maxAmount !== null && rule.maxAmount > 0 && finalAmount > rule.maxAmount) {
    cappedAmount = finalAmount;
    finalAmount = rule.maxAmount;
    adjustments.push({
      type: 'cap',
      label: 'Maximum Cap',
      amount: rule.maxAmount - calculatedAmount,
      description: `Capped from ₹${calculatedAmount.toLocaleString('en-IN')} to ₹${rule.maxAmount.toLocaleString('en-IN')}`,
    });
    explanationParts.push(`Maximum cap of ₹${rule.maxAmount.toLocaleString('en-IN')} applied.`);
  }

  // ── Step 6: Apply bonus ──
  if (bonus > 0) {
    finalAmount += bonus;
    adjustments.push({
      type: 'bonus',
      label: 'Bonus',
      amount: bonus,
      description: `Bonus of ₹${bonus.toLocaleString('en-IN')}`,
    });
    explanationParts.push(`Bonus of ₹${bonus.toLocaleString('en-IN')} added.`);
  }

  // ── Step 7: Apply penalty ──
  if (penalty > 0) {
    const penaltyDeduction = Math.min(penalty, finalAmount);
    finalAmount -= penaltyDeduction;
    adjustments.push({
      type: 'penalty',
      label: 'Penalty',
      amount: -penaltyDeduction,
      description: `Penalty of ₹${penalty.toLocaleString('en-IN')}`,
    });
    explanationParts.push(`Penalty of ₹${penalty.toLocaleString('en-IN')} deducted.`);
  }

  // ── Step 8: Ensure non-negative ──
  if (finalAmount < 0) {
    finalAmount = 0;
    warnings.push('Commission was negative after adjustments. Set to ₹0.');
    explanationParts.push('Commission set to ₹0 (negative result prevented).');
  }

  return {
    success: !hasFatalErrors,
    errors: allErrors,
    warnings,
    appliedRule: hasFatalErrors ? null : rule,
    ruleName: rule.name || 'Unnamed Rule',
    commissionType: rule.type as CommissionRuleType,
    dealValue,
    systemSizeKW,
    baseValue,
    calculatedAmount,
    cappedAmount,
    adjustments,
    finalAmount,
    formula,
    explanation: explanationParts,
    appliedSlab,
  };
}

// ═════════════════════════════════════════════════════════════
//  PREVIEW FUNCTIONS
// ═════════════════════════════════════════════════════════════

/**
 * Calculates commission preview without saving.
 * Useful for UI preview before approval.
 * Never writes data.
 */
export function calculateCommissionPreview(
  rule: CommissionRule,
  dealValue: number,
  systemSizeKW: number,
  options?: { bonus?: number; penalty?: number; overrideAmount?: number; overrideReason?: string },
): CommissionCalculationResult {
  return calculateCommission({
    dealValue,
    systemSizeKW,
    rule,
    bonus: options?.bonus || 0,
    penalty: options?.penalty || 0,
    overrideAmount: options?.overrideAmount,
    overrideReason: options?.overrideReason,
  });
}

/**
 * Estimates partner commission across multiple leads.
 * Useful for dashboard estimates.
 * Never writes data.
 */
export function estimatePartnerCommission(
  rules: CommissionRule[],
  leads: Array<{ dealValue: number; systemSizeKW: number; partnerId?: string; partnerTier?: string; locationState?: string }>,
  context: RuleResolutionContext,
): { total: number; breakdown: Array<{ leadIndex: number; rule: string; amount: number; status: string }> } {
  const breakdown: Array<{ leadIndex: number; rule: string; amount: number; status: string }> = [];
  let total = 0;

  leads.forEach((lead, idx) => {
    const resolved = resolveCommissionRule(rules, {
      ...context,
      partnerId: lead.partnerId || context.partnerId,
      partnerTier: lead.partnerTier || context.partnerTier,
      locationState: lead.locationState || context.locationState,
    });

    if (!resolved.rule) {
      breakdown.push({ leadIndex: idx, rule: 'No rule', amount: 0, status: 'no_rule' });
      return;
    }

    // Validate rule
    const ruleErrors = validateCommissionRule(resolved.rule);
    if (ruleErrors.length > 0) {
      breakdown.push({ leadIndex: idx, rule: resolved.rule.name || 'Invalid', amount: 0, status: 'invalid' });
      return;
    }

    const result = calculateCommission({
      dealValue: lead.dealValue,
      systemSizeKW: lead.systemSizeKW,
      rule: resolved.rule,
    });

    breakdown.push({
      leadIndex: idx,
      rule: resolved.rule.name || 'Unnamed',
      amount: result.finalAmount,
      status: result.success ? 'calculated' : 'error',
    });
    total += result.finalAmount;
  });

  return { total, breakdown };
}

// ═════════════════════════════════════════════════════════════
//  FORMATTING HELPERS (for reports, not UI)
// ═════════════════════════════════════════════════════════════

/**
 * Generates a structured breakdown for reports/dashboard.
 */
export function getCommissionBreakdown(result: CommissionCalculationResult): Record<string, unknown> {
  return {
    ruleName: result.ruleName,
    type: result.commissionType,
    dealValue: result.dealValue,
    systemSizeKW: result.systemSizeKW,
    baseRate: result.baseValue,
    calculatedAmount: result.calculatedAmount,
    cappedAmount: result.cappedAmount,
    adjustments: result.adjustments.map((a) => ({
      type: a.type,
      label: a.label,
      amount: a.amount,
      description: a.description,
    })),
    finalAmount: result.finalAmount,
    formula: result.formula,
    explanation: result.explanation,
  };
}
