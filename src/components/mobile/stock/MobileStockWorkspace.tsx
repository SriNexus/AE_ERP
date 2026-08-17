import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Download, Edit2, Mail, MessageCircle, Package, Phone, Plus, Target, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  STOCK_FORM_DEFAULT,
  exportStockCSV,
  useDeleteStockEntry,
  useProducts,
  useSaveStockEntry,
  useStock,
  useStockSummary,
  type StockForm,
} from '../../../features/inventory/hooks/useInventory';
import { useWarehouses } from '../../../features/warehouses/hooks/useWarehouses';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import { getInventoryMovements, summarizeMovements, type InventoryMovement } from '../../../lib/inventoryMovements';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { stockIn } from '../../../lib/stockWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import type { Product } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Mode = 'records' | 'create';
type StockView = 'summary' | 'ledger';
type MobileStockRow = Record<string, any>;
type StockFilters = {
  search: string;
  warehouse: string;
  category: string;
  status: string;
  date: string;
};
type StockInForm = {
  productId: string;
  warehouseId: string;
  qty: string;
  unit: string;
  sourceType: 'purchase' | 'return' | 'adjustment';
  sourceId: string;
  notes: string;
};

function normalize(value?: string) {
  return String(value || '').trim().toLowerCase();
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInDateRange(value: any, range: string) {
  if (range === 'all' || range === ALL) return true;
  const date = toDate(value);
  if (!date) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days ? date >= new Date(Date.now() - days * 86400000) : true;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);
}

function cleanPhone(phone?: string) {
  return String(phone || '').replace(/\D/g, '');
}

function whatsappHref(phone?: string) {
  const value = cleanPhone(phone);
  return value ? `https://wa.me/${value}` : undefined;
}

function productFor(row: MobileStockRow, productMap: Map<string, Product>) {
  return productMap.get(String(row.productId || row.product || '').trim()) as (Product & Record<string, any>) | undefined;
}

function warehouseFor(row: MobileStockRow, warehouseMap: Map<string, any>) {
  const id = String(row.warehouseId || row.warehouse || '').trim();
  return id ? warehouseMap.get(id) : undefined;
}

function productLabel(row: MobileStockRow, productMap: Map<string, Product>) {
  const product = productFor(row, productMap);
  return product?.name || row.productName || row.product || row.name || 'Product not set';
}

function productCode(row: MobileStockRow, productMap: Map<string, Product>) {
  const product = productFor(row, productMap) as any;
  return product?.sku || product?.productCode || row.sku || row.productCode || 'SKU not set';
}

function productCategory(row: MobileStockRow, productMap: Map<string, Product>) {
  const product = productFor(row, productMap) as any;
  return row.category || product?.category || 'Uncategorized';
}

function warehouseLabel(row: MobileStockRow, warehouseMap: Map<string, any>) {
  const warehouse = warehouseFor(row, warehouseMap);
  return warehouse?.name || row.warehouseName || row.warehouse || 'Warehouse not set';
}

function warehouseLocation(row: MobileStockRow, warehouseMap: Map<string, any>) {
  const warehouse = warehouseFor(row, warehouseMap);
  return [warehouse?.city, warehouse?.state].filter(Boolean).join(', ') || warehouse?.location || 'Location not set';
}

function stockSummaryStatus(row: MobileStockRow, productMap: Map<string, Product>) {
  const product = productFor(row, productMap) as any;
  const available = Number(row.availableQty ?? row.available) || 0;
  const reserved = Number(row.reservedQty ?? row.reserved) || 0;
  const minStock = Number(row.min_stock ?? row.lowStockThreshold ?? product?.lowStockThreshold ?? 5) || 5;
  if (row.status === 'Inactive') return 'Inactive';
  if (available <= 0) return 'Out Of Stock';
  if (reserved > 0) return 'Reserved';
  if (available <= minStock) return 'Low Stock';
  return 'In Stock';
}

function stockLedgerStatus(row: MobileStockRow) {
  return String(row.type || row.movementType || row.sourceType || 'IN').toUpperCase();
}

function stockStatusVariant(status: string) {
  if (status === 'Out Of Stock' || status === 'OUT') return 'danger';
  if (status === 'Low Stock' || status === 'Reserved' || status === 'ADJUSTMENT' || status === 'RESERVED') return 'warning';
  if (status === 'RELEASED') return 'info';
  if (status === 'Inactive') return 'info';
  return 'success';
}

function stockTotal(row: MobileStockRow) {
  return (Number(row.availableQty ?? row.available) || 0) + (Number(row.reservedQty ?? row.reserved) || 0);
}

function matchesStockRecord(row: MobileStockRow, filters: StockFilters, mode: StockView, productMap: Map<string, Product>, warehouseMap: Map<string, any>) {
  const term = filters.search.trim().toLowerCase();
  const product = productFor(row, productMap) as any;
  const warehouse = warehouseFor(row, warehouseMap);
  const status = mode === 'summary' ? stockSummaryStatus(row, productMap) : stockLedgerStatus(row);
  if (filters.status !== ALL && status !== filters.status) return false;
  if (filters.warehouse !== ALL && String(row.warehouseId || row.warehouse || '') !== filters.warehouse) return false;
  if (filters.category !== ALL && productCategory(row, productMap) !== filters.category) return false;
  if (!isInDateRange(row.updatedAt || row.createdAt || row.date || row.movementAt, filters.date)) return false;
  if (!term) return true;
  return [
    row.id,
    row.product,
    row.productName,
    row.reference,
    row.sourceId,
    row.notes,
    row.createdBy,
    row.performedBy,
    product?.name,
    product?.sku,
    product?.productCode,
    product?.category,
    warehouse?.name,
    warehouse?.code,
    warehouse?.city,
    warehouse?.state,
  ].some((value) => String(value || '').toLowerCase().includes(term));
}

function sortStockRows(rows: MobileStockRow[]) {
  return [...rows].sort((a, b) => {
    const aTime = toDate(a.updatedAt || a.createdAt || a.date || a.movementAt)?.getTime() || 0;
    const bTime = toDate(b.updatedAt || b.createdAt || b.date || b.movementAt)?.getTime() || 0;
    return bTime - aTime;
  });
}

function relatedRowsByProductOrWarehouse(rows: MobileStockRow[], record: MobileStockRow) {
  return rows.filter((row) =>
    (record.productId && row.productId === record.productId) ||
    (record.warehouseId && row.warehouseId === record.warehouseId)
  );
}

export function MobileStockWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((state) => state.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: stockSummary = [], isLoading: summaryLoading, error: summaryError, refetch: refetchSummary } = useStockSummary();
  const { data: stockLedger = [], isLoading: ledgerLoading, error: ledgerError, refetch: refetchLedger } = useStock();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const { data: users = [] } = useQuery({ queryKey: queryKeys.global.users, queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });
  const { data: dispatches = [] } = useQuery({ queryKey: keys.dispatchAll, queryFn: () => getAll(COLLECTIONS.DISPATCH), staleTime: 60000 });
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: quotations = [] } = useQuery({ queryKey: keys.quotationsAll, queryFn: () => getAll(COLLECTIONS.QUOTATIONS), staleTime: 60000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });

  const [view, setView] = useState<StockView>((params.get('tab') as StockView) === 'ledger' ? 'ledger' : 'summary');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<MobileStockRow | null>(null);
  const [viewMode, setViewMode] = useState<StockView>('summary');
  const [form, setForm] = useState<StockForm>({ ...STOCK_FORM_DEFAULT });
  const [stockInForm, setStockInForm] = useState<StockInForm>({ productId: '', warehouseId: '', qty: '', unit: 'PCS', sourceType: 'purchase', sourceId: '', notes: '' });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MobileStockRow | null>(null);

  const canCreate = perms.canCreate('stock');
  const canEdit = perms.canEdit('stock');
  const canDelete = perms.canDelete('stock');
  const canExport = perms.canExport('stock') || canEdit || canCreate;
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';
  const createParam = params.get('create') || '';

  const productMap = useMemo(() => new Map((products as Product[]).map((product) => [product.id, product])), [products]);
  const warehouseMap = useMemo(() => new Map((warehouses as any[]).map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const userMap = useMemo(() => new Map((users as any[]).flatMap((user) => [
    [normalize(user.id), user],
    [normalize(user.email), user],
    [normalize(user.name), user],
  ])), [users]);
  const productOptions = useMemo(() => (products as any[]).map((product) => ({ label: product.name || product.id, value: product.id })), [products]);
  const warehouseOptions = useMemo(() => (warehouses as any[]).map((warehouse) => ({ label: warehouse.name || warehouse.id, value: warehouse.id })), [warehouses]);
  const categoryOptions = useMemo(() => Array.from(new Set((products as any[]).map((product) => product.category).filter(Boolean))).sort(), [products]);

  useEffect(() => {
    if (mode === 'create') {
      setStockInOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setStockInForm({ productId: '', warehouseId: '', qty: '', unit: 'PCS', sourceType: 'purchase', sourceId: '', notes: '' });
    setDirty(false);
    setStockInOpen(true);
  }, [mode, params]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewRecord) return;
    const summary = (stockSummary as MobileStockRow[]).find((row) => row.id === openId);
    const ledger = (stockLedger as MobileStockRow[]).find((row) => row.id === openId);
    if (summary) {
      setViewRecord(summary);
      setViewMode('summary');
    } else if (ledger) {
      setViewRecord(ledger);
      setViewMode('ledger');
    }
  }, [params, stockLedger, stockSummary, viewRecord]);

  const filters = useMemo<StockFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    warehouse: params.get('warehouse') || ALL,
    category: params.get('category') || ALL,
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const summaryRows = useMemo(() => sortStockRows((stockSummary as MobileStockRow[]).filter((row) => matchesStockRecord(row, filters, 'summary', productMap, warehouseMap))), [filters, productMap, stockSummary, warehouseMap]);
  const ledgerRows = useMemo(() => sortStockRows((stockLedger as MobileStockRow[]).filter((row) => matchesStockRecord(row, filters, 'ledger', productMap, warehouseMap))), [filters, productMap, stockLedger, warehouseMap]);
  const rows = view === 'summary' ? summaryRows : ledgerRows;
  const loading = view === 'summary' ? summaryLoading : ledgerLoading;
  const error = view === 'summary' ? summaryError : ledgerError;
  const paginatedRows = useMemo(() => rows.slice((page - 1) * PER_PAGE, page * PER_PAGE), [page, rows]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [page, rows.length]);

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set(rows.map((row) => row.id));
      const next = new Set(Array.from(current).filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const saveStockEntry = useSaveStockEntry(() => {
    closeAdjustmentForm();
    void refetchSummary();
    void refetchLedger();
  });
  const deleteStockEntry = useDeleteStockEntry();
  const stockInMutation = useMutation({
    mutationFn: () => stockIn({
      productId: stockInForm.productId,
      warehouseId: stockInForm.warehouseId,
      qty: Number(stockInForm.qty),
      unit: stockInForm.unit || 'PCS',
      sourceType: stockInForm.sourceType,
      sourceId: stockInForm.sourceId,
      notes: stockInForm.notes,
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.stock }),
        qc.invalidateQueries({ queryKey: keys.stockLedger }),
      ]);
      toast.success('Stock added');
      closeStockInForm();
      void refetchSummary();
      void refetchLedger();
    },
    onError: (e: any) => toast.error(e.message || 'Stock entry failed'),
  });

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function switchView(nextView: StockView) {
    setView(nextView);
    setSelected(new Set());
    setPage(1);
    const next = new URLSearchParams(params);
    next.set('tab', nextView);
    next.delete('page');
    setParams(next, { replace: true });
  }

  function openById(row: MobileStockRow, modeForRow: StockView) {
    setViewRecord(row);
    setViewMode(modeForRow);
    const next = new URLSearchParams(params);
    next.set('open', row.id);
    setParams(next, { replace: true });
  }

  function closeRecord() {
    setViewRecord(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }

  function closeStockInForm() {
    setStockInOpen(false);
    setStockInForm({ productId: '', warehouseId: '', qty: '', unit: 'PCS', sourceType: 'purchase', sourceId: '', notes: '' });
    setDirty(false);
    if (mode === 'create') navigate('/app', { replace: true });
    if (createParam === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function closeAdjustmentForm() {
    setFormOpen(false);
    setForm({ ...STOCK_FORM_DEFAULT });
    setDirty(false);
  }

  function requestCloseForm() {
    if (dirty) return setConfirmClose(true);
    closeStockInForm();
    closeAdjustmentForm();
  }

  function updateStockInForm(patch: Partial<StockInForm>) {
    setStockInForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function updateForm(patch: Partial<StockForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function openCreate() {
    setStockInForm({ productId: '', warehouseId: '', qty: '', unit: 'PCS', sourceType: 'purchase', sourceId: '', notes: '' });
    setDirty(false);
    setStockInOpen(true);
  }

  function openAdjust(row?: MobileStockRow, type: 'IN' | 'OUT' = 'IN') {
    closeRecord();
    const product = row ? productFor(row, productMap) as any : undefined;
    const warehouse = row ? warehouseFor(row, warehouseMap) : undefined;
    setForm({
      ...STOCK_FORM_DEFAULT,
      productId: row?.productId || '',
      product: row ? productLabel(row, productMap) : '',
      warehouseId: row?.warehouseId || '',
      warehouse: warehouse?.name || row?.warehouse || '',
      type,
      unit: row?.unit || product?.unit || 'PCS',
      date: new Date().toISOString().split('T')[0],
    });
    setDirty(false);
    setFormOpen(true);
  }

  function submitStockIn(event: React.FormEvent) {
    event.preventDefault();
    if (!stockInForm.productId || !stockInForm.warehouseId || !stockInForm.qty) return toast.error('Product, warehouse and quantity are required');
    stockInMutation.mutate();
  }

  function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!form.productId || !form.warehouseId || !form.qty) return toast.error('Product, warehouse and quantity are required');
    saveStockEntry.mutate(form);
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exportRows(rowsToExport: MobileStockRow[]) {
    if (!rowsToExport.length) return toast.error('No rows selected');
    exportStockCSV(rowsToExport);
  }

  async function deleteRows(rowsToDelete: MobileStockRow[]) {
    if (view !== 'ledger') return toast.error('Only ledger entries can be deleted');
    await Promise.all(rowsToDelete.map((row) => deleteStockEntry.mutateAsync(row.id)));
    setSelected(new Set());
    setDeleteTarget(null);
    closeRecord();
  }

  if (mode === 'create') {
    return (
      <StockDialogs
        stockInOpen={stockInOpen}
        formOpen={false}
        stockInForm={stockInForm}
        form={form}
        productOptions={productOptions}
        warehouseOptions={warehouseOptions}
        dirty={dirty}
        savingStockIn={stockInMutation.isPending}
        savingAdjustment={saveStockEntry.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeStockInForm(); closeAdjustmentForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onStockInChange={updateStockInForm}
        onFormChange={updateForm}
        onStockInSubmit={submitStockIn}
        onAdjustmentSubmit={submitAdjustment}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3" data-tour="stock-table">
        <div className="flex items-center justify-between gap-3">
          <h1 data-tour="mobile-stock-header" className="text-xl font-bold tracking-tight text-[var(--color-text)]">Stock</h1>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1">
          <button type="button" onClick={() => switchView('summary')} className={cn('rounded-lg px-3 py-2 text-sm font-bold transition-colors', view === 'summary' ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)]')}>Summary</button>
          <button type="button" onClick={() => switchView('ledger')} className={cn('rounded-lg px-3 py-2 text-sm font-bold transition-colors', view === 'ledger' ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)]')}>Ledger</button>
        </div>

        {selected.size > 0 ? (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canExport ? <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportRows(selectedRows)}>Export</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => openAdjust(selectedRows[0])}>Adjust</Button> : null}
              {view === 'ledger' && canDelete ? <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteTarget(selectedRows[0])}>Delete</Button> : null}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </Card>
        ) : null}

        {error ? (
          <Card className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Stock could not be loaded. <button type="button" className="font-bold underline" onClick={() => view === 'summary' ? refetchSummary() : refetchLedger()}>Retry</button>
          </Card>
        ) : null}

        <div className="space-y-2">
          {loading ? Array.from({ length: 5 }).map((_, index) => <StockSkeletonCard key={index} />) : null}
          {!loading && !paginatedRows.length ? (
            <Card className="rounded-xl p-6 text-center">
              <Target className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
              <p className="mt-3 text-sm font-bold text-[var(--color-text)]">
                {(filters.search || filters.status !== ALL || filters.warehouse !== ALL || filters.category !== ALL || filters.date !== 'all')
                  ? 'No stock records found'
                  : 'No stock records yet'}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {(filters.search || filters.status !== ALL || filters.warehouse !== ALL || filters.category !== ALL || filters.date !== 'all')
                  ? 'Clear search or filters to view inventory records.'
                  : 'Add your first stock entry to start tracking inventory.'}
              </p>
              {!filters.search && filters.status === ALL && filters.warehouse === ALL && filters.category === ALL && filters.date === 'all' && canCreate ? (
                <Button size="sm" data-tour="stock-create" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="mt-3">Add First Stock Entry</Button>
              ) : null}
            </Card>
          ) : null}
          {paginatedRows.map((row) => (
            <StockCard
              key={row.id}
              row={row}
              mode={view}
              selected={selected.has(row.id)}
              productMap={productMap}
              warehouseMap={warehouseMap}
              phone={companyPhone}
              email={companyEmail}
              onSelect={() => toggleSelect(row.id)}
              onView={() => openById(row, view)}
            />
          ))}
        </div>

        <div data-tour="stock-pagination">
          <Pagination page={page} total={rows.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      </div>

      <StockDialogs
        stockInOpen={stockInOpen}
        formOpen={formOpen}
        stockInForm={stockInForm}
        form={form}
        productOptions={productOptions}
        warehouseOptions={warehouseOptions}
        dirty={dirty}
        savingStockIn={stockInMutation.isPending}
        savingAdjustment={saveStockEntry.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeStockInForm(); closeAdjustmentForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onStockInChange={updateStockInForm}
        onFormChange={updateForm}
        onStockInSubmit={submitStockIn}
        onAdjustmentSubmit={submitAdjustment}
      />

      <StockViewModal
        record={viewRecord}
        mode={viewMode}
        productMap={productMap}
        warehouseMap={warehouseMap}
        userMap={userMap}
        stockSummary={stockSummary as MobileStockRow[]}
        stockLedger={stockLedger as MobileStockRow[]}
        dispatches={dispatches as any[]}
        orders={orders as any[]}
        quotations={quotations as any[]}
        invoices={invoices as any[]}
        canEdit={canEdit}
        canDelete={canDelete && viewMode === 'ledger'}
        canExport={canExport}
        companyPhone={companyPhone}
        companyEmail={companyEmail}
        onClose={closeRecord}
        onAdjust={(row, type) => openAdjust(row, type)}
        onDelete={(row) => setDeleteTarget(row)}
        onExport={(row) => exportRows([row])}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteRows(selected.size ? selectedRows : deleteTarget ? [deleteTarget] : [])}
        loading={deleteStockEntry.isPending}
        title="Delete Stock Entry"
        message="Delete selected ledger entry? Summary stock cannot be deleted from mobile."
      />
    </div>
  );
}

function StockCard({ row, mode, selected, productMap, warehouseMap, phone, email, onSelect, onView }: {
  row: MobileStockRow;
  mode: StockView;
  selected: boolean;
  productMap: Map<string, Product>;
  warehouseMap: Map<string, any>;
  phone: string;
  email: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const product = productFor(row, productMap) as any;
  const available = Number(row.availableQty ?? row.available) || 0;
  const reserved = Number(row.reservedQty ?? row.reserved) || 0;
  const incoming = Number(row.incomingQty ?? row.incoming ?? row.pendingQty) || 0;
  const status = mode === 'summary' ? stockSummaryStatus(row, productMap) : stockLedgerStatus(row);
  const qty = mode === 'ledger' ? Number(row.qty) || 0 : stockTotal(row);
  return (     <Card data-tour="stock-row" className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${productLabel(row, productMap)}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <div className="flex items-start gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]">
              {Array.isArray(product?.photos) && product.photos[0] ? <img src={product.photos[0]} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-[var(--color-text-muted)]" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{productLabel(row, productMap)}</p>
              <p className="mt-0.5 truncate font-mono text-xs font-medium text-[var(--color-text-muted)]">{productCode(row, productMap)}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{warehouseLabel(row, warehouseMap)}</p>
            <p className="truncate">{productCategory(row, productMap)}</p>
            <p className="truncate font-semibold text-[var(--color-text)]">{mode === 'ledger' ? `Qty ${formatNumber(qty)}` : `Available ${formatNumber(available)}`}</p>
            <p className="truncate">{mode === 'ledger' ? `After ${formatNumber(Number(row.afterQty) || 0)}` : `Reserved ${formatNumber(reserved)}`}</p>
            {mode === 'summary' ? <p className="truncate">Incoming {formatNumber(incoming)}</p> : <p className="truncate">{row.reference || row.sourceId || 'No reference'}</p>}
            <p className="truncate">{row.updatedAt || row.createdAt || row.date ? fmtDate(row.updatedAt || row.createdAt || row.date) : 'Not updated'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={stockStatusVariant(status)}>{status}</Badge>
            {mode === 'summary' ? <Badge variant="info">Total {formatNumber(stockTotal(row))}</Badge> : statusBadge(status)}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp stock" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !phone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={email ? `mailto:${email}?subject=${encodeURIComponent(productLabel(row, productMap))}` : undefined} aria-label="Email stock" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call stock" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function StockSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function StockDialogs({ stockInOpen, formOpen, stockInForm, form, productOptions, warehouseOptions, dirty, savingStockIn, savingAdjustment, confirmClose, onCloseForm, onDiscard, onKeepEditing, onStockInChange, onFormChange, onStockInSubmit, onAdjustmentSubmit }: {
  stockInOpen: boolean;
  formOpen: boolean;
  stockInForm: StockInForm;
  form: StockForm;
  productOptions: { label: string; value: string }[];
  warehouseOptions: { label: string; value: string }[];
  dirty: boolean;
  savingStockIn: boolean;
  savingAdjustment: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onStockInChange: (patch: Partial<StockInForm>) => void;
  onFormChange: (patch: Partial<StockForm>) => void;
  onStockInSubmit: (event: React.FormEvent) => void;
  onAdjustmentSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={stockInOpen} onClose={onCloseForm} title="Stock Entry" size="full">
        <form onSubmit={onStockInSubmit} className="space-y-4">
          <Section title="Product & Warehouse">
            <Select label="Product" required value={stockInForm.productId} onChange={(event) => {
              const selected = productOptions.find((option) => option.value === event.target.value);
              onStockInChange({ productId: event.target.value, unit: selected ? stockInForm.unit : 'PCS' });
            }} options={[{ label: 'Select product...', value: '' }, ...productOptions]} />
            <Select label="Warehouse" required value={stockInForm.warehouseId} onChange={(event) => onStockInChange({ warehouseId: event.target.value })} options={[{ label: 'Select warehouse...', value: '' }, ...warehouseOptions]} />
          </Section>
          <Section title="Stock In">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Quantity" required inputMode="decimal" value={stockInForm.qty} onChange={(event) => onStockInChange({ qty: event.target.value })} />
              <Input label="Unit" value={stockInForm.unit} onChange={(event) => onStockInChange({ unit: event.target.value })} />
            </div>
            <Select label="Source Type" value={stockInForm.sourceType} onChange={(event) => onStockInChange({ sourceType: event.target.value as StockInForm['sourceType'] })} options={[{ label: 'Purchase', value: 'purchase' }, { label: 'Return', value: 'return' }, { label: 'Adjustment', value: 'adjustment' }]} />
            <Input label="Reference Number" value={stockInForm.sourceId} onChange={(event) => onStockInChange({ sourceId: event.target.value })} />
            <Textarea label="Remarks" value={stockInForm.notes} onChange={(event) => onStockInChange({ notes: event.target.value })} rows={3} />
          </Section>
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={savingStockIn}>Save</Button>
          </div>
        </form>
      </Modal>

      <Modal open={formOpen} onClose={onCloseForm} title="Stock Adjustment" size="full">
        <form onSubmit={onAdjustmentSubmit} className="space-y-4">
          <Section title="Adjustment">
            <Select label="Transaction Type" value={form.type} onChange={(event) => onFormChange({ type: event.target.value as StockForm['type'] })} options={[{ label: 'IN (Stock In)', value: 'IN' }, { label: 'OUT (Stock Out)', value: 'OUT' }]} />
            <Select label="Product" required value={form.productId} onChange={(event) => {
              const selected = productOptions.find((option) => option.value === event.target.value);
              onFormChange({ productId: event.target.value, product: selected?.label || '' });
            }} options={[{ label: 'Select product...', value: '' }, ...productOptions]} />
            <Select label="Warehouse" required value={form.warehouseId} onChange={(event) => {
              const selected = warehouseOptions.find((option) => option.value === event.target.value);
              onFormChange({ warehouseId: event.target.value, warehouse: selected?.label || '' });
            }} options={[{ label: 'Select warehouse...', value: '' }, ...warehouseOptions]} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Quantity" required inputMode="decimal" value={form.qty} onChange={(event) => onFormChange({ qty: event.target.value })} />
              <Input label="Date" type="date" value={form.date} onChange={(event) => onFormChange({ date: event.target.value })} />
            </div>
            <Input label="Reference Number" value={form.reference} onChange={(event) => onFormChange({ reference: event.target.value })} />
            <Textarea label="Reason / Remarks" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} rows={3} />
          </Section>
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={savingAdjustment}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function StockViewModal({ record, mode, productMap, warehouseMap, userMap, stockSummary, stockLedger, dispatches, orders, quotations, invoices, canEdit, canDelete, canExport, companyPhone, companyEmail, onClose, onAdjust, onDelete, onExport }: {
  record: MobileStockRow | null;
  mode: StockView;
  productMap: Map<string, Product>;
  warehouseMap: Map<string, any>;
  userMap: Map<string, any>;
  stockSummary: MobileStockRow[];
  stockLedger: MobileStockRow[];
  dispatches: any[];
  orders: any[];
  quotations: any[];
  invoices: any[];
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  companyPhone: string;
  companyEmail: string;
  onClose: () => void;
  onAdjust: (row: MobileStockRow, type?: 'IN' | 'OUT') => void;
  onDelete: (row: MobileStockRow) => void;
  onExport: (row: MobileStockRow) => void;
}) {
  const { data: movements = [] } = useQuery({
    queryKey: ['stock-movements', record?.productId, record?.warehouseId],
    queryFn: () => getInventoryMovements({ productId: record?.productId, warehouseId: record?.warehouseId, limit: 20 }),
    enabled: Boolean(record?.productId || record?.warehouseId),
    staleTime: 30000,
  });

  if (!record) return null;
  const product = productFor(record, productMap) as any;
  const warehouse = warehouseFor(record, warehouseMap);
  const summary = mode === 'summary' ? record : stockSummary.find((row) => row.productId === record.productId && row.warehouseId === record.warehouseId) || {};
  const available = Number(summary.availableQty ?? summary.available) || 0;
  const reserved = Number(summary.reservedQty ?? summary.reserved) || 0;
  const incoming = Number(summary.incomingQty ?? summary.incoming ?? summary.pendingQty) || 0;
  const minStock = Number(summary.min_stock ?? summary.lowStockThreshold ?? product?.lowStockThreshold ?? 5) || 5;
  const maxStock = Number(summary.max_stock ?? summary.maxStock ?? product?.maxStock) || 0;
  const status = stockSummaryStatus(summary, productMap);
  const movementSummary = summarizeMovements(movements as InventoryMovement[]);
  const relatedLedger = relatedRowsByProductOrWarehouse(stockLedger, record);
  const relatedOrders = orders.filter((order) => order.items?.some((item: any) => item.productId === record.productId));
  const relatedQuotations = quotations.filter((quotation) => quotation.items?.some((item: any) => item.productId === record.productId));
  const relatedInvoices = invoices.filter((invoice) => invoice.items?.some((item: any) => item.productId === record.productId));
  const relatedDispatches = dispatches.filter((dispatch) => dispatch.items?.some((item: any) => item.productId === record.productId || item.warehouseId === record.warehouseId));
  const actor = userMap.get(normalize(record.updatedBy || record.createdBy || record.performedBy));

  return (
    <Modal open={!!record} onClose={onClose} title={productLabel(record, productMap)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={stockStatusVariant(status)}>{status}</Badge>
            {mode === 'ledger' ? <Badge variant={stockStatusVariant(stockLedgerStatus(record))}>{stockLedgerStatus(record)}</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Available" value={formatNumber(available)} />
            <Detail label="Reserved" value={formatNumber(reserved)} />
          </div>
        </section>

        <Section title="Product Information">
          <Detail label="Product" value={productLabel(record, productMap)} />
          <Detail label="SKU" value={productCode(record, productMap)} />
          <Detail label="Category" value={productCategory(record, productMap)} />
          <Detail label="Unit" value={summary.unit || product?.unit || record.unit || 'PCS'} />
          <Detail label="Product Status" value={product?.status || 'Active'} />
        </Section>

        <Section title="Warehouse Information">
          <Detail label="Warehouse" value={warehouseLabel(record, warehouseMap)} />
          <Detail label="Warehouse Code" value={warehouse?.code || 'Not available'} />
          <Detail label="Location" value={warehouseLocation(record, warehouseMap)} />
          <Detail label="Warehouse Status" value={warehouse?.status || 'Active'} />
        </Section>

        <Section title="Current Stock">
          <Detail label="Available Quantity" value={formatNumber(available)} />
          <Detail label="Reserved Quantity" value={formatNumber(reserved)} />
          <Detail label="Total Quantity" value={formatNumber(available + reserved)} />
          <Detail label="Incoming Quantity" value={formatNumber(incoming)} />
          <Detail label="Outgoing Quantity" value={formatNumber(Math.max(0, movementSummary.totalOut))} />
          <Detail label="Reorder Level" value={formatNumber(minStock)} />
          <Detail label="Maximum Stock" value={maxStock ? formatNumber(maxStock) : 'Not set'} />
          <Detail label="Stock Status" value={status} />
        </Section>

        <Section title="Recent Stock Movements">
          {(movements as InventoryMovement[]).length ? (movements as InventoryMovement[]).slice(0, 8).map((movement) => (
            <div key={movement.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{movement.movementType || movement.type || 'Movement'} · {formatNumber(movement.qty)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{movement.sourceType || 'manual'} {movement.sourceId ? `· ${movement.sourceId}` : ''} {movement.date || movement.createdAt ? `· ${fmtDate(movement.date || movement.createdAt || '')}` : ''}</p>
            </div>
          )) : <p className="text-sm text-[var(--color-text-muted)]">No movement history found.</p>}
        </Section>

        <RelatedRows title="Related Orders" rows={relatedOrders} />
        <RelatedRows title="Related Quotations" rows={relatedQuotations} />
        <RelatedRows title="Related Invoices" rows={relatedInvoices} />
        <RelatedRows title="Related Dispatches" rows={relatedDispatches} />

        <Section title="Timeline">
          <MobileTimelinePreview
            title={`${productLabel(record, productMap)} Timeline`}
            entries={relatedLedger.map((entry) => ({
              type: stockLedgerStatus(entry),
              desc: `${entry.reference || entry.sourceId || 'No reference'} · Qty ${formatNumber(Number(entry.qty) || 0)}`,
              date: entry.modifiedAt || entry.updatedAt || entry.createdAt || entry.date || entry.movementAt,
              userName: entry.performedByName || entry.performedBy || entry.createdBy || 'Inventory',
            }))}
          />
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{record.notes || summary.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{record.attachmentName || record.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={actor?.name || actor?.email || record.createdByName || record.createdBy || 'System'} />
          <Detail label="Created" value={record.createdAt ? fmtDate(record.createdAt) : 'Not available'} />
          <Detail label="Updated" value={record.updatedAt ? fmtDate(record.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {companyPhone ? <a className={linkButtonClass} href={`tel:${companyPhone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {companyPhone ? <a className={linkButtonClass} href={whatsappHref(companyPhone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {companyEmail ? <a className={linkButtonClass} href={`mailto:${companyEmail}?subject=${encodeURIComponent(productLabel(record, productMap))}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canExport ? <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => onExport(record)}>Export</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => onAdjust(record, 'IN')}>Stock In</Button> : null}
          {canEdit ? <Button variant="outline" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => onAdjust(record, 'OUT')}>Stock Out</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(record)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function RelatedRows({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Section title={title}>
      {rows.length ? rows.slice(0, 6).map((row) => (
        <div key={row.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
          <p className="text-sm font-semibold text-[var(--color-text)]">{row.orderNumber || row.quotationNumber || row.invoiceNumber || row.piNumber || row.dispatchNumber || row.id}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.customerName || row.customer || row.status || 'Related record'}</p>
        </div>
      )) : <p className="text-sm text-[var(--color-text-muted)]">No related records.</p>}
    </Section>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3><div className="mt-3 space-y-3">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p></div>;
}

export default MobileStockWorkspace;
