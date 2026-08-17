/**
 * AppShell — Enterprise layout container
 * Composable compound component.
 *
 * Fix: AppShell.Topbar is now a transparent passthrough <div> wrapper.
 * TopBar owns its own layout, height, padding, flex, sticky positioning,
 * and border. The outer wrapper must not impose its own flex/height/padding
 * on top of TopBar, which would cause the inner <header> to compress as a
 * non-full-width flex child.
 */

import React, { type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '../../utils/cn';

interface RootProps {
  children: ReactNode;
  className?: string;
}

function AppShellSidebar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('app-shell__sidebar', className)}>{children}</div>;
}

/**
 * Topbar wrapper — transparent passthrough only.
 * TopBar component owns all its own layout: height, flex, padding, sticky,
 * border, backdrop. This wrapper must NOT add any competing styles.
 */
function AppShellTopbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('app-shell__topbar-wrapper', className)}>{children}</div>;
}

function AppShellMain({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <main className={cn('app-shell__main animate-fadeIn', className)}>
      {children ?? <Outlet />}
    </main>
  );
}

function AppShellRoot({ children, className }: RootProps) {
  return (
    <div className={cn('app-shell', className)}>
      {children}
    </div>
  );
}

export const AppShell = Object.assign(AppShellRoot, {
  Sidebar:  AppShellSidebar,
  Topbar:   AppShellTopbar,
  Main:     AppShellMain,
});

export default AppShell;
