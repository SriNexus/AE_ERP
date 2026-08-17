/**
 * PartnerLayout — Simplified layout for the Partner Portal
 *
 * No ERP sidebar. No admin navigation.
 * Includes:
 *   - Top bar with branding, notification bell, user menu
 *   - Horizontal PartnerNav strip
 *   - PageShell-wrapped content area via Outlet
 *   - Responsive container
 *
 * Auth is handled by the parent PartnerPortalLayout wrapper (routes.tsx).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Bell, Plus, Handshake } from 'lucide-react';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { GlobalCreatePopup } from '../shared/GlobalCreatePopup';
import { NotificationPanel } from '../shared/NotificationPanel';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { useNotifications } from '../../hooks/useNotifications';
import { useAppStore } from '../../store/useAppStore';
import { isCanonicalDemoIdentity } from '../../lib/demoCapabilityPolicy';
import { cn } from '../../utils/cn';
import { PartnerNav } from './PartnerNav';

export function PartnerLayout() {
  const [activeDropdown, setActiveDropdown] = useState<'notifications' | 'user' | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { notifications, isLoading, unreadCount, markAsRead, markAllRead } = useNotifications();
  const user = useAppStore((state) => state.user);
  const isDemoMode = isCanonicalDemoIdentity(user || undefined);

  const toggleNotif = useCallback(
    () => setActiveDropdown((v) => (v === 'notifications' ? null : 'notifications')),
    [],
  );
  const toggleUser = useCallback(() => setActiveDropdown((v) => (v === 'user' ? null : 'user')), []);
  const closeAll = useCallback(() => setActiveDropdown(null), []);
  const notifRef = useRef<HTMLDivElement>(null);

  // Outside-click dismissal for the partner notification dropdown (UserMenu's
  // global listener is now scoped to its own open state).
  useEffect(() => {
    if (activeDropdown !== 'notifications') return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeDropdown]);

  const partnerName = user?.name || 'Partner';

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      {/* ── Top Bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1.5 border-b border-[var(--color-topbar-border)] bg-[var(--color-topbar-bg)] px-3 backdrop-blur-md sm:gap-3 sm:px-4">
        {/* Brand / Title */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white">
            <Handshake className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold text-[var(--color-text)]">
            Partner Portal
          </span>
          <span className="hidden text-sm text-[var(--color-text-muted)] sm:inline">
            — {partnerName}
          </span>
        </div>

        {/* Breadcrumbs for page context */}
        <div className="hidden md:flex items-center ml-2">
          <Breadcrumbs />
        </div>

        {/* Demo mode badge */}
        {isDemoMode && (
          <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            ✨ Demo Mode
          </span>
        )}

        <div className="flex-1 min-w-0" />

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={toggleNotif}
            aria-label="Notifications"
            type="button"
            className={cn(
              'relative rounded-lg p-2 transition-colors',
              'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
              activeDropdown === 'notifications' && 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]',
            )}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-topbar-bg)]">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {activeDropdown === 'notifications' && (
            <NotificationPanel
              notifications={notifications}
              unreadCount={unreadCount}
              isLoading={isLoading}
              onMarkRead={markAsRead}
              onMarkAllRead={markAllRead}
              onClose={closeAll}
            />
          )}
        </div>

        {/* Create button */}
        <button
          onClick={() => { closeAll(); setCreateOpen(true); }}
          aria-label="Create"
          type="button"
          className="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* User menu */}
        <UserMenu open={activeDropdown === 'user'} onToggle={toggleUser} onClose={closeAll} />
      </header>

      {/* ── Partner Navigation ──────────────────────────── */}
      <PartnerNav />

      {/* ── Page Content ────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      {/* ── Global Create Popup ─────────────────────────── */}
      <GlobalCreatePopup open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export default PartnerLayout;
