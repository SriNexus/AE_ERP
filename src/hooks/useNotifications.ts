import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { COLLECTIONS, db, firebaseEnv } from '../lib/firebase';
import { fromDoc, getAll, getOne, resolveWriteCompanyId, updateDocById } from '../lib/firestore';
import { useAppStore } from '../store/useAppStore';
import type { Notification } from '../types';
import { trackNotificationMetric } from '../lib/notificationMetrics';
import { buildNotificationQuery } from '../lib/notificationQuery';

type NotificationState = {
  notifications: Notification[];
  isLoading: boolean;
  error: string | null;
  lastSyncAt: string | null;
};

type ListenerContext = {
  key: string;
  companyId: string;
  userId: string;
  isAdmin: boolean;
};

type Listener = () => void;

const DEFAULT_STATE: NotificationState = {
  notifications: [],
  isLoading: true,
  error: null,
  lastSyncAt: null,
};

let state: NotificationState = DEFAULT_STATE;
let activeContext: ListenerContext | null = null;
let unsubscribeSnapshot: Unsubscribe | null = null;
const listeners = new Set<Listener>();

function isAdminRole(role?: string) {
  return role === 'Admin' || role === 'Director';
}

function sortNotifications(rows: Notification[]) {
  return [...rows].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

function visibleTo(notification: Notification, userId: string, isAdmin: boolean) {
  if (isAdmin) return true;
  const visible = Array.isArray(notification.visibleTo) ? notification.visibleTo : [];
  return notification.recipientUserId === userId || notification.createdBy === userId || visible.includes(userId);
}

function setState(next: Partial<NotificationState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function optimisticPatch(id: string, delta: Partial<Notification>) {
  setState({
    notifications: state.notifications
      .map((notification) => notification.id === id ? { ...notification, ...delta } : notification)
      .filter((notification) => notification.isDeleted !== true),
  });
}

function optimisticPatchMany(ids: string[], delta: Partial<Notification>) {
  const idSet = new Set(ids);
  setState({
    notifications: state.notifications
      .map((notification) => idSet.has(notification.id) ? { ...notification, ...delta } : notification)
      .filter((notification) => notification.isDeleted !== true),
  });
}

function startSharedListener(context: ListenerContext) {
  if (activeContext?.key === context.key && unsubscribeSnapshot) return;

  unsubscribeSnapshot?.();
  activeContext = context;
  state = { ...DEFAULT_STATE, notifications: [] };

  if (!firebaseEnv.isConfigured) {
    void getAll<Notification>(COLLECTIONS.NOTIFICATIONS)
      .then((rows) => {
        setState({
          notifications: sortNotifications(rows.filter((notification) => (
            notification.companyId === context.companyId
            && notification.isDeleted !== true
            && visibleTo(notification, context.userId, context.isAdmin)
          ))),
          isLoading: false,
          error: null,
          lastSyncAt: new Date().toISOString(),
        });
      })
      .catch((error) => {
        console.warn('[notifications] fallback load failed', error);
        setState({ isLoading: false, error: error.message });
      });
    unsubscribeSnapshot = () => undefined;
    return;
  }

  unsubscribeSnapshot = onSnapshot(
    buildNotificationQuery(collection(db, COLLECTIONS.NOTIFICATIONS), context),
    (snapshot) => {
      const rows = snapshot.docs
        .map((snap) => fromDoc<Notification>(snap))
        .filter((notification) => notification.isDeleted !== true)
        .filter((notification) => visibleTo(notification, context.userId, context.isAdmin));

      setState({
        notifications: sortNotifications(rows),
        isLoading: false,
        error: null,
        lastSyncAt: new Date().toISOString(),
      });
    },
    (error) => {
      // Raw error is logged for diagnosis; the UI renders a user-safe message
      // via notificationErrorMessage (src/lib/notificationErrors.ts).
      console.warn('[notifications] snapshot listener failed', error);
      setState({ isLoading: false, error: error.message });
    }
  );
}

function stopSharedListenerIfUnused() {
  if (listeners.size > 0) return;
  unsubscribeSnapshot?.();
  unsubscribeSnapshot = null;
  activeContext = null;
  state = DEFAULT_STATE;
}

function resolveCompanyId() {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

export function useNotifications() {
  const activeCompanyId = useAppStore((store) => store.activeCompanyId);
  const company = useAppStore((store) => store.company);
  const user = useAppStore((store) => store.user);
  const [localState, setLocalState] = useState(state);

  const companyId = useMemo(() => {
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    return resolveWriteCompanyId();
  }, [activeCompanyId, company?.id, user?.companyId]);

  useEffect(() => {
    const listener = () => setLocalState(state);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
      stopSharedListenerIfUnused();
    };
  }, []);

  useEffect(() => {
    if (!companyId || !user?.id) {
      setState({ notifications: [], isLoading: false, error: null, lastSyncAt: null });
      return;
    }

    startSharedListener({
      key: `${companyId}:${user.id}:${isAdminRole(user.role)}`,
      companyId,
      userId: user.id,
      isAdmin: isAdminRole(user.role),
    });
  }, [companyId, user?.id, user?.role]);

  const unreadCount = useMemo(
    () => localState.notifications.filter((notification) => !notification.isRead).length,
    [localState.notifications]
  );

  const markAsRead = useCallback(async (id: string) => {
    const notification = state.notifications.find((item) => item.id === id);
    if (notification?.isRead) return;
    optimisticPatch(id, { isRead: true, readAt: new Date().toISOString() });
    try {
      await updateDocById(COLLECTIONS.NOTIFICATIONS, id, { isRead: true, readAt: new Date().toISOString() });
      trackNotificationMetric('read', { id });
    } catch (error) {
      if (notification) optimisticPatch(id, notification);
      console.warn('Mark notification read failed', error);
    }
  }, []);

  const markAsUnread = useCallback(async (id: string) => {
    const notification = state.notifications.find((item) => item.id === id);
    if (!notification || !notification.isRead) return;
    optimisticPatch(id, { isRead: false, readAt: null });
    try {
      await updateDocById(COLLECTIONS.NOTIFICATIONS, id, { isRead: false, readAt: null });
    } catch (error) {
      optimisticPatch(id, notification);
      console.warn('Mark notification unread failed', error);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = state.notifications.filter((notification) => !notification.isRead);
    if (!unread.length) return;
    const ids = unread.map((notification) => notification.id);
    optimisticPatchMany(ids, { isRead: true, readAt: new Date().toISOString() });
    try {
      await Promise.all(unread.map((notification) => (
        updateDocById(COLLECTIONS.NOTIFICATIONS, notification.id, { isRead: true, readAt: new Date().toISOString() })
      )));
      unread.forEach((notification) => trackNotificationMetric('read', { id: notification.id }));
    } catch (error) {
      optimisticPatchMany(ids, { isRead: false, readAt: null });
      console.warn('Mark all notifications read failed', error);
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    const notification = state.notifications.find((item) => item.id === id);
    optimisticPatch(id, { isDeleted: true, deletedAt: new Date().toISOString() });
    try {
      await updateDocById(COLLECTIONS.NOTIFICATIONS, id, {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: useAppStore.getState().user?.id || 'system',
      });
    } catch (error) {
      if (notification) {
        setState({ notifications: sortNotifications([...state.notifications, notification]) });
      }
      console.warn('Delete notification failed', error);
    }
  }, []);

  const bulkMarkRead = useCallback(async (ids: string[]) => {
    const selected = state.notifications.filter((notification) => ids.includes(notification.id) && !notification.isRead);
    if (!selected.length) return;
    optimisticPatchMany(selected.map((notification) => notification.id), { isRead: true, readAt: new Date().toISOString() });
    await Promise.all(selected.map((notification) => (
      updateDocById(COLLECTIONS.NOTIFICATIONS, notification.id, { isRead: true, readAt: new Date().toISOString() })
    )));
  }, []);

  return {
    notifications: localState.notifications,
    isLoading: localState.isLoading,
    error: localState.error,
    lastSyncAt: localState.lastSyncAt,
    unreadCount,
    markAsRead,
    markAsUnread,
    markAllRead,
    deleteNotification,
    bulkMarkRead,
    loadMore: async () => undefined,
    hasMore: false,
    loadingMore: false,
  };
}

export function useNotification(id?: string) {
  const { notifications, isLoading, error, markAsRead, markAsUnread, deleteNotification } = useNotifications();
  const [directNotification, setDirectNotification] = useState<Notification | null>(null);
  const [directLoading, setDirectLoading] = useState(false);
  const notification = useMemo(() => notifications.find((item) => item.id === id) || null, [id, notifications]);

  useEffect(() => {
    if (!id || notification || isLoading) {
      setDirectNotification(null);
      return;
    }

    let cancelled = false;
    setDirectLoading(true);
    const loadDirect = firebaseEnv.isConfigured
      ? getDoc(doc(db, COLLECTIONS.NOTIFICATIONS, id)).then((snapshot) => {
          if (!snapshot.exists()) return null;
          return fromDoc<Notification>(snapshot);
        })
      : getOne<Notification>(COLLECTIONS.NOTIFICATIONS, id);

    loadDirect
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot) {
          setDirectNotification(null);
          return;
        }
        const user = useAppStore.getState().user;
        setDirectNotification(snapshot.isDeleted || !user || !visibleTo(snapshot, user.id, isAdminRole(user.role)) ? null : snapshot);
      })
      .catch(() => {
        if (!cancelled) setDirectNotification(null);
      })
      .finally(() => {
        if (!cancelled) setDirectLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isLoading, notification]);

  return {
    notification: notification || directNotification,
    isLoading: isLoading || directLoading,
    error,
    markAsRead: () => id ? markAsRead(id) : Promise.resolve(),
    markAsUnread: () => id ? markAsUnread(id) : Promise.resolve(),
    deleteNotification: () => id ? deleteNotification(id) : Promise.resolve(),
  };
}

export function getNotificationCompanyId() {
  return resolveCompanyId();
}

// ═══════════════════════════════════════════════════════════
//  Test support — exported only for module-level contract tests
//  These are not part of the public API and may change without notice.
// ═══════════════════════════════════════════════════════════

// Test-only exports for verifying the shared listener lifecycle contract
export const __test__ = {
  getListeners: () => listeners,
  getActiveContext: () => activeContext,
  isUnsubscribed: () => unsubscribeSnapshot === null,
  triggerSetState: (next: Partial<NotificationState>) => setState(next),
};

export function toMillis(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value && typeof value === 'object' && 'seconds' in value) return Number(value.seconds) * 1000;
  const parsed = value ? new Date(String(value)).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}
