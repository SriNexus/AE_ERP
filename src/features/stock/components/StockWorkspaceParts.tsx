import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Package, Plus, Search, Trash2, ArrowLeftRight } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Badge, statusBadge } from '../../../components/ui/Badge';
import { Input } from '../../../components/ui/Input';
import { getInventoryMovements } from '../../../lib/inventoryMovements';
import { fmtDateTime } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';

export const PER_PAGE_OPTIONS = [10, 20, 50] as const;

export type StockTab = 'summary' | 'ledger';

export type StockTabState = {
  search: string;
  dateRange: any;
  customFrom: string;
  customTo: string;
  company: string;
  warehouse: string;
  category: string;
  product: string;
  status: string;
  activeKpi: string;
  page: number;
  perPage: number;
  selected: Set<string>;
};

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toLocaleString('en-IN');
}

export function getPageNumbers(page: number, pages: number) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, '…', pages];
  if (page >= pages - 3) return [1, '…', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, '…', page - 1, page, page + 1, '…', pages];
}

export function daysAgoText(value: any): string {
  if (!value) return 'Not available';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = new Date(date);
  then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(date);
  created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

export function warehouseLabel(row: any, warehouseMap: Map<string, any>): string {
  const id = String(row.warehouseId || row.warehouse || '').trim();
  if (id && warehouseMap.has(id)) return warehouseMap.get(id)?.name || warehouseMap.get(id)?.code || '—';
  return row.warehouseName || row.warehouse || '—';
}

export function productLabel(row: any, productMap: Map<string, any>): string {
  const id = String(row.productId || row.product || '').trim();
  if (id && productMap.has(id)) return productMap.get(id)?.name || '—';
  return row.productName || row.product || '—';
}

export function stockLedgerStatus(row: any): string {
  return String(row.type || row.movementType || row.sourceType || 'IN').toUpperCase();
}

export function stockSummaryStatus(row: any, minStockFallback = 5): string {
  const available = Number(row.availableQty ?? row.available) || 0;
  const reserved = Number(row.reservedQty ?? row.reserved) || 0;
  const minStock = Number(row.min_stock ?? row.lowStockThreshold ?? minStockFallback) || minStockFallback;
  if (available <= 0) return 'Out Of Stock';
  if (reserved > 0) return 'Reserved';
  if (available <= minStock) return 'Low Stock';
  return 'In Stock';
}

export function stockSummaryMatchesKpi(row: any, kpi: string): boolean {
  const available = Number(row.availableQty ?? row.available) || 0;
  const reserved = Number(row.reservedQty ?? row.reserved) || 0;
  const minStock = Number(row.min_stock ?? row.lowStockThreshold ?? 5) || 5;
  switch (kpi) {
    case 'total':
    case '':
      return true;
    case 'instock':
      return available > 0;
    case 'low':
      return available > 0 && available <= minStock;
    case 'out':
      return available <= 0;
    case 'reserved':
      return reserved > 0;
    case 'available':
      return available > 0 && reserved === 0;
    default:
      return true;
  }
}

export function stockLedgerMatchesKpi(row: any, kpi: string): boolean {
  const type = stockLedgerStatus(row);
  switch (kpi) {
    case 'total':
    case '':
      return true;
    case 'in':
      return type === 'IN';
    case 'out':
      return type === 'OUT';
    case 'transfer':
      return String(row.sourceType || '').toLowerCase().includes('dispatch') || String(row.sourceType || '').toLowerCase().includes('order');
    case 'adjust':
      return type === 'ADJUSTMENT';
    default:
      return true;
  }
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</div>
    </div>
  );
}

function StatMini({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5 shadow-[var(--shadow-enterprise-control)]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[var(--color-text)] tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[var(--color-text-muted)]">{sub}</p>}
    </div>
  );
}

function StockSelectionToolbar({
  selectedCount,
  onExport,
  onAdjust,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  onExport: () => void;
  onAdjust?: () => void;
  onDelete?: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-sm font-semibold text-[var(--color-primary-text)]">
        {selectedCount} selected
      </span>
      <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={onExport}>Export</Button>
      {onAdjust && (
        <Button size="xs" variant="outline" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={onAdjust}>Adjust</Button>
      )}
      {onDelete && (
        <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>Delete</Button>
      )}
      <button type="button" onClick={onClear} className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
    </div>
  );
}

type StockBoundaryProps = { children: React.ReactNode };
type StockBoundaryState = { hasError: boolean };

class StockPageBoundary extends React.Component<StockBoundaryProps, StockBoundaryState> {
  state: StockBoundaryState = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('[StockPageBoundary]', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-enterprise-surface)]">
          <p className="text-sm font-semibold text-[var(--color-text)]">Stock page error was contained.</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Reload the page to restore the inventory workspace.</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text-inverse)]"
            onClick={() => window.location.reload()}
          >
            Reload stock
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type StockModalBoundaryProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};
type StockModalBoundaryState = { hasError: boolean };

class StockModalBoundary extends React.Component<StockModalBoundaryProps, StockModalBoundaryState> {
  state: StockModalBoundaryState = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('[StockModal]', error);
  }
  componentDidUpdate(prevProps: StockModalBoundaryProps) {
    if (!prevProps.open && this.props.open && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (!this.props.open) return null;
    if (this.state.hasError) {
      return (
        <Modal
          open={this.props.open}
          onClose={this.props.onClose}
          title="Stock details unavailable"
          size="2xl"
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false })}>Retry</Button>
              <Button variant="danger" size="sm" onClick={this.props.onClose}>Close</Button>
            </div>
          )}
        >
          <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <p>Stock details could not be rendered. The page is still available.</p>
            <p className="text-[var(--color-text-muted)]">Close the popup and reopen it, or retry the current render.</p>
          </div>
        </Modal>
      );
    }
    return this.props.children;
  }
}

export function StockDetailsModal({
  open,
  mode,
  record,
  productMap,
  warehouseMap,
  userMap,
  onClose,
  onAdjust,
  onAddStock,
  onExport,
  onDelete,
}: {
  open: boolean;
  mode: StockTab;
  record: any;
  productMap: Map<string, any>;
  warehouseMap: Map<string, any>;
  userMap: Map<string, any>;
  onClose: () => void;
  onAdjust: (record: any) => void;
  onAddStock: (record?: any) => void;
  onExport: (record: any) => void;
  onDelete: (record: any) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'movements' | 'activity' | 'notes' | 'actions'>('overview');

  const { data: movements = [] } = useQuery({
    queryKey: ['stock-detail-movements', mode, record?.id || 'none', record?.productId || '', record?.warehouseId || ''],
    enabled: Boolean(open && record),
    queryFn: () => getInventoryMovements({
      productId: record?.productId || undefined,
      warehouseId: record?.warehouseId || undefined,
      limit: 30,
    }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setTab('overview');
  }, [open, record?.id]);

  const productName = productLabel(record, productMap);
  const warehouseName = warehouseLabel(record, warehouseMap);
  const available = Number(record?.availableQty ?? record?.available) || 0;
  const reserved = Number(record?.reservedQty ?? record?.reserved) || 0;
  const quantity = Number(record?.qty) || 0;
  const beforeQty = Number(record?.beforeQty) || 0;
  const afterQty = Number(record?.afterQty) || 0;
  const statusLabel = mode === 'summary' ? stockSummaryStatus(record) : stockLedgerStatus(record);
  const recentMovement = (movements as any[])[0] || null;
  const product = record?.productId ? productMap.get(String(record.productId)) : null;
  const warehouse = record?.warehouseId ? warehouseMap.get(String(record.warehouseId)) : null;
  const tabLabels = [
    ['overview', 'Overview'],
    ['movements', 'Movement History'],
    ['activity', 'Activity'],
    ['notes', 'Notes'],
    ['actions', 'Actions'],
  ];

  if (!open || !record) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onAddStock(record)}>Add Stock</Button>
          <Button variant="outline" size="sm" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => onAdjust(record)}>Adjust Stock</Button>
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => onExport(record)}>Export</Button>
          {mode === 'ledger' && (
            <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(record)}>Delete</Button>
          )}
        </div>
      )}
    >
      <div className="flex h-[78vh] max-h-[780px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
        <header className="shrink-0 flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
              {(productName || warehouseName || 'S')[0]?.toUpperCase() || 'S'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{productName}</h2>
                <span>{statusBadge(statusLabel)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                <span>{warehouseName}</span>
                <span>{mode === 'summary' ? 'Stock Summary' : 'Stock Ledger'}</span>
                <span>Record: {productName || warehouseName || '—'}</span>
              </div>
            </div>
          </div>
        </header>

        <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-5">
          {tabLabels.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as any)}
              className={[
                'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                tab === key
                  ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
          {tab === 'overview' && (
            <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-5">
                <DetailCard title="Stock Information">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailField label="Product" value={productName} />
                    <DetailField label="Warehouse" value={warehouseName} />
                    <DetailField label="Category" value={record?.category || product?.category || '—'} />
                    <DetailField label="Company" value={record?.company || product?.company || warehouse?.company || '—'} />
                    <DetailField label="Status" value={statusLabel} />
                    <DetailField label="Unit" value={record?.unit || product?.unit || 'PCS'} />
                  </div>
                </DetailCard>

                <DetailCard title="Latest Movement">
                  {recentMovement ? (
                    <div className="space-y-3">
                      <p className="text-[var(--color-text-secondary)] leading-relaxed">
                        {productLabel(recentMovement, productMap)} moved through {warehouseLabel(recentMovement, warehouseMap)}.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                        <span>{stockLedgerStatus(recentMovement)}</span>
                        <span>{fmtDateTime(recentMovement.date || recentMovement.createdAt)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-5 text-sm text-[var(--color-text-muted)]">
                      No movements found for this stock record.
                    </div>
                  )}
                </DetailCard>
              </div>

              <aside className="space-y-4">
                <DetailCard title="Quick Stats">
                  <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                    <p>Available: <span className="font-semibold text-[var(--color-text)]">{formatNumber(available)}</span></p>
                    <p>Reserved: <span className="font-semibold text-[var(--color-text)]">{formatNumber(reserved)}</span></p>
                    <p>On hand: <span className="font-semibold text-[var(--color-text)]">{formatNumber(available + reserved)}</span></p>
                    <p>Updated: <span className="font-semibold text-[var(--color-text)]">{daysAgoText(record?.updatedAt || record?.date)}</span></p>
                  </div>
                </DetailCard>
                <DetailCard title="Recent Activity">
                  <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                    <p>{fmtDateTime(record?.updatedAt || record?.date)}</p>
                    <p>{record?.performedBy || record?.createdBy || 'System'}</p>
                  </div>
                </DetailCard>
              </aside>
            </div>
          )}

          {tab === 'movements' && (
            <div className="pt-5">
              <DetailCard title="Movement History">
                {movements.length ? (
                  <div className="space-y-3">
                    {(movements as any[]).map((move, index) => (
                      <div key={move.id || index} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-[var(--color-text)]">{productLabel(move, productMap)}</p>
                            <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(move.date || move.createdAt)}</time>
                          </div>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                            {stockLedgerStatus(move)} · Qty {move.qty || 0} · {warehouseLabel(move, warehouseMap)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">No movements recorded yet.</p>
                )}
              </DetailCard>
            </div>
          )}

          {tab === 'activity' && (
            <div className="pt-5">
              <DetailCard title="Activity">
                <div className="space-y-3">
                  <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text)]">Created</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(record?.createdAt || record?.date)}</time>
                        </div>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Initial stock record created.</p>
                      </div>
                    </div>
                  {record?.updatedAt && (
                    <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text)]">Updated</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(record?.updatedAt)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Record was modified.</p>
                      </div>
                    </div>
                  )}
                  {(movements as any[]).slice(0, 6).map((move, index) => (
                    <div key={move.id || `move-${index}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text)]">{stockLedgerStatus(move)}</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(move.date || move.createdAt)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{productLabel(move, productMap)} · Qty {move.qty || 0}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </DetailCard>
            </div>
          )}

          {tab === 'notes' && (
            <div className="pt-5">
              <DetailCard title="Notes">
                {record?.notes ? (
                  <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text-secondary)]">{record.notes}</p>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-6 text-sm text-[var(--color-text-muted)]">
                    No notes have been recorded for this stock entry.
                  </div>
                )}
              </DetailCard>
            </div>
          )}

          {tab === 'actions' && (
            <div className="pt-5">
              <DetailCard title="Actions">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button variant="outline" size="sm" className="justify-start" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onAddStock(record)}>Add Stock</Button>
                  <Button variant="outline" size="sm" className="justify-start" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => onAdjust(record)}>Adjust Stock</Button>
                  <Button variant="outline" size="sm" className="justify-start" icon={<Download className="h-3.5 w-3.5" />} onClick={() => onExport(record)}>Export</Button>
                  {mode === 'ledger' && (
                    <Button variant="danger" size="sm" className="justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(record)}>Delete</Button>
                  )}
                </div>
              </DetailCard>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export {
  DetailCard,
  DetailField,
  StatMini,
  StockModalBoundary,
  StockPageBoundary,
  StockSelectionToolbar,
};
