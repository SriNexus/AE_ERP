/**
 * settlementAudit — Immutable audit trail for settlement lifecycle
 *
 * Every settlement action (create, process, approve, reject, pay, cancel)
 * appends an audit entry that records:
 *   - timestamp
 *   - action
 *   - previous status
 *   - new status
 *   - performed by
 *   - notes (optional)
 *   - IP/device placeholder (future-ready)
 *
 * Entries are stored in COLLECTIONS.ENTITIES with entityType: 'settlement_audit'.
 * They are immutable — once written, they are never modified.
 */

import { createDocWithId, genId, getAll, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';

// ── Types ──────────────────────────────────────────────────

export interface SettlementAuditEntry {
  id: string;
  companyId: string;
  /** ID of the settlement or withdrawal this relates to */
  entityId: string;
  /** 'settlement' | 'withdrawal' */
  entityType: 'settlement' | 'withdrawal';
  /** The action performed */
  action: string;
  /** Status before the action */
  previousStatus: string;
  /** Status after the action */
  newStatus: string;
  /** Who performed the action */
  performedBy: string;
  /** Performer's display name */
  performedByName: string;
  /** Optional notes */
  notes?: string;
  /** Future-ready IP/device info */
  ipAddress?: string;
  deviceInfo?: string;
  /** Timestamp */
  timestamp: string;
  /** Immutable — always false */
  isDeleted: false;
}

// ── Recording ──────────────────────────────────────────────

/**
 * Record an immutable audit entry for a settlement or withdrawal action.
 */
export async function recordSettlementAudit(
  entityId: string,
  entityType: 'settlement' | 'withdrawal',
  action: string,
  previousStatus: string,
  newStatus: string,
  notes?: string,
): Promise<string> {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const userId = state.user?.id || 'system';
  const userName = state.user?.name || 'System';
  const id = genId.generic('AUD');

  const entry: SettlementAuditEntry = {
    id,
    companyId,
    entityId,
    entityType,
    action,
    previousStatus,
    newStatus,
    performedBy: userId,
    performedByName: userName,
    notes,
    ipAddress: undefined,
    deviceInfo: undefined,
    timestamp: new Date().toISOString(),
    isDeleted: false,
  };

  // Store as entity with entityType: 'settlement_audit'
  await createDocWithId(COLLECTIONS.ENTITIES, id, {
    ...entry,
    entityType: 'settlement_audit',
    companyId,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  });

  // Also log to activity
  const actionLabel = `${entityType === 'settlement' ? 'Settlement' : 'Withdrawal'} ${action}`;
  await logActivity('Settlements', actionLabel, entityId, {
    actionLabel,
    previousStatus,
    newStatus,
    notes,
    entityName: entityId,
  });

  // Generate operational notification for important actions
  const notifiableActions = ['processed', 'approved', 'rejected', 'paid', 'cancelled', 'failed'];
  if (notifiableActions.includes(action.toLowerCase())) {
    void notifyRoleUsers(
      ['Admin'],
      NotificationType.SETTLEMENT_COMPLETED,
      `${entityType === 'settlement' ? 'Settlement' : 'Withdrawal'} ${action}`,
      `${entityType === 'settlement' ? 'Settlement' : 'Withdrawal'} ${entityId} was ${action}. Status: ${previousStatus} → ${newStatus}${notes ? `. Notes: ${notes}` : ''}`,
      'settlement',
      entityId,
      companyId,
    ).catch(() => {});
  }

  return id;
}

/**
 * Load audit trail for a specific settlement or withdrawal.
 */
export async function loadSettlementAuditTrail(
  entityId: string,
): Promise<SettlementAuditEntry[]> {
  if (!entityId) return [];

  const allEntries = await getAll<any>(COLLECTIONS.ENTITIES);
  return allEntries
    .filter((e: any) =>
      e.entityType === 'settlement_audit' &&
      e.entityId === entityId &&
      !e.isDeleted,
    )      .map((e: any) => ({
      id: e.id,
      companyId: e.companyId,
      entityId: e.entityId,
      entityType: e.entityType as 'settlement' | 'withdrawal',
      action: e.action,
      previousStatus: e.previousStatus || '—',
      newStatus: e.newStatus || '—',
      performedBy: e.performedBy,
      performedByName: e.performedByName || e.performedBy,
      notes: e.notes,
      ipAddress: e.ipAddress,
      deviceInfo: e.deviceInfo,
      timestamp: e.timestamp || e.createdAt,
      isDeleted: false as false,
    }))
    .sort((a: SettlementAuditEntry, b: SettlementAuditEntry) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
}

export default {
  recordSettlementAudit,
  loadSettlementAuditTrail,
};
