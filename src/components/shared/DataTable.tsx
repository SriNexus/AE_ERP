/**
 * DataTable — Reusable enterprise table
 * Phase P1: Full semantic token compliance.
 */

import React, { useState, useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../ui/Table';
import { Pagination } from '../ui/Pagination';
import { SearchInput } from '../ui/Input';

export interface TableColumn<T = any> {
  key:        string;
  label:      string;
  sortable?:  boolean;
  className?: string;
  render?:    (row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T = any> {
  data:           T[];
  columns:        TableColumn<T>[];
  loading?:       boolean;
  searchKeys?:    (keyof T)[];
  searchValue?:   string;
  onSearch?:      (v: string) => void;
  perPage?:       number;
  emptyMessage?:  string;
  emptyIcon?:     React.ReactNode;
  actions?:       (row: T) => React.ReactNode;
  onRowClick?:    (row: T) => void;
  header?:        React.ReactNode;
  footer?:        React.ReactNode;
  className?:     string;
  rowClassName?:  (row: T) => string;
  selectedIds?:   Set<string>;
  onSelect?:      (id: string) => void;
  getRowId?:      (row: T) => string;
}

export function DataTable<T extends Record<string, any>>({
  data, columns, loading = false, searchKeys, searchValue, onSearch,
  perPage = 15, emptyMessage = 'No records found.', emptyIcon, actions,
  onRowClick, header, footer, className, rowClassName, selectedIds, onSelect, getRowId,
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState('');
  const [page, setPage]  = useState(1);
  const [sortKey, setSortKey]  = useState('');
  const [sortDesc, setSortDesc] = useState(false);

  const search = searchValue ?? internalSearch;
  const setSearch = onSearch ?? ((v: string) => { setInternalSearch(v); setPage(1); });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q || !searchKeys?.length) return data;
    return data.filter(row =>
      searchKeys.some(k => String(row[k] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, searchKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });
  }, [filtered, sortKey, sortDesc]);

  const paginated = sorted.slice((page - 1) * perPage, page * perPage);
  const allCols = columns.length + (actions ? 1 : 0) + (onSelect ? 1 : 0);

  function handleSort(key: string) {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(false); }
    setPage(1);
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {searchKeys && !onSearch && (
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="max-w-sm" />
        </div>
      )}

      {header}

      <Table>
        <Thead>
          {onSelect && <Th className="w-8" />}
          {columns.map((col, index) => (
            <Th
              key={col.key}
              className={cn(
                index === 0 && 'sticky left-0 z-20 bg-[var(--color-bg-sunken)]',
                col.className
              )}
              sortable={col.sortable}
              sorted={sortKey === col.key}
              desc={sortDesc}
              onSort={col.sortable ? () => handleSort(col.key) : undefined}
            >
              {col.label}
            </Th>
          ))}
          {actions && <Th className="w-24">ACTIONS</Th>}
        </Thead>
        <Tbody>
          {loading ? (
            <SkeletonRows cols={allCols} rows={3} />
          ) : paginated.length === 0 ? (
            <tr>
              <td colSpan={allCols}>
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="text-[var(--color-text-disabled)] mb-3">
                    {emptyIcon ?? <Inbox className="h-8 w-8" />}
                  </div>
                  <p className="text-sm text-[var(--color-text-muted)] font-medium">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : paginated.map((row, i) => {
            const rowId = getRowId ? getRowId(row) : row.id;
            const isSelected = selectedIds?.has(rowId);
            return (
              <Tr
                key={rowId ?? i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                selected={isSelected}
                className={rowClassName?.(row)}
              >
                {onSelect && (
                  <Td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelect(rowId)}
                      className="rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
                      onClick={e => e.stopPropagation()}
                    />
                  </Td>
                )}
                {columns.map((col, colIndex) => (
                  <Td
                    key={col.key}
                    className={cn(
                      colIndex === 0 && 'sticky left-0 z-10 bg-[var(--color-surface)]',
                      col.className
                    )}
                  >
                    {col.render ? col.render(row, i) : String(row[col.key] ?? '—')}
                  </Td>
                ))}
                {actions && <Td>{actions(row)}</Td>}
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      {footer}

      {sorted.length > perPage && (
        <Pagination page={page} total={sorted.length} perPage={perPage} onChange={setPage} />
      )}
    </div>
  );
}

export default DataTable;
