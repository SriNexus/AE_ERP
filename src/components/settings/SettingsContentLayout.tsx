/**
 * SettingsContentLayout — Content panel wrapper for settings sections.
 * Provides consistent padding, scroll, and container behavior for both Desktop and Mobile.
 */

import React, { type ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface SettingsContentLayoutProps {
  children: ReactNode;
  className?: string;
}

export function SettingsContentLayout({ children, className }: SettingsContentLayoutProps) {
  return (
    <main className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-canvas)] px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5 xl:px-6', className)}>
      {children}
    </main>
  );
}
