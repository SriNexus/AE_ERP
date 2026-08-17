/**
 * Stock Ledger Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total Transactions, Inbound, Outbound, Adjustments, Transfers, Today's Transactions)
 * - Leads-style search + inline filters (Date, Product, Warehouse, Type, Reference, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Delete)
 * - StockDetailsModal for detail view
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 * - Back to Stock navigation button
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAll, fmtDate } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import { useStock, useDeleteStockEntry, exportStockCSV } from '../features/inventory/hooks/useInventory';
import { useProducts } from '../features/inventory/hooks/useInventory';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import { Badge } from '../components/ui/Badge';
import {
  StockDetailsModal,
  StockModalBoundary,
  StockPageBoundary,
  formatNumber,
  stockLedgerStatus,
  warehouseLabel,
  productLabel,
} from '../features/stock/components/StockWorkspaceParts';
import {
  isInteractiveTarget,
  userDisplayName,
} from '../features/stock/utils/stockWorkspaceUtils';
import {
  BookOpen,
  RefreshCw,
  Download,
  Trash2,
  Eye,
  X,
  ArrowLeft,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  RotateCw,
  Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product } from '../types';

const PER_PAGE = 10;

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function isToday(value: any): boolean {
  const date = toDateValue(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

// ─────────────────────────────────────────────────────────────────────────────
export default function StockLedger() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);

  const [productF, setProductF] = useState(() => searchParams.get('product') || '');
  const [warehouseF, setWarehouseF] = useState(() => searchParams.get('warehouse') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
  const [referenceF, setReferenceF] = useState(() => searchParams.get('reference') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');

  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table ────────────────────────────────────────────────────
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('date');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const userClosedRef = useRef(false);

  // ── Mutations state ──────────────────────────────────────────
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────
  const { data: stockLedger = [], isLoading, refetch } = useStock();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const openParam = searchParams.get('open') || '';

  const { data: allUsers = [] } = useQuery({
    queryKey: ['company-users-ledger', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
  });

  const productMap = useMemo(() => new Map((products as Product[]).map((p) => [p.id, p])), [products]);
  const warehouseMap = useMemo(() => new Map((warehouses as any[]).map((w: any) => [w.id, w])), [warehouses]);
  const userMap = useMemo(() => new Map((allUsers as any[]).flatMap((u: any) => [
    [String(u.id).toLowerCase().trim(), u],
    [String(u.email || '').toLowerCase().trim(), u],
    [String(u.name || '').toLowerCase().trim(), u],
  ])), [allUsers]);

  const deleteStockMutation = useDeleteStockEntry();

  // ── Computed data ────────────────────────────────────────────
  const ledgerRows = useMemo(() =>
    (stockLedger as any[])
      .filter((row: any) => row && row.isDeleted !== true)
      .slice()
      .sort((a: any, b: any) => {
        const da = toDateValue(b.date || b.createdAt || b.movementAt || b.updatedAt)?.getTime() || 0;
        const db = toDateValue(a.date || a.createdAt || a.movementAt || a.updatedAt)?.getTime() || 0;
        return da - db;
      }),
  [stockLedger]);

  const productOptions = useMemo(() => {
    const unique = Array.from(new Map(ledgerRows.map((row: any): [string, { label: string; value: string }] => {
      const pid = String(row.productId || row.product || row.productName || '');
      const name = productMap.get(pid)?.name || row.productName || row.product || pid;
      return [pid, { label: name, value: pid }];
    })).values());
    return [{ label: 'All Products', value: '' }, ...unique];
  }, [ledgerRows, productMap]);

  const warehouseOptions = useMemo(() => {
    const unique = Array.from(new Map(ledgerRows.map((row: any): [string, { label: string; value: string }] => {
      const wid = String(row.warehouseId || row.warehouse || row.warehouseName || '');
      const name = warehouseMap.get(wid)?.name || row.warehouseName || row.warehouse || wid;
      return [wid, { label: name, value: wid }];
    })).values());
    return [{ label: 'All Warehouses', value: '' }, ...unique];
  }, [ledgerRows, warehouseMap]);

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(ledgerRows.map((row: any) => stockLedgerStatus(row)))) as string[];
    return [{ label: 'All Types', value: '' }, ...types.map((t) => ({ label: t, value: t }))];
  }, [ledgerRows]);

  const userOptions = useMemo(() => {
    return [
      { label: 'All Users', value: '' },
      ...Array.from(new Map((allUsers as any[]).map((u: any) => [u.id, u])).values())
        .filter((u: any) => u.name || u.email)
        .map((u: any) => ({ label: u.name || u.email, value: u.id })),
    ];
  }, [allUsers]);

  // ── Stats (6 KPIs) ──────────────────────────────────────────
  const stats = useMemo(() => {
    const total = ledgerRows.length;
    const inbound = ledgerRows.filter((row: any) => stockLedgerStatus(row) === 'IN').length;
    const outbound = ledgerRows.filter((row: any) => stockLedgerStatus(row) === 'OUT').length;
    const adjustments = ledgerRows.filter((row: any) => stockLedgerStatus(row) === 'ADJUSTMENT').length;
    const transfers = ledgerRows.filter((row: any) =>
      String(row.sourceType || '').toLowerCase().includes('dispatch') ||
      String(row.sourceType || '').toLowerCase().includes('order') ||
      String(row.sourceType || '').toLowerCase().includes('transfer')
    ).length;
    const today = ledgerRows.filter((row: any) => isToday(row.date || row.createdAt || row.movementAt)).length;
    return { total, inbound, outbound, adjustments, transfers, today };
  }, [ledgerRows]);

  // ── Sync helper ──────────────────────────────────────────────
  function syncQueueParams(nextState: {
    q?: string;
    product?: string;
    warehouse?: string;
    type?: string;
    reference?: string;
    createdBy?: string;
    date?: string;
    from?: string;
    to?: string;
    kpi?: string;
    page?: number;
    perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const product = nextState.product ?? productF;
    const warehouse = nextState.warehouse ?? warehouseF;
    const type = nextState.type ?? typeF;
    const reference = nextState.reference ?? referenceF;
    const createdBy = nextState.createdBy ?? createdByF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (product) next.set('product', product); else next.delete('product');
    if (warehouse) next.set('warehouse', warehouse); else next.delete('warehouse');
    if (type) next.set('type', type); else next.delete('type');
    if (reference) next.set('reference', reference); else next.delete('reference');
    if (createdBy) next.set('createdBy', createdBy); else next.delete('createdBy');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Filtering & sorting ──────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...ledgerRows];

    // KPI filter
    if (activeKpi) {
      list = list.filter((row: any) => {
        switch (activeKpi) {
          case 'inbound':
            return stockLedgerStatus(row) === 'IN';
          case 'outbound':
            return stockLedgerStatus(row) === 'OUT';
          case 'adjustments':
            return stockLedgerStatus(row) === 'ADJUSTMENT';
          case 'transfers':
            return String(row.sourceType || '').toLowerCase().includes('dispatch') ||
                   String(row.sourceType || '').toLowerCase().includes('order') ||
                   String(row.sourceType || '').toLowerCase().includes('transfer');
          case 'today':
            return isToday(row.date || row.createdAt || row.movementAt);
          default:
            return true;
        }
      });
    }

    // Search
    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter((row: any) => {
        const text = [
          row.id, row.reference, row.sourceId,
          productLabel(row, productMap),
          warehouseLabel(row, warehouseMap),
          userDisplayName(row, userMap),
          row.notes,
          row.type, row.movementType, row.sourceType,
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes(q);
      });
    }

    // Filters
    if (productF) {
      list = list.filter((row: any) =>
        String(row.productId || row.product || row.productName || '') === productF ||
        productMap.get(String(row.productId || ''))?.name === productF
      );
    }
    if (warehouseF) {
      list = list.filter((row: any) =>
        String(row.warehouseId || row.warehouse || row.warehouseName || '') === warehouseF ||
        warehouseMap.get(String(row.warehouseId || ''))?.name === warehouseF
      );
    }
    if (typeF) {
      list = list.filter((row: any) => stockLedgerStatus(row) === typeF);
    }
    if (referenceF) {
      const refNorm = referenceF.toLowerCase();
      list = list.filter((row: any) =>
        String(row.reference || row.sourceId || '').toLowerCase().includes(refNorm)
      );
    }
    if (createdByF) {
      list = list.filter((row: any) => String(row.createdBy || '').toLowerCase().trim() === String(createdByF).toLowerCase().trim());
    }

    // Date range
    if (dateRange !== 'all') {
      list = list.filter((row: any) => isInDateRange(row.date || row.createdAt || row.movementAt, dateRange as any, customFrom, customTo));
    }

    // Sort
    list.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date': {
          const da = toDateValue(a.date || a.createdAt || a.movementAt)?.getTime() || 0;
          const db = toDateValue(b.date || b.createdAt || b.movementAt)?.getTime() || 0;
          cmp = da - db;
          break;
        }
        case 'product': {
          const na = productLabel(a, productMap);
          const nb = productLabel(b, productMap);
          cmp = na.localeCompare(nb);
          break;
        }
        case 'warehouse': {
          const wa = warehouseLabel(a, warehouseMap);
          const wb = warehouseLabel(b, warehouseMap);
          cmp = wa.localeCompare(wb);
          break;
        }
        case 'qty':
          cmp = (Number(a.qty) || 0) - (Number(b.qty) || 0);
          break;
        case 'before':
          cmp = (Number(a.beforeQty) || 0) - (Number(b.beforeQty) || 0);
          break;
        case 'after':
          cmp = (Number(a.afterQty) || 0) - (Number(b.afterQty) || 0);
          break;
        default:
          cmp = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
      }
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [ledgerRows, deferredSearch, productF, warehouseF, typeF, referenceF, createdByF, dateRange, customFrom, customTo, activeKpi, productMap, warehouseMap, userMap]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── URL sync for open param ──────────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = ledgerRows.find((row: any) => row.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() =>
      document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }),
    0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, ledgerRows]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !productF && !warehouseF && !typeF && !referenceF && !createdByF && dateRange === 'all';
  }, [activeKpi, search, productF, warehouseF, typeF, referenceF, createdByF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (productF) count++;
    if (warehouseF) count++;
    if (typeF) count++;
    if (referenceF) count++;
    if (createdByF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, productF, warehouseF, typeF, referenceF, createdByF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }),
  []);

  const toggleAll = () =>
    setSelected((s) =>
      s.size === paginated.length ? new Set() : new Set(paginated.map((row: any) => row.id)),
    );
  const allSel = selected.size === paginated.length && paginated.length > 0;
  const partialSel = selected.size > 0 && !allSel;

  const closeView = useCallback(() => {
    userClosedRef.current = true;
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);

  const openView = useCallback(
    (record: any, replace = false) => {
      userClosedRef.current = false;
      setViewItem(record);
      if (!record?.id) return;
      const next = new URLSearchParams(searchParams);
      next.set('open', record.id);
      if (search) next.set('q', search); else next.delete('q');
      if (productF) next.set('product', productF); else next.delete('product');
      if (warehouseF) next.set('warehouse', warehouseF); else next.delete('warehouse');
      if (typeF) next.set('type', typeF); else next.delete('type');
      if (referenceF) next.set('reference', referenceF); else next.delete('reference');
      if (createdByF) next.set('createdBy', createdByF); else next.delete('createdBy');
      if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
      if (customFrom) next.set('from', customFrom); else next.delete('from');
      if (customTo) next.set('to', customTo); else next.delete('to');
      if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
      if (page > 1) next.set('page', String(page)); else next.delete('page');
      if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
      setSearchParams(next, { replace });
    },
    [activeKpi, createdByF, customFrom, customTo, dateRange, page, perPage, productF, referenceF, search, searchParams, setSearchParams, typeF, warehouseF],
  );

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, row: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openView(row);
  }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, row: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openView(row);
  }

  function sort(k: string) {
    if (sortKey === k) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(k);
      setSortDesc(true);
    }
  }

  function clearAll() {
    setSearch('');
    setProductF('');
    setWarehouseF('');
    setTypeF('');
    setReferenceF('');
    setCreatedByF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({
      q: '', product: '', warehouse: '', type: '', reference: '', createdBy: '',
      date: 'all', from: '', to: '', kpi: '', page: 1,
    });
  }

  function exportSelected() {
    const rows = ledgerRows.filter((row: any) => selected.has(row.id));
    if (!rows.length) return toast.error('No transactions selected');
    exportStockCSV(rows);
    toast.success(`Exported ${rows.length} transaction${rows.length > 1 ? 's' : ''}`);
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => deleteStockMutation.mutateAsync(id)));
      toast.success(`Deleted ${ids.length} transactions`);
      setSelected(new Set());
    } catch (error: any) {
      toast.error(error?.message || 'Delete failed');
    }
  }

  // ── Date options ────────────────────────────────────────────
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' },
    { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') {
      setCustomFrom('');
      setCustomTo('');
    }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  // ── KPI Tiles ────────────────────────────────────────────────
  const KPI_TILES = [
    { label: 'TOTAL', value: stats.total, key: '', icon: <BookOpen className="h-4 w-4" />, description: `${stats.total} transactions` },
    { label: 'INBOUND', value: stats.inbound, key: 'inbound', icon: <TrendingDown className="h-4 w-4" />, description: 'Stock in transactions' },
    { label: 'OUTBOUND', value: stats.outbound, key: 'outbound', icon: <TrendingUp className="h-4 w-4" />, description: 'Stock out transactions' },
    { label: 'ADJUSTMENTS', value: stats.adjustments, key: 'adjustments', icon: <RotateCw className="h-4 w-4" />, description: 'Adjustment entries' },
    { label: 'TRANSFERS', value: stats.transfers, key: 'transfers', icon: <ArrowRightLeft className="h-4 w-4" />, description: 'Transfer movements' },
    { label: "TODAY", value: stats.today, key: 'today', icon: <Calendar className="h-4 w-4" />, description: "Today's transactions" },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <StockPageBoundary>
      <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
        {/* ── Premium Workspace Hero ─────────────────────────── */}
        <WorkspaceHero
          title="Stock Ledger"
          icon={<BookOpen className="h-6 w-6" />}
          breadcrumbs={['Home', 'Inventory', 'Stock Ledger']}
          statusText="Last sync · Realtime Connected"
          statusDotColor="var(--color-success)"
          className="gap-3"
          actions={
            <>
              <Button variant="outline" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/stock')}>
                Back to Stock
              </Button>
              <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
                Refresh
              </Button>
            </>
          }
        />

        {/* ── Premium Clickable KPI Cards ────────────────────── */}
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
          {KPI_TILES.map((k) => (
            <PremiumKpi
              key={k.key}
              label={k.label}
              value={k.value}
              icon={k.icon}
              description={k.description}
              onClick={() => {
                const nextKpi = activeKpi === k.key ? '' : k.key;
                setActiveKpi(nextKpi);
                setPage(1);
                syncQueueParams({ kpi: nextKpi, page: 1 });
              }}
              active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            />
          ))}
        </div>

        {/* ── Premium Elevated Table Card ────────────────────── */}
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
          {/* ── Card Header with Search + Filters ────────────── */}
          <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                aria-label="Search transactions"
                placeholder="Search product, warehouse, reference..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
                className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              <Select
                aria-label="Date"
                value={dateRange}
                options={DATE_OPTIONS}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-[110px] h-8 py-1"
              />
              {dateRange === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                </div>
              )}
              <Select
                aria-label="Product"
                value={productF}
                onChange={(e) => { setProductF(e.target.value); setPage(1); syncQueueParams({ product: e.target.value, page: 1 }); }}
                options={productOptions}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Warehouse"
                value={warehouseF}
                onChange={(e) => { setWarehouseF(e.target.value); setPage(1); syncQueueParams({ warehouse: e.target.value, page: 1 }); }}
                options={warehouseOptions}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Type"
                value={typeF}
                onChange={(e) => { setTypeF(e.target.value); setPage(1); syncQueueParams({ type: e.target.value, page: 1 }); }}
                options={typeOptions}
                className="w-[110px] h-8 py-1"
              />
              <input
                aria-label="Reference"
                placeholder="Ref..."
                value={referenceF}
                onChange={(e) => { setReferenceF(e.target.value); setPage(1); syncQueueParams({ reference: e.target.value, page: 1 }); }}
                className="w-[90px] h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              <Select
                aria-label="Created By"
                value={createdByF}
                onChange={(e) => { setCreatedByF(e.target.value); setPage(1); syncQueueParams({ createdBy: e.target.value, page: 1 }); }}
                options={userOptions}
                className="w-[120px] h-8 py-1"
              />
              {/* Active filter pills + Clear All */}
              {activeFilterCount > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {activeKpi && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                      {KPI_TILES.find((t) => t.key === activeKpi)?.label || activeKpi}
                      <button
                        type="button"
                        onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }}
                        className="ml-0.5 hover:opacity-70"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )}
                  {search && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                      S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}
                    </span>
                  )}
                  {productF && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{productF}</span>
                  )}
                  {warehouseF && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{warehouseF}</span>
                  )}
                  <button
                    type="button"
                    onClick={clearAll}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                    Clear
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              </div>
            </div>
          </CardHeader>

          {/* ── Bulk action bar ──────────────────────────────── */}
          {selected.size > 0 && (
            <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
              <span className="text-sm font-semibold text-[var(--color-primary-text)]">
                {selected.size} transaction{selected.size > 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Button
                  size="sm" variant="outline"
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={exportSelected}
                  className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
                >
                  Export CSV
                </Button>
                <Button
                  size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30"
                >
                  Delete
                </Button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1"
                >
                  ✕ Clear
                </button>
              </div>
            </div>
          )}

          {/* ── Table + Pagination (unified) ─────────────────── */}
          <div className="px-6 flex-1 flex flex-col min-h-0">
            <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
              <Table>
                <Thead>
                  <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                    <UniversalCheckbox
                      checked={allSel}
                      indeterminate={partialSel}
                      onChange={toggleAll}
                      ariaLabel="Select visible items"
                    />
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'date'}
                    desc={sortDesc}
                    onSort={() => sort('date')}
                    style={{ width: 100, minWidth: 100 }}
                  >
                    DATE
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'product'}
                    desc={sortDesc}
                    onSort={() => sort('product')}
                    style={{ width: '18%', minWidth: 150 }}
                  >
                    PRODUCT
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'warehouse'}
                    desc={sortDesc}
                    onSort={() => sort('warehouse')}
                    style={{ width: 120, minWidth: 120 }}
                  >
                    WAREHOUSE
                  </Th>
                  <Th style={{ width: 90, minWidth: 90 }}>TYPE</Th>
                  <Th
                    sortable
                    sorted={sortKey === 'qty'}
                    desc={sortDesc}
                    onSort={() => sort('qty')}
                    style={{ width: 90, minWidth: 90 }}
                  >
                    QUANTITY
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'before'}
                    desc={sortDesc}
                    onSort={() => sort('before')}
                    style={{ width: 80, minWidth: 80 }}
                  >
                    BEFORE
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'after'}
                    desc={sortDesc}
                    onSort={() => sort('after')}
                    style={{ width: 80, minWidth: 80 }}
                  >
                    AFTER
                  </Th>
                  <Th style={{ width: 100, minWidth: 100 }}>REFERENCE</Th>
                  <Th style={{ width: 100, minWidth: 100 }}>USER</Th>
                  <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
                </Thead>
                <Tbody>
                  {isLoading ? (
                    <SkeletonRows cols={11} />
                  ) : paginated.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-14 text-center">
                        <EmptyState
                          icon={<BookOpen className="h-9 w-9" />}
                          title={
                            search || productF || warehouseF || typeF
                              ? 'No transactions match filters'
                              : 'No transactions yet'
                          }
                          description={
                            search || productF || warehouseF || typeF
                              ? undefined
                              : 'Transactions appear automatically when stock is added, adjusted, or dispatched.'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    paginated.map((row: any) => {
                      const type = stockLedgerStatus(row);
                      return (
                        <Tr
                          key={row.id}
                          selected={selected.has(row.id)}
                          data-record-id={row.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => handleRowClick(e, row)}
                          onKeyDown={(e) => handleRowKeyDown(e, row)}
                          className="transition-colors duration-150"
                        >
                          <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                            <UniversalCheckbox
                              checked={selected.has(row.id)}
                              onChange={() => toggleSelect(row.id)}
                              ariaLabel={`Select transaction ${row.id}`}
                            />
                          </Td>

                          {/* Date */}
                          <Td className="py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                            {fmtDate(row.date || row.createdAt || row.movementAt)}
                          </Td>

                          {/* Product */}
                          <Td className="py-3 min-w-[150px]">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                                {(productLabel(row, productMap) || '?')[0].toUpperCase()}
                              </div>
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">
                                {productLabel(row, productMap)}
                              </span>
                            </div>
                          </Td>

                          {/* Warehouse */}
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">
                            {warehouseLabel(row, warehouseMap)}
                          </Td>

                          {/* Type */}
                          <Td className="py-3">
                            <Badge variant={type === 'OUT' ? 'danger' : type === 'ADJUSTMENT' ? 'warning' : 'success'}>
                              {type}
                            </Badge>
                          </Td>

                          {/* Quantity */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text)]">
                            {formatNumber(Number(row.qty) || 0)}
                          </Td>

                          {/* Before */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {formatNumber(Number(row.beforeQty) || 0)}
                          </Td>

                          {/* After */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {formatNumber(Number(row.afterQty) || 0)}
                          </Td>

                          {/* Reference */}
                          <Td className="py-3 font-mono text-[11px] text-[var(--color-text-muted)]">
                            {row.reference || row.sourceId || '—'}
                          </Td>

                          {/* User */}
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">
                            {userDisplayName(row, userMap)}
                          </Td>

                          {/* Actions */}
                          <Td className="py-3" align="right">
                            <Button
                              size="xs"
                              variant="outline"
                              icon={<Eye className="h-3 w-3" />}
                              onClick={(e) => { e.stopPropagation(); openView(row); }}
                              data-action
                            >
                              View
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </Tbody>
              </Table>
            </div>

            <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
              <Pagination
                page={page}
                total={filtered.length}
                perPage={perPage}
                onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
                onPerPageChange={(n) => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }}
              />
            </div>
          </div>
        </Card>

        {/* ── Stock Details Modal ──────────────────────────────── */}
        <StockModalBoundary open={Boolean(viewItem)} onClose={closeView}>
          <StockDetailsModal
            open={Boolean(viewItem)}
            mode="ledger"
            record={viewItem}
            productMap={productMap as Map<string, any>}
            warehouseMap={warehouseMap as Map<string, any>}
            userMap={userMap as Map<string, any>}
            onClose={closeView}
            onAdjust={(record) => {
              navigate('/stock');
              toast('Use the Stock page to adjust inventory.');
            }}
            onAddStock={(record) => {
              navigate('/stock');
              toast('Use the Stock page to manage inventory.');
            }}
            onExport={(record) => {
              const rows = [record];
              exportStockCSV(rows);
            }}
            onDelete={(record) => setDelId(record.id)}
          />
        </StockModalBoundary>

        {/* ── Delete Confirmation ──────────────────────────────── */}
        <ConfirmDialog
          open={!!delId}
          onClose={() => setDelId(null)}
          onConfirm={async () => {
            try {
              if (delId === '__bulk__') {
                await bulkDelete();
              } else if (delId) {
                await deleteStockMutation.mutateAsync(delId);
                if (viewItem?.id === delId) closeView();
              }
              setDelId(null);
            } catch {}
          }}
          loading={deleteStockMutation.isPending}
          title={delId === '__bulk__' ? 'Delete Transactions' : 'Delete Transaction'}
          message={
            delId === '__bulk__'
              ? `Delete ${selected.size} transactions? This action cannot be undone.`
              : 'Delete this transaction?'
          }
        />
      </div>
    </StockPageBoundary>
  );
}
