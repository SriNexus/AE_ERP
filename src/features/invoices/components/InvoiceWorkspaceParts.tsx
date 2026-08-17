import React from 'react';
import { Eye } from 'lucide-react';

import { Button } from '../../../components/ui/Button';

export function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function InvoiceField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</div>
    </div>
  );
}

export function InvoiceActionStrip({ onView }: { onView: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1.5 opacity-90 transition-opacity duration-150 group-hover:opacity-100" data-action>
      <Button
        size="xs"
        variant="outline"
        icon={<Eye className="h-3.5 w-3.5" />}
        onClick={onView}
        className="h-7 rounded-xl border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--color-text)] hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]"
      >
        View
      </Button>
    </div>
  );
}
