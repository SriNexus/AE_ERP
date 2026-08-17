/**
 * RecentDataTables — Compact recent leads + orders tables.
 * Phase P1: Full semantic token compliance on all themed surfaces/text.
 * VALID palette: indigo brand pigments (avatar, links, order IDs).
 *
 * Redesign pass: header/row/empty-state polish to match the shared
 * icon-badge panel language used across the dashboard. Table structure,
 * columns, data props and navigation targets are unchanged.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Target, ShoppingCart } from 'lucide-react';
import { statusBadge } from '../ui/Badge';
import { ageDays, fmtCompactCurrency, fmtCurrency } from '../../lib/firestore';

interface RecentLeadsTableProps {
  leads: any[];
  loading?: boolean;
  variant?: 'table' | 'mobile';
}

interface RecentOrdersTableProps {
  orders: any[];
  currencySymbol?: string;
  loading?: boolean;
  variant?: 'table' | 'mobile';
  compactCurrency?: boolean;
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 rounded bg-[var(--color-bg-sunken)] w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Shared header treatment — icon badge + title + link — matches every other
// dashboard panel so the page reads as one cohesive product.
function TableHeader({ icon, title, onAction }: { icon: React.ReactNode; title: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--color-border-subtle)]">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-[var(--color-primary-light)] p-1.5 text-[var(--color-primary-text)]">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-[var(--color-text)]">{title}</h3>
      </div>
      <button
        onClick={onAction}
        className="flex items-center gap-1 rounded-md px-2 py-1 -mr-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-[var(--color-surface-hover)] hover:text-indigo-700 transition-colors"
      >
        View all <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

function EmptyRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10">
      <div className="text-[var(--color-text-disabled)]">{icon}</div>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}

export const RecentLeadsTable = React.memo(function RecentLeadsTable({
  leads, loading, variant = 'table',
}: RecentLeadsTableProps) {
  const navigate = useNavigate();

  if (variant === 'mobile') {
    return (
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <TableHeader icon={<Target className="h-4 w-4" />} title="Recent Leads" onAction={() => navigate('/leads')} />
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse p-3">
                  <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-bg-sunken)] opacity-70" />
                </div>
              ))
            : leads.length === 0
            ? <EmptyRow icon={<Target className="h-7 w-7" />} label="No leads yet" />
            : leads.map(l => (
                <button
                  key={l.id}
                  onClick={() => navigate('/leads')}
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                >
                  <div className="h-8 w-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0">
                    {(l.name ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--color-text)]">{l.name}</p>
                    <p className="truncate text-[10px] text-[var(--color-text-muted)]">{l.company ?? l.city ?? '—'} · {l.source ?? '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {statusBadge(l.status ?? 'New')}
                    <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">{ageDays(l.createdAt)}d</span>
                  </div>
                </button>
              ))
          }
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <TableHeader icon={<Target className="h-4 w-4" />} title="Recent Leads" onAction={() => navigate('/leads')} />

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm divide-y divide-[var(--color-border-subtle)]">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Name', 'Status', 'Source', 'Age'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {loading
              ? <TableSkeleton cols={4} />
              : leads.length === 0
              ? (
                <tr>
                  <td colSpan={4} className="px-4">
                    <EmptyRow icon={<Target className="h-7 w-7" />} label="No leads yet" />
                  </td>
                </tr>
              )
              : leads.map(l => (
                  <tr
                    key={l.id}
                    onClick={() => navigate('/leads')}
                    className="hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* VALID: indigo-100/indigo-700 is fixed brand avatar pigment */}
                        <div className="h-6 w-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(l.name ?? '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--color-text)] leading-tight">{l.name}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)]">{l.company ?? l.city ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(l.status ?? 'New')}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{l.source ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] tabular-nums">{ageDays(l.createdAt)}d</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
});

export const RecentOrdersTable = React.memo(function RecentOrdersTable({
  orders, currencySymbol = '₹', loading, variant = 'table', compactCurrency = false,
}: RecentOrdersTableProps) {
  const navigate = useNavigate();
  const formatMoney = compactCurrency ? fmtCompactCurrency : fmtCurrency;

  if (variant === 'mobile') {
    return (
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
        <TableHeader icon={<ShoppingCart className="h-4 w-4" />} title="Recent Orders" onAction={() => navigate('/orders')} />
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse p-3">
                  <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-bg-sunken)] opacity-70" />
                </div>
              ))
            : orders.length === 0
            ? <EmptyRow icon={<ShoppingCart className="h-7 w-7" />} label="No orders yet" />
            : orders.map(o => (
                <button
                  key={o.id}
                  onClick={() => navigate('/orders')}
                  className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                      #{o.id?.slice(-6).toUpperCase()}
                    </p>
                    <p className="truncate text-xs font-semibold text-[var(--color-text-secondary)]">{o.customer ?? '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs font-bold text-[var(--color-text)] tabular-nums">{formatMoney(o.total, currencySymbol)}</span>
                    {statusBadge(o.status ?? 'Pending')}
                  </div>
                </button>
              ))
          }
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <TableHeader icon={<ShoppingCart className="h-4 w-4" />} title="Recent Orders" onAction={() => navigate('/orders')} />

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm divide-y divide-[var(--color-border-subtle)]">
          <thead className="bg-[var(--color-bg-sunken)]">
            <tr>
              {['Order', 'Customer', 'Total', 'Status'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
            {loading
              ? <TableSkeleton cols={4} />
              : orders.length === 0
              ? (
                <tr>
                  <td colSpan={4} className="px-4">
                    <EmptyRow icon={<ShoppingCart className="h-7 w-7" />} label="No orders yet" />
                  </td>
                </tr>
              )
              : orders.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => navigate('/orders')}
                    className="hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                  >
                    {/* VALID: indigo-600 is primary brand pigment used for order ID identity */}
                    <td className="px-4 py-3 font-mono text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                      #{o.id?.slice(-6).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)] font-medium max-w-[120px] truncate">
                      {o.customer ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-[var(--color-text)] tabular-nums">
                      {formatMoney(o.total, currencySymbol)}
                    </td>
                    <td className="px-4 py-3">{statusBadge(o.status ?? 'Pending')}</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
});
