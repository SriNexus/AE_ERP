import React from 'react';
import { cn } from '../../utils/cn';
import { SearchInput, DateRangeFilter } from './Input';
import { Button } from './Button';
import { Download, Trash2, X } from 'lucide-react';

type Filter = { label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void };
const SEL = 'text-sm border border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] shadow-[var(--shadow-enterprise-control)] hover:border-[var(--color-border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] max-w-[160px]';

export function FilterBar({ search, onSearch, searchPlaceholder = 'Search...', dateRange, onDateRange, customFrom, customTo, onCustomRange, dateRangeOptions, filters = [], count, total, label = 'records', selectedCount = 0, onExport, onImport, onBulkDelete, onClearAll }: {
  search: string; onSearch: (v: string) => void; searchPlaceholder?: string;
  dateRange?: string; onDateRange?: (v: string) => void; customFrom?: string; customTo?: string; onCustomRange?: (f: string, t: string) => void;
  dateRangeOptions?: { label: string; value: string }[];
  filters?: Filter[]; count: number; total: number; label?: string;
  selectedCount?: number; onExport?: () => void; onImport?: () => void; onBulkDelete?: () => void; onClearAll?: () => void;
}) {
  const hasFilters = Boolean(search || (dateRange && dateRange !== 'all') || filters.some(f => f.value));

  const renderAdvancedControls = () => (
    <>
      {onDateRange && <DateRangeFilter value={dateRange || 'all'} onChange={onDateRange} customFrom={customFrom} customTo={customTo} onCustomChange={onCustomRange} options={dateRangeOptions} />}
      {filters.map(f => (
        <select key={f.label} value={f.value} onChange={e => f.onChange(e.target.value)} className={SEL}>
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {hasFilters && (
        <button onClick={onClearAll} className="flex min-h-10 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]">
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </>
  );

  return (
    <div className="px-4 py-2 space-y-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-[var(--shadow-enterprise-control)]">
      <div className="flex flex-wrap gap-2.5 items-center lg:flex-nowrap">
        <SearchInput value={search} onChange={onSearch} placeholder={searchPlaceholder} className="flex-1 min-w-48 max-w-sm" />
        <div className="filterbar-advanced ml-auto flex shrink-0 flex-wrap items-center gap-2.5 lg:flex-nowrap">
          {renderAdvancedControls()}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2 py-1.5 px-3 bg-[var(--color-primary-light)] rounded-lg border border-[var(--color-primary-muted)] animate-fadeIn">
          <span className="text-xs font-semibold text-[var(--color-primary-text)]">{selectedCount} selected</span>
          <div className="flex-1" />
          {onExport && <Button variant="outline" size="xs" icon={<Download className="h-3 w-3" />} onClick={onExport}>Export</Button>}
          {onBulkDelete && <Button variant="danger" size="xs" icon={<Trash2 className="h-3 w-3" />} onClick={onBulkDelete}>Delete</Button>}
        </div>
      )}
    </div>
  );
}

export function KpiTile({ label, value, color = 'border-l-[var(--color-border-strong)]', onClick, active }: { label: string; value: string | number; color?: string; onClick?: () => void; active?: boolean }) {
  return (
    <div onClick={onClick}
      style={{
        borderRadius: 'var(--theme-radius)',
        borderLeftWidth: 'var(--theme-kpi-border-width, 4px)',
        boxShadow: 'var(--theme-kpi-shadow, var(--theme-shadow-md))',
      }}
      className={cn('bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 transition-all duration-200 ease-out', color, onClick && 'cursor-pointer hover:-translate-y-0.5', active && 'ring-2 ring-[var(--color-primary)]')}>
      <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight">{value}</p>
    </div>
  );
}
