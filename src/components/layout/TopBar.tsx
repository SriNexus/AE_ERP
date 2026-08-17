/**
 * TopBar — sticky app topbar
 * Phase P1: Full semantic token compliance. No raw gray/white hardcodes.
 */

import { useState, useCallback, useEffect } from 'react';
import { Bell, Maximize2, Minimize2 } from 'lucide-react';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { GlobalSearch } from '../../features/search/components/GlobalSearch';
import { NotificationDrawer } from '../shared/NotificationDrawer';
import { useNotifications } from '../../hooks/useNotifications';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { useAppStore } from '../../store/useAppStore';
import { isCanonicalDemoIdentity } from '../../lib/demoCapabilityPolicy';

export function TopBar() {
  const [activeDropdown, setActiveDropdown] = useState<'user' | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { notifications, isLoading, error, unreadCount, markAsRead, markAllRead } = useNotifications();
  const user = useAppStore((state) => state.user);
  const isDemoMode = isCanonicalDemoIdentity(user || undefined);

  const toggleNotif = useCallback(() => {
    setNotifOpen((v) => !v);
    setActiveDropdown(null);
  }, []);
  const toggleUser = useCallback(() => {
    setActiveDropdown((v) => (v === 'user' ? null : 'user'));
    setNotifOpen(false);
  }, []);
  const closeAll = useCallback(() => {
    setActiveDropdown(null);
    setNotifOpen(false);
  }, []);

  // Escape dismisses the user menu. The notification drawer owns its own
  // Escape handling so its slide-out animation plays fully.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveDropdown(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Full Screen toggle — keeps the button in sync with the actual browser
  // state (including exit via the Esc key or browser controls), which fire
  // the 'fullscreenchange' event.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  return (
    <header
      className={[
        'h-14 shrink-0 z-20',
        'sticky top-0',
        'flex items-center gap-1.5 px-3 sm:gap-3 sm:px-4',
        'bg-[var(--color-topbar-bg)]',
        'backdrop-blur-md',
        'border-b border-[var(--color-topbar-border)]',
      ].join(' ')}
    >
      <Breadcrumbs />

      {isDemoMode && (
        <div className="ml-2 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold rounded">
          ✨ Demo Mode
        </div>
      )}

      <div className="flex-1 min-w-0" />

      <GlobalSearch />

      <button
        onClick={toggleNotif}
        aria-label="Notifications"
        type="button"
        className={[
          'relative rounded-lg p-2 transition-colors',
          'text-[var(--color-text-muted)]',
          'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
          notifOpen ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]' : '',
        ].join(' ')}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-topbar-bg)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <button
        onClick={() => {
          closeAll();
          toggleFullscreen();
        }}
        aria-label={isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
        title={isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
        type="button"
        className={[
          'rounded-lg p-2 transition-colors',
          'text-[var(--color-text-muted)]',
          'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
          isFullscreen ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]' : '',
        ].join(' ')}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>

      <UserMenu open={activeDropdown === 'user'} onToggle={toggleUser} onClose={closeAll} />

      {notifOpen && (
        <NotificationDrawer
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={isLoading}
          error={error}
          onMarkRead={markAsRead}
          onMarkAllRead={markAllRead}
        />
      )}
    </header>
  );
}

export default TopBar;
