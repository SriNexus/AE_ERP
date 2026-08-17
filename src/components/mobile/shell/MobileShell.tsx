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
import { Outlet } from 'react-router-dom';
import MobileTopBar from './MobileTopBar';
import MobileBottomNav from './MobileBottomNav';
import { ContextResolverProvider } from '../context/ContextResolver';
import { cn } from '../../../utils/cn';

interface MobileShellProps {
  children?: ReactNode;
}

export function MobileShell({ children }: MobileShellProps) {
  return (
    <div className={cn('mobile-shell', 'flex flex-col h-screen w-full overflow-hidden bg-[var(--color-bg)]')}>
      <ContextResolverProvider>
        {/* Top Bar */}
        <MobileTopBar />

        {/* Scrollable Content Area */}
        <main className={cn(
          'mobile-shell__content',
          'flex-1 overflow-y-auto overflow-x-hidden',
          'px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]',
          'overscroll-behavior-y-contain',
          'scroll-smooth',
        )}>
          {children ?? <Outlet />}
        </main>

        {/* Bottom Navigation */}
        <MobileBottomNav />
      </ContextResolverProvider>
    </div>
  );
}

export default MobileShell;
