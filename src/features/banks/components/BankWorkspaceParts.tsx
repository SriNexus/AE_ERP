import { Edit2, Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { RowViewAction } from '../../../components/shared';

export function BankActionStrip({ onView }: { onView: () => void }) {
  return <RowViewAction onView={onView} />;
}

export function BankStatusBadge(status?: string) {
  if (!status) return <Badge variant="gray">Unknown</Badge>;
  if (status === 'Active') return <Badge variant="success">Active</Badge>;
  return <Badge variant="gray">Inactive</Badge>;
}

export function BankTypeBadge(type?: string) {
  if (!type) return null;
  const colors: Record<string, string> = {
    'Public': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'Private': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    'Cooperative': 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    'NBFC': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${colors[type] || 'bg-slate-100 text-slate-700'}`}>
      {type}
    </span>
  );
}

export function BankDetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-enterprise-surface)]">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function BankField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value}</div>
    </div>
  );
}
