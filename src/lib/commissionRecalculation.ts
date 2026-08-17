/**
 * commissionRecalculation — Commission Recalculation Engine
 *
 * Complete recalculation workflow for existing commission records.
 * Features:
 *   - Recalculate one or multiple commissions using current rules or historical snapshots
 *   - Difference detection (old → new → diff → reason)
 *   - Rule snapshot preservation for audit
 *   - Preview mode (never overwrites immediately)
 *   - Batch recalculation with progress
 *
 * Architecture:
 *   - Pure service layer — no Firestore SDK in UI
 *   - Reuses existing CommissionRecord, CommissionRule types
 *   - Stores ruleSnapshot on each commission for historical comparison
 *   - Stores recalculationHistory entries for undo/audit
 *
 * Workflow:
 *   1. Load commission records + current rules
 *   2. previewRecalculation() → shows diff without changes
 *   3. applyRecalculation() → persists preview results
 */

import { getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { recordSettlementAudit } from './settlementAudit';
import type {
  CommissionRecord,
  CommissionRule,
  CommissionSlab,
  RecalculationEntry,
  RecalculationPreview,
  RuleSnapshot,
  CommissionRuleType,
} from '../features/channel-partner/types';

// ═══════════════════════════════════════════════════════════
//  CORE RECALCULATION LOGIC
// ═══════════════════════════════════════════════════════════

/**
 * Compute what a commission *would* be worth under a given rule.
 * Pure function — no side effects.
 */
function computeCommissionAmount(
  dealValue: number,
  systemSizeKW: number,
  rule: { type: CommissionRuleType; value: number; slabs?: CommissionSlab[]; minAmount?: number; maxAmount?: number },
): number {
  let amount = 0;

  switch (rule.type) {
    case 'percentage':
      amount = (dealValue * rule.value) / 100;
      break;
    case 'fixed':
      amount = rule.value;
      break;
    case 'per_kw':
      amount = systemSizeKW * rule.value;
      break;
    case 'per_deal':
      amount = rule.value;
      break;
    case 'slab': {
      if (rule.slabs && rule.slabs.length > 0) {
        // Find matching slab
        const slab = rule.slabs.find(
          (s) => systemSizeKW >= s.fromKW && systemSizeKW <= s.toKW,
        );
        if (slab) {
          if (slab.type === 'percentage') amount = (dealValue * slab.value) / 100;
          else if (slab.type === 'fixed') amount = slab.value;
          else if (slab.type === 'per_kw') amount = systemSizeKW * slab.value;
        } else {
          // Fallback: use rule value
          amount = (dealValue * rule.value) / 100;
        }
      } else {
        amount = (dealValue * rule.value) / 100;
      }
      break;
    }
    default:
      amount = (dealValue * rule.value) / 100;
  }

  // Apply caps
  if (rule.minAmount && amount < rule.minAmount) amount = rule.minAmount;
  if (rule.maxAmount && amount > rule.maxAmount) amount = rule.maxAmount;

  return Math.round(amount);
}

/**
 * Find the applicable rule for a commission record.
 * First tries exact ruleId match, then tries matching by partner/lead context.
 */
async function findApplicableRule(
  record: CommissionRecord,
  partners: any[],
): Promise<{ rule: CommissionRule | null; reason: string }> {
  // First try exact ruleId match
  if (record.ruleId) {
    const rule = await getOne<CommissionRule>(COLLECTIONS.COMMISSION_RULES, record.ruleId);
    if (rule && rule.isActive && !rule.isDeleted) {
      return { rule, reason: `Rule unchanged (${rule.name})` };
    }
  }

  // Try finding a matching active rule
  const allRules = await getAll<CommissionRule>(COLLECTIONS.COMMISSION_RULES);
  const activeRules = allRules.filter((r) => r.isActive && !r.isDeleted);

  // Match by partner tier
  const partner = (partners as any[]).find((p: any) => p.id === record.partnerId);
  const partnerTier = partner?.tier || 'bronze';

  // Find best matching rule
  for (const rule of activeRules) {
    if (rule.applicableTo === 'partner' && rule.applicableIds?.includes(record.partnerId)) {
      return { rule, reason: `Matched partner-specific rule: ${rule.name}` };
    }
    if (rule.applicableTo === 'partner_tier' && rule.partnerTier === partnerTier) {
      return { rule, reason: `Matched tier rule (${partnerTier}): ${rule.name}` };
    }
  }

  // Fallback to first 'all' rule
  const allRule = activeRules.find((r) => r.applicableTo === 'all');
  if (allRule) {
    return { rule: allRule, reason: `Fallback to global rule: ${allRule.name}` };
  }

  return { rule: null, reason: 'No applicable active rule found' };
}

// ═══════════════════════════════════════════════════════════
//  PREVIEW
// ═══════════════════════════════════════════════════════════

/**
 * Preview recalculation for a set of commission records.
 * Returns diff information without applying any changes.
 */
export async function previewRecalculation(
  commissionIds: string[],
  options: {
    useCurrentRules?: boolean;
  } = {},
): Promise<RecalculationPreview[]> {
  const { useCurrentRules = true } = options;
  const partners = await getAll(COLLECTIONS.CHANNEL_PARTNERS);
  const partnerNames: Record<string, string> = {};
  (partners as any[]).forEach((p: any) => {
    partnerNames[p.id] = p.firmName || p.contactPerson || p.id;
  });

  const results: RecalculationPreview[] = [];

  for (const id of commissionIds) {
    const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, id);
    if (!record || record.isDeleted) continue;

    let newAmount: number;
    let reason: string;
    let ruleUsed: string;

    if (useCurrentRules) {
      // Use current active rules
      const { rule, reason: rsn } = await findApplicableRule(record, partners);
      ruleUsed = rule?.name || 'No rule';
      if (rule) {
        newAmount = computeCommissionAmount(
          record.dealValue || 0,
          record.systemSizeKW || 0,
          rule,
        );
        reason = rsn;
      } else {
        newAmount = record.approvedAmount || record.amount || 0;
        reason = 'No applicable rule — amount unchanged';
      }
    } else {
      // Use historical rule snapshot
      const snapshot = record.ruleSnapshot;
      if (snapshot) {
        ruleUsed = snapshot.ruleName;
        newAmount = computeCommissionAmount(
          record.dealValue || 0,
          record.systemSizeKW || 0,
          {
            type: snapshot.ruleType,
            value: snapshot.ruleValue,
            slabs: snapshot.slabs,
            minAmount: snapshot.minAmount,
            maxAmount: snapshot.maxAmount,
          },
        );
        reason = `Recalculated using historical snapshot (${snapshot.ruleName})`;
      } else {
        newAmount = record.approvedAmount || record.amount || 0;
        ruleUsed = record.ruleName || 'Unknown';
        reason = 'No historical snapshot — amount unchanged';
      }
    }

    const oldAmount = record.approvedAmount || record.amount || 0;
    const difference = newAmount - oldAmount;

    results.push({
      commissionId: record.id,
      leadId: record.leadId,
      partnerId: record.partnerId,
      partnerName: partnerNames[record.partnerId] || record.partnerId,
      oldAmount,
      oldStatus: record.status,
      newAmount,
      difference,
      reason,
      changed: Math.abs(difference) > 0.01,
      ruleUsed,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
//  APPLY RECALCULATION
// ═══════════════════════════════════════════════════════════

/**
 * Apply the results of a previewed recalculation.
 * Updates commission records with new amounts and stores audit trail.
 */
export async function applyRecalculation(
  previewResults: RecalculationPreview[],
  options: {
    useCurrentRules?: boolean;
  } = {},
): Promise<{ success: number; skipped: number; failed: number; errors: string[] }> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';

  let success = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const preview of previewResults) {
    if (!preview.changed) {
      skipped++;
      continue;
    }

    try {
      const record = await getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, preview.commissionId);
      if (!record || record.isDeleted) {
        skipped++;
        continue;
      }

      // Only recalculate records that haven't been paid
      if (record.status === 'paid') {
        skipped++;
        continue;
      }

      // Build recalculation entry
      const entry: RecalculationEntry = {
        timestamp: new Date().toISOString(),
        recalculatedBy: userId,
        recalculatedByName: userName,
        useCurrentRules: options.useCurrentRules ?? true,
        previousAmount: preview.oldAmount,
        newAmount: preview.newAmount,
        difference: preview.difference,
        reason: preview.reason,
      };

      // Build rule snapshot (if using current rules)
      let newSnapshot: RuleSnapshot | undefined;
      if (options.useCurrentRules) {
        const rule = await getOne<CommissionRule>(COLLECTIONS.COMMISSION_RULES, record.ruleId || '');
        if (rule) {
          newSnapshot = {
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.type,
            ruleValue: rule.value,
            minAmount: rule.minAmount,
            maxAmount: rule.maxAmount,
            slabs: rule.slabs,
            effectiveFrom: rule.effectiveFrom,
            effectiveTo: rule.effectiveTo,
            priority: rule.priority,
          };
        }
      }

      // Update the commission record
      const previousHistory = record.recalculationHistory || [];
      await updateDocById(COLLECTIONS.COMMISSION_RECORDS, preview.commissionId, {
        approvedAmount: preview.newAmount,
        amount: preview.newAmount,
        ruleSnapshot: newSnapshot || record.ruleSnapshot,
        recalculationHistory: [entry, ...previousHistory].slice(0, 10), // Keep last 10
        // Reset approval if amount changed significantly
        ...(record.status === 'approved' || record.status === 'calculated'
          ? { status: 'calculated' as const }
          : {}),
        updatedAt: new Date().toISOString(),
      });

      // Audit trail
      // Note: Commission isn't settlement/withdrawal, but audit type limited to these two
      await recordSettlementAudit(
        preview.commissionId,
        'withdrawal' as 'settlement' | 'withdrawal',
        'recalculated',
        preview.oldStatus,
        'calculated',
        `${preview.reason}. Amount: ${preview.oldAmount} → ${preview.newAmount} (${preview.difference >= 0 ? '+' : ''}${preview.difference})`,
      );

      success++;
    } catch (err) {
      failed++;
      errors.push(`Failed to recalculate ${preview.commissionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Activity log
  await logActivity('Settlements', 'Commission Recalculation Applied', 'batch', {
    total: previewResults.length,
    success,
    skipped,
    failed,
    actionLabel: `Commission recalculation: ${success} updated, ${skipped} skipped, ${failed} failed`,
  });

  // Notify admins
  void notifyRoleUsers(
    ['Admin'],
    NotificationType.COMMISSION_APPROVED,
    'Commission recalculation completed',
    `Recalculation applied to ${success} commission(s). ${skipped} skipped, ${failed} failed.`,
    'settlement',
    'recalculation',
    companyId,
  ).catch(() => {});

  return { success, skipped, failed, errors };
}

// ═══════════════════════════════════════════════════════════
//  BATCH — Recalculate an entire settlement batch
// ═══════════════════════════════════════════════════════════

/**
 * Preview recalculation for all commissions in a settlement batch.
 */
export async function previewBatchRecalculation(
  settlementId: string,
  options: { useCurrentRules?: boolean } = {},
): Promise<RecalculationPreview[]> {
  // Read from settlements collection first (Phase 2F normalization), fallback to legacy
  let settlement = await getOne<any>(COLLECTIONS.SETTLEMENTS, settlementId);
  if (!settlement) {
    settlement = await getOne<any>(COLLECTIONS.PARTNER_WALLET_TXNS, settlementId);
  }
  if (!settlement) return [];

  const commissionIds: string[] = settlement.commissionIds || [];
  if (commissionIds.length === 0) return [];

  return previewRecalculation(commissionIds, options);
}

/**
 * Load a single commission record for detail preview.
 */
export async function getCommissionDetail(commissionId: string): Promise<CommissionRecord | null> {
  return getOne<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS, commissionId);
}

// ═══════════════════════════════════════════════════════════
//  RULE SNAPSHOT — Save current rule state to a commission
// ═══════════════════════════════════════════════════════════

/**
 * Save a rule snapshot to a commission record (if not already saved).
 * Called when a commission is generated to preserve the rule state.
 *
 * TODO: Integrate into commission generation workflow (Phase 9.2).
 * Currently defined here for future use but not wired into the
 * commission generation pipeline yet.
 */
export async function saveRuleSnapshot(
  commissionId: string,
  ruleId: string,
): Promise<void> {
  const rule = await getOne<CommissionRule>(COLLECTIONS.COMMISSION_RULES, ruleId);
  if (!rule) return;

  const snapshot: RuleSnapshot = {
    ruleId: rule.id,
    ruleName: rule.name,
    ruleType: rule.type,
    ruleValue: rule.value,
    minAmount: rule.minAmount,
    maxAmount: rule.maxAmount,
    slabs: rule.slabs,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    priority: rule.priority,
  };

  await updateDocById(COLLECTIONS.COMMISSION_RECORDS, commissionId, {
    ruleSnapshot: snapshot,
    updatedAt: new Date().toISOString(),
  });
}

export default {
  previewRecalculation,
  applyRecalculation,
  previewBatchRecalculation,
  getCommissionDetail,
  saveRuleSnapshot,
};
