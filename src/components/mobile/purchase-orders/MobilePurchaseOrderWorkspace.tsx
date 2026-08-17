import { useEffect, useMemo, useState, useCallback } from 'react';
import type React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Calendar, Download, Edit2, Eye, FileText, FolderKanban, Mail, Phone, Plus, ShoppingCart, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, statusBadge } from '../../ui';
import { PurchaseOrderForm } from '../../../features/procurement/components/PurchaseOrderForm';
import { usePurchaseOrders } from '../../../features/procurement/hooks/usePurchaseOrders';
import { useVendors } from '../../../features/procurement/hooks/useVendors';
import { PURCHASE_ORDER_FORM_DEFAULT, PURCHASE_ORDER_STATUSES, type PurchaseOrderFormValues, type PurchaseOrderRecord, type PurchaseOrderStatus } from '../../../features/procurement/types';
import { PURCHASE_ORDER_TRANSITIONS } from '../../../features/procurement/services/purchaseOrderWorkflow';
import { useSalesProducts } from '../../../features/sales/hooks/useSales';
import { fmtCurrency, fmtDate } from '../../../lib/firestore';
import { usePermissions } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;

function blank(): PurchaseOrderFormValues {
  return { ...PURCHASE_ORDER_FORM_DEFAULT, orderDate: new Date().toISOString().slice(0, 10), items: PURCHASE_ORDER_FORM_DEFAULT.items.map((item) => ({ ...item })) };
}

function editForm(record: PurchaseOrderRecord): PurchaseOrderFormValues {
  return {
    vendorId: record.vendorId, projectId: record.projectId || '',
    orderDate: record.orderDate, expectedDeliveryDate: record.expectedDeliveryDate,
    notes: record.notes || '',
    items: record.items.map((item) => ({
      productId: item.productId, product: item.product, description: item.description,
      hsn: item.hsn, qty: String(item.qty), unit: item.unit,
      price: String(item.price), tax: String(item.tax), discount: String(item.discount),
    })),
  };
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

type POFilters = {
  search: string;
  status: string;
  date: string;
};

function filterPOs(orders: PurchaseOrderRecord[], filters: POFilters) {
  const term = filters.search.trim().toLowerCase();
  return orders
    .filter((order) => {
      if (filters.status && (order.status || 'Draft') !== filters.status) return false;
      if (filters.date === 'today' && !isToday(order.createdAt || order.orderDate)) return false;
      if (filters.date === 'week' && !isThisWeek(order.createdAt || order.orderDate)) return false;
      if (filters.date === 'month' && !isThisMonth(order.createdAt || order.orderDate)) return false;
      if (!term) return true;
      return [
        order.purchaseOrderId,
        order.vendorName,
        order.vendorGstin,
        order.projectName,
        ...order.items.map((i) => i.product),
      ].some((v) => String(v || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || toDate(a.orderDate)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || toDate(b.orderDate)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadCsv(rows: PurchaseOrderRecord[], filename: string) {
  const headers = ['PO', 'Vendor', 'Project', 'Order Date', 'Delivery', 'Items', 'Total', 'Status'];
  const lines = rows.map((o) =>
    [o.purchaseOrderId, o.vendorName, o.projectName || '', o.orderDate, o.expectedDeliveryDate, o.items.length, o.total, o.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobilePurchaseOrderWorkspace() {
  const [params, setParams] = useSearchParams();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const currency = company.currencySymbol;
  const perms = usePermissions();
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const { data: vendors = [] } = useVendors();
  const { data: products = [] } = useSalesProducts();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrderRecord | null>(null);
  const [form, setForm] = useState<PurchaseOrderFormValues>(blank());
  const [viewOrder, setViewOrder] = useState<PurchaseOrderRecord | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [noteOrder, setNoteOrder] = useState<PurchaseOrderRecord | null>(null);
  const [noteText, setNoteText] = useState('');
  const createParam = params.get('create');

  useEffect(() => {
    if (createParam !== '1') return;
    setEditingOrder(null);
    setForm(blank());
    setFormOpen(true);
  }, [createParam]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewOrder || !orders.length) return;
    const found = orders.find((order) => order.id === openId);
    if (found) setViewOrder(found);
  }, [orders, params, viewOrder]);

  const filters = useMemo<POFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || '',
    date: params.get('date') || 'all',
  }), [params]);

  const filteredOrders = useMemo(() => filterPOs(orders as PurchaseOrderRecord[], filters), [orders, filters]);
  const paginatedOrders = useMemo(() => filteredOrders.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredOrders, page]);
  const canCreate = perms.canCreate('purchase_orders');
  const canEdit = perms.canEdit('purchase_orders');
  const canDelete = perms.canDelete('purchase_orders');
  const canExport = perms.canExport('purchase_orders') || canEdit || canCreate;

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredOrders.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredOrders.length, page]);

  const setFilter = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key); else next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const openCreate = useCallback(() => {
    setEditingOrder(null);
    setForm(blank());
    setFormOpen(true);
    const next = new URLSearchParams(params);
    next.set('create', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingOrder(null);
    setForm(blank());
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    toast.success(editingOrder ? 'PO updated' : 'PO created');
    closeForm();
  }, [editingOrder, closeForm]);

  const openEdit = useCallback((order: PurchaseOrderRecord) => {
    setViewOrder(null);
    setEditingOrder(order);
    setForm(editForm(order));
    setFormOpen(true);
    const next = new URLSearchParams(params);
    next.set('create', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const viewDetails = useCallback((order: PurchaseOrderRecord) => {
    setViewOrder(order);
    const next = new URLSearchParams(params);
    next.set('open', order.id);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closeDetails = useCallback(() => {
    setViewOrder(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const transition = useCallback((order: PurchaseOrderRecord, nextStatus: PurchaseOrderStatus) => {
    const updated = { ...order, status: nextStatus };
    setViewOrder(updated as PurchaseOrderRecord);
    toast.success(`PO marked as ${nextStatus}`);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const exportSelected = useCallback(() => {
    const rows = orders.filter((o) => selected.has(o.id));
    if (!rows.length) { toast.error('No POs selected'); return; }
    downloadCsv(rows, `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} PO${rows.length > 1 ? 's' : ''}`);
    setSelected(new Set());
  }, [orders, selected]);

  const deleteOrder = useCallback((id: string) => {
    toast.success('PO deleted');
    setDeleteOpen(false);
    if (viewOrder?.id === id) closeDetails();
    setSelected((s) => { const next = new Set(s); next.delete(id); return next; });
  }, [viewOrder, closeDetails]);

  const addNote = useCallback(() => {
    if (!noteText.trim()) return toast.error('Note is empty');
    toast.success('Note added');
    setNoteText('');
    setNoteOrder(null);
  }, [noteText]);

  return (
    <div className="space-y-4 pb-20 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour="mobile-purchase-orders-header" className="text-xl font-bold text-[var(--color-text)]">Purchase Orders</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{filteredOrders.length} PO{filteredOrders.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && selected.size > 0 && (
            <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportSelected}>Export</Button>
          )}
          {canCreate && (
            <Button size="sm" data-tour="purchase-orders-create" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New</Button>
          )}
        </div>
      </div>

      {/* Search */}
      <Input
        data-tour="purchase-orders-search"
        placeholder="Search PO, vendor or product..."
        value={filters.search}
        onChange={(e) => setFilter('q', e.target.value)}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[160px] flex-1">
          <Select
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            options={[
              { label: 'All Statuses', value: '' },
              ...PURCHASE_ORDER_STATUSES.map((s) => ({ label: s, value: s })),
            ]}
          />
        </div>
        <div className="min-w-[130px] flex-1">
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
            {selected.size} PO{selected.size !== 1 ? 's' : ''} selected
          </span>
          <div className="ml-auto flex gap-2">
            {canDelete && (
              <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />}
                onClick={() => { selected.forEach((id) => deleteOrder(id)); }}>
                Delete
              </Button>
            )}
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              ✕ Clear
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
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

      {/* Error state */}
      {!isLoading && filteredOrders.length === 0 && (
        <Card className="p-8 text-center">
          <ShoppingCart className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text-muted)]">
            {filters.search || filters.status || filters.date !== 'all'
              ? 'No purchase orders match your filters'
              : 'No purchase orders yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
            {filters.search || filters.status || filters.date !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create your first purchase order to get started'}
          </p>
          {!filters.search && !filters.status && filters.date === 'all' && canCreate && (
            <Button size="sm" className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Create First PO
            </Button>
          )}
        </Card>
      )}

      {/* Cards */}
      {!isLoading && paginatedOrders.length > 0 && (
        <>
          <div className="space-y-3" data-tour="purchase-orders-table">
            {paginatedOrders.map((order) => {
              const isSelected = selected.has(order.id);
              return (
                <Card
                  key={order.id}
                  data-tour="purchase-orders-row-view"
                  className={`cursor-pointer p-4 transition-all active:scale-[0.98] ${isSelected ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
                  onClick={() => viewDetails(order)}
                >
                  {/* Selection checkbox overlay */}
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(order.id)}
                        className="cursor-pointer rounded border-[var(--color-border)] text-indigo-600"
                      />
                      <span className="text-xs font-semibold text-[var(--color-primary-text)]">{order.purchaseOrderId}</span>
                    </label>
                    {statusBadge(order.status)}
                  </div>

                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <span className="font-medium text-[var(--color-text)]">{order.vendorName}</span>
                  </div>

                  {order.projectName && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                      <FolderKanban className="h-3 w-3" />
                      <span>{order.projectName}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>Due {fmtDate(order.expectedDeliveryDate)}</span>
                    </div>
                    <span className="font-semibold text-[var(--color-text)]">{fmtCurrency(order.total, currency)}</span>
                  </div>

                  {/* Quick action buttons */}
                  <div className="mt-3 flex gap-2 border-t border-[var(--color-border-subtle)] pt-3" onClick={(e) => e.stopPropagation()}>
                    {canEdit && order.status === 'Draft' && (
                      <Button size="xs" variant="outline" icon={<Edit2 className="h-3 w-3" />}
                        onClick={() => openEdit(order)}>
                        Edit
                      </Button>
                    )}
                    {PURCHASE_ORDER_TRANSITIONS[order.status]?.filter(next => !['PartiallyReceived', 'Received'].includes(next)).slice(0, 2).map((next) => (
                      <Button key={next} size="xs"
                        variant={next === 'Cancelled' ? 'danger' : 'primary'}
                        onClick={() => transition(order, next as PurchaseOrderStatus)}>
                        {next === 'Sent' ? 'Send' : next}
                      </Button>
                    ))}
                    <Button size="xs" variant="outline" icon={<Eye className="h-3 w-3" />}
                      onClick={() => viewDetails(order)}>
                      View
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          <div data-tour="purchase-orders-pagination">
            <Pagination
              page={page}
              total={filteredOrders.length}
              perPage={PER_PAGE}
              onChange={(p) => { setPage(p); const next = new URLSearchParams(params); next.set('page', String(p)); setParams(next, { replace: true }); }}
            />
          </div>
        </>
      )}

      {/* Create / Edit Modal */}
      <Modal open={formOpen} onClose={closeForm} title={editingOrder ? `Edit ${editingOrder.purchaseOrderId}` : 'New Purchase Order'} size="full">
        <PurchaseOrderForm
          value={form}
          vendors={vendors as any[]}
          products={products as any[]}
          projects={[]}
          currencySymbol={currency}
          onChange={setForm}
          onSubmit={submit}
          onCancel={closeForm}
          saving={false}
        />
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!viewOrder} onClose={closeDetails} title={viewOrder?.purchaseOrderId || 'Purchase Order'} size="full">
        {viewOrder && (
          <div className="space-y-4 text-sm">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{viewOrder.purchaseOrderId}</h2>
                  {statusBadge(viewOrder.status)}
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{viewOrder.vendorName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">Expected {fmtDate(viewOrder.expectedDeliveryDate)}</p>
              </div>
              <span className="text-lg font-bold text-[var(--color-text)]">{fmtCurrency(viewOrder.total, currency)}</span>
            </div>

            {/* Project */}
            {viewOrder.projectName && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-sunken)] p-3">
                <FolderKanban className="h-4 w-4 text-[var(--color-primary)]" />
                <span className="text-xs">Project: <b>{viewOrder.projectName}</b></span>
              </div>
            )}

            {/* Contact info */}
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {(viewOrder as any).vendorPhone && (
                <a href={`tel:${(viewOrder as any).vendorPhone}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-border)] p-2 text-xs hover:bg-[var(--color-surface-hover)]">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
              {(viewOrder as any).vendorEmail && (
                <a href={`mailto:${(viewOrder as any).vendorEmail}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-border)] p-2 text-xs hover:bg-[var(--color-surface-hover)]">
                  <Mail className="h-3.5 w-3.5" /> Email
                </a>
              )}
            </div>

            {/* Timeline Preview */}
            <MobileTimelinePreview
              title="Activity"
              entries={[
                viewOrder.createdAt && { type: 'Created' as const, description: `Purchase order created`, date: viewOrder.createdAt, user: viewOrder.createdBy || 'System' },
                viewOrder.updatedAt && { type: 'Updated' as const, description: `Purchase order updated`, date: viewOrder.updatedAt, user: viewOrder.updatedBy || 'System' },
                ...(viewOrder.statusHistory || []).map((h: any) => ({
                  type: `Status: ${h.status}` as const,
                  description: `Status changed to ${h.status}`,
                  date: h.changedAt,
                  user: h.changedBy || 'System',
                })),
              ].filter(Boolean) as any[]}
            />

            <div className="space-y-3">
              {/* Status transition buttons */}
              {canEdit && PURCHASE_ORDER_TRANSITIONS[viewOrder.status]?.filter(next => !['PartiallyReceived', 'Received'].includes(next)).map((next) => (
                <Button key={next} className="w-full"
                  variant={next === 'Cancelled' ? 'danger' : 'primary'}
                  onClick={() => transition(viewOrder, next as PurchaseOrderStatus)}>
                  {next === 'Sent' ? 'Send to Vendor' : `Mark ${next}`}
                </Button>
              ))}

              {canEdit && viewOrder.status === 'Draft' && (
                <Button className="w-full" variant="outline" onClick={() => { openEdit(viewOrder); }}>
                  Edit Draft
                </Button>
              )}

              {canDelete && (
                <Button className="w-full" variant="danger" onClick={() => setDeleteOpen(true)}>
                  Delete PO
                </Button>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <h3 className="font-semibold text-[var(--color-text)]">Notes</h3>
              {viewOrder.notes ? (
                <p className="rounded-xl bg-[var(--color-bg-sunken)] p-3 text-xs leading-relaxed">
                  {viewOrder.notes}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">No notes recorded.</p>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a note..."
                  value={noteOrder === viewOrder ? noteText : ''}
                  onChange={(e) => { setNoteText(e.target.value); setNoteOrder(viewOrder); }}
                />
                <Button size="sm" onClick={addNote}>Add</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => viewOrder && deleteOrder(viewOrder.id)}
        title="Delete Purchase Order"
        message={`Delete purchase order ${viewOrder?.purchaseOrderId || ''} permanently?`}
      />

      <ConfirmDialog
        open={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        onConfirm={() => {
          if (!bulkStatus) { toast.error('Select a status'); return; }
          toast.success(`Status updated for ${selected.size} PO${selected.size > 1 ? 's' : ''}`);
          setBulkStatusOpen(false);
          setSelected(new Set());
        }}
        title="Change Status"
        message={`Update ${selected.size} PO${selected.size > 1 ? 's' : ''} to ${bulkStatus || 'selected status'}?`}
      />
    </div>
  );
}
