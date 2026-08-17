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

export function VendorField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
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
