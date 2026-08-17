/**
 * autoSettlementScheduler — Configurable Auto Settlement Scheduler
 *
 * Provides:
 *   - Scheduler configuration type and defaults
 *   - Service-based execution workflow (no cron)
 *   - Preview next eligible run
 *   - Manual run trigger
 *
 * Reuses existing settlement engine (processSettlementBatch, createSettlementBatch).
 * No cron implementation. Scheduler is triggered manually or via config.
 * No duplicated settlement logic.
 */

import { getAll, getOne, createDocWithId, genId, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { createSettlementBatch, processSettlementBatch } from './channelPartnerSettlement';
import { recordSchedulerExecution } from './schedulerHistory';
import { executeMonthlyTierEvaluation } from './tierEvaluation';
import type { CommissionRecord } from '../features/channel-partner/types';

// ═══════════════════════════════════════════════════════════
//  SCHEDULER CONFIGURATION
// ═══════════════════════════════════════════════════════════

export type SettlementMode = 'manual' | 'automatic';
export type PartnerFilterType = 'all' | 'tier' | 'location';

export interface SchedulerConfig {
  /** Whether auto-settlement is enabled */
  enabled: boolean;
  /** Day of month (1–28) to run auto-settlement */
  settlementDay: number;
  /** Manual = button-triggered, Automatic = runs on configured day */
  mode: SettlementMode;
  /** Which partners to include */
  partnerFilter: PartnerFilterType;
  /** Partner tier filter (only when partnerFilter === 'tier') */
  partnerTier?: string;
  /** Location/state filter (only when partnerFilter === 'location') */
  locationState?: string;
  /** Minimum commission amount to include */
  minCommissionAmount: number;
  /** Whether to include pending commission records */
  includePending: boolean;
  /** Last run timestamp */
  lastRunAt?: string;
  /** Next scheduled run */
  nextRunAt?: string;
  /** Total runs completed */
  totalRuns: number;
  /** Total amount settled across all runs */
  totalSettledAmount: number;
  /** Whether to run monthly tier evaluation */
  enableTierEvaluation?: boolean;
  enableFraudEvaluation?: boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  settlementDay: 1,
  mode: 'manual',
  partnerFilter: 'all',
  minCommissionAmount: 0,
  includePending: false,
  totalRuns: 0,
  totalSettledAmount: 0,
  enableTierEvaluation: false,
  enableFraudEvaluation: false,
};

// ═══════════════════════════════════════════════════════════
//  CONFIG STORAGE KEY
// ═══════════════════════════════════════════════════════════

const SETTLEMENT_SCHEDULER_DOC_ID = 'auto_settlement_scheduler';

/**
 * Load scheduler configuration from the entities collection.
 */
export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  const doc = await getOne<any>(COLLECTIONS.ENTITIES, SETTLEMENT_SCHEDULER_DOC_ID);
  if (doc && doc.config) {
    return { ...DEFAULT_SCHEDULER_CONFIG, ...doc.config };
  }
  return { ...DEFAULT_SCHEDULER_CONFIG };
}

/**
 * Save scheduler configuration.
 */
export async function saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  const existing = await getOne<any>(COLLECTIONS.ENTITIES, SETTLEMENT_SCHEDULER_DOC_ID);
  if (existing) {
    await updateDocById(COLLECTIONS.ENTITIES, SETTLEMENT_SCHEDULER_DOC_ID, {
      config,
      updatedAt: new Date().toISOString(),
      updatedBy: state.user?.id || 'system',
    });
  } else {
    await createDocWithId(COLLECTIONS.ENTITIES, SETTLEMENT_SCHEDULER_DOC_ID, {
      id: SETTLEMENT_SCHEDULER_DOC_ID,
      entityType: 'scheduler_config',
      companyId,
      config,
      createdAt: new Date().toISOString(),
      createdBy: state.user?.id || 'system',
      updatedAt: new Date().toISOString(),
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  SCHEDULER EXECUTION
// ═══════════════════════════════════════════════════════════

export interface ScheduledRunResult {
  success: boolean;
  batchesCreated: number;
  batchesProcessed: number;
  totalSettled: number;
  errors: string[];
  timestamp: string;
}

/**
 * Preview the next scheduled run — returns eligible commission records
 * without executing any mutations.
 */
export async function previewNextRun(config: SchedulerConfig): Promise<{
  eligibleCount: number;
  eligibleAmount: number;
  partnersInvolved: number;
}> {
  const eligible = await getEligibleCommissionRecords(config);
  const partnerIds = new Set(eligible.map((r) => r.partnerId));

  return {
    eligibleCount: eligible.length,
    eligibleAmount: eligible.reduce((sum, r) => sum + (r.approvedAmount || r.amount || 0), 0),
    partnersInvolved: partnerIds.size,
  };
}

/**
 * Execute the auto-settlement run.
 * Collects eligible commissions, creates settlement batches, processes them.
 */
export async function executeSchedulerRun(config: SchedulerConfig): Promise<ScheduledRunResult> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const result: ScheduledRunResult = {
    success: true,
    batchesCreated: 0,
    batchesProcessed: 0,
    totalSettled: 0,
    errors: [],
    timestamp: new Date().toISOString(),
  };

  try {
    // Get eligible commissions
    const eligible = await getEligibleCommissionRecords(config);
    if (eligible.length === 0) {
      result.success = true;
      await logActivity('Settlements', 'Auto-Settlement Run: No eligible commissions', 'system', {
        actionLabel: 'Auto-settlement run completed — no eligible commissions found',
      });

      // Record execution even when no eligible commissions
      void recordSchedulerExecution(
        config.mode === 'automatic' ? 'scheduled' : 'manual',
        config,
        0, 0, 0, 0, 0, [], 1, true,
      ).catch(() => {});

      return result;
    }

    // Group by partner
    const byPartner = new Map<string, CommissionRecord[]>();
    for (const r of eligible) {
      const pid = r.partnerId;
      if (!byPartner.has(pid)) byPartner.set(pid, []);
      byPartner.get(pid)!.push(r);
    }

    // Create and process batches per partner
    for (const [partnerId, records] of byPartner) {
      try {
        const ids = records.map((r) => r.id);
        const settlementId = await createSettlementBatch(ids);
        if (settlementId) {
          result.batchesCreated++;
          const summary = await processSettlementBatch(settlementId);
          result.batchesProcessed++;
          result.totalSettled += records.reduce((s, r) => s + (r.approvedAmount || r.amount || 0), 0);
        }
      } catch (err) {
        const msg = `Failed to process partner ${partnerId}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }

    // Update scheduler config with run stats
    const updatedConfig: SchedulerConfig = {
      ...config,
      lastRunAt: result.timestamp,
      totalRuns: config.totalRuns + 1,
      totalSettledAmount: config.totalSettledAmount + result.totalSettled,
    };

    // Calculate next run date
    const nextDate = new Date();
    nextDate.setDate(config.settlementDay);
    if (nextDate <= new Date()) {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }
    updatedConfig.nextRunAt = nextDate.toISOString();

    await saveSchedulerConfig(updatedConfig);

    // Log activity
    await logActivity('Settlements', 'Auto-Settlement Run Completed', 'system', {
      batchesCreated: result.batchesCreated,
      batchesProcessed: result.batchesProcessed,
      totalSettled: result.totalSettled,
      errors: result.errors.length,
      actionLabel: `Auto-settlement run: ${result.batchesCreated} batches, ₹${result.totalSettled.toLocaleString('en-IN')} settled`,
    });

    // Notify admins
    void notifyRoleUsers(
      ['Admin'],
      NotificationType.SETTLEMENT_COMPLETED,
      'Auto-settlement run completed',
      `Auto-settlement processed ${result.batchesCreated} batches totaling ₹${result.totalSettled.toLocaleString('en-IN')}.${result.errors.length ? ` ${result.errors.length} error(s).` : ''}`,
      'settlement',
      'auto-scheduler',
      companyId,
    ).catch(() => {});

    result.success = result.errors.length === 0;
    // Record execution in scheduler history
    const eligibleCount = (await getEligibleCommissionRecords(config)).length;
    const skippedCount = Math.max(0, eligibleCount - result.batchesProcessed - result.errors.length);
    const startMs = new Date(result.timestamp).getTime();
    const durationSec = Math.round((Date.now() - startMs) / 1000);

    void recordSchedulerExecution(
      config.mode === 'automatic' ? 'scheduled' : 'manual',
      config,
      eligibleCount,
      result.batchesProcessed,
      skippedCount,
      result.errors.length,
      result.totalSettled,
      result.errors,
      Math.max(durationSec, 1),
      result.success,
    ).catch(() => {});

    // Optionally run fraud evaluation
    if (config.enableFraudEvaluation) {
      try {
        const { runFraudEvaluation } = await import('./fraudDetection');
        const fraudResult = await runFraudEvaluation();
        await logActivity('Fraud Detection', 'Scheduled Fraud Evaluation', 'system', {
          partnersEvaluated: fraudResult.evaluations.length,
          criticalCount: fraudResult.evaluations.filter((e: any) => e.riskLevel === 'critical').length,
          highCount: fraudResult.evaluations.filter((e: any) => e.riskLevel === 'high').length,
          alertsCreated: fraudResult.alertsCreated,
          actionLabel: `Scheduled fraud evaluation: ${fraudResult.evaluations.length} partners, ${fraudResult.alertsCreated} alerts`,
        });
      } catch (fraudErr) {
        result.errors.push(`Fraud evaluation failed: ${fraudErr instanceof Error ? fraudErr.message : String(fraudErr)}`);
      }
    }

    // Optionally run monthly tier evaluation
    if (config.enableTierEvaluation) {
      try {
        const tierResult = await executeMonthlyTierEvaluation();
        await logActivity('Partners', 'Monthly Tier Evaluation (Scheduled)', 'system', {
          total: tierResult.total,
          upgraded: tierResult.upgraded,
          downgraded: tierResult.downgraded,
          actionLabel: `Scheduled tier evaluation: ${tierResult.upgraded} upgraded, ${tierResult.downgraded} downgraded`,
        });
      } catch (tierErr) {
        result.errors.push(`Tier evaluation failed: ${tierErr instanceof Error ? tierErr.message : String(tierErr)}`);
      }
    }
  } catch (err) {
    result.success = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Get eligible commission records based on scheduler config.
 */
async function getEligibleCommissionRecords(config: SchedulerConfig): Promise<CommissionRecord[]> {
  const allRecords = await getAll<CommissionRecord>(COLLECTIONS.COMMISSION_RECORDS);

  let eligible = allRecords.filter((r: any) => !r.isDeleted);

  // Filter by status
  if (config.includePending) {
    eligible = eligible.filter((r) => r.status === 'approved' || r.status === 'pending');
  } else {
    eligible = eligible.filter((r) => r.status === 'approved');
  }

  // Apply minimum amount filter
  if (config.minCommissionAmount > 0) {
    eligible = eligible.filter((r) => (r.approvedAmount || r.amount || 0) >= config.minCommissionAmount);
  }

  // Apply partner filter
  if (config.partnerFilter !== 'all') {
    const allPartners = await getAll<any>(COLLECTIONS.CHANNEL_PARTNERS);
    let filteredPartnerIds: string[] = [];

    if (config.partnerFilter === 'tier' && config.partnerTier) {
      filteredPartnerIds = allPartners
        .filter((p: any) => {
          const tierLookup: Record<string, string> = {
            bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
          };
          return (p.tier || 'bronze') === config.partnerTier;
        })
        .map((p: any) => p.id);
    } else if (config.partnerFilter === 'location' && config.locationState) {
      filteredPartnerIds = allPartners
        .filter((p: any) => (p.address?.state || '') === config.locationState)
        .map((p: any) => p.id);
    }

    if (filteredPartnerIds.length > 0) {
      eligible = eligible.filter((r) => filteredPartnerIds.includes(r.partnerId));
    }
  }

  return eligible;
}

export default {
  loadSchedulerConfig,
  saveSchedulerConfig,
  previewNextRun,
  executeSchedulerRun,
  DEFAULT_SCHEDULER_CONFIG,
};
