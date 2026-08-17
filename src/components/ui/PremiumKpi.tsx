import { cn } from '../../utils/cn';
import React from 'react';

/**
 * PremiumKpi — Premium clickable KPI card.
 *
 * This is the single production variant used by Leads and all workspace pages.
 * No experimental or alternate visual languages exist here.
 *
 * Layout:
 *   ┌──────────────────────┬──────┐
 *   │  value (large)       │ icon │
 *   │  description         │      │
 *   │                      │      │
 *   │  LABEL               │      │
 *   │  trend               │      │
 *   └──────────────────────┴──────┘
 */

const SC: Record<string, [string, string]> = {
  indigo: ['bg-[var(--color-primary-light)] text-[var(--color-primary-text)]', 'ring-[var(--color-primary-muted)]'],
  emerald: ['bg-[var(--color-success-light)] text-[var(--color-success-text)]', 'ring-[var(--color-success)]'],
  amber: ['bg-[var(--color-warning-light)] text-[var(--color-warning-text)]', 'ring-[var(--color-warning)]'],
  red: ['bg-[var(--color-danger-light)] text-[var(--color-danger-text)]', 'ring-[var(--color-danger)]'],
  blue: ['bg-[var(--color-info-light)] text-[var(--color-info-text)]', 'ring-[var(--color-info)]'],
  purple: ['bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', 'ring-purple-200 dark:ring-purple-700'],
  teal: ['bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400', 'ring-teal-200 dark:ring-teal-700'],
  orange: ['bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400', 'ring-orange-200 dark:ring-orange-700'],
  pink: ['bg-pink-50 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400', 'ring-pink-200 dark:ring-pink-700'],
};

export function PremiumKpi({
  label,
  value,
  icon,
  description,
  trend,
  onClick,
  active,
  color = 'indigo',
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  description?: string;
  trend?: { value: number; label?: string };
  onClick?: () => void;
  active?: boolean;
  color?: string;
}) {
  const isActive = active && onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'relative flex flex-col gap-1.5 rounded-xl border p-3.5 text-left overflow-hidden',
        'transition-all duration-200 ease-out transform-gpu will-change-transform',
        'bg-[var(--color-surface)]',
        onClick
          ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]'
          : 'cursor-default',
        isActive
          ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)] ring-inset shadow-[0_4px_12px_rgba(0,0,0,0.04)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:shadow-sm',
        'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
      )}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute inset-x-2 top-0 h-1 rounded-full bg-[var(--color-primary)]" />
      )}

      {isActive && (
        <div className="absolute inset-0 rounded-xl bg-[var(--color-primary)] opacity-[0.03] pointer-events-none" />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={cn('text-3xl font-bold leading-tight tabular-nums tracking-tight', isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]')}>
            {value}
          </p>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200',
              isActive
                ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)] ring-2 ring-[var(--color-primary-muted)] scale-105'
                : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
            )}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Label */}
      <p
        className={cn(
          'text-[11px] font-semibold uppercase tracking-[0.06em]',
          isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]',
        )}
      >
        {label}
      </p>

      {/* Trend indicator */}
      {trend && (
        <p
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            trend.value >= 0
              ? 'text-[var(--color-success-text)]'
              : 'text-[var(--color-danger-text)]',
          )}
        >
          <span>{trend.value >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(trend.value)}%</span>
          {trend.label && <span className="text-[var(--color-text-muted)]">{trend.label}</span>}
        </p>
      )}
    </button>
  );
}
