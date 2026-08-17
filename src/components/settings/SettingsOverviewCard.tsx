/**
 * SettingsOverviewCard — Dashboard card for the Overview section.
 *
 * Displays a single status/stat item with icon, label, value, and optional status indicator.
 * No backend functionality — purely UI architecture for Phase 2.
 */

import React, { type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export type OverviewStatus = 'configured' | 'pending' | 'warning' | 'error' | 'info';

interface SettingsOverviewCardProps {
  /** Card label (e.g. "Current Theme") */
  label: string;
  /** Card value (e.g. "Light Mode") */
  value: string;
  /** Icon */
  icon: ReactNode;
  /** Status indicator color */
  status?: OverviewStatus;
  /** Optional click handler */
  onClick?: () => void;
  /** Whether the card represents a configured vs un-configured item */
  isConfigured?: boolean;
}

const STATUS_STYLES: Record<OverviewStatus, string> = {
  configured: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  pending: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  warning: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  info: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800',
};

const STATUS_DOT: Record<OverviewStatus, string> = {
  configured: 'bg-emerald-500',
  pending: 'bg-amber-500',
  warning: 'bg-orange-500',
  error: 'bg-red-500',
  info: 'bg-indigo-500',
};

export function SettingsOverviewCard({
  label,
  value,
  icon,
  status = 'info',
  onClick,
  isConfigured,
}: SettingsOverviewCardProps) {
  const resolvedStatus: OverviewStatus = isConfigured === undefined
    ? status
    : isConfigured ? 'configured' : 'pending';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-150',
        'hover:shadow-sm hover:-translate-y-0.5',
        onClick && 'cursor-pointer',
        !onClick && 'cursor-default',
        STATUS_STYLES[resolvedStatus],
      )}
    >
      <div className="h-10 w-10 rounded-lg bg-[var(--color-surface)] flex items-center justify-center shrink-0 shadow-sm">
        <span className="text-[var(--color-text-secondary)]">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-sm font-bold text-[var(--color-text)] truncate mt-0.5">
          {value}
        </p>
      </div>
      <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', STATUS_DOT[resolvedStatus])} />
    </button>
  );
}
