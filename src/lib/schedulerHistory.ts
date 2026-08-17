/**
 * schedulerHistory — Scheduler execution history & retry
 *
 * Maintains an immutable log of every auto-settlement scheduler run.
 * Admins can:
 *   - Inspect previous runs (execution date, scheduled/manual, eligible, processed, skipped, failed, duration, errors)
 *   - Retry failed runs
 *   - Duplicate previous configuration
 *   - Manually rerun any historical execution
 *
 * No cron implementation. Only service workflow.
 *
 * Storage: COLLECTIONS.ENTITIES with entityType: 'scheduler_execution'
 */

import { createDocWithId, genId, updateDocById, getAll, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { loadSchedulerConfig, executeSchedulerRun, type SchedulerConfig } from './autoSettlementScheduler';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';
import { recordSettlementAudit } from './settlementAudit';

// ── Types ──────────────────────────────────────────────────

export type RunType = 'scheduled' | 'manual';

export interface SchedulerExecution {
  id: string;
  companyId: string;
  /** Execution metadata */
  runType: RunType;
  executionDate: string;
  duration: number; // seconds
  /** Snapshot of config at time of run */
  configAtRun: Partial<SchedulerConfig>;
  /** Results */
  eligibleCommissions: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
  totalSettledAmount: number;
  /** Status */
  success: boolean;
  isDeleted: boolean;
  /** When retried, reference the original execution */
  retryOf?: string;
}

// ── Storage ────────────────────────────────────────────────

/**
 * Record a scheduler execution in history.
 */
export async function recordSchedulerExecution(
  runType: RunType,
  config: SchedulerConfig,
  eligibleCommissions: number,
  processedCount: number,
  skippedCount: number,
  failedCount: number,
  totalSettledAmount: number,
  errors: string[],
  duration: number,
  success: boolean,
  retryOf?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const id = genId.generic('SCH');

  const execution: Omit<SchedulerExecution, 'isDeleted'> = {
    id,
    companyId,
    runType,
    executionDate: new Date().toISOString(),
    duration,
    configAtRun: {
      enabled: config.enabled,
      settlementDay: config.settlementDay,
      mode: config.mode,
      partnerFilter: config.partnerFilter,
      partnerTier: config.partnerTier,
      locationState: config.locationState,
      minCommissionAmount: config.minCommissionAmount,
      includePending: config.includePending,
    },
    eligibleCommissions,
    processedCount,
    skippedCount,
    failedCount,
    errors,
    totalSettledAmount,
    success,
    retryOf,
  };

  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    ...execution,
    entityType: 'scheduler_execution',
    companyId,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  });

  return id;
}

/**
 * Load scheduler execution history.
 */
export async function loadSchedulerHistory(
  companyId: string,
  limit = 50,
): Promise<SchedulerExecution[]> {
  if (!companyId) return [];

  const allEntries = await getAll<any>(COLLECTIONS.ENTITIES);
  const entries = allEntries
    .filter((e: any) =>
      e.entityType === 'scheduler_execution' &&
      e.companyId === companyId &&
      !e.isDeleted,
    )
    .map((e: any) => ({
      id: e.id,
      companyId: e.companyId,
      runType: e.runType as RunType,
      executionDate: e.executionDate || e.createdAt,
      duration: e.duration || 0,
      configAtRun: e.configAtRun || {},
      eligibleCommissions: e.eligibleCommissions || 0,
      processedCount: e.processedCount || 0,
      skippedCount: e.skippedCount || 0,
      failedCount: e.failedCount || 0,
      errors: e.errors || [],
      totalSettledAmount: e.totalSettledAmount || 0,
      success: e.success !== false,
      isDeleted: false,
      retryOf: e.retryOf,
    }))
    .sort((a: SchedulerExecution, b: SchedulerExecution) =>
      new Date(b.executionDate).getTime() - new Date(a.executionDate).getTime(),
    );

  return entries.slice(0, limit);
}

/**
 * Retry a failed scheduler execution.
 * Returns the result of the new run.
 */
export async function retrySchedulerExecution(
  executionId: string,
): Promise<{
  success: boolean;
  newExecutionId?: string;
  errors: string[];
}> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  // Load the original execution
  const history = await loadSchedulerHistory(companyId, 100);
  const original = history.find((h) => h.id === executionId);
  if (!original) {
    return { success: false, errors: [`Execution ${executionId} not found`] };
  }

  // Recreate config from the snapshot
  const config = await loadSchedulerConfig();
  const mergedConfig: SchedulerConfig = {
    ...config,
    ...original.configAtRun,
  };

  const startTime = Date.now();
  const result = await executeSchedulerRun(mergedConfig);
  const duration = Math.round((Date.now() - startTime) / 1000);

  // Record the retry execution
  const newExecutionId = await recordSchedulerExecution(
    'manual',
    mergedConfig,
    0,
    result.batchesCreated || 0,
    result.batchesProcessed || 0,
    0,
    result.totalSettled || 0,
    result.errors || [],
    duration,
    result.success,
    executionId,
  );

  await logActivity('Settlements', 'Scheduler Run Retried', executionId, {
    actionLabel: `Retried scheduler execution ${executionId} — ${result.success ? 'success' : 'failed'}`,
    newExecutionId,
    success: result.success,
  });

  // Notify admins
  void notifyRoleUsers(
    ['Admin'],
    NotificationType.SETTLEMENT_COMPLETED,
    `Scheduler retry ${result.success ? 'succeeded' : 'failed'}`,
    `Retry of scheduler run ${executionId} ${result.success ? 'completed successfully' : 'failed'}. New execution: ${newExecutionId}.`,
    'settlement',
    newExecutionId || executionId,
    companyId,
  ).catch(() => {});

  return {
    success: result.success,
    newExecutionId,
    errors: result.errors || [],
  };
}

/**
 * Soft-delete a scheduler execution (admin cleanup).
 */
export async function deleteSchedulerExecution(id: string): Promise<void> {
  await updateDocById(COLLECTIONS.ENTITIES, id, {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export default {
  recordSchedulerExecution,
  loadSchedulerHistory,
  retrySchedulerExecution,
  deleteSchedulerExecution,
};
