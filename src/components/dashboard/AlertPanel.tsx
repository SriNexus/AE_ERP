/**
 * AlertPanel — Attention panel: overdue follow-ups, unpaid invoices, pending dispatches.
 * Phase P1: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: alert category pigments (rose/amber/blue), emerald empty-state, rose badge.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Receipt, Truck, ChevronRight } from 'lucide-react';

interface AlertPanelProps {
  overdueFollowups?: number;
  unpaidInvoices?: number;
  pendingDispatch?: number;
  loading?: boolean;
}

interface AlertItem {
  icon: React.ReactNode;
  label: string;
  count: number;
  path: string;
  color: string;
  bg: string;
}

function SkeletonAlert() {
  return (
    <div className="flex items-center gap-3 p-3 animate-pulse rounded-lg">
      {/* Skeleton blocks use --color-bg-sunken: correct elevation for loading placeholder */}
      <div className="h-8 w-8 rounded-lg bg-[var(--color-bg-sunken)] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-28 rounded bg-[var(--color-bg-sunken)]" />
        {/* Slightly more subtle secondary line — still bg-sunken, just narrower */}
        <div className="h-2.5 w-16 rounded bg-[var(--color-bg-sunken)] opacity-60" />
      </div>
      <div className="h-6 w-6 rounded-full bg-[var(--color-bg-sunken)]" />
    </div>
  );
}

export const AlertPanel = React.memo(function AlertPanel({
  overdueFollowups = 0, unpaidInvoices = 0, pendingDispatch = 0, loading,
}: AlertPanelProps) {
  const navigate = useNavigate();

  // VALID: rose/amber/blue are fixed alert-category pigments — not theme surfaces
  const alerts: AlertItem[] = [
    {
      icon: <Clock className="h-4 w-4" />,
      label: 'Overdue Follow-ups',
      count: overdueFollowups,
      path: '/leads',
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
    },
    {
      icon: <Receipt className="h-4 w-4" />,
      label: 'Unpaid Invoices',
      count: unpaidInvoices,
      path: '/invoices',
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
    },
    {
      icon: <Truck className="h-4 w-4" />,
      label: 'Pending Dispatch',
      count: pendingDispatch,
      path: '/dispatch',
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
    },
  ].filter(a => a.count > 0 || loading);

  const hasAlerts = alerts.some(a => a.count > 0);

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
        {/* Alert icon: amber when active, text-disabled (decorative) when idle */}
        <AlertTriangle className={`h-4 w-4 ${hasAlerts ? 'text-amber-500' : 'text-[var(--color-text-disabled)]'}`} />
        <h3 className="text-sm font-bold text-[var(--color-text)]">Attention Needed</h3>
        {/* VALID: rose badge is a fixed danger-count indicator pigment */}
        {hasAlerts && (
          <span className="ml-auto text-xs bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold px-1.5 py-0.5 rounded-full ring-1 ring-rose-200 dark:ring-rose-800/60">
            {overdueFollowups + unpaidInvoices + pendingDispatch}
          </span>
        )}
      </div>

      <div className="p-2">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonAlert key={i} />)
          : alerts.length === 0
          ? (
            <div className="flex flex-col items-center gap-1.5 py-5">
              {/* VALID: emerald empty-state is a fixed success identity pigment */}
              <div className="h-8 w-8 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                <ChevronRight className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">All clear! No pending actions.</p>
            </div>
          )
          : alerts.map(alert => (
              <button
                key={alert.label}
                onClick={() => navigate(alert.path)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--color-surface-hover)] w-full text-left transition-colors group"
              >
                {/* VALID: alert.bg/alert.color are fixed per-category pigments */}
                <div className={`p-2 rounded-lg shrink-0 ${alert.bg} ${alert.color}`}>
                  {alert.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-text-secondary)]">{alert.label}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Click to review</p>
                </div>
                <span className={`text-sm font-bold tabular-nums ${alert.color}`}>
                  {alert.count}
                </span>
                {/* Chevron: decorative navigation affordance — text-disabled */}
                <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-disabled)] group-hover:translate-x-0.5 transition-transform" />
              </button>
            ))
        }
      </div>
    </div>
  );
});
