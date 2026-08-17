import { useEffect, useMemo, useState, useCallback } from 'react';
import type React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Calendar, Download, Eye, FolderKanban, PackageCheck, Plus, Trash2, ArrowLeftRight, Warehouse,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, statusBadge } from '../../ui';
import { GoodsReceiptForm } from '../../../features/procurement/components/GoodsReceiptForm';
import { useCreateGoodsReceipt, useGoodsReceipts } from '../../../features/procurement/hooks/useGoodsReceipts';
import { usePurchaseOrders } from '../../../features/procurement/hooks/usePurchaseOrders';
import type { GoodsReceiptFormValues, GoodsReceiptRecord } from '../../../features/procurement/types';
import { useWarehouses } from '../../../features/warehouses/hooks/useWarehouses';
import type { Warehouse as WarehouseType } from '../../../features/warehouses/types';
import { fmtDate } from '../../../lib/firestore';
import { usePermissions } from '../../../lib/permissions';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const STATUSES = ['Pending', 'Partial', 'Completed', 'Archived', 'Cancelled'] as const;

function blank(): GoodsReceiptFormValues {
  return {
    purchaseOrderId: '', projectId: '', projectName: '',
    warehouseId: '', receivedDate: new Date().toISOString().slice(0, 10),
    notes: '', quantities: {},
  };
}

function formatDate(value: any): string {
  if (!value) return '—';
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().toLocaleDateString('en-GB');
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000).toLocaleDateString('en-GB');
  try { return new Date(value).toLocaleDateString('en-GB'); } catch { return '—'; }
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function isThisWeek(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return date >= start;
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

type GRFilters = {
  search: string;
  warehouse: string;
  status: string;
  date: string;
};

function filterGRs(receipts: GoodsReceiptRecord[], filters: GRFilters) {
  const term = filters.search.trim().toLowerCase();
  return receipts
    .filter((r) => {
      if (filters.status && ((r as any).status || 'Pending') !== filters.status) return false;
      if (filters.warehouse && r.warehouseId !== filters.warehouse) return false;
      if (filters.date === 'today' && !isToday(r.receivedDate || r.createdAt)) return false;
      if (filters.date === 'week' && !isThisWeek(r.receivedDate || r.createdAt)) return false;
      if (filters.date === 'month' && !isThisMonth(r.receivedDate || r.createdAt)) return false;
      if (!term) return true;
      return [
        r.goodsReceiptId, r.purchaseOrderId, r.vendorName, r.warehouseName, r.projectName,
        ...(r.receivedItems ?? []).map((i) => i.product),
      ].some((v) => String(v || '').toLowerCase().includes(term));
    })
    .sort((a, b) => String(b.receivedDate || b.createdAt || '').localeCompare(String(a.receivedDate || a.createdAt || '')));
}

export function MobileGoodsReceiptWorkspace() {
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const { data: receipts = [], isLoading } = useGoodsReceipts();
  const { data: orders = [] } = usePurchaseOrders();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateGoodsReceipt();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<GoodsReceiptFormValues>(blank());
  const [viewReceipt, setViewReceipt] = useState<GoodsReceiptRecord | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'items' | 'stock-movement' | 'history'>('overview');
  const createParam = params.get('create');

  const eligible = useMemo(() =>
    (orders as any[]).filter((o: any) => ['Sent', 'PartiallyReceived'].includes(o.status)),
  [orders]);

  useEffect(() => {
    if (createParam !== '1') return;
    setForm(blank());
    setFormOpen(true);
  }, [createParam]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewReceipt || !receipts.length) return;
    const found = receipts.find((r) => r.id === openId);
    if (found) setViewReceipt(found);
  }, [receipts, params, viewReceipt]);

  const filters = useMemo<GRFilters>(() => ({
    search: params.get('q') || '',
    warehouse: params.get('warehouse') || '',
    status: params.get('status') || '',
    date: params.get('date') || 'all',
  }), [params]);

  const filtered = useMemo(() => filterGRs(receipts as GoodsReceiptRecord[], filters), [receipts, filters]);
  const rows = useMemo(() => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filtered, page]);
  const canReceive = perms.canCreate('stock') && perms.canEdit('purchase_orders');
  const canDelete = perms.canDelete('stock');

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  const setFilter = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key); else next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openCreate = useCallback(() => {
    setForm(blank());
    setFormOpen(true);
    const next = new URLSearchParams(params);
    next.set('create', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setForm(blank());
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const viewDetails = useCallback((r: GoodsReceiptRecord) => {
    setViewReceipt(r);
    setDetailTab('overview');
    const next = new URLSearchParams(params);
    next.set('open', r.id);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closeDetails = useCallback(() => {
    setViewReceipt(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    if (!form.purchaseOrderId) { toast.error('Purchase order required'); return; }
    void create.mutateAsync(form).then(closeForm);
  }, [form, create, closeForm]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const exportSelected = useCallback(() => {
    const s = receipts.filter((r) => selected.has(r.id));
    if (!s.length) { toast.error('No receipts selected'); return; }
    const headers = ['Receipt', 'PO', 'Vendor', 'Warehouse', 'Date', 'Items', 'Qty', 'Status'];
    const lines = s.map((r) =>
      [r.goodsReceiptId, r.purchaseOrderId, r.vendorName, r.warehouseName, r.receivedDate,
        (r.receivedItems ?? []).length, (r.receivedItems ?? []).reduce((a, i) => a + i.qty, 0), (r as any).status || 'Pending']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `goods-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${s.length} receipt${s.length > 1 ? 's' : ''}`);
    setSelected(new Set());
  }, [receipts, selected]);

  return (
    <div className="space-y-4 pb-20 pt-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Goods Receipts</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {(canReceive || canDelete) && selected.size > 0 && (
            <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportSelected}>Export</Button>
          )}
          {canReceive && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New</Button>
          )}
        </div>
      </div>

      {/* Search */}
      <Input
        placeholder="Search receipt, PO, vendor, product..."
        value={filters.search}
        onChange={(e) => setFilter('q', e.target.value)}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[140px] flex-1">
          <Select
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            options={[
              { label: 'All Status', value: '' },
              ...STATUSES.map((s) => ({ label: s, value: s })),
            ]}
          />
        </div>
        <div className="min-w-[140px] flex-1">
          <Select
            value={filters.warehouse}
            onChange={(e) => setFilter('warehouse', e.target.value)}
            options={[
              { label: 'All Warehouses', value: '' },
              ...(warehouses as WarehouseType[]).map((w) => ({ label: w.name, value: w.id })),
            ]}
          />
        </div>
        <div className="min-w-[120px] flex-1">
          <Select
            value={filters.date}
            onChange={(e) => setFilter('date', e.target.value)}
            options={[
              { label: 'All Dates', value: 'all' },
              { label: 'Today', value: 'today' },
              { label: 'This Week', value: 'week' },
              { label: 'This Month', value: 'month' },
            ]}
          />
        </div>
      </div>

      {/* Selection Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--color-primary-light)] px-4 py-2">
          <span className="text-sm font-semibold text-[var(--color-primary-text)]">
            {selected.size} receipt{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-[var(--color-border-subtle)]" />
                  <div className="h-3 w-24 rounded bg-[var(--color-border-subtle)]" />
                </div>
                <div className="h-5 w-16 rounded bg-[var(--color-border-subtle)]" />
              </div>
              <div className="mt-3 flex justify-between">
                <div className="h-3 w-20 rounded bg-[var(--color-border-subtle)]" />
                <div className="h-3 w-16 rounded bg-[var(--color-border-subtle)]" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center">
          <PackageCheck className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text-muted)]">
            {filters.search || filters.status || filters.warehouse || filters.date !== 'all'
              ? 'No receipts match your filters'
              : 'No goods receipts yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
            {filters.search || filters.status || filters.warehouse || filters.date !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Receive goods against a sent purchase order'}
          </p>
          {!filters.search && !filters.status && !filters.warehouse && filters.date === 'all' && canReceive && (
            <Button size="sm" className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Create First Receipt
            </Button>
          )}
        </Card>
      )}

      {/* Cards */}
      {!isLoading && rows.length > 0 && (
        <>
          <div className="space-y-3">
            {rows.map((r) => {
              const qty = (r.receivedItems ?? []).reduce((s, i) => s + i.qty, 0);
              const itemCount = (r.receivedItems ?? []).length;
              const isSelected = selected.has(r.id);
              return (
                <Card
                  key={r.id}
                  className={`cursor-pointer p-4 transition-all active:scale-[0.98] ${isSelected ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
                  onClick={() => viewDetails(r)}
                >
                  {/* Header row */}
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.id)}
                        className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600"
                      />
                      <div className="flex items-center gap-1.5">
                        <PackageCheck className="h-4 w-4 text-[var(--color-primary-text)]" />
                        <span className="text-xs font-semibold text-[var(--color-primary-text)]">{r.goodsReceiptId}</span>
                      </div>
                    </label>
                    {statusBadge((r as any).status || 'Pending')}
                  </div>

                  {/* Vendor + PO */}
                  <p className="text-sm font-medium text-[var(--color-text)]">{r.vendorName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">PO: {r.purchaseOrderId}</p>

                  {/* Warehouse + Date row */}
                  <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                    <span className="flex items-center gap-1">
                      <Warehouse className="h-3 w-3" />
                      {r.warehouseName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(r.receivedDate)}
                    </span>
                  </div>

                  {/* Items + Qty summary */}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-muted)]">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{qty} units received</span>
                  </div>

                  {/* Quick actions */}
                  <div className="mt-3 flex gap-2 border-t border-[var(--color-border-subtle)] pt-3" onClick={(e) => e.stopPropagation()}>
                    <Button size="xs" variant="outline" icon={<Eye className="h-3 w-3" />}
                      onClick={() => viewDetails(r)}>View</Button>
                  </div>
                </Card>
              );
            })}
          </div>

          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={(p) => { setPage(p); const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n, { replace: true }); }}
          />
        </>
      )}

      {/* Create Form Modal */}
      <Modal open={formOpen} onClose={closeForm} title="New Goods Receipt" size="full">
        <GoodsReceiptForm
          value={form}
          orders={eligible}
          warehouses={warehouses as WarehouseType[]}
          onChange={setForm}
          onSubmit={submit}
          onCancel={closeForm}
          saving={create.isPending}
        />
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!viewReceipt} onClose={closeDetails} title={viewReceipt?.goodsReceiptId || 'Goods Receipt'} size="full">
        {viewReceipt && (
          <div className="space-y-4 text-sm">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-5 w-5 text-[var(--color-primary-text)]" />
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{viewReceipt.goodsReceiptId}</h2>
                  {statusBadge((viewReceipt as any).status || 'Pending')}
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{viewReceipt.vendorName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">PO: {viewReceipt.purchaseOrderId}</p>
              </div>
            </div>

            {/* Detail fields */}
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--color-bg-sunken)] p-3">
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Warehouse</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{viewReceipt.warehouseName}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Date</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{formatDate(viewReceipt.receivedDate)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Items</p>
                <p className="text-sm font-medium text-[var(--color-text)]">{(viewReceipt.receivedItems ?? []).length}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Quantity</p>
                <p className="text-sm font-bold text-emerald-600">+{(viewReceipt.receivedItems ?? []).reduce((s, i) => s + i.qty, 0)}</p>
              </div>
            </div>

            {/* Project */}
            {viewReceipt.projectName && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-sunken)] p-3">
                <FolderKanban className="h-4 w-4 text-[var(--color-primary)]" />
                <span className="text-xs">Project: <b>{viewReceipt.projectName}</b></span>
              </div>
            )}

            {/* Timeline */}
            <MobileTimelinePreview
              title="Activity"
              entries={[
                viewReceipt.createdAt && { type: 'Created' as const, description: `Goods receipt created`, date: viewReceipt.createdAt, user: viewReceipt.receivedBy || 'System' },
                viewReceipt.updatedAt && { type: 'Updated' as const, description: `Receipt updated`, date: viewReceipt.updatedAt, user: viewReceipt.updatedBy || 'System' },
              ].filter(Boolean) as any[]}
            />

            {/* Tab navigation */}
            <div className="flex gap-1 rounded-xl bg-[var(--color-bg-sunken)] p-1">
              {(['overview', 'items', 'stock-movement', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                    detailTab === tab
                      ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm'
                      : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {tab === 'overview' ? 'Details' : tab === 'stock-movement' ? 'Stock' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {detailTab === 'overview' && (
              <div className="space-y-2">
                {(viewReceipt.receivedItems ?? []).map((item, i) => (
                  <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                    <div className="flex justify-between">
                      <p className="font-medium text-[var(--color-text)]">{item.product}</p>
                      <p className="font-semibold text-emerald-600">+{item.qty} {item.unit}</p>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Ordered {item.orderedQty} · Previously {item.previouslyReceivedQty}
                    </p>
                    <div className="mt-2 h-1 w-full rounded-full bg-[var(--color-border-subtle)]">
                      <div className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min(100, ((item.previouslyReceivedQty + item.qty) / item.orderedQty) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === 'items' && (
              <div className="space-y-2">
                {(viewReceipt.receivedItems ?? []).map((item, i) => (
                  <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                    <p className="font-medium text-[var(--color-text)]">{item.product}</p>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded bg-[var(--color-bg-sunken)] p-1.5">
                        <p className="text-[var(--color-text-muted)]">Ordered</p>
                        <p className="font-semibold">{item.orderedQty}</p>
                      </div>
                      <div className="rounded bg-emerald-50 p-1.5 dark:bg-emerald-950/20">
                        <p className="text-emerald-600">Received</p>
                        <p className="font-semibold text-emerald-600">+{item.qty}</p>
                      </div>
                      <div className="rounded bg-[var(--color-bg-sunken)] p-1.5">
                        <p className="text-[var(--color-text-muted)]">Pending</p>
                        <p className="font-semibold">{Math.max(0, item.orderedQty - item.previouslyReceivedQty - item.qty)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === 'stock-movement' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-5 w-5 text-[var(--color-primary)]" />
                    <div>
                      <p className="font-semibold text-[var(--color-text)]">{viewReceipt.warehouseName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">Destination warehouse</p>
                    </div>
                  </div>
                </div>

                {(viewReceipt.receivedItems ?? []).map((item, i) => {
                  const after = item.previouslyReceivedQty + item.qty;
                  return (
                    <div key={i} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                      <p className="font-medium text-[var(--color-text)]">{item.product}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                          <p className="text-[10px] text-[var(--color-text-muted)]">Before</p>
                          <p className="text-sm font-bold">{item.previouslyReceivedQty}</p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950/20">
                          <p className="text-[10px] text-emerald-600">+Added</p>
                          <p className="text-sm font-bold text-emerald-600">+{item.qty}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                          <p className="text-[10px] text-[var(--color-text-muted)]">After</p>
                          <p className="text-sm font-bold">{after}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      Inventory updated: +{(viewReceipt.receivedItems ?? []).reduce((s, i) => s + i.qty, 0)} units
                    </span>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'history' && (
              <div className="space-y-2">
                {viewReceipt.notes && (
                  <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3">
                    <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Notes</p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">{viewReceipt.notes}</p>
                  </div>
                )}
                <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">Created</p>
                  <p className="mt-1 text-sm text-[var(--color-text)]">
                    {formatDate(viewReceipt.createdAt || viewReceipt.receivedDate)}
                    {viewReceipt.receivedBy ? ` by ${viewReceipt.receivedBy}` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2">
              {canDelete && (
                <Button className="w-full" variant="danger" onClick={() => setDeleteOpen(true)}>Delete Receipt</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          toast.success('Receipt deleted');
          setDeleteOpen(false);
          closeDetails();
        }}
        title="Delete Goods Receipt"
        message="Delete this goods receipt permanently? This does not reverse stock movements."
      />
    </div>
  );
}
