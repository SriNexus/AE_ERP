/**
 * MobileShell — Outer frame for the mobile experience
 *
 * Composes:
 *   - MobileTopBar (sticky top)
 *   - Scrollable content area (children / Outlet)
 *   - MobileBottomNav (sticky bottom, self-manages active tab)
 *
 * This component is the mobile equivalent of the desktop AppShell.
 * It is conditionally rendered in App.tsx when viewport < 1024px.
 *
 * Context: Wraps all children in ContextResolverProvider so that
 * both the workspace content (Outlet) and MobileBottomNav can
 * access the current module/entity context.
 * The login page is rendered outside MobileShell entirely (in MobileRoutes).
 */

import React, { type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import MobileTopBar from './MobileTopBar';
import MobileBottomNav from './MobileBottomNav';
import { ContextResolverProvider } from '../context/ContextResolver';
import { cn } from '../../../utils/cn';

interface MobileShellProps {
  children?: ReactNode;
}

/**
 * Routes rendered as a true full-screen workspace — no global top bar, no
 * bottom navigation, and the page owns the entire viewport (fixed header +
 * fixed footer + a single scrolling middle). Currently: mobile Lead Details
 * and mobile Customer Details.
 */
function isFullScreenRoute(pathname: string): boolean {
  return /^\/leads\/workspace\//.test(pathname)
    || /^\/customers\/[^/]+$/.test(pathname)
    || /^\/projects\/[^/]+$/.test(pathname)
    || /^\/loan-applications\/[^/]+$/.test(pathname);
}

export function MobileShell({ children }: MobileShellProps) {
  const { pathname } = useLocation();
  const fullScreen = isFullScreenRoute(pathname);

  return (
    <div className={cn('mobile-shell', 'flex flex-col h-dvh w-full overflow-hidden bg-[var(--color-bg)]')}>
      <ContextResolverProvider>
        {/* Top Bar — hidden on full-screen workspace routes */}
        {!fullScreen && <MobileTopBar />}

        {/* Content Area — full-screen routes manage their own header/scroll/
            footer; every other route gets the standard scrolling body. */}
        <main className={cn(
          'mobile-shell__content',
          'flex-1 min-h-0 overflow-x-hidden',
          fullScreen
            ? 'overflow-hidden'
            : 'overflow-y-auto px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] overscroll-behavior-y-contain scroll-smooth',
        )}>
          {children ?? <Outlet />}
        </main>

        {/* Bottom Navigation — hidden on full-screen workspace routes */}
        {!fullScreen && <MobileBottomNav />}
      </ContextResolverProvider>
    </div>
  );
}

export default MobileShell;
