/**
 * ModuleCard — Single module tile in the App tab's ModuleGrid
 *
 * Renders a compact tappable card with icon + label for each module.
 * Passes the route to AppWorkspace for navigation so ContextResolver
 * is updated before the route change.
 *
 * Per Foundation doc:
 * - Icon + label + optional small badge
 * - min 44×44px tap target
 * - hidden entirely if role lacks `view` permission
 */

import React from 'react';
import { cn } from '../../../utils/cn';

export interface ModuleCardProps {
  label: string;
  icon: React.ReactNode;
  route: string;
  count?: number;
  onSelect: (route: string) => void;
}

const COLORS = [
  { bg: 'bg-indigo-50 dark:bg-indigo-950/40', icon: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800/60' },
  { bg: 'bg-teal-50 dark:bg-teal-950/40',     icon: 'text-teal-600 dark:text-teal-400',     border: 'border-teal-200 dark:border-teal-800/60' },
  { bg: 'bg-blue-50 dark:bg-blue-950/40',     icon: 'text-blue-600 dark:text-blue-400',     border: 'border-blue-200 dark:border-blue-800/60' },
  { bg: 'bg-amber-50 dark:bg-amber-950/40',   icon: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-200 dark:border-amber-800/60' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800/60' },
  { bg: 'bg-purple-50 dark:bg-purple-950/40', icon: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800/60' },
  { bg: 'bg-rose-50 dark:bg-rose-950/40',     icon: 'text-rose-600 dark:text-rose-400',     border: 'border-rose-200 dark:border-rose-800/60' },
  { bg: 'bg-orange-50 dark:bg-orange-950/40', icon: 'text-orange-600 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800/60' },
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const ModuleCard = React.memo(function ModuleCard({
  label, icon, route, count, onSelect,
}: ModuleCardProps) {
  // Deterministic color assignment based on label
  const c = COLORS[hashCode(label) % COLORS.length];

  return (
    <button
      type="button"
      onClick={() => onSelect(route)}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5',
        'min-h-[76px] min-w-0 w-full',
        'p-2.5 rounded-xl',
        'border border-[var(--color-border)]',
        'bg-[var(--color-bg-sunken)] hover:bg-[var(--color-surface-hover)]',
        'transition-all duration-150 active:scale-[0.97]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
        'relative',
      )}
    >
      {/* Color icon container with theme-aware styling */}
      <div className={cn(
        'p-1.5 rounded-lg',
        'border', c.border, c.bg, c.icon,
      )}>
        {icon}
      </div>

      <span className="text-[11px] font-semibold text-[var(--color-text)] text-center leading-tight line-clamp-1">
        {label}
      </span>

      {count !== undefined && count > 0 && (
        <span className={cn(
          'absolute -top-1 -right-1',
          'text-[10px] font-bold tabular-nums',
          'min-w-[18px] h-[18px] px-1',
          'flex items-center justify-center',
          'rounded-full',
          c.icon, c.bg, `border ${c.border}`,
        )}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
});

export default ModuleCard;
