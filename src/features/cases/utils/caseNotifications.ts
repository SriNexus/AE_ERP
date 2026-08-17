/**
 * caseNotifications — Case Notification utility (Phase 3J)
 *
 * Event-driven, non-blocking case notification layer.
 * Wraps the existing ERP notification infrastructure.
 *
 * Architecture:
 * - READ-ONLY: no Firestore writes except through sendNotification()
 * - No polling: all functions are event-driven
 * - No blocking: all functions fire and forget via Promise.all
 * - No duplicate notifications: handled by sendNotification() dedup
 * - Reuses: notifyUsersOnce(), notifyRoleUsers(), sendNotification()
 *
 * Integration:
 *   import { notifyCaseCreated } from '../features/cases/utils/caseNotifications';
 *   await notifyCaseCreated(caseRecord, leadData, user);
 */

import { NotificationType } from '../../../types';
import {
  notifyUsersOnce,
  notifyRoleUsers,
} from '../../../lib/notifications';

// ═══════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════

export type CaseNotificationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface CaseNotificationEvent {
  type: NotificationType;
  priority: CaseNotificationPriority;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
}

// ═══════════════════════════════════════════════════════════
//  Priority & Event Helpers
// ═══════════════════════════════════════════════════════════

const CASE_EVENT_PRIORITY: Record<string, CaseNotificationPriority> = {
  CASE_CREATED: 'low',
  CASE_ASSIGNED: 'medium',
  CASE_STAGE_CHANGED: 'medium',
  CASE_COMPLETED: 'low',
  CASE_FAILED: 'high',
  CASE_CANCELLED: 'low',
  CASE_VALIDATION_FAILED: 'critical',
  CASE_REPAIR_RECOMMENDED: 'high',
  CASE_REPAIR_COMPLETED: 'medium',
  CASE_HEALTH_CHANGED: 'high',
  CASE_DUPLICATE_DETECTED: 'critical',
  CASE_ORPHAN_DETECTED: 'critical',
  CASE_CIRCULAR_REFERENCE: 'critical',
  CASE_MONITORING_STARTED: 'low',
  CASE_AMC_CREATED: 'medium',
  CASE_SERVICE_TICKET_CREATED: 'medium',
  CASE_SUBSIDY_APPROVED: 'medium',
};

/** Get the priority level for a case notification type */
export function getCaseNotificationPriority(type: NotificationType): CaseNotificationPriority {
  return CASE_EVENT_PRIORITY[type] || 'medium';
}

/** Build a case notification event object */
export function buildCaseEvent(
  type: NotificationType,
  caseId: string,
  details: { title?: string; body?: string; stage?: string; health?: string },
): CaseNotificationEvent {
  const priority = getCaseNotificationPriority(type);
  const stage = details.stage ? ` at ${details.stage}` : '';
  const health = details.health ? ` (${details.health})` : '';

  const title = details.title || type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const body = details.body || `Case ${caseId}${stage}${health}`;

  return { type, priority, title, body, entityType: 'case', entityId: caseId };
}

// ═══════════════════════════════════════════════════════════
//  Notification Functions (10 required + 7 additional)
// ═══════════════════════════════════════════════════════════

/**
 * 1. notifyCaseCreated — Case has been created
 * Priority: Low
 */
export async function notifyCaseCreated(
  caseId: string,
  createdBy: string,
  companyId?: string,
  leadName?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_CREATED, caseId, {
    title: `Case Created: ${caseId}`,
    body: `New case created for lead ${leadName || caseId} by ${createdBy}`,
  });
  await notifyRoleUsers(['Admin', 'Director', 'Sales'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 2. notifyCaseAssigned — Case assigned to employee
 * Priority: Medium
 */
export async function notifyCaseAssigned(
  caseId: string,
  assignedUserId: string,
  assignedByName: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_ASSIGNED, caseId, {
    title: `Case Assigned: ${caseId}`,
    body: `Case ${caseId} has been assigned to ${assignedByName}`,
  });
  // Notify the assigned user + managers
  await notifyUsersOnce(
    [{ id: assignedUserId }],
    event.type, event.title, event.body, event.entityType, event.entityId,
    companyId,
  );
  await notifyRoleUsers(['Admin', 'Director'], event.type, `Case ${caseId} assigned to ${assignedByName}`, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 3. notifyCaseStageChanged — Case moved to a new EPC stage
 * Priority: Medium
 */
export async function notifyCaseStageChanged(
  caseId: string,
  fromStage: string,
  toStage: string,
  companyId?: string,
  targetUserIds?: string[],
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_STAGE_CHANGED, caseId, {
    title: `Case Stage Changed: ${caseId}`,
    body: `Case ${caseId} moved from ${fromStage} → ${toStage}`,
    stage: toStage,
  });
  if (targetUserIds && targetUserIds.length > 0) {
    await notifyUsersOnce(
      targetUserIds.map((id) => ({ id })),
      event.type, event.title, event.body, event.entityType, event.entityId,
      companyId,
    );
  }
  await notifyRoleUsers(['Admin', 'Director', 'Operations'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 4. notifyCaseCompleted — All stages completed
 * Priority: Low
 */
export async function notifyCaseCompleted(
  caseId: string,
  companyId?: string,
  durationDays?: number,
): Promise<void> {
  const duration = durationDays ? ` in ${durationDays} days` : '';
  const event = buildCaseEvent(NotificationType.CASE_COMPLETED, caseId, {
    title: `Case Completed: ${caseId}`,
    body: `Case ${caseId} completed${duration}`,
  });
  await notifyRoleUsers(['Admin', 'Director', 'Operations'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 5. notifyCaseFailed — Case failed at a stage
 * Priority: High
 */
export async function notifyCaseFailed(
  caseId: string,
  failedStage: string,
  reason: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_FAILED, caseId, {
    title: `Case Failed: ${caseId}`,
    body: `Case ${caseId} failed at ${failedStage}: ${reason}`,
    stage: failedStage,
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Director', 'Operations'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 6. notifyValidationFailure — Validation check failed
 * Priority: Critical
 */
export async function notifyValidationFailure(
  caseId: string,
  failureReason: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_VALIDATION_FAILED, caseId, {
    title: `Validation Failed: ${caseId}`,
    body: `Case ${caseId} validation failed: ${failureReason}`,
    health: 'critical',
  });
  await notifyRoleUsers(['Admin', 'Director'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 7. notifyHealthChange — Case health status changed
 * Priority: High
 */
export async function notifyHealthChange(
  caseId: string,
  previousHealth: string,
  currentHealth: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_HEALTH_CHANGED, caseId, {
    title: `Case Health Changed: ${caseId}`,
    body: `Case ${caseId} health changed from ${previousHealth} → ${currentHealth}`,
    health: currentHealth,
  });
  await notifyRoleUsers(['Admin', 'Director'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 8. notifyRepairRecommended — Repair action recommended
 * Priority: High
 */
export async function notifyRepairRecommended(
  caseId: string,
  repairType: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_REPAIR_RECOMMENDED, caseId, {
    title: `Repair Recommended: ${caseId}`,
    body: `Case ${caseId} requires repair: ${repairType}`,
    health: 'warning',
  });
  await notifyRoleUsers(['Admin', 'Director'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 9. notifyDuplicateCase — Duplicate case detected
 * Priority: Critical
 */
export async function notifyDuplicateCase(
  caseId: string,
  duplicateOfCaseId: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_DUPLICATE_DETECTED, caseId, {
    title: `Duplicate Case Detected: ${caseId}`,
    body: `Case ${caseId} is a duplicate of ${duplicateOfCaseId}`,
    health: 'critical',
  });
  await notifyRoleUsers(['Admin'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * 10. notifyOrphanEntity — Orphan entity detected in case
 * Priority: Critical
 */
export async function notifyOrphanEntity(
  caseId: string,
  orphanEntityType: string,
  orphanEntityId: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_ORPHAN_DETECTED, caseId, {
    title: `Orphan Entity: ${caseId}`,
    body: `Case ${caseId} has orphan ${orphanEntityType}: ${orphanEntityId}`,
    health: 'critical',
  });
  await notifyRoleUsers(['Admin'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

// ═══════════════════════════════════════════════════════════
//  Additional notification helpers (7 more events)
// ═══════════════════════════════════════════════════════════

/**
 * notifyCircularReference — Circular reference detected
 * Priority: Critical
 */
export async function notifyCircularReference(
  caseId: string,
  chainDescription: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_CIRCULAR_REFERENCE, caseId, {
    title: `Circular Reference: ${caseId}`,
    body: `Case ${caseId} has circular reference: ${chainDescription}`,
    health: 'critical',
  });
  await notifyRoleUsers(['Admin'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * notifyMonitoringStarted — Monitoring phase started
 * Priority: Low
 */
export async function notifyMonitoringStarted(
  caseId: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_MONITORING_STARTED, caseId, {
    title: `Monitoring Started: ${caseId}`,
    body: `Case ${caseId} has entered monitoring phase`,
    stage: 'Monitoring',
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Operations'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * notifyAmcCreated — AMC contract created for case
 * Priority: Medium
 */
export async function notifyAmcCreated(
  caseId: string,
  amcContractId: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_AMC_CREATED, caseId, {
    title: `AMC Created: ${caseId}`,
    body: `AMC contract ${amcContractId} created for case ${caseId}`,
    stage: 'AMC',
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Operations'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * notifyServiceTicketCreated — Service ticket raised for case
 * Priority: Medium
 */
export async function notifyServiceTicketCreated(
  caseId: string,
  ticketId: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_SERVICE_TICKET_CREATED, caseId, {
    title: `Service Ticket: ${caseId}`,
    body: `Service ticket ${ticketId} raised for case ${caseId}`,
    stage: 'Service Tickets',
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Operations', 'Service'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * notifySubsidyApproved — Subsidy approved for case
 * Priority: Medium
 */
export async function notifySubsidyApproved(
  caseId: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_SUBSIDY_APPROVED, caseId, {
    title: `Subsidy Approved: ${caseId}`,
    body: `Subsidy has been approved for case ${caseId}`,
    stage: 'Subsidy',
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Accounts'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * notifyRepairCompleted — Repair action completed
 * Priority: Medium
 */
export async function notifyRepairCompleted(
  caseId: string,
  repairType: string,
  companyId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_REPAIR_COMPLETED, caseId, {
    title: `Repair Completed: ${caseId}`,
    body: `Repair completed for case ${caseId}: ${repairType}`,
    health: 'healthy',
  });
  await notifyRoleUsers(['Admin', 'Director'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

// ═══════════════════════════════════════════════════════════
//  Bulk / convenience helpers
// ═══════════════════════════════════════════════════════════

/**
 * notifyCaseCancelled — Case cancelled
 * Priority: Low
 */
export async function notifyCaseCancelled(
  caseId: string,
  reason: string,
  companyId?: string,
  assignedUserId?: string,
): Promise<void> {
  const event = buildCaseEvent(NotificationType.CASE_CANCELLED, caseId, {
    title: `Case Cancelled: ${caseId}`,
    body: `Case ${caseId} cancelled: ${reason}`,
  });
  if (assignedUserId) {
    await notifyUsersOnce([{ id: assignedUserId }], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
  }
  await notifyRoleUsers(['Admin', 'Director'], event.type, event.title, event.body, event.entityType, event.entityId, companyId);
}

/**
 * Fire multiple case notifications in parallel (non-blocking).
 * Errors are caught individually so one failure doesn't block others.
 */
export async function fireCaseNotifications(
  events: Array<{
    fn: () => Promise<void>;
    description: string;
  }>,
): Promise<void> {
  await Promise.allSettled(
    events.map((e) =>
      e.fn().catch((err) => {
        console.warn(`[caseNotifications] Failed to send "${e.description}":`, err);
      }),
    ),
  );
}
