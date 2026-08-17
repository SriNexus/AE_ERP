import React from 'react';
import { Eye } from 'lucide-react';

export function EmptyCell({ children = '-' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

export function CreatedDateCell({
  value,
  formatCreatedDate,
  recencyDotClass,
}: {
  value: any;
  formatCreatedDate: (value: any) => string;
  recencyDotClass: (value: any) => string;
}) {
  const formatted = formatCreatedDate(value);
  if (!formatted) return <EmptyCell />;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(value)}`} aria-hidden="true" />
      {formatted}
    </span>
  );
}

export function MutedValue({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>;
}

export function RegField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value ?? <MutedValue />}</div>
    </div>
  );
}

export function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ActionStrip({ onView }: { onView: () => void }) {
  return (
    <div
      data-action
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center justify-end gap-1 opacity-75 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <button
        type="button"
        onClick={onView}
        className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        <Eye className="h-3.5 w-3.5" />
        View
      </button>
    </div>
  );
}

/** Status badge for loan application status */
export function loanApplicationStatusBadge(status: string) {
  const colors: Record<string, string> = {
    'Draft': 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    'Digital Sign Pending': 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700',
    'Digital Sign Completed': 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-700',
    'Bank Submission Pending': 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-400 dark:border-orange-700',
    'Submitted To Bank': 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-900/40 dark:text-cyan-400 dark:border-cyan-700',
    'Under Review': 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-700',
    'Approved': 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-400 dark:border-green-700',
    'Rejected': 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-400 dark:border-red-700',
    'Payment Received': 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/40 dark:text-purple-400 dark:border-purple-700',
    'Closed': 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600',
  };
  const cls = colors[status] || colors['Draft'];
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-tight ${cls}`}>
      {status}
    </span>
  );
}

/** Digital sign badge */
export function signStatusBadge(status: string) {
  const colors: Record<string, string> = {
    'pending': 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700',
    'completed': 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-700',
  };
  const cls = colors[status] || colors['pending'];
  const label = status === 'completed' ? '✅ Done' : '✍️ Pending';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${cls}`}>
      {label}
    </span>
  );
}
