import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, CheckCheck, CreditCard, FileText, Inbox, ListTodo, ShoppingCart, Target, Truck, X } from 'lucide-react';
import type { Notification } from '../../types';
import { NotificationType } from '../../types';
import { toMillis } from '../../hooks/useNotifications';
import { getNotificationRoute } from '../../lib/notificationRoutes';
import { notificationErrorMessage } from '../../lib/notificationErrors';

type Props = {
  notifications: Notification[];
  unreadCount: number;
  isLoading?: boolean;
  error?: string | null;
  onMarkRead: (id: string) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  onClose: () => void;
  /** fill: stretch the content to fill a full-height container (drawer mode) */
  fill?: boolean;
  /** showClose: render an inline X close control in the header */
  showClose?: boolean;
};

function relativeTime(value: unknown) {
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

function LoadingState() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[var(--color-bg-sunken)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--color-bg-sunken)]" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-[var(--color-bg-sunken)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Inbox className="h-9 w-9 text-[var(--color-text-disabled)]" />
      <p className="text-sm font-medium text-[var(--color-text)]">You're all caught up</p>
      <p className="text-xs text-[var(--color-text-muted)]">No new notifications</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <AlertCircle className="h-9 w-9 text-[var(--color-danger)]" />
      <p className="text-sm font-medium text-[var(--color-text)]">Couldn't load notifications</p>
      <p className="text-xs text-[var(--color-text-muted)]">{notificationErrorMessage(message)}</p>
    </div>
  );
}

/**
 * NotificationPanelContent — single source of truth for the notification list
 * behavior (loading / error / empty / rows / mark-read / view-all). It is
 * intentionally presentation-agnostic: NotificationPanel wraps it in the
 * dropdown container (desktop partner portal + mobile sheet), while
 * NotificationDrawer renders it in a right-side drawer. ALL notification
 * business logic lives in the shared useNotifications hook.
 */
export function NotificationPanelContent({
  notifications,
  unreadCount,
  isLoading,
  error,
  onMarkRead,
  onMarkAllRead,
  onClose,
  fill = false,
  showClose = false,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col' : ''}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 shrink-0">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">Notifications</p>
          <p className="text-xs text-[var(--color-text-muted)]">{unreadCount} unread</p>
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className={fill ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-96 overflow-y-auto'}>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : notifications.length === 0 ? (
          <EmptyState />
        ) : notifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            onClick={async () => {
              await onMarkRead(notification.id);
              navigate(getNotificationRoute(notification.entityType, notification.entityId, notification.projectId), { state: { entityId: notification.entityId } });
              onClose();
            }}
            className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${!notification.isRead ? 'bg-[var(--color-primary-light)]' : ''}`}
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
              {iconFor(notification.type)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--color-text)]">{notification.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-[var(--color-text-muted)]">{notification.body}</span>
              <span className="mt-1 block text-[11px] text-[var(--color-text-disabled)]">{relativeTime(notification.createdAt)}</span>
            </span>
            {!notification.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />}
          </button>
        ))}
      </div>
      {notifications.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-2.5 relative z-10 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              navigate('/notifications');
            }}
            className="w-full rounded-lg py-2 text-center text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * NotificationPanel — dropdown presentation of the shared notification content.
 * Used by the desktop Partner Portal and by MobileNotificationSheet (which
 * overrides positioning via CSS to make it a full-screen mobile view).
 */
export function NotificationPanel(props: Props) {
  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)]"
    >
      <NotificationPanelContent {...props} />
    </div>
  );
}
