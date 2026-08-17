/**
 * MobilePartnerShell — Partner-specific mobile shell
 *
 * Similar to MobileShell but with partner-specific bottom navigation:
 *   Home | Leads | Wallet | Profile
 *
 * Reuses MobileTopBar for the top bar and ContextResolverProvider.
 * The bottom nav uses partner-specific tabs that navigate to /partner/* routes.
 */

import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Home, Target, Wallet, User } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { ContextResolverProvider } from '../context/ContextResolver';
import MobileTopBar from '../shell/MobileTopBar';
import { OfflineBanner } from '../shared/OfflineBanner';

interface PartnerTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
}

const PARTNER_TABS: PartnerTab[] = [
  { id: 'home',     label: 'Home',     icon: <Home className="h-5 w-5" />,     path: '/partner' },
  { id: 'leads',    label: 'Leads',    icon: <Target className="h-5 w-5" />,    path: '/partner/leads' },
  { id: 'wallet',   label: 'Wallet',   icon: <Wallet className="h-5 w-5" />,   path: '/partner/wallet' },
  { id: 'notifications', label: 'Alerts', icon: <Bell className="h-5 w-5" />,  path: '/partner/notifications' },
  { id: 'profile',      label: 'Profile', icon: <User className="h-5 w-5" />,     path: '/partner/profile' },
];

export function MobilePartnerShell() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = PARTNER_TABS.find(
    (tab) => tab.path !== '/partner' && location.pathname.startsWith(tab.path),
  )?.id || (location.pathname === '/partner' || location.pathname.startsWith('/partner/dashboard') ? 'home' : undefined);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[var(--color-bg)]">
      <ContextResolverProvider>
        {/* Offline Indicator */}
        <OfflineBanner />

        {/* Top Bar */}
        <MobileTopBar />

        {/* Scrollable Content */}
        <main className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden',
          'px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]',
          'overscroll-behavior-y-contain scroll-smooth',
        )}>
          <Outlet />
        </main>

        {/* Bottom Navigation — Partner-specific */}
        <nav
          className={cn(
            'fixed inset-x-0 bottom-0 h-16 shrink-0 z-30',
            'flex items-center justify-around',
            'bg-[var(--color-surface)] border-t border-[var(--color-border)]',
            'safe-area-bottom',
          )}
          role="tablist"
          aria-label="Partner mobile navigation"
        >
          {PARTNER_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={tab.label}
                onClick={() => navigate(tab.path)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1',
                  'min-w-[64px] min-h-[48px] px-3 py-1.5',
                  'relative transition-colors duration-150',
                  isActive
                    ? 'text-[var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                )}
              >
                {isActive && (
                  <span className="absolute -top-px left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-primary)]" />
                )}
                {tab.icon}
                <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </ContextResolverProvider>
    </div>
  );
}

export default MobilePartnerShell;
