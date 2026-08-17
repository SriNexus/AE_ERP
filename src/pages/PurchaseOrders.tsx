import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Plus, Download, Trash2, Eye, RefreshCw,
  CheckCircle2, X, FileText, Search,
  Activity, Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getAll, updateDocById, deleteDocById, fmtCurrency } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { COLLECTIONS } from '../lib/firebase';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { statusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Input';
import { PurchaseOrderForm } from '../features/procurement/components/PurchaseOrderForm';
import { useVendors } from '../features/procurement/hooks/useVendors';
import { PURCHASE_ORDER_FORM_DEFAULT, PURCHASE_ORDER_STATUSES, type PurchaseOrderFormValues, type PurchaseOrderRecord } from '../features/procurement/types';
import { useSalesProducts } from '../features/sales/hooks/useSales';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';

const PER_PAGE = 10;

function newForm(): PurchaseOrderFormValues {
  const today = new Date().toISOString().slice(0, 10);
  return { ...PURCHASE_ORDER_FORM_DEFAULT, orderDate: today, items: PURCHASE_ORDER_FORM_DEFAULT.items.map((item) => ({ ...item })) };
}

function formFromRecord(record: PurchaseOrderRecord): PurchaseOrderFormValues {
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

function asDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value && 'seconds' in value) return new Date(Number(value.seconds) * 1000);
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: unknown): string {
  const date = asDate(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
}

function downloadPoCsv(rows: PurchaseOrderRecord[], filename: string) {
  const headers = ['PO', 'Vendor', 'Project', 'Order Date', 'Delivery Date', 'Items', 'Total', 'Status'];
  const lines = rows.map(o =>
    [o.purchaseOrderId, o.vendorName, o.projectName || '', o.orderDate, o.expectedDeliveryDate, o.items.length, o.total, o.status]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const company = useAppStore(s => s.company);
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const currency = company.currencySymbol;
  const perms = usePermissions();
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const navigate = useNavigate();

  const { data: purchaseOrders = [], isLoading, refetch } = useQuery({
    queryKey: qkeys.purchaseOrders || ['purchaseOrders', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.PURCHASE_ORDERS || 'purchaseOrders'),
    staleTime: 30000,
  });
  const { data: vendors = [] } = useVendors();
  const { data: products = [] } = useSalesProducts();

  const [searchParams, setSearchParams] = useSearchParams();
  const createParam = searchParams.get('create') || '';
  const editParam = searchParams.get('edit') || '';
  const projectIdParam = searchParams.get('projectId') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [vendorF, setVendorF] = useState(() => searchParams.get('vendor') || '');
  const [projectF, setProjectF] = useState(() => searchParams.get('project') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(createParam === '1');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PurchaseOrderFormValues>(newForm());
  const [delId, setDelId] = useState<string | null>(null);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  function syncParams(next: {
    q?: string; status?: string; vendor?: string; project?: string;
    date?: string; from?: string; to?: string; kpi?: string; page?: number; perPage?: number;
  }) {
    const p = new URLSearchParams(searchParams);
    const q = next.q ?? search; const status = next.status ?? statusF;
    const vendor = next.vendor ?? vendorF; const project = next.project ?? projectF;
    const date = next.date ?? dateRange; const from = next.from ?? customFrom; const to = next.to ?? customTo;
    const kpi = next.kpi ?? activeKpi; const pg = next.page ?? page; const pp = next.perPage ?? perPage;
    if (q) p.set('q', q); else p.delete('q');
    if (status) p.set('status', status); else p.delete('status');
    if (vendor) p.set('vendor', vendor); else p.delete('vendor');
    if (project) p.set('project', project); else p.delete('project');
    if (date && date !== 'all') p.set('date', date); else p.delete('date');
    if (from) p.set('from', from); else p.delete('from');
    if (to) p.set('to', to); else p.delete('to');
    if (kpi) p.set('kpi', kpi); else p.delete('kpi');
    if (pg > 1) p.set('page', String(pg)); else p.delete('page');
    if (pp !== PER_PAGE) p.set('perPage', String(pp)); else p.delete('perPage');
    setSearchParams(p, { replace: true });
  }

  // ── Create from URL (optionally pre-scoped to a project — the embedded
  // Procurement workspace links here with ?create=1&projectId=…) ──
  useEffect(() => {
    if (createParam !== '1') return;
    const next = newForm();
    if (projectIdParam) next.projectId = projectIdParam;
    setForm(next);
    setEditId(null);
    setShowForm(true);
  }, [createParam, projectIdParam]);

  // ── Edit from URL (the /purchase-orders/:id workspace's Edit PO quick
  // action deep-links here; the retired popup's ?open= machinery is gone) ──
  useEffect(() => {
    if (!editParam || isLoading) return;
    const target = (purchaseOrders as PurchaseOrderRecord[]).find(o => o.id === editParam);
    if (!target) return;
    setForm(formFromRecord(target));
    setEditId(target.id);
    setShowForm(true);
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [editParam, isLoading, purchaseOrders, searchParams, setSearchParams]);

  // ── Filter ──
  const orders = purchaseOrders as PurchaseOrderRecord[];

  const filtered = useMemo(() => {
    let list = orders;

    if (activeKpi === 'Draft') list = list.filter(o => o.status === 'Draft');
    else if (activeKpi === 'Sent') list = list.filter(o => o.status === 'Sent');
    else if (activeKpi === 'Received') list = list.filter(o => o.status === 'Received' || o.status === 'PartiallyReceived');
    else if (activeKpi === 'Cancelled') list = list.filter(o => o.status === 'Cancelled');

    const q = search.toLowerCase();
    if (q) list = list.filter(o =>
      [o.purchaseOrderId, o.vendorName, o.vendorGstin, o.projectName, ...o.items.map(i => i.product)]
        .some(v => String(v || '').toLowerCase().includes(q))
    );

    if (statusF) list = list.filter(o => o.status === statusF);
    if (vendorF) list = list.filter(o => o.vendorId === vendorF);
    if (projectF) list = list.filter(o => projectF === '__none__' ? !o.projectId : o.projectId === projectF);
    if (dateRange !== 'all') list = list.filter(o => isInDateRange(o.createdAt || o.orderDate, dateRange as any, customFrom, customTo));

    return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [orders, search, statusF, vendorF, projectF, dateRange, customFrom, customTo, activeKpi]);

  const paginated = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  const totalValue = useMemo(() => orders.reduce((s, o) => s + (o.total || 0), 0), [orders]);
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    orders.forEach(o => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  const isTotalDefault = !activeKpi && !search && !statusF && !vendorF && !projectF && dateRange === 'all';
  const activeFilterCount = [search ? 's' : '', statusF ? 'st' : '', vendorF ? 'v' : '', projectF ? 'p' : '', activeKpi ? 'k' : '', dateRange !== 'all' ? 'd' : ''].filter(Boolean).length;

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(o => o.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function closeForm() {
    setShowForm(false); setEditId(null); setForm(newForm());
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('projectId');
      setSearchParams(next, { replace: true });
    }
  }

  function openEdit(o: PurchaseOrderRecord) {
    setForm(formFromRecord(o));
    setEditId(o.id);
    setShowForm(true);
  }

  function openCreateForm() {
    setForm(newForm());
    setEditId(null);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vendorId) return toast.error('Vendor required');
    toast.success(editId ? 'PO updated (simulated)' : 'PO created (simulated)');
    closeForm();
  }

  // The old Purchase Order view popup was retired — opening a row now goes to
  // the PO's full workspace page (/purchase-orders/:id), exactly like the
  // Order list rows already do after the Order popup retirement.
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, o: PurchaseOrderRecord) {
    if (isRowOpenIgnored(e.target)) return;
    navigate(`/purchase-orders/${encodeURIComponent(o.id)}`);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, o: PurchaseOrderRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    navigate(`/purchase-orders/${encodeURIComponent(o.id)}`);
  }

  function exportSelected() {
    const rows = orders.filter(o => selected.has(o.id));
    if (!rows.length) return toast.error('No POs selected');
    downloadPoCsv(rows, `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} PO${rows.length > 1 ? 's' : ''}`);
  }

  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.PURCHASE_ORDERS || 'purchaseOrders', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders', activeCompanyId] });
      toast.success('Deleted');
      setDelId(null);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map(id => updateDocById(COLLECTIONS.PURCHASE_ORDERS || 'purchaseOrders', id, { status })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders', activeCompanyId] });
      toast.success(`Status updated for ${selected.size} PO${selected.size > 1 ? 's' : ''}`);
      setShowBulkStatus(false); setBulkStatus(''); setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteDocById(COLLECTIONS.PURCHASE_ORDERS || 'purchaseOrders', id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchaseOrders', activeCompanyId] });
      toast.success(`Deleted ${selected.size} PO${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setVendorF(''); setProjectF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncParams({ q: '', status: '', vendor: '', project: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: orders.length, icon: <ShoppingCart className="h-4 w-4" />, desc: `${orders.length} total POs` },
    { key: 'Draft', label: 'DRAFT', value: statusCounts['Draft'] || 0, icon: <FileText className="h-4 w-4" />, desc: 'Awaiting sending' },
    { key: 'Sent', label: 'SENT', value: statusCounts['Sent'] || 0, icon: <Activity className="h-4 w-4" />, desc: 'Sent to vendor' },
    { key: 'Received', label: 'RECEIVED', value: (statusCounts['Received'] || 0) + (statusCounts['PartiallyReceived'] || 0), icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Items received' },
    { key: 'Cancelled', label: 'CANCELLED', value: statusCounts['Cancelled'] || 0, icon: <X className="h-4 w-4" />, desc: 'No longer active' },
    { key: '', label: 'VALUE', value: `₹${(totalValue / 100000).toFixed(1)}L`, icon: <Calendar className="h-4 w-4" />, desc: `₹${(totalValue / 10000000).toFixed(1)}Cr total` },
  ], [orders.length, statusCounts, totalValue]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<ShoppingCart className="h-4 w-4" />}
        breadcrumbs={['Home', 'Procurement', 'Purchase Orders']} title="Purchase Orders"
        statusText="Procurement" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canCreate('purchase_orders') && (
              <Button size="sm" data-tour="purchase-orders-create" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreateForm}>Create PO</Button>
            )}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              if (k.key === '' && isTotalDefault) return;
              const nextKpi = activeKpi === k.key ? '' : k.key;
              setActiveKpi(nextKpi);
              setPage(1);
              syncParams({ kpi: nextKpi, page: 1 });
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* SEARCH + FILTERS */}
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                data-tour="purchase-orders-search"
                placeholder="Search PO number, vendor, project..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncParams({ q: e.target.value, page: 1 }); }}
              />
            </div>
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncParams({ from: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncParams({ to: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={statusF} onChange={(e) => {
              const v = e.target.value;
              setStatusF(v);
              if (v && activeKpi && v !== activeKpi) { setActiveKpi(''); setPage(1); syncParams({ status: v, kpi: '', page: 1 }); }
              else { setPage(1); syncParams({ status: v, page: 1 }); }
            }} options={[{ label: 'All Status', value: '' }, ...PURCHASE_ORDER_STATUSES.map(s => ({ label: s, value: s }))]} className="h-8 min-w-[110px] py-1" />
            <UiSelect value={vendorF} onChange={(e) => { setVendorF(e.target.value); setPage(1); syncParams({ vendor: e.target.value, page: 1 }); }}
              options={[{ label: 'All Vendors', value: '' }, ...(vendors as any[]).map((v: any) => ({ label: v.name, value: v.id }))]} className="h-8 min-w-[120px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} PO{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} PO{selected.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('purchase_orders') && (
                <Button size="sm" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">Change Status</Button>
              )}
              {perms.canDelete('purchase_orders') && (
                <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>
              )}
              <button onClick={() => setSelected(new Set())} className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* TABLE AREA */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div data-tour="purchase-orders-table" className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible POs" />
                </Th>
                <Th style={{ width: '14%', minWidth: 130 }}>PO</Th>
                <Th style={{ width: '16%', minWidth: 140 }}>VENDOR</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>ORDER DATE</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>DELIVERY</Th>
                <Th style={{ width: '12%', minWidth: 100 }}>TOTAL</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>STATUS</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={8} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={8} className="py-14 text-center">
                      <EmptyState icon={<ShoppingCart className="h-9 w-9" />}
                        title={search || statusF || vendorF || activeKpi ? 'No POs match filters' : 'No purchase orders yet'}
                        description={search || statusF || vendorF || activeKpi ? undefined : 'Create your first purchase order to get started.'}
                        action={!search && !statusF && !vendorF && !activeKpi && perms.canCreate('purchase_orders') ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreateForm} className="mt-2">Create First PO</Button>
                        ) : undefined} />
                    </td></tr>
                  ) : paginated.map((o: PurchaseOrderRecord) => (
                    <Tr key={o.id} selected={selected.has(o.id)} data-record-id={o.id} role="button" tabIndex={0}
                      onClick={(e) => handleRowClick(e, o)} onKeyDown={(e) => handleRowKeyDown(e, o)}>
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} ariaLabel={`Select ${o.purchaseOrderId}`} />
                      </Td>
                      <Td className="py-3"><span className="text-xs font-mono font-semibold text-[var(--color-primary-text)]">{o.purchaseOrderId}</span></Td>
                      <Td className="py-3">
                        <span className="text-sm font-medium text-[var(--color-text)]">{o.vendorName}</span>
                        {o.vendorGstin && <p className="text-[10px] text-[var(--color-text-muted)]">{o.vendorGstin}</p>}
                      </Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{formatDate(o.orderDate)}</Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{formatDate(o.expectedDeliveryDate)}</Td>
                      <Td className="py-3 font-semibold text-sm text-[var(--color-text)]">{fmtCurrency(o.total, currency)}</Td>
                      <Td className="py-3">{statusBadge(o.status)}</Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" data-tour="purchase-orders-row-view" icon={<Eye className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/purchase-orders/${encodeURIComponent(o.id)}`); }}>View</Button>
                      </Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        {filtered.length > perPage && (
          <div data-tour="purchase-orders-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncParams({ page: nextPage }); }}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); syncParams({ perPage: nextPerPage, page: 1 }); }} />
          </div>
        )}
      </Card>

      {/* ── Form Modal ── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Purchase Order' : 'New Purchase Order'} size="2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <PurchaseOrderForm
            value={form}
            vendors={vendors as any[]}
            products={products as any[]}
            projects={[]}
            currencySymbol={currency}
            onChange={setForm}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            saving={false}
          />
        </form>
      </Modal>

      {/* ── Bulk Status Modal ── */}
      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} PO{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={[{ label: 'Select Status...', value: '' }, ...PURCHASE_ORDER_STATUSES.map(s => ({ label: s, value: s }))]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => { if (!bulkStatus) return toast.error('Select a status'); bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus }); }}
              loading={bulkStatusMutation.isPending}>Update {selected.size} PO{selected.size > 1 ? 's' : ''}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            bulkDeleteMutation.mutate(Array.from(selected));
          } else if (delId) {
            del.mutate(delId);
          }
        }}
        loading={del.isPending || bulkDeleteMutation.isPending} title="Delete Purchase Order"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected PO${selected.size > 1 ? 's' : ''} permanently?` : 'Delete this purchase order permanently?'}
      />
    </div>
  );
}
