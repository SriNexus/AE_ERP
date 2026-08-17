/**
 * CustomerRelationshipHealth — Right Panel widget (Phase 4). Shows the
 * derived Relationship Health level (see relationshipHealth.ts for the
 * exact calculation) plus the supporting signals that produced it.
 *
 * Visual pattern follows LeadHealthCard's structure (badge + metric rows)
 * but is a deliberately distinct, Customer-appropriate 3-tier system
 * (Healthy / Needs Attention / At Risk) — not a numeric score, and not a
 * relabeled copy of Lead Score.
 *
 * Final UI Cleanup mission: Active Orders and Relationship Age moved here
 * from the now-removed CustomerWorkspaceKpis bar (Customer Workspace only —
 * Lead Workspace's own health widget, LeadWorkspaceHealth.tsx, is untouched).
 * Both values reuse the exact source/calculation the KPI bar used —
 * ACTIVE_ORDER_STATUSES_EXCLUDED imported from CustomerWorkspaceKpis.tsx
 * (not reimplemented), and the same customer.createdAt day-count formula —
 * so nothing here is a new or duplicate calculation.
 */
import { HeartPulse, Clock, CalendarClock, ShoppingCart, ListChecks, Hourglass } from 'lucide-react';
import { calculateRelationshipHealth } from '../../../services/relationshipHealth';
import { ACTIVE_ORDER_STATUSES_EXCLUDED } from '../CustomerWorkspaceKpis';

interface Props {
  customer: any;
  isB2B: boolean;
  orders: any[];
}

const LEVEL_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  attention: 'Needs Attention',
  risk: 'At Risk',
};

const LEVEL_COLOR: Record<string, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  attention: 'text-amber-600 dark:text-amber-400',
  risk: 'text-red-600 dark:text-red-400',
};

const LEVEL_BG: Record<string, string> = {
  healthy: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
  attention: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
  risk: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
};

function fmtDays(d: number | null): string {
  if (d === null) return '—';
  if (d === 0) return 'Today';
  return `${d}d ago`;
}

export default function CustomerRelationshipHealth({ customer, isB2B, orders }: Props) {
  const { level, signals } = calculateRelationshipHealth(customer, { isB2B, orders });

  const activeOrders = orders.filter((o) => !ACTIVE_ORDER_STATUSES_EXCLUDED.has(o.status)).length;
  const relationshipAgeDays = customer?.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(customer.createdAt).getTime()) / 86400000))
    : null;

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Relationship Health</h3>

      <div className={['rounded-lg border p-3 mb-3', LEVEL_BG[level]].join(' ')}>
        <div className="flex items-center gap-2.5">
          <HeartPulse className={['h-5 w-5 shrink-0', LEVEL_COLOR[level]].join(' ')} />
          <div>
            <p className={['text-[12px] font-bold', LEVEL_COLOR[level]].join(' ')}>{LEVEL_LABEL[level]}</p>
            <p className="text-[9px] text-[var(--color-text-muted)]">
              {signals.isNewCustomer ? 'New customer' : 'Relationship status'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" />Last Activity</span>
          <span className="text-[11px] font-semibold text-[var(--color-text)]">{fmtDays(signals.daysSinceLastActivity)}</span>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><CalendarClock className="h-3 w-3" />Follow-up</span>
          <span className={['text-[11px] font-semibold', signals.hasOverdueFollowup ? 'text-red-600 dark:text-red-400' : 'text-[var(--color-text)]'].join(' ')}>
            {signals.hasOverdueFollowup ? 'Overdue' : signals.hasOpenFollowup ? 'Scheduled' : 'None set'}
          </span>
        </div>
        {isB2B && (
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><ShoppingCart className="h-3 w-3" />Last Order</span>
            <span className="text-[11px] font-semibold text-[var(--color-text)]">{fmtDays(signals.daysSinceLastOrder)}</span>
          </div>
        )}
        {isB2B && (
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><ListChecks className="h-3 w-3" />Active Orders</span>
            <span className="text-[11px] font-semibold text-[var(--color-text)]">{activeOrders}</span>
          </div>
        )}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><Hourglass className="h-3 w-3" />Relationship Age</span>
          <span className="text-[11px] font-semibold text-[var(--color-text)]">{relationshipAgeDays !== null ? `${relationshipAgeDays}d` : '—'}</span>
        </div>
      </div>
    </div>
  );
}
