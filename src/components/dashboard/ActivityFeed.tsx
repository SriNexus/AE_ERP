/**
 * ActivityFeed — Compact real-time activity stream.
 * Phase P1: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: TYPE_CONFIG pigments (violet/blue/amber), emerald live dot.
 *
 * Redesign pass: icon-badge header (matches every other dashboard panel —
 * TaskPanel, RecentDataTables, DashboardCharts, WorkflowStepper,
 * ProjectsByStageWidget), row spacing polish. Props, data shape, time
 * formatting and navigation targets are unchanged.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, ShoppingCart, Truck, Clock } from 'lucide-react';

interface ActivityItem {
  id: string;
  _type: 'lead' | 'order' | 'dispatch';
  name?: string;
  customer?: string;
  company?: string;
  status?: string;
  total?: number;
  created_at?: any;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  loading?: boolean;
  currencySymbol?: string;
}

function timeAgo(val: any): string {
  if (!val) return '—';
  const d = val?.toDate?.() ?? new Date(val);
  if (isNaN(d.getTime())) return '—';
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      {/* bg-sunken: correct for skeleton pulse in both light and dark */}
      <div className="h-7 w-7 rounded-lg bg-[var(--color-bg-sunken)] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-32 rounded bg-[var(--color-bg-sunken)]" />
        {/* Secondary line: same surface, reduced opacity for visual depth */}
        <div className="h-2.5 w-20 rounded bg-[var(--color-bg-sunken)] opacity-60" />
      </div>
      <div className="h-3 w-10 rounded bg-[var(--color-bg-sunken)]" />
    </div>
  );
}

// VALID: These are fixed type-identity pigments (violet/blue/amber),
// not theme surfaces. They represent permanent category identity.
const TYPE_CONFIG = {
  lead:     { icon: <Target className="h-3.5 w-3.5" />,      bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-600 dark:text-violet-400', label: 'Lead',     path: '/leads'    },
  order:    { icon: <ShoppingCart className="h-3.5 w-3.5" />, bg: 'bg-blue-100 dark:bg-blue-900/40',     text: 'text-blue-600 dark:text-blue-400',     label: 'Order',    path: '/orders'   },
  dispatch: { icon: <Truck className="h-3.5 w-3.5" />,        bg: 'bg-amber-100 dark:bg-amber-900/40',   text: 'text-amber-600 dark:text-amber-400',   label: 'Dispatch', path: '/dispatch' },
};

export const ActivityFeed = React.memo(function ActivityFeed({
  items, loading, currencySymbol = '₹',
}: ActivityFeedProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[var(--color-primary-light)] p-1.5 text-[var(--color-primary-text)]">
            <Clock className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">Activity Feed</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* VALID: emerald-500 is a fixed "live/active" status pigment */}
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-[var(--color-text-muted)]">Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 divide-y divide-[var(--color-border-subtle)]">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
          : items.length === 0
          ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              {/* Empty state icon: text-disabled (decorative, no action possible) */}
              <Clock className="h-8 w-8 text-[var(--color-text-disabled)]" />
              <p className="text-xs text-[var(--color-text-muted)]">No recent activity</p>
            </div>
          )
          : items.map((item) => {
              const cfg = TYPE_CONFIG[item._type] ?? TYPE_CONFIG.lead;
              const title = item.name ?? item.customer ?? item.company ?? `#${item.id.slice(-6)}`;
              const sub = item.status
                ? item.status
                : item._type === 'order' && item.total
                ? `${currencySymbol}${Number(item.total).toLocaleString()}`
                : cfg.label;

              return (
                <button
                  key={`${item._type}-${item.id}`}
                  onClick={() => navigate(cfg.path)}
                  // -mx-4 px-4: intentional bleed trick to make hover fill full card width.
                  // Must be preserved exactly — only hover color changes.
                  className="flex items-center gap-3 py-2.5 w-full text-left group hover:bg-[var(--color-surface-hover)] -mx-4 px-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                >
                  {/* VALID: cfg.bg/cfg.text are fixed type-identity pigments */}
                  <div className={`p-1.5 rounded-lg shrink-0 ${cfg.bg} ${cfg.text} transition-transform duration-200 group-hover:scale-110`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                      {title}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">{sub}</p>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 tabular-nums">
                    {timeAgo(item.created_at)}
                  </span>
                </button>
              );
            })
        }
      </div>
    </div>
  );
});
