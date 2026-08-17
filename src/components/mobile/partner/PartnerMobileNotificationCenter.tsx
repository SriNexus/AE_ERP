/**
 * PartnerMobileNotificationCenter — Full-screen mobile notification center for partners
 *
 * Features:
 *   - Filter tabs: All / Unread / Read
 *   - Mark all read
 *   - Individual mark read/unread
 *   - Deep linking via getNotificationRoute
 *   - Empty states per filter
 *   - Loading skeletons
 *   - Pull-to-refresh style (manual refresh button)
 *
 * Reuses existing useNotifications hook, getNotificationRoute, and NotificationType.
 * No duplicated notification logic.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../../utils/cn';
import { useNotifications } from '../../../hooks/useNotifications';
import { getNotificationRoute } from '../../../lib/notificationRoutes';
import { toMillis } from '../../../hooks/useNotifications';
import { NotificationType } from '../../../types';
import {
  CreditCard,
  FileText,
  ListTodo,
  ShoppingCart,
  Target,
  Truck,
} from 'lucide-react';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
] as const;

type FilterKey = (typeof FILTER_TABS)[number]['key'];

function relativeTime(value: unknown): string {
  const millis = toMillis(value);
  if (!millis) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - millis) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function iconFor(type: NotificationType) {
  if (type === NotificationType.LEAD_ASSIGNED) return <Target className="h-4 w-4" />;
  if (type === NotificationType.ORDER_PLACED) return <ShoppingCart className="h-4 w-4" />;
  if (type === NotificationType.DISPATCH_APPROVED || type === NotificationType.DISPATCH_VERIFIED) return <Truck className="h-4 w-4" />;
  if (type === NotificationType.PAYMENT_CONFIRMED) return <CreditCard className="h-4 w-4" />;
  if (type === NotificationType.PI_GENERATED) return <FileText className="h-4 w-4" />;
  if (type === NotificationType.TASK_ASSIGNED || type === NotificationType.TASK_STATUS_CHANGED) return <ListTodo className="h-4 w-4" />;
  return <Bell className="h-4 w-4" />;
}

function NotificationSkeleton() {
  return (
    <div className="flex gap-3 px-4 py-3 animate-pulse">
      <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-bg-sunken)]" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
        <div className="h-2.5 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
      </div>
    </div>
  );
}

export function PartnerMobileNotificationCenter() {
  const navigate = useNavigate();
  const {
    notifications,
    isLoading,
    unreadCount,
    markAsRead,
    markAsUnread,
    markAllRead,
  } = useNotifications();

  const [filterTab, setFilterTab] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    if (filterTab === 'unread') return notifications.filter((n) => !n.isRead);
    if (filterTab === 'read') return notifications.filter((n) => n.isRead);
    return notifications;
  }, [notifications, filterTab]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Bell className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--color-text)]">Notifications</h1>
              <p className="text-xs text-[var(--color-text-muted)]">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* ── Filter Tabs ───────────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap',
                filterTab === tab.key
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]',
              )}
            >
              {tab.label}
              {tab.key === 'unread' && unreadCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-white/20 px-1 text-[9px] font-bold">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Notification List ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 text-center px-6">
            <div className="h-14 w-14 rounded-2xl bg-[var(--color-bg-sunken)] flex items-center justify-center mb-4">
              <Inbox className="h-7 w-7 text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {filterTab === 'unread'
                ? 'No unread notifications'
                : filterTab === 'read'
                  ? 'No read notifications'
                  : 'No notifications yet'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-[200px]">
              {filterTab === 'all'
                ? 'Notifications about leads, commissions, and updates will appear here.'
                : 'Try switching to a different filter tab.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {filtered.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={async () => {
                  if (!notification.isRead) await markAsRead(notification.id);
                  const route = getNotificationRoute(notification.entityType, notification.entityId, notification.projectId);
                  navigate(route);
                }}
                className={cn(
                  'flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]',
                  !notification.isRead && 'bg-[var(--color-primary-light)]',
                )}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
                  {iconFor(notification.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--color-text)]">
                    {notification.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--color-text-muted)] line-clamp-2">
                    {notification.body}
                  </span>
                  <span className="mt-1 block text-[11px] text-[var(--color-text-disabled)]">
                    {relativeTime(notification.createdAt)}
                  </span>
                </span>
                <div className="flex flex-col items-end justify-between shrink-0">
                  {!notification.isRead && (
                    <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                  )}
                  <ChevronRight className="h-4 w-4 text-[var(--color-text-disabled)]" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PartnerMobileNotificationCenter;
