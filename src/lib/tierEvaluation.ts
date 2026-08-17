/**
 * tierEvaluation — Partner Tier Evaluation Service
 *
 * Evaluates partner tiers against configurable rules and applies changes.
 * Works with both automatic evaluation and manual overrides.
 *
 * Architecture:
 *   - Uses pure tierRules engine for evaluation logic
 *   - Stores tier history on partners (immutable)
 *   - Sends notifications on tier changes
 *   - Records audit trail entries
 *   - Supports scheduler integration
 *
 * Workflow:
 *   1. previewTierEvaluation() → shows recommendations without changes
 *   2. applyTierChanges() → persists changes with full history
 *   3. manualTierOverride() → manual override with reason
 */

import { getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers, sendNotification } from './notifications';
import { NotificationType } from '../types';
import { recordSettlementAudit } from './settlementAudit';
import { evaluatePartnerTier } from './tierRules';
import { buildPartnerScoreInput, computePartnerScore } from '../features/channel-partner/utils/analytics';
import type {
  ChannelPartner,
  PartnerTier,
  TierPreview,
  TierEvaluationInput,
  TierChangeEntry,
  TierRule,
} from '../features/channel-partner/types';

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Calculate how many months a partner has been active.
 */
function calculateActiveMonths(partner: ChannelPartner): number {
  if (!partner.createdAt) return 0;
  const created = new Date(partner.createdAt).getTime();
  const now = Date.now();
  return Math.max(1, Math.floor((now - created) / (30 * 86400000)));
}

/**
 * Build a TierEvaluationInput from partner and analytics data.
 */
function buildTierInput(
  partner: ChannelPartner,
  allLeads: any[],
  allSettlements: any[],
  allCommissionRecords: any[],
): TierEvaluationInput {
  const scoreInput = buildPartnerScoreInput(partner.id, allLeads, allSettlements, allCommissionRecords);
  const scoreResult = computePartnerScore(scoreInput);

  const partnerLeads = allLeads.filter((l: any) => l.partnerId === partner.id);
  const totalRevenue = partnerLeads.reduce((s: number, l: any) => s + (Number(l.value) || 0), 0);

  return {
    partnerId: partner.id,
    currentTier: partner.tier || 'bronze',
    metrics: {
      totalRevenue,
      totalCommissionEarned: partner.totalCommissionEarned || 0,
      totalLeadsCreated: partner.totalLeadsCreated || 0,
      totalLeadsConverted: partner.totalLeadsConverted || 0,
      conversionRate: partner.conversionRate || 0,
      successfulSettlements: allSettlements.filter(
        (s: any) => s.partnerId === partner.id && s.status === 'completed',
      ).length,
      activeMonths: calculateActiveMonths(partner),
      performanceScore: scoreResult.numeric,
      manualBonusScore: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  PREVIEW — Evaluate all partners without applying changes
// ═══════════════════════════════════════════════════════════

/**
 * Preview tier evaluation for all or selected partners.
 * Returns recommendations without persisting any changes.
 */
export async function previewTierEvaluation(
  options: {
    partnerIds?: string[];
    rules?: TierRule[];
  } = {},
): Promise<TierPreview[]> {
  const allPartners = await getAll<any>(COLLECTIONS.CHANNEL_PARTNERS);
  const allLeads = await getAll(COLLECTIONS.LEADS);
  // Read from settlements collection first (Phase 2F normalization), fallback to legacy
  let allSettlements = await getAll(COLLECTIONS.SETTLEMENTS);
  if (allSettlements.length === 0) {
    const legacyTxns = await getAll(COLLECTIONS.PARTNER_WALLET_TXNS);
    allSettlements = legacyTxns.filter((t: any) => t.commissionIds && Array.isArray(t.commissionIds) && !t.isDeleted);
  }
  const allCommissionRecords = await getAll(COLLECTIONS.COMMISSION_RECORDS);

  const activePartners = allPartners.filter(
    (p: any) => !p.isDeleted && p.status === 'active',
  ) as ChannelPartner[];

  const filtered = options.partnerIds
    ? activePartners.filter((p) => options.partnerIds!.includes(p.id))
    : activePartners;

  const results: TierPreview[] = [];

  for (const partner of filtered) {
    const input = buildTierInput(partner, allLeads, allSettlements, allCommissionRecords);
    const evaluation = evaluatePartnerTier(input, options.rules);

    results.push({
      partnerId: partner.id,
      partnerName: partner.firmName || partner.contactPerson || partner.id,
      currentTier: partner.tier || 'bronze',
      recommendedTier: evaluation.recommendedTier,
      direction: evaluation.direction,
      reasons: evaluation.reasons,
      score: evaluation.score,
      metrics: input.metrics,
    });
  }

  return results;
}

/**
 * Preview tier evaluation for a single partner.
 */
export async function previewSinglePartner(
  partnerId: string,
  rules?: TierRule[],
): Promise<TierPreview | null> {
  const results = await previewTierEvaluation({ partnerIds: [partnerId], rules });
  return results[0] || null;
}

// ═══════════════════════════════════════════════════════════
//  APPLY — Persist tier changes
// ═══════════════════════════════════════════════════════════

/**
 * Apply tier changes from evaluation results.
 * Persists tier updates, stores immutable history, sends notifications.
 */
export async function applyTierChanges(
  previews: TierPreview[],
  options: {
    changeType?: 'automatic' | 'manual';
    changedBy?: string;
    changedByName?: string;
  } = {},
): Promise<{ success: number; skipped: number; failed: number; errors: string[] }> {
  const state = useAppStore.getState();
  // Tenant safety: canonical resolveWriteCompanyId() instead of a local
  // fallback to the literal string 'default' (Admin companyId='default'
  // 403-storm root cause — same bug class fixed in entityProjection.ts).
  const companyId = resolveWriteCompanyId();
  const userId = options.changedBy || state.user?.id || 'system';
  const userName = options.changedByName || state.user?.name || 'System';
  const changeType = options.changeType || 'automatic';

  let success = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const preview of previews) {
    if (preview.direction === 'stay') {
      skipped++;
      continue;
    }

    try {
      const partner = await getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, preview.partnerId);
      if (!partner || partner.isDeleted) {
        skipped++;
        continue;
      }

      const entry: TierChangeEntry = {
        oldTier: preview.currentTier,
        newTier: preview.recommendedTier,
        changedAt: new Date().toISOString(),
        reason: preview.reasons.join('; '),
        changeType,
        changedBy: userId,
        changedByName: userName,
        metricsAtChange: {
          totalRevenue: preview.metrics.totalRevenue,
          totalCommissionEarned: preview.metrics.totalCommissionEarned,
          totalLeadsCreated: preview.metrics.totalLeadsCreated,
          totalLeadsConverted: preview.metrics.totalLeadsConverted,
          conversionRate: preview.metrics.conversionRate,
          performanceScore: preview.metrics.performanceScore,
          activeMonths: preview.metrics.activeMonths,
        },
      };

      const currentHistory = partner.tierHistory || [];

      await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, preview.partnerId, {
        tier: preview.recommendedTier,
        tierHistory: [...currentHistory, entry],
      });

      // Record immutable audit trail
      await recordSettlementAudit(
        preview.partnerId,
        'settlement' as 'settlement' | 'withdrawal',
        `tier_${preview.direction}`,
        preview.currentTier,
        preview.recommendedTier,
        `${preview.direction === 'upgrade' ? 'Upgraded' : 'Downgraded'} via ${changeType}. ${preview.reasons.join('; ')}`,
      ).catch(() => {});

      // Log activity
      await logActivity('Partners', `Tier ${preview.direction === 'upgrade' ? 'Upgraded' : 'Downgraded'}`, preview.partnerId, {
        oldTier: preview.currentTier,
        newTier: preview.recommendedTier,
        direction: preview.direction,
        reason: preview.reasons.join('; '),
        changeType,
        changedBy: userId,
        entityName: preview.partnerName,
        actionLabel: `Partner tier ${preview.direction} from ${preview.currentTier} to ${preview.recommendedTier}`,
      });

      // Notify partner
      if (partner.userId) {
        void sendNotification(
          partner.userId,
          preview.direction === 'upgrade' ? NotificationType.PARTNER_MILESTONE : NotificationType.PARTNER_SUSPENDED,
          `Tier ${preview.direction === 'upgrade' ? 'Upgrade' : 'Change'}`,
          `Your tier has been ${preview.direction === 'upgrade' ? 'upgraded' : 'changed'} from ${preview.currentTier} to ${preview.recommendedTier}.${changeType === 'automatic' ? '' : ' (Manual override)'}`,
          'partner',
          preview.partnerId,
          companyId,
        ).catch(() => {});
      }

      // Notify admins
      void notifyRoleUsers(
        ['Admin', 'Director'],
        NotificationType.PARTNER_MILESTONE,
        `Partner tier ${preview.direction === 'upgrade' ? 'upgraded' : 'downgraded'}`,
        `${preview.partnerName} was ${preview.direction === 'upgrade' ? 'upgraded' : 'downgraded'} from ${preview.currentTier} to ${preview.recommendedTier} (${changeType}).`,
        'partner',
        preview.partnerId,
        companyId,
      ).catch(() => {});

      success++;
    } catch (err) {
      failed++;
      errors.push(`Failed to update ${preview.partnerName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (success > 0) {
    await logActivity('Partners', 'Bulk Tier Evaluation Applied', 'batch', {
      total: previews.length,
      success,
      skipped,
      failed,
      changeType,
      actionLabel: `Tier evaluation: ${success} changes, ${skipped} skipped, ${failed} failed`,
    });
  }

  return { success, skipped, failed, errors };
}

// ═══════════════════════════════════════════════════════════
//  MANUAL OVERRIDE
// ═══════════════════════════════════════════════════════════

/**
 * Manually override a partner's tier.
 * Records the override separately from automatic changes.
 */
export async function manualTierOverride(
  partnerId: string,
  newTier: PartnerTier,
  reason: string,
  metadata?: { changedBy?: string; changedByName?: string; effectiveDate?: string },
): Promise<void> {
  const state = useAppStore.getState();
  const userId = metadata?.changedBy || state.user?.id || 'system';
  const userName = metadata?.changedByName || state.user?.name || 'System';
  const effectiveDate = metadata?.effectiveDate || new Date().toISOString();

  const partner = await getOne<ChannelPartner>(COLLECTIONS.CHANNEL_PARTNERS, partnerId);
  if (!partner) throw new Error(`Partner ${partnerId} not found`);

  const currentTier = partner.tier || 'bronze';
  const direction = tierLevel(newTier) > tierLevel(currentTier) ? 'upgrade'
    : tierLevel(newTier) < tierLevel(currentTier) ? 'downgrade'
    : 'stay';

  const entry: TierChangeEntry = {
    oldTier: currentTier,
    newTier,
    changedAt: effectiveDate,
    reason,
    changeType: 'manual',
    changedBy: userId,
    changedByName: userName,
  };

  const currentHistory = partner.tierHistory || [];

  await updateDocById(COLLECTIONS.CHANNEL_PARTNERS, partnerId, {
    tier: newTier,
    tierHistory: [...currentHistory, entry],
  });

  await logActivity('Partners', 'Manual Tier Override', partnerId, {
    oldTier: currentTier,
    newTier,
    reason,
    changedBy: userId,
    entityName: partner.firmName || partner.contactPerson || partnerId,
    actionLabel: `Manual tier override: ${currentTier} → ${newTier} (${reason})`,
  });

  void notifyRoleUsers(
    ['Admin', 'Director'],
    NotificationType.PARTNER_MILESTONE,
    'Manual tier override',
    `${partner.firmName || partner.contactPerson} tier overridden from ${currentTier} to ${newTier}. Reason: ${reason}`,
    'partner',
    partnerId,
    resolveWriteCompanyId(),
  ).catch(() => {});
}

function tierLevel(tier: PartnerTier): number {
  const levels: Record<PartnerTier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };
  return levels[tier] ?? 0;
}

// ═══════════════════════════════════════════════════════════
//  SCHEDULER INTEGRATION
// ═══════════════════════════════════════════════════════════

/**
 * Execute monthly tier evaluation — called by scheduler.
 * Evaluates all active partners and applies automatic changes.
 */
export async function executeMonthlyTierEvaluation(): Promise<{
  total: number;
  upgraded: number;
  downgraded: number;
  unchanged: number;
  errors: string[];
}> {
  const previews = await previewTierEvaluation();

  const upgrades = previews.filter((p) => p.direction === 'upgrade');
  const downgrades = previews.filter((p) => p.direction === 'downgrade');
  const unchanged = previews.filter((p) => p.direction === 'stay');

  const changedPreviews = [...upgrades, ...downgrades];
  const result = await applyTierChanges(changedPreviews, { changeType: 'automatic' });

  return {
    total: previews.length,
    upgraded: result.success,
    downgraded: downgrades.length,
    unchanged: unchanged.length + result.skipped,
    errors: result.errors,
  };
}

export default {
  previewTierEvaluation,
  previewSinglePartner,
  applyTierChanges,
  manualTierOverride,
  executeMonthlyTierEvaluation,
};
