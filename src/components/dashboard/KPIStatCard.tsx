/**
 * KPIStatCard — Premium KPI card with trend indicator and skeleton loading.
 * Phase P1: Full semantic token compliance on all themed surfaces/text.
 * VALID palette usage: COLOR_MAP icon pigments, emerald/rose trend pigments.
 *
 * Redesign pass: enterprise card polish (Stripe/HubSpot-style) — spacing,
 * icon placement, number hierarchy, hover/border/shadow/radius, alignment.
 * Props, exports and data contract are unchanged.
 */

import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPIStatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: 'indigo' | 'teal' | 'blue' | 'emerald' | 'amber' | 'purple' | 'orange' | 'rose';
  trend?: number;
  loading?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

// VALID: These are intentional brand-pigment icon containers, not theme surfaces.
// They represent fixed metric category identity and must not be token-ized.
// `top` adds a hairline top accent so each metric reads at a glance without
// resorting to a wash of background color across the card.
const COLOR_MAP = {
  indigo:  { bg: 'bg-indigo-50  dark:bg-indigo-950/40',  icon: 'text-indigo-600  dark:text-indigo-400',  ring: 'ring-indigo-200  dark:ring-indigo-800/60',  top: 'bg-indigo-500'  },
  teal:    { bg: 'bg-teal-50    dark:bg-teal-950/40',    icon: 'text-teal-600    dark:text-teal-400',    ring: 'ring-teal-200    dark:ring-teal-800/60',    top: 'bg-teal-500'    },
  blue:    { bg: 'bg-blue-50    dark:bg-blue-950/40',    icon: 'text-blue-600    dark:text-blue-400',    ring: 'ring-blue-200    dark:ring-blue-800/60',    top: 'bg-blue-500'    },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-200 dark:ring-emerald-800/60', top: 'bg-emerald-500' },
  amber:   { bg: 'bg-amber-50   dark:bg-amber-950/40',   icon: 'text-amber-600   dark:text-amber-400',   ring: 'ring-amber-200   dark:ring-amber-800/60',   top: 'bg-amber-500'   },
  purple:  { bg: 'bg-purple-50  dark:bg-purple-950/40',  icon: 'text-purple-600  dark:text-purple-400',  ring: 'ring-purple-200  dark:ring-purple-800/60',  top: 'bg-purple-500'  },
  orange:  { bg: 'bg-orange-50  dark:bg-orange-950/40',  icon: 'text-orange-600  dark:text-orange-400',  ring: 'ring-orange-200  dark:ring-orange-800/60',  top: 'bg-orange-500'  },
  rose:    { bg: 'bg-rose-50    dark:bg-rose-950/40',    icon: 'text-rose-600    dark:text-rose-400',    ring: 'ring-rose-200    dark:ring-rose-800/60',    top: 'bg-rose-500'    },
};

// Skeleton uses --color-bg-sunken: loading pulse must match dark-mode sunken surface elevation.
function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[var(--color-bg-sunken)] ${className}`} />;
}

export const KPIStatCard = React.memo(function KPIStatCard({
  label, value, sub, icon, color, trend, loading, onClick, compact = false,
}: KPIStatCardProps) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.indigo;
  const valueText = String(value);
  const valueSizeClass = compact
    ? 'text-lg truncate'
    : valueText.length > 9
      ? 'text-[1.35rem]'
      : valueText.length > 7
        ? 'text-[1.5rem]'
        : 'text-[1.75rem]';

  const trendEl = useMemo(() => {
    if (trend === undefined) return null;
    // VALID: emerald-600/rose-500 are fixed status pigments (positive/negative financial trend).
    if (trend > 0) return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
        <TrendingUp className="h-3 w-3" /> +{trend}%
      </span>
    );
    if (trend < 0) return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 text-rose-500 dark:text-rose-400 text-[11px] font-semibold">
        <TrendingDown className="h-3 w-3" /> {trend}%
      </span>
    );
    // Zero trend: neutral, no directional signal — use muted token
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[var(--color-text-muted)] text-[11px] font-semibold">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }, [trend]);

  if (loading) {
    return (
      <div className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] ${compact ? 'p-3 space-y-2 min-h-[108px]' : 'p-4 space-y-3 min-h-[132px]'}`}>
        <div className="flex items-center justify-between">
          <Skeleton className={compact ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-lg'} />
          {!compact && <Skeleton className="h-4 w-14 rounded-full" />}
        </div>
        <Skeleton className={compact ? 'h-5 w-14 mt-1' : 'h-7 w-24 mt-1'} />
        <Skeleton className={compact ? 'h-3 w-12' : 'h-3 w-20'} />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={[
        'relative overflow-hidden bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]',
        compact ? 'p-3 min-h-[108px]' : 'p-4 min-h-[132px]',
        'flex flex-col justify-between',
        'transition-all duration-200 group',
        onClick
          ? 'cursor-pointer hover:shadow-md hover:border-[var(--color-border-strong)] hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]'
          : '',
      ].join(' ')}
    >
      {/* Hairline top accent — quiet per-metric identity cue, not a color wash */}
      <span className={`absolute inset-x-0 top-0 h-0.5 ${c.top} opacity-70`} aria-hidden="true" />

      <div className="flex items-start justify-between gap-2">
        <div className={`${compact ? 'p-1.5' : 'p-2'} rounded-lg ring-1 ${c.bg} ${c.ring} ${c.icon} transition-transform duration-200 ${onClick ? 'group-hover:scale-110' : ''}`}>
          {icon}
        </div>
        {!compact && trendEl}
      </div>

      <div className={compact ? 'mt-2' : 'mt-3'}>
        {/* Primary metric value — highest text hierarchy on this card */}
        <p className={`${valueSizeClass} font-bold text-[var(--color-text)] tabular-nums leading-none whitespace-nowrap`}>
          {value}
        </p>
        {/* Label — subordinate descriptor, muted */}
        <p className={`${compact ? 'text-[11px] leading-tight' : 'text-xs'} font-semibold text-[var(--color-text-muted)] mt-1.5 uppercase tracking-wide`}>
          {label}
        </p>
        {sub && !compact && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{sub}</p>
        )}
      </div>
    </div>
  );
});
