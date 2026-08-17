import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import {
  PackageCheck, Plus, Download, Trash2, Eye, RefreshCw,
  X, FolderKanban, Search, Activity, Warehouse,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { deleteDocById, fmtDate } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { COLLECTIONS } from '../lib/firebase';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';

import { GoodsReceiptForm } from '../features/procurement/components/GoodsReceiptForm';
import { useCreateGoodsReceipt, useGoodsReceipts } from '../features/procurement/hooks/useGoodsReceipts';
import { usePurchaseOrders } from '../features/procurement/hooks/usePurchaseOrders';
import type { GoodsReceiptFormValues, GoodsReceiptRecord } from '../features/procurement/types';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import type { Warehouse as WarehouseType } from '../features/warehouses/types';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';

const PER_PAGE = 10;

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

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadCsv(rows: GoodsReceiptRecord[], filename: string) {
  const headers = ['Receipt No', 'PO', 'Vendor', 'Warehouse', 'Project', 'Date', 'Items', 'Quantity', 'Status'];
  const lines = rows.map(r =>
    [r.goodsReceiptId, r.purchaseOrderId, r.vendorName, r.warehouseName, r.projectName || '', r.receivedDate, (r.receivedItems ?? []).length, (r.receivedItems ?? []).reduce((s, i) => s + i.qty, 0), (r as any).status || 'Pending']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function GRField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{children ?? value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</div>
    </div>
  );
}

export default function GoodsReceipts() {
  const qc = useQueryClient();
  const company = useAppStore(s => s.company);
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const perms = usePermissions();

  const { data: receipts = [], isLoading, refetch } = useGoodsReceipts();
  const { data: orders = [] } = usePurchaseOrders();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateGoodsReceipt();

  const [searchParams, setSearchParams] = useSearchParams();
  const createParam = searchParams.get('create') || '';
  const openParam = searchParams.get('open') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [warehouseF, setWarehouseF] = useState(() => searchParams.get('warehouse') || '');
  const [vendorF, setVendorF] = useState(() => searchParams.get('vendor') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(createParam === '1');
  const [form, setForm] = useState<GoodsReceiptFormValues>(blank());
  const [viewItem, setViewItem] = useState<GoodsReceiptRecord | null>(null);
  const [delId, setDelId] = useState<string | null>(null);

  function syncParams(next: {
    q?: string; warehouse?: string; vendor?: string; status?: string;
    date?: string; from?: string; to?: string; kpi?: string; page?: number; perPage?: number;
  }) {
    const p = new URLSearchParams(searchParams);
    const q = next.q ?? search; const wh = next.warehouse ?? warehouseF;
    const v = next.vendor ?? vendorF; const st = next.status ?? statusF;
    const d = next.date ?? dateRange; const f = next.from ?? customFrom; const t = next.to ?? customTo;
    const k = next.kpi ?? activeKpi; const pg = next.page ?? page; const pp = next.perPage ?? perPage;
    if (q) p.set('q', q); else p.delete('q');
    if (wh) p.set('warehouse', wh); else p.delete('warehouse');
    if (v) p.set('vendor', v); else p.delete('vendor');
    if (st) p.set('status', st); else p.delete('status');
    if (d && d !== 'all') p.set('date', d); else p.delete('date');
    if (f) p.set('from', f); else p.delete('from');
    if (t) p.set('to', t); else p.delete('to');
    if (k) p.set('kpi', k); else p.delete('kpi');
    if (pg > 1) p.set('page', String(pg)); else p.delete('page');
    if (pp !== PER_PAGE) p.set('perPage', String(pp)); else p.delete('perPage');
    setSearchParams(p, { replace: true });
  }

  // ── Create from URL ──
  useEffect(() => {
    if (createParam !== '1') return;
    setForm(blank());
    setShowForm(true);
  }, [createParam]);

  // ── Open from URL ──
  const userClosedRef = useRef(false);

  const closeDetail = useCallback(() => {
    userClosedRef.current = true;
    setViewItem(null);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openDetail = useCallback((r: GoodsReceiptRecord, replace = false) => {
    userClosedRef.current = false;
    setViewItem(r);
    if (!r?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', r.id);
    if (search) next.set('q', search); else next.delete('q');
    if (warehouseF) next.set('warehouse', warehouseF); else next.delete('warehouse');
    if (vendorF) next.set('vendor', vendorF); else next.delete('vendor');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
    if (customFrom) next.set('from', customFrom); else next.delete('from');
    if (customTo) next.set('to', customTo); else next.delete('to');
    if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
    setSearchParams(next, { replace });
  }, [search, warehouseF, vendorF, statusF, dateRange, customFrom, customTo, activeKpi, page, perPage, searchParams, setSearchParams]);

  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openParam || isLoading) return;
    const target = (receipts as GoodsReceiptRecord[]).find(r => r.id === openParam);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() => document.querySelector(`[data-record-id="${CSS.escape(openParam)}"]`)?.scrollIntoView({ block: 'center' }), 0);
  }, [openParam, isLoading, receipts]);

  // ── Filter ──
  const list = receipts as GoodsReceiptRecord[];
  const warehousesList = warehouses as WarehouseType[];

  const filtered = useMemo(() => {
    let filteredList = list;

    if (activeKpi === 'pending') filteredList = filteredList.filter(r => !(r as any).receivedAt);
    else if (activeKpi === 'partiallyReceived') filteredList = filteredList.filter(r => (r as any).status === 'Partial');
    else if (activeKpi === 'fullyReceived') filteredList = filteredList.filter(r => (r as any).receivedAt);
    else if (activeKpi === 'discrepancies') filteredList = filteredList.filter(r => (r as any).discrepancies > 0);

    const q = search.toLowerCase().trim();
    if (q) filteredList = filteredList.filter(r =>
      [r.goodsReceiptId, r.vendorName, r.purchaseOrderId, r.warehouseName, r.projectName]
        .some(v => String(v || '').toLowerCase().includes(q))
    );

    if (warehouseF) filteredList = filteredList.filter(r => r.warehouseId === warehouseF);
    if (vendorF) filteredList = filteredList.filter(r => r.vendorName?.toLowerCase().includes(vendorF.toLowerCase()));
    if (statusF) {
      if (statusF === 'pending') filteredList = filteredList.filter(r => !(r as any).receivedAt);
      else if (statusF === 'partial') filteredList = filteredList.filter(r => (r as any).status === 'Partial');
      else if (statusF === 'completed') filteredList = filteredList.filter(r => (r as any).receivedAt);
    }
    if (dateRange !== 'all') filteredList = filteredList.filter(r => isInDateRange(r.createdAt || r.receivedDate, dateRange as any, customFrom, customTo));

    return filteredList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [list, search, warehouseF, vendorF, statusF, dateRange, customFrom, customTo, activeKpi]);

  const paginated = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  const kpis = useMemo(() => ({
    total: list.length,
    pending: list.filter(r => !(r as any).receivedAt).length,
    partiallyReceived: list.filter(r => (r as any).status === 'Partial').length,
    fullyReceived: list.filter(r => (r as any).receivedAt).length,
    discrepancies: list.filter(r => (r as any).discrepancies > 0).length,
    totalQty: list.reduce((s, r) => s + (r.receivedItems ?? []).reduce((si, i) => si + i.qty, 0), 0),
  }), [list]);

  const isTotalDefault = !activeKpi && !search && !warehouseF && !vendorF && !statusF && dateRange === 'all';
  const activeFilterCount = [search ? 's' : '', warehouseF ? 'w' : '', vendorF ? 'v' : '', statusF ? 'st' : '', activeKpi ? 'k' : '', dateRange !== 'all' ? 'd' : ''].filter(Boolean).length;

  const toggleSelect = useCallback((id: string) =>
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(r => r.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  // ── Bulk actions ──
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteDocById(COLLECTIONS.GOODS_RECEIPTS, id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goods-receipts', activeCompanyId] });
      toast.success(`Deleted ${selected.size} receipt${selected.size > 1 ? 's' : ''}`);
      setDelId(null); setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, r: GoodsReceiptRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openDetail(r);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, r: GoodsReceiptRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openDetail(r);
  }

  function exportSelected() {
    const rows = list.filter(r => selected.has(r.id));
    if (!rows.length) return toast.error('No receipts selected');
    downloadCsv(rows, `goods-receipts-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} receipt${rows.length > 1 ? 's' : ''}`);
  }

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
    setSearch(''); setWarehouseF(''); setVendorF(''); setStatusF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi(''); setPage(1);
    syncParams({ q: '', warehouse: '', vendor: '', status: '', date: 'all', from: '', to: '', kpi: '', page: 1 });
  }

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: kpis.total, icon: <PackageCheck className="h-4 w-4" />, desc: `${kpis.totalQty} total items` },
    { key: 'pending', label: 'PENDING', value: kpis.pending, icon: <Activity className="h-4 w-4" />, desc: 'Awaiting inspection' },
    { key: 'partiallyReceived', label: 'PARTIAL', value: kpis.partiallyReceived, icon: <Warehouse className="h-4 w-4" />, desc: 'Partially received' },
    { key: 'fullyReceived', label: 'RECEIVED', value: kpis.fullyReceived, icon: <PackageCheck className="h-4 w-4" />, desc: 'Fully received' },
    { key: 'discrepancies', label: 'ISSUES', value: kpis.discrepancies, icon: <X className="h-4 w-4" />, desc: 'With discrepancies' },
    { key: '', label: 'ITEMS', value: kpis.totalQty, icon: <FolderKanban className="h-4 w-4" />, desc: 'Total items received' },
  ], [kpis]);

  function statusBadge(r: GoodsReceiptRecord) {
    const status = (r as any).receivedAt ? 'Received' : (r as any).status === 'Partial' ? 'Partial' : 'Pending';
    const variant = status === 'Received' ? 'success' as const : status === 'Partial' ? 'warning' as const : 'default' as const;
    return <Badge variant={variant}>{status}</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<PackageCheck className="h-4 w-4" />}
        breadcrumbs={['Home', 'Procurement', 'Goods Receipts']} title="Goods Receipts"
        statusText="Procurement" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canCreate('purchase_orders') && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm(blank()); setShowForm(true); }}>Create receipt</Button>
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
                placeholder="Search receipt, PO, vendor, warehouse..." value={search}
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
            }} options={[{ label: 'All Status', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'Partial', value: 'partial' }, { label: 'Completed', value: 'completed' }]} className="h-8 min-w-[110px] py-1" />
            <UiSelect value={warehouseF} onChange={(e) => { setWarehouseF(e.target.value); setPage(1); syncParams({ warehouse: e.target.value, page: 1 }); }}
              options={[{ label: 'All Warehouses', value: '' }, ...warehousesList.map((w: any) => ({ label: w.name || w.id, value: w.id }))]} className="h-8 min-w-[130px] py-1" />
            <UiSelect value={vendorF} onChange={(e) => { setVendorF(e.target.value); setPage(1); syncParams({ vendor: e.target.value, page: 1 }); }}
              options={[{ label: 'All Vendors', value: '' }, ...Array.from(new Set(list.map(r => r.vendorName).filter(Boolean))).map(n => ({ label: n, value: n }))]} className="h-8 min-w-[120px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} receipt{selected.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
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
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible receipts" />
                </Th>
                <Th style={{ width: '14%', minWidth: 130 }}>RECEIPT NO</Th>
                <Th style={{ width: '16%', minWidth: 140 }}>PO</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>VENDOR</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>WAREHOUSE</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>ITEMS</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>QTY</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>DATE</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={9} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center">
                      <EmptyState icon={<PackageCheck className="h-9 w-9" />}
                        title={search || warehouseF || vendorF || statusF || activeKpi ? 'No receipts match filters' : 'No goods receipts yet'}
                        description={search || warehouseF || vendorF || statusF || activeKpi ? undefined : 'Create your first goods receipt to get started.'}
                        action={!search && !warehouseF && !vendorF && !statusF && !activeKpi && perms.canCreate('purchase_orders') ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm(blank()); setShowForm(true); }} className="mt-2">Create First Receipt</Button>
                        ) : undefined} />
                    </td></tr>
                  ) : paginated.map((r: GoodsReceiptRecord) => (
                    <Tr key={r.id} selected={selected.has(r.id)} data-record-id={r.id} role="button" tabIndex={0}
                      onClick={(e) => handleRowClick(e, r)} onKeyDown={(e) => handleRowKeyDown(e, r)}>
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} ariaLabel={`Select ${r.goodsReceiptId}`} />
                      </Td>
                      <Td className="py-3"><span className="text-xs font-mono font-semibold text-[var(--color-text)]">{r.goodsReceiptId}</span></Td>
                      <Td className="py-3"><span className="text-xs text-[var(--color-text-secondary)]">{r.purchaseOrderId}</span></Td>
                      <Td className="py-3"><span className="text-sm font-medium text-[var(--color-text)]">{r.vendorName}</span></Td>
                      <Td className="py-3">
                        <span className="text-xs text-[var(--color-text-secondary)]">{r.warehouseName}</span>
                      </Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{(r.receivedItems ?? []).length}</Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{(r.receivedItems ?? []).reduce((s, i) => s + i.qty, 0)}</Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{formatDate(r.receivedDate)}</Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDetail(r); }}>View</Button>
                      </Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        {filtered.length > perPage && (
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncParams({ page: nextPage }); }}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); syncParams({ perPage: nextPerPage, page: 1 }); }} />
          </div>
        )}
      </Card>

      {/* ── Form Modal ── */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setForm(blank()); }} title="New Goods Receipt" size="xl">
        <GoodsReceiptForm
          value={form}
          orders={orders as any[]}
          warehouses={warehousesList}
          onChange={setForm}
          saving={create.isPending}
          onCancel={() => { setShowForm(false); setForm(blank()); }}
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            create.mutate(form, {
              onSuccess: () => { setShowForm(false); setForm(blank()); },
            });
          }}
        />
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal open={Boolean(viewItem)} onClose={closeDetail} size="xl">
        {viewItem && <GRDetail receipt={viewItem} />}
      </Modal>

      {/* ── Confirm Delete ── */}
      <ConfirmDialog
        open={Boolean(delId)} onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId === '__bulk__') {
            bulkDeleteMutation.mutate(Array.from(selected));
          }
        }}
        loading={bulkDeleteMutation.isPending}
        title="Delete receipts"
        message={delId === '__bulk__' ? `Delete ${selected.size} selected receipt${selected.size > 1 ? 's' : ''} permanently?` : 'Delete this receipt permanently?'}
      />
    </div>
  );
}

function GRDetail({ receipt }: { receipt: GoodsReceiptRecord }) {
  const totalQty = (receipt.receivedItems ?? []).reduce((s, i) => s + i.qty, 0);
  const status = (receipt as any).receivedAt ? 'Received' : (receipt as any).status === 'Partial' ? 'Partial' : 'Pending';
  const variant = status === 'Received' ? 'success' as const : status === 'Partial' ? 'warning' as const : 'default' as const;

  return (
    <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
      <header className="shrink-0 flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-5">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-2xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
            <PackageCheck className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-bold text-[var(--color-text)]">{receipt.goodsReceiptId}</h2>
              <Badge variant={variant}>{status}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
              <span>{receipt.vendorName}</span>
              <span>PO: {receipt.purchaseOrderId}</span>
              <span>Warehouse: {receipt.warehouseName}</span>
              <span>{formatDate(receipt.receivedDate)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pt-5 space-y-5">
        <DetailCard title="Receipt Information">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <GRField label="Receipt No" value={receipt.goodsReceiptId} />
            <GRField label="Purchase Order" value={receipt.purchaseOrderId} />
            <GRField label="Vendor" value={receipt.vendorName} />
            <GRField label="Warehouse" value={receipt.warehouseName} />
            <GRField label="Received Date" value={formatDate(receipt.receivedDate)} />
            <GRField label="Status"><Badge variant={variant}>{status}</Badge></GRField>
          </div>
        </DetailCard>

        {receipt.projectName && (
          <DetailCard title="Project">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <FolderKanban className="h-4 w-4 text-[var(--color-primary)]" />
              <Link to={`/projects/${receipt.projectId}`} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
                {receipt.projectName}
              </Link>
            </div>
          </DetailCard>
        )}

        <DetailCard title="Received Items">
          {(receipt.receivedItems ?? []).length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
              <div className="max-h-[30vh] overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--color-bg-sunken)]">
                    <tr>
                      {['Product', 'Qty', 'Unit', 'Ordered', 'Previously Received'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                    {(receipt.receivedItems ?? []).map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium text-[var(--color-text)]">{item.product}</td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.qty}</td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.unit}</td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.orderedQty}</td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">{item.previouslyReceivedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[var(--color-bg-sunken)]">
                    <tr>
                      <td className="px-3 py-2 font-semibold text-[var(--color-text)]">Total</td>
                      <td className="px-3 py-2 font-semibold text-[var(--color-text)]">{totalQty}</td>
                      <td className="px-3 py-2" colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-5 text-sm text-[var(--color-text-muted)]">
              No items recorded for this receipt.
            </div>
          )}
        </DetailCard>

        {receipt.notes && (
          <DetailCard title="Notes">
            <p className="whitespace-pre-wrap rounded-xl bg-[var(--color-bg-sunken)] p-4 text-[var(--color-text)]">{receipt.notes}</p>
          </DetailCard>
        )}

        {(receipt as any).stockEntries && (receipt as any).stockEntries.length > 0 && (
          <DetailCard title="Stock Movements">
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
              <table className="min-w-full text-xs">
                <thead className="bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {((receipt as any).stockEntries as any[]).map((entry: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-[var(--color-text)]">{entry.productId}</td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{entry.transactionId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        )}
      </div>
    </div>
  );
}
