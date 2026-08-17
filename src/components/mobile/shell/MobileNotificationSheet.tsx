/**
 * MobileNotificationSheet — Full-screen notification view for mobile
 *
 * Thin mobile wrapper that renders the EXISTING desktop NotificationPanel
 * component inside a full-screen container. CSS overrides are used to
 * convert the dropdown-style NotificationPanel into a native-feeling
 * mobile full-screen view — the component itself is not modified.
 *
 * ALL business logic comes from useNotifications (same as desktop).
 * NO notification components or logic duplicated.
 */

import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNotifications } from '../../../hooks/useNotifications';
import { NotificationPanel } from '../../shared/NotificationPanel';
import { cn } from '../../../utils/cn';

interface MobileNotificationSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNotificationSheet({ open, onClose }: MobileNotificationSheetProps) {
  const {
    notifications, isLoading, unreadCount,
    markAsRead, markAllRead,
  } = useNotifications();

  // Intercept popstate (back button) to close
  useEffect(() => {
    if (!open) return;
    const handler = () => { onClose(); };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open, onClose]);

  // Push a state so back button can close the sheet
  useEffect(() => {
    if (!open) return;
    window.history.pushState(null, '', window.location.href);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]">
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--color-border-subtle)] shrink-0 safe-area-top bg-[var(--color-surface)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className={cn(
            'rounded-lg p-2',
            'text-[var(--color-text-muted)]',
            'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
            'transition-colors -ml-1',
          )}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-bold text-[var(--color-text)]">Notifications</h1>
      </div>

      {/* NotificationPanel rendered inside an overriding container.
          The [&>*] classes override NotificationPanel's absolute positioning
          to make it fill the available space like a native screen. */}
      <div className={cn(
        'flex-1 overflow-y-auto',
        // Override NotificationPanel's root container: make it static,
        // full-width, no shadow, no border, no rounded corners.
        '[&>div]:!static [&>div]:!w-full [&>div]:!shadow-none [&>div]:!border-0 [&>div]:!rounded-none',
        // Override the notification list max-height to fill space
        '[&_div:has(>.max-h-96)]:!max-h-none',
      )}>
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={isLoading}
          onMarkRead={markAsRead}
          onMarkAllRead={markAllRead}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

export default MobileNotificationSheet;
