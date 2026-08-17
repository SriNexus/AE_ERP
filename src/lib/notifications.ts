import { collection, getDocs, limit, query, serverTimestamp, where } from 'firebase/firestore';
import { COLLECTIONS } from './firebase';
import { createDocWithId, genId, getOne, resolveWriteCompanyId } from './firestore';
import { NotificationType } from '../types';
import { db } from './firebase';
import { trackNotificationMetric } from './notificationMetrics';
import { useAppStore } from '../store/useAppStore';
import { getUserSettingsDocId } from '../features/settings/services/settingsService';
import type { SettingsDocument } from '../features/settings/types';
import type { UserNotificationPreferences } from '../features/auto-reminders/types';
import { isHiddenOwnerRecord } from './ownerAccess';

type NotificationRecipient = { id: string; name?: string; role?: string; companyId?: string; isDeleted?: boolean; status?: string };

export type NotificationDeliveryDecision = { deliver: boolean; reason?: 'event-disabled' | 'quiet-hours' };

export function notificationPreferenceEvent(type: NotificationType, entityType = ''): string | undefined {
  if (type === NotificationType.ESCALATION_CRITICAL) return 'escalation_critical';
  if (type === NotificationType.TASK_ASSIGNED) return 'task_assigned';
  if (type === NotificationType.LEAD_ASSIGNED) return 'project_assigned';
  if (type !== NotificationType.REMINDER) return undefined;
  const entity = entityType.toLowerCase();
  if (entity === 'project') return 'stuck_project';
  if (entity === 'task') return 'task_overdue';
  if (entity === 'lead') return 'lead_followup';
  if (entity === 'service_ticket') return 'service_ticket_stuck';
  return 'reminder_info';
}

export function isWithinQuietHours(now: Date, start?: string, end?: string): boolean {
  if (!start || !end || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const from = toMinute(start); const until = toMinute(end);
  return from < until ? minute >= from && minute < until : minute >= from || minute < until;
}

export function evaluateNotificationPreferences(preferences: UserNotificationPreferences, type: NotificationType, entityType: string, now = new Date()): NotificationDeliveryDecision {
  const eventType = notificationPreferenceEvent(type, entityType);
  const event = eventType ? preferences.events?.find((item) => item.eventType === eventType) : undefined;
  if (event?.inApp === false) return { deliver: false, reason: 'event-disabled' };
  if (preferences.quietHoursEnabled && isWithinQuietHours(now, preferences.quietHoursStart, preferences.quietHoursEnd)) return { deliver: false, reason: 'quiet-hours' };
  return { deliver: true };
}

export async function loadUserNotificationPreferences(userId: string): Promise<UserNotificationPreferences | null> {
  const document = await getOne<SettingsDocument>(COLLECTIONS.SETTINGS, getUserSettingsDocId(userId, 'notifications'));
  const stored = document?.data && typeof document.data === 'object'
    ? (document.data as unknown as Record<string, unknown>).notificationPreferences
    : undefined;
  return stored && typeof stored === 'object' ? stored as UserNotificationPreferences : null;
}

function notificationHash(companyId: string, recipientUserId: string, type: NotificationType, entityId: string) {
  return `${companyId}:${recipientUserId}:${type}:${entityId}`;
}

export function resolveNotificationCompanyId(companyId?: string) {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return companyId || resolveWriteCompanyId() || '';
}

export async function getNotificationUsersByRoles(roles: string[], companyId = resolveNotificationCompanyId()) {
  if (roles.length === 0 || !companyId) return [];
  try {
    const roleSet = new Set(roles.map((role) => role.toLowerCase()));
    const snap = await getDocs(query(collection(db, COLLECTIONS.USERS), where('companyId', '==', companyId), limit(500)));
    return snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as NotificationRecipient))
      .filter((user) => {
        const role = String(user.role || '').toLowerCase();
        return !isHiddenOwnerRecord(user) && roleSet.has(role) && user.isDeleted !== true && user.status !== 'Inactive';
      });
  } catch (error) {
    console.warn('Notification recipient lookup failed', error);
    return [];
  }
}

export async function notifyUsersOnce(
  users: Array<{ id: string }>,
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string,
  companyId = resolveNotificationCompanyId(),
  projectId?: string
) {
  const seen = new Set<string>();
  await Promise.all(users.map(async (user) => {
    if (!user.id || seen.has(user.id)) return;
    seen.add(user.id);
    // Skip if current user is the recipient and is the one performing the action (prevent self-notifications)
    const currentUser = useAppStore.getState().user;
    if (user.id === currentUser?.id) return;
    await sendNotification(user.id, type, title, body, entityType, entityId, companyId, projectId);
  }));
}

export async function notifyRoleUsers(
  roles: string[],
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string,
  companyId = resolveNotificationCompanyId(),
  projectId?: string
) {
  const users = await getNotificationUsersByRoles(roles, companyId);
  await notifyUsersOnce(users, type, title, body, entityType, entityId, companyId, projectId);
}

export async function sendNotification(
  recipientUserId: string,
  type: NotificationType,
  title: string,
  body: string,
  entityType: string,
  entityId: string,
  companyId: string,
  projectId?: string
): Promise<void> {
  try {
    if (!recipientUserId || !companyId) return;

    // Preferences are evaluated per recipient before any notification query or
    // write. Missing preferences and lookup failures deliberately fail open.
    try {
      const preferences = await loadUserNotificationPreferences(recipientUserId);
      if (preferences) {
        const decision = evaluateNotificationPreferences(preferences, type, entityType);
        if (!decision.deliver) {
          trackNotificationMetric('suppressed_by_prefs', { recipientUserId, type, entityId, reason: decision.reason });
          return;
        }
      }
    } catch (preferenceError) {
      console.warn('Notification preference lookup failed; delivering notification', preferenceError);
    }

    const currentUser = useAppStore.getState().user;
    const createdBy = currentUser?.id || 'system';
    const visibleTo = Array.from(new Set([recipientUserId, createdBy].filter(Boolean)));
    const hash = notificationHash(companyId, recipientUserId, type, entityId);
    const cutoff = Date.now() - (2 * 60 * 1000);
    // Dedup lookup. Must be provably scoped by the security rules or the read
    // is rejected (PERMISSION_DENIED): a bare `notificationHash ==` query can
    // never satisfy canSeeNotification (no tenant/creator anchor) and silently
    // aborted EVERY notification creation. Scope by companyId + createdBy —
    // the actor's OWN notifications, provable via the same equality branches
    // the list query uses — and FAIL OPEN: if the lookup cannot run for any
    // reason, deliver the notification rather than silently dropping it.
    const existing = await getDocs(query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('companyId', '==', companyId),
      where('createdBy', '==', createdBy),
      where('notificationHash', '==', hash),
      limit(5)
    )).catch(() => null);
    const duplicate = existing?.docs.some((docSnap) => {
      const value = docSnap.data().createdAt;
      const millis = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate().getTime()
        : value && typeof value === 'object' && 'seconds' in value
          ? Number(value.seconds) * 1000
          : value ? new Date(String(value)).getTime() : 0;
      return millis >= cutoff;
    });
    if (duplicate) {
      trackNotificationMetric('deduplicated', { recipientUserId, type, entityId });
      return;
    }
    const id = genId.generic('NTF');
    await createDocWithId(COLLECTIONS.NOTIFICATIONS, id, {
      id,
      companyId,
      recipientUserId,
      type,
      title,
      body,
      entityType,
      entityId,
      ...(projectId ? { projectId } : {}),
      createdBy,
      createdByName: currentUser?.name || '',
      visibleTo,
      notificationHash: hash,
      isRead: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDeleted: false,
    });
    trackNotificationMetric('created', { recipientUserId, type, entityId });
    trackNotificationMetric('delivered', { recipientUserId, type, entityId });
  } catch (error) {
    trackNotificationMetric('failed', { recipientUserId, type, entityId });
    console.warn('Notification send failed', error);
  }
}
