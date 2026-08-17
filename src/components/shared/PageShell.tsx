/**
 * PageShell — Standardized page layout wrapper
 *
 * Provides consistent:
 *   - Page header with icon, title, subtitle, actions
 *   - KPI tiles row
 *   - Main card content area
 *   - Loading/empty/error states
 *   - Responsive spacing
 *
 * Phase 1A: KpisSection now uses .kpi-grid-N CSS utility classes
 * from index.css instead of Tailwind grid-cols-* strings. This
 * ensures consistent responsive breakpoints across all pages.
 *
 * Usage:
 *   <PageShell title="Customers" subtitle="Home / Sales" icon={<Building2/>} actions={<Button>Add</Button>}>
 *     <PageShell.Kpis cols={4}> ... </PageShell.Kpis>
 *     <PageShell.Content> ... </PageShell.Content>
 *   </PageShell>
 */

import React, { type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { PageHeader } from '../ui/Card';

// ── Sub-components ────────────────────────────────────────────

function KpisSection({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  // Use CSS utility class — see index.css .kpi-grid-N rules
  // This guarantees consistent responsive behavior:
  //   2col narrow → 3/4/5/6col on tablet/desktop
  return (
    <div className={cn(`kpi-grid-${cols}`, className)}>
      {children}
    </div>
  );
}

function ContentSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      {children}
    </div>
  );
}

// ── Alert/Banner ─────────────────────────────────────────────

export function AlertBanner({
  message, variant = 'warning',
}: { message: string; variant?: 'warning' | 'danger' | 'info' | 'success' }) {
  const styles = {
    warning: 'bg-[var(--color-warning-light)] border-[var(--color-warning)] text-[var(--color-warning-text)]',
    danger:  'bg-[var(--color-danger-light)] border-[var(--color-danger)] text-[var(--color-danger-text)]',
    info:    'bg-[var(--color-info-light)] border-[var(--color-info)] text-[var(--color-info-text)]',
    success: 'bg-[var(--color-success-light)] border-[var(--color-success)] text-[var(--color-success-text)]',
  };
  const icons = { warning: '⚠️', danger: '🚫', info: 'ℹ️', success: '✅' };

  return (
    <div className={cn('flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium', styles[variant])}>
      <span>{icons[variant]}</span>
      <span>{message}</span>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────

interface PageShellProps {
  title:       string;
  subtitle?:   string;
  icon?:       ReactNode;
  actions?:    ReactNode;
  children:    ReactNode;
  className?:  string;
}

function PageShellRoot({ title, subtitle, icon, actions, children, className }: PageShellProps) {
  return (
    <div className={cn('space-y-5 animate-fadeIn', className)}>
      <PageHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      {children}
    </div>
  );
}

export const PageShell = Object.assign(PageShellRoot, {
  Kpis:    KpisSection,
  Content: ContentSection,
});

export default PageShell;
