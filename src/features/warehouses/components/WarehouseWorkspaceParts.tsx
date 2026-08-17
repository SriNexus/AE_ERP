import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../../../utils/cn';

export const PER_PAGE_OPTIONS = [10, 20, 50] as const;

function getPageNumbers(page: number, pages: number) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, '…', pages];
  if (page >= pages - 3) return [1, '…', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, '…', page - 1, page, page + 1, '…', pages];
}

export function WarehouseFooter({
  page,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
}: {
  page: number;
  total: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageNumbers = getPageNumbers(page, pages);
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-enterprise-control)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}/page</option>
          ))}
        </select>
      </div>

      {pages > 1 ? (
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>

          {pageNumbers.map((item, index) =>
            item === '…' ? (
              <span key={`ellipsis-${index}`} className="px-2 text-xs text-[var(--color-text-muted)]">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(Number(item))}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold transition-colors',
                  Number(item) === page
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-text-inverse)] shadow-sm'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
                )}
              >
                {item}
              </button>
            )
          )}

          <button
            type="button"
            disabled={page === pages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="ml-auto" />
      )}
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

export function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</div>
    </div>
  );
}

export function StatMini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5 shadow-[var(--shadow-enterprise-control)]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{value}</p>
      {sub && <p className="text-xs text-[var(--color-text-muted)]">{sub}</p>}
    </div>
  );
}
