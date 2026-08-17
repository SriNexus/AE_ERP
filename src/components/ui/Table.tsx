import { cn } from '../../utils/cn';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Check, Minus, MoreHorizontal } from 'lucide-react';

// ── Universal Table Design System Premium Components ─────────
// These components implement the Neozy Universal Table Design System
// and are the single source of truth for all ERP tables.
//
// Key features:
//   - Theme-driven: all colors from --color-* CSS variables
//   - Premium sticky header with scroll shadow
//   - Premium sort indicators (ChevronUp/Down icons)
//   - Premium checkbox with checked/indeterminate states
//   - Smooth transitions and hover states
//   - Keyboard accessible

/**
 * Premium sort arrow icon component
 */
export function SortIcon({ direction, active }: { direction?: 'asc' | 'desc' | null; active?: boolean }) {
  if (direction === 'asc') return <ChevronUp className={cn('h-3.5 w-3.5 inline-block', active ? 'text-[var(--color-table-header-text)]' : 'text-[var(--color-table-header-sort)]')} />;
  if (direction === 'desc') return <ChevronDown className={cn('h-3.5 w-3.5 inline-block', active ? 'text-[var(--color-table-header-text)]' : 'text-[var(--color-table-header-sort)]')} />;
  return <ChevronsUpDown className="h-3 w-3 inline-block text-[var(--color-table-header-sort)] opacity-50" />;
}

/**
 * Premium checkbox with checked, unchecked, and indeterminate states
 */
export function UniversalCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel || 'Select row'}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={cn(
        'relative flex items-center justify-center w-[20px] h-[20px] rounded-[4px] border-2 transition-all duration-100 shrink-0',
        checked || indeterminate
          ? 'bg-[var(--color-table-checkbox)] border-[var(--color-table-checkbox)]'
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] hover:border-[var(--color-table-checkbox)]',
        className,
      )}
    >
      {indeterminate ? (
        <Minus className="h-[10px] w-[10px] text-white" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-[10px] w-[10px] text-white" strokeWidth={3} />
      ) : null}
    </button>
  );
}

/**
 * Premium table outer container
 */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('table-scroll-wrapper', className)}>
      <table className="min-w-full border-collapse text-sm" role="grid" aria-label="Data table">{children}</table>
    </div>
  );
}

export function TableScrollWrapper({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('table-scroll-wrapper', className)}>
      {children}
    </div>
  );
}

/**
 * Premium sticky table header with scroll shadow
 */
export function Thead({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLTableSectionElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Find the nearest scrollable ancestor (the overflow-auto container)
    const scrollContainer = el.closest('[class*="overflow-auto"]') ||
      el.closest('[style*="overflow: auto"]') ||
      el.parentElement?.closest('.overflow-auto, .overflow-y-auto, .overflow-x-auto') ||
      el.parentElement;
    if (!scrollContainer) return;

    const handler = () => {
      // Check if the scroll container has been scrolled past 2px
      setScrolled(scrollContainer.scrollTop > 2);
    };

    scrollContainer.addEventListener('scroll', handler, { passive: true });
    handler(); // check initial scroll position on mount

    return () => scrollContainer.removeEventListener('scroll', handler);
  }, []);

  return (
    <thead
      ref={ref}
      className={cn(
        'sticky top-0 z-10 transition-shadow duration-200',
        'bg-[var(--color-table-header-bg)]',
        scrolled && 'shadow-[0_2px_8px_rgba(0,0,0,0.06)]',
      )}
    >
      <tr className="divide-x divide-[var(--color-border-subtle)]">{children}</tr>
    </thead>
  );
}

/**
 * Premium sortable header cell
 */
export function Th({
  children,
  className,
  sortable,
  sorted,
  desc,
  onSort,
  align,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  sortable?: boolean;
  sorted?: boolean;
  desc?: boolean;
  onSort?: () => void;
  align?: 'left' | 'center' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <th
      onClick={sortable ? onSort : undefined}
      onKeyDown={sortable && onSort ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); } } : undefined}
      tabIndex={sortable ? 0 : undefined}
      aria-sort={sorted ? (desc ? 'descending' : 'ascending') : 'none'}
      aria-label={sortable && typeof children === 'string' ? `Sort by ${children}` : undefined}
      style={style}
      className={cn(
        'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] whitespace-nowrap select-none transition-colors duration-150',
        'text-[var(--color-table-header-text)]',
        sortable && 'cursor-pointer hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {children}
        {sortable && (
          <SortIcon direction={sorted ? (desc ? 'desc' : 'asc') : null} active={sorted} />
        )}
      </span>
    </th>
  );
}

/**
 * Premium table body
 */
export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="bg-[var(--color-surface)] divide-y divide-[var(--color-border-subtle)]">{children}</tbody>;
}

/**
 * Premium table row with hover, selection, and click states
 */
export function Tr({
  children,
  onClick,
  className,
  selected,
  ...props
}: {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLTableRowElement>;
  className?: string;
  selected?: boolean;
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(e as unknown as React.MouseEvent<HTMLTableRowElement>); } : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-selected={selected}
      role="row"
      {...props}
      className={cn(
        'transition-colors duration-100',
        onClick && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
        selected
          ? 'bg-[var(--color-table-row-selected)]'
          : onClick && 'hover:bg-[var(--color-table-row-hover)]',
        className,
      )}
    >
      {children}
    </tr>
  );
}

/**
 * Premium table data cell
 */
export function Td({
  children,
  className,
  align,
  ...props
}: { children?: React.ReactNode; className?: string; align?: 'left' | 'center' | 'right' } & React.TdHTMLAttributes<HTMLTableDataCellElement>) {
  return (
    <td
      className={cn(
        'px-4 py-2.5 text-[13px] text-[var(--color-text-secondary)] leading-tight',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/**
 * Premium skeleton loading rows
 */
export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="h-4 rounded animate-pulse"
                style={{
                  width: `${55 + (j * 13) % 40}%`,
                  background: 'var(--color-bg-sunken)',
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Premium overflow menu (•••) for table actions.
 * Replaces inline action buttons with a clean dropdown pattern.
 */
export function OverflowMenu({
  items,
  align = 'right',
}: {
  items: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'danger';
  }>;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label="More actions"
        aria-expanded={open}
        className={cn(
          'flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-100',
          'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
          open && 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-full mt-1 z-50 min-w-[140px] overflow-hidden rounded-lg border py-1 shadow-lg',
            'border-[var(--color-border)] bg-[var(--color-surface)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors',
                item.variant === 'danger'
                  ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]',
                'focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
              )}
            >
              {item.icon && <span className="h-3.5 w-3.5 shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type ColumnDef = { key: string; label: string; visible?: boolean; sortable?: boolean; align?: 'left' | 'center' | 'right' };
