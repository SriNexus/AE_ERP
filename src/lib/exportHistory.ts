/**
 * exportHistory — Centralized export history tracking
 *
 * Stores metadata about every generated export so admins can search,
 * filter, re-download, and delete past exports.
 *
 * Partners can only see their own exports via partnerId filter.
 *
 * Architecture:
 *   - Uses COLLECTIONS.ENTITIES for storage (entityType: 'export_history')
 *   - No Firestore SDK in UI — all through domain services
 *   - React Query ready with query keys
 */

import { getAll, createDocWithId, genId, updateDocById, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';

// ── Types ──────────────────────────────────────────────────

export type ExportFormat = 'CSV' | 'PDF';
export type ExportEntityType = 'settlements' | 'withdrawals' | 'commission_records' | 'partner_statement';

export interface ExportHistoryEntry {
  id: string;
  companyId: string;
  /** Who generated the export */
  generatedBy: string;
  generatedByName: string;
  /** Export metadata */
  exportType: ExportEntityType;
  format: ExportFormat;
  filtersUsed?: Record<string, string>;
  rowCount: number;
  /** Download filename */
  filename: string;
  /** Status — always 'completed' for now */
  status: 'completed';
  /** Partner scope — if set, only this partner can see it */
  partnerId?: string;
  /** Timestamps */
  generatedAt: string;
  isDeleted: boolean;
}

// ── Storage ────────────────────────────────────────────────

const HISTORY_COLLECTION = COLLECTIONS.ENTITIES;

/**
 * Log an export to history.
 * Called after a successful CSV/PDF download.
 */
export async function logExport(
  exportType: ExportEntityType,
  format: ExportFormat,
  filename: string,
  rowCount: number,
  filtersUsed?: Record<string, string>,
  partnerId?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';
  const id = genId.generic('EXP');

  const entry: ExportHistoryEntry = {
    id,
    companyId,
    generatedBy: userId,
    generatedByName: userName,
    exportType,
    format,
    filtersUsed,
    rowCount,
    filename,
    status: 'completed',
    partnerId,
    generatedAt: new Date().toISOString(),
    isDeleted: false,
  };

  await createDocWithId(HISTORY_COLLECTION, id, {
    ...entry,
    entityType: 'export_history',
    companyId,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  });

  // Notify creator that export finished
  void notifyRoleUsers(
    ['Admin'],
    NotificationType.SETTLEMENT_COMPLETED,
    'Export generated',
    `${format} export of ${exportType} completed — ${rowCount} rows exported. File: ${filename}`,
    'settlement',
    id,
    companyId,
  ).catch(() => {});

  return id;
}

/**
 * Load all export history entries for a company.
 * Partners see only their own; admins see all.
 */
export async function loadExportHistory(
  companyId: string,
  options?: {
    partnerId?: string;
    exportType?: ExportEntityType;
    format?: ExportFormat;
    limit?: number;
  },
): Promise<ExportHistoryEntry[]> {
  if (!companyId) return [];

  const allEntries = await getAll<any>(HISTORY_COLLECTION);
  let entries = allEntries
    .filter((e: any) => e.entityType === 'export_history' && e.companyId === companyId && !e.isDeleted)
    .map((e: any) => ({
      id: e.id,
      companyId: e.companyId,
      generatedBy: e.generatedBy,
      generatedByName: e.generatedByName,
      exportType: e.exportType as ExportEntityType,
      format: e.format as ExportFormat,
      filtersUsed: e.filtersUsed,
      rowCount: e.rowCount,
      filename: e.filename,
      status: 'completed' as const,
      partnerId: e.partnerId,
      generatedAt: e.generatedAt || e.createdAt,
      isDeleted: false,
    }))
    .sort((a: ExportHistoryEntry, b: ExportHistoryEntry) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );

  // Apply filters
  if (options?.partnerId) {
    entries = entries.filter((e) => !e.partnerId || e.partnerId === options.partnerId);
  }
  if (options?.exportType) {
    entries = entries.filter((e) => e.exportType === options.exportType);
  }
  if (options?.format) {
    entries = entries.filter((e) => e.format === options.format);
  }
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Soft-delete an export history entry.
 */
export async function deleteExportHistory(id: string): Promise<void> {
  await updateDocById(HISTORY_COLLECTION, id, {
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export default {
  logExport,
  loadExportHistory,
  deleteExportHistory,
};
