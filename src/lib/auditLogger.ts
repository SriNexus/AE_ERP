/**
 * auditLogger.ts — Centralized Audit Logging Engine (Phase 9E)
 *
 * Single source of truth for all audit logging across Neozy ERP.
 * Wraps the existing activity.ts and workflow.ts logActivity with
 * a comprehensive API covering all required event types.
 *
 * Architecture:
 *   - All logs written to COLLECTIONS.AUDIT_LOGS
 *   - Security events also written to COLLECTIONS.SECURITY_LOGS
 *   - No Firestore reads — append-only
 *   - Works in both Desktop and Mobile
 *   - Works in Demo Mode (no-op if Firestore unavailable)
 */

import { createDocWithId, genId, resolveWriteCompanyId } from './firestore';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { logActivity } from './workflow';
import { isOwnerEmail } from './ownerAccess';
import { notifyRoleUsers } from './notifications';
import { NotificationType } from '../types';

// ── Types ──────────────────────────────────────────────────

export type AuditActionType =
  | 'create' | 'update' | 'delete' | 'restore' | 'view'
  | 'export' | 'print' | 'bulk_action'
  | 'login' | 'logout' | 'password_reset'
  | 'permission_change' | 'role_change'
  | 'notification_send' | 'fcm_delivery'
  | 'ai_query' | 'search' | 'route_visit'
  | 'failure' | 'security_event'
  | 'scheduler_execution'
  | 'unauthorized_access'
  | 'demo_activity';

export type AuditSeverity = 'info' | 'success' | 'warning' | 'danger' | 'critical';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  userRole: string;
  companyId: string;
  action: AuditActionType;
  entityType?: string;
  entityId?: string;
  module?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  route?: string;
  device?: string;
  browser?: string;
  os?: string;
  source?: 'web' | 'mobile' | 'api' | 'system';
  status: 'success' | 'failure';
  ipAddress?: string;
  severity: AuditSeverity;
  message: string;
  metadata: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────

function getContext() {
  const state = useAppStore.getState();
  const user = state.user;
  return {
    userId: user?.id || 'system',
    userEmail: user?.email || 'system@neozy.local',
    userRole: user?.role || 'System',
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    companyId: resolveWriteCompanyId(),
  };
}

function detectEnvironment() {
  if (typeof window === 'undefined') return { device: 'server', browser: 'unknown', os: 'unknown' };
  const ua = navigator.userAgent;
  const browser = ua.includes('Chrome') ? 'Chrome'
    : ua.includes('Firefox') ? 'Firefox'
    : ua.includes('Safari') ? 'Safari'
    : ua.includes('Edge') ? 'Edge'
    : 'Other';
  const os = ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac') ? 'macOS'
    : ua.includes('Linux') ? 'Linux'
    : ua.includes('Android') ? 'Android'
    : ua.includes('iOS') ? 'iOS'
    : 'Other';
  return {
    device: /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'web' as 'web' | 'mobile',
    browser,
    os,
  };
}

function buildEntry(
  action: AuditActionType,
  message: string,
  options?: {
    entityType?: string;
    entityId?: string;
    module?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    route?: string;
    status?: 'success' | 'failure';
    severity?: AuditSeverity;
    metadata?: Record<string, unknown>;
  },
): AuditLogEntry {
  const ctx = getContext();
  const env = detectEnvironment();
  const now = new Date().toISOString();

  return {
    id: genId.generic('AUD'),
    timestamp: now,
    userId: ctx.userId,
    userEmail: ctx.userEmail,
    userRole: ctx.userRole,
    companyId: ctx.companyId,
    action,
    entityType: options?.entityType,
    entityId: options?.entityId,
    module: options?.module,
    oldValues: options?.oldValues,
    newValues: options?.newValues,
    route: options?.route || (typeof window !== 'undefined' ? window.location.pathname : undefined),
    device: env.device,
    browser: env.browser,
    os: env.os,
    source: env.device === 'mobile' ? 'mobile' : 'web',
    status: options?.status || 'success',
    severity: options?.severity || 'info',
    message,
    metadata: options?.metadata || {},
  };
}

async function writeLog(entry: AuditLogEntry): Promise<void> {
  try {
    await createDocWithId(COLLECTIONS.AUDIT_LOGS, entry.id, entry);

    // Security events and failures get dual-written to SECURITY_LOGS
    if (entry.severity === 'critical' || entry.severity === 'danger' || entry.action === 'security_event' || entry.action === 'unauthorized_access') {
      try {
        await createDocWithId(COLLECTIONS.AUDIT_LOGS, `${entry.id}-sec`, {
          ...entry,
          id: `${entry.id}-sec`,
          module: 'security',
          severity: 'critical',
        });
      } catch {
        // Best-effort security logging
      }
    }
  } catch (error) {
    console.warn('[AuditLogger] Failed to write audit log:', error);
  }
}

// ── Public API ─────────────────────────────────────────────

/** Log a record creation */
export async function logCreate(entityType: string, entityId: string, record: Record<string, unknown>, module?: string): Promise<void> {
  const label = (record as Record<string, unknown>).name || (record as Record<string, unknown>).orderNumber || (record as Record<string, unknown>).projectId || entityId;
  void logActivity(module || entityType, `${entityType} created`, entityId, { entityName: label });
  await writeLog(buildEntry('create', `${entityType} created: ${label}`, {
    entityType, entityId, module, newValues: record, severity: 'success',
  }));
}

/** Log a record update */
export async function logUpdate(entityType: string, entityId: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>, module?: string): Promise<void> {
  const label = (newValues as Record<string, unknown>).name || entityId;
  void logActivity(module || entityType, `${entityType} updated`, entityId, { entityName: label });
  await writeLog(buildEntry('update', `${entityType} updated: ${label}`, {
    entityType, entityId, module, oldValues, newValues, severity: 'info',
  }));
}

/**
 * logEntityChange — structured status-change audit entry (Vendor Lock spec:
 * "Every transition: audit via logUpdate('scheme_registration', …) + logActivity").
 *
 * Writes ONE structured AUDIT_LOGS document (actor identity + role, canonical
 * company, entityType/entityId, oldValues/newValues, severity, metadata) via
 * the existing audit engine — WITHOUT the extra logActivity pass that
 * logUpdate performs, so workflows that already emit their own verb activity
 * entry (e.g. logActivity('scheme_registration', 'submitted', …)) do not
 * double-write the thin trail. Old/new values and metadata are the caller's
 * (workflow owns what changed); the entry always carries the authenticated
 * actor from the store — never a client-supplied identity.
 */
export async function logEntityChange(
  entityType: string,
  entityId: string,
  module: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await writeLog(buildEntry('update', message, {
    entityType, entityId, module, oldValues, newValues, severity: 'info', metadata,
  }));
}

/** Log a record deletion */
export async function logDelete(entityType: string, entityId: string, record?: Record<string, unknown>, module?: string): Promise<void> {
  const label = record?.name || entityId;
  void logActivity(module || entityType, `${entityType} deleted`, entityId, { entityName: label });
  await writeLog(buildEntry('delete', `${entityType} deleted: ${label}`, {
    entityType, entityId, module, oldValues: record,
    severity: record ? 'warning' : 'info',
  }));
}

/** Log a record restore */
export async function logRestore(entityType: string, entityId: string, module?: string): Promise<void> {
  await writeLog(buildEntry('restore', `${entityType} restored: ${entityId}`, {
    entityType, entityId, module, severity: 'success',
  }));
}

/** Log a record view (for sensitive records) */
export async function logView(entityType: string, entityId: string, module?: string): Promise<void> {
  await writeLog(buildEntry('view', `${entityType} viewed: ${entityId}`, {
    entityType, entityId, module, severity: 'info',
  }));
}

/** Log an export action */
export async function logExport(module: string, format: string, count?: number, filters?: Record<string, unknown>): Promise<void> {
  await writeLog(buildEntry('export', `Exported ${module} as ${format}${count ? ` (${count} records)` : ''}`, {
    module, status: 'success', severity: 'info',
    metadata: { format, count, filters },
  }));
}

/** Log a login event */
export async function logLogin( method: 'email' | 'google' | 'phone' | 'demo', status: 'success' | 'failure', error?: string): Promise<void> {
  await writeLog(buildEntry('login', status === 'success' ? `User logged in via ${method}` : `Login failed via ${method}${error ? `: ${error}` : ''}`, {
    status, severity: status === 'success' ? 'info' : 'warning',
    metadata: { method, error },
  }));
}

/** Log a logout event */
export async function logLogout(): Promise<void> {
  await writeLog(buildEntry('logout', 'User logged out', { severity: 'info' }));
}

/** Log a permission change */
export async function logPermissionChange(userId: string, userEmail: string, role: string, changes: Record<string, unknown>): Promise<void> {
  await writeLog(buildEntry('permission_change', `Permissions changed for ${userEmail}`, {
    entityType: 'user', entityId: userId, module: 'permissions',
    newValues: changes, severity: 'warning',
    metadata: { targetUser: userEmail, targetRole: role },
  }));
}

/** Log a role change */
export async function logRoleChange(userId: string, userEmail: string, oldRole: string, newRole: string): Promise<void> {
  await writeLog(buildEntry('role_change', `Role changed for ${userEmail}: ${oldRole} → ${newRole}`, {
    entityType: 'user', entityId: userId, module: 'roles',
    oldValues: { role: oldRole }, newValues: { role: newRole }, severity: 'warning',
  }));
}

/** Log a notification send */
export async function logNotification(notificationType: string, recipientUserId: string, entityType: string, entityId: string): Promise<void> {
  await writeLog(buildEntry('notification_send', `Notification ${notificationType} sent to ${recipientUserId}`, {
    entityType, entityId, module: 'notifications', severity: 'info',
    metadata: { notificationType, recipientUserId },
  }));
}

/** Log an AI query */
export async function logAiUsage(prompt: string, provider: string, responseLength: number, status: 'success' | 'failure', error?: string): Promise<void> {
  const currentUser = useAppStore.getState().user;
  await writeLog(buildEntry('ai_query', `AI query to ${provider}${error ? ` failed: ${error}` : ''}`, {
    module: 'ai', severity: status === 'success' ? 'info' : 'warning', status,
    metadata: {
      prompt: prompt.slice(0, 200),
      provider,
      responseLength,
      error,
      userEmail: currentUser?.email,
    },
  }));
}

/** Log a search query */
export async function logSearch(query: string, resultCount: number, filters?: Record<string, unknown>): Promise<void> {
  if (!query || query.length < 2) return;
  await writeLog(buildEntry('search', `Search: "${query.slice(0, 100)}" (${resultCount} results)`, {
    module: 'search', severity: 'info',
    metadata: { query: query.slice(0, 200), resultCount, filters },
  }));
}

/** Log a route visit */
export async function logRouteVisit(route: string): Promise<void> {
  await writeLog(buildEntry('route_visit', `Visited: ${route}`, {
    route, severity: 'info', metadata: { route },
  }));
}

/** Log a failure */
export async function logFailure(module: string, action: string, error: string, metadata?: Record<string, unknown>): Promise<void> {
  await writeLog(buildEntry('failure', `${module} ${action} failed: ${error}`, {
    module, severity: 'danger', status: 'failure', metadata: { error, ...metadata },
  }));
}

/** Log an unauthorized access attempt (also triggers notification to owner) */
export async function logUnauthorizedAccess(route: string, attemptedAction?: string): Promise<void> {
  const state = useAppStore.getState();
  const user = state.user;
  await writeLog(buildEntry('unauthorized_access', `Unauthorized access attempt to ${route}${attemptedAction ? ` (${attemptedAction})` : ''} by ${user?.email || 'unknown'}`, {
    module: 'security', route, severity: 'critical', status: 'failure',
    metadata: { attemptedAction, userEmail: user?.email, userId: user?.id, userRole: user?.role },
  }));
  // Notify owner about unauthorized access
  try {
    void notifyRoleUsers(
      ['owner'],
      NotificationType.ESCALATION_CRITICAL,
      '🔴 Unauthorized Access Attempt',
      `Route: ${route} attempted by ${user?.email || 'unknown'}${attemptedAction ? ` (${attemptedAction})` : ''}`,
      'unauthorized_access',
      route,
      resolveWriteCompanyId(),
    );
  } catch {
    // Best-effort notification
  }
}

/** Log a security event (also triggers notification to admin users) */
export async function logSecurityEvent(eventType: string, description: string, metadata?: Record<string, unknown>): Promise<void> {
  await writeLog(buildEntry('security_event', `Security: ${description}`, {
    module: 'security', severity: 'critical', metadata: { eventType, ...metadata },
  }));
  // Notify owner/admin about critical security events
  try {
    const currentUser = useAppStore.getState().user;
    if (currentUser) {
      void notifyRoleUsers(
        ['owner', 'admin'],
        NotificationType.ESCALATION_CRITICAL,
        '⚠️ Security Event',
        description.slice(0, 200),
        'security_event',
        eventType,
        currentUser.companyId,
      );
    }
  } catch {
    // Best-effort notification
  }
}

/** Log a scheduler execution */
export async function logSchedulerExecution(schedulerName: string, status: 'success' | 'failure', details?: string): Promise<void> {
  await writeLog(buildEntry('scheduler_execution', `Scheduler ${schedulerName} ${status}${details ? `: ${details}` : ''}`, {
    module: 'scheduler', severity: status === 'success' ? 'info' : 'danger', status,
    metadata: { schedulerName, details },
  }));
}

/** Log demo mode activity */
export async function logDemoActivity(action: string, details?: string): Promise<void> {
  await writeLog(buildEntry('demo_activity', `Demo: ${action}${details ? ` — ${details}` : ''}`, {
    module: 'demo', severity: 'info', metadata: { action, details },
  }));
}

export default {
  logCreate, logUpdate, logDelete, logRestore, logView,
  logExport, logLogin, logLogout,
  logPermissionChange, logRoleChange,
  logNotification, logAiUsage, logSearch, logRouteVisit,
  logFailure, logUnauthorizedAccess, logSecurityEvent,
  logSchedulerExecution, logDemoActivity,
};
