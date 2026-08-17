/**
 * Stock Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total, Available, Reserved, Low Stock, Out Of Stock, Inventory Value)
 * - Leads-style search + inline filters (Date, Warehouse, Category, Product, Status, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Adjust, Delete)
 * - StockDetailsModal for detail view
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 * - Link to standalone Stock Ledger page
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAll, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';import {
  useStockSummary,
  useSaveStockEntry,
  useDeleteStockEntry,
  exportStockCSV,
  STOCK_FORM_DEFAULT,
  type StockForm,
} from '../features/inventory/hooks/useInventory';
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
import { statusBadge } from '../components/ui/Badge';
import {
  StockDetailsModal,
  StockModalBoundary,
  StockPageBoundary,
  formatNumber,
  stockSummaryStatus,
  warehouseLabel,
  productLabel,
} from '../features/stock/components/StockWorkspaceParts';
import {
  isInteractiveTarget,
} from '../features/stock/utils/stockWorkspaceUtils';
import {
  Package,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  ArrowLeftRight,
  Eye,
  X,
  DollarSign,
  BookOpen,
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

// ─────────────────────────────────────────────────────────────────────────────
export default function StockSummary() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { company } = useAppStore();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);

  const [warehouseF, setWarehouseF] = useState(() => searchParams.get('warehouse') || '');
  const [catF, setCatF] = useState(() => searchParams.get('category') || '');
  const [productF, setProductF] = useState(() => searchParams.get('product') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');

  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table ────────────────────────────────────────────────────
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('product');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const userClosedRef = useRef(false);

  // ── Mutations state ──────────────────────────────────────────
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<StockForm>({ ...STOCK_FORM_DEFAULT });

  // ── Queries ──────────────────────────────────────────────────
  const { data: stockSummary = [], isLoading, refetch } = useStockSummary();
  const { data: products = [] } = useProducts();
  const { data: warehouses = [] } = useWarehouses();
  const openParam = searchParams.get('open') || '';

  const { data: allUsers = [] } = useQuery({
    queryKey: ['company-users-stock', activeCompanyId],
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

  const saveStockMutation = useSaveStockEntry(() => {
    setAdjustOpen(false);
    setAdjustForm({ ...STOCK_FORM_DEFAULT });
  });
  const deleteStockMutation = useDeleteStockEntry();

  // ── Computed data ────────────────────────────────────────────
  const productsForStock = (products as Product[]);
  const warehousesForStock = (warehouses as any[]);

  const summaryRows = useMemo(() =>
    (stockSummary as any[])
      .filter((row: any) => row && row.isDeleted !== true)
      .slice()
      .sort((a: any, b: any) => {
        const da = toDateValue(b.updatedAt || b.createdAt)?.getTime() || 0;
        const db = toDateValue(a.updatedAt || a.createdAt)?.getTime() || 0;
        return da - db;
      }),
  [stockSummary]);

  const catOptions = useMemo(() => {
    const cats = Array.from(new Set(productsForStock.map((p) => p.category).filter(Boolean))) as string[];
    return [{ label: 'All Categories', value: '' }, ...cats.map((c) => ({ label: c, value: c }))];
  }, [productsForStock]);

  const productOptions = useMemo(() => {
    const unique = Array.from(new Map(summaryRows.map((row: any): [string, { label: string; value: string }] => {
      const pid = String(row.productId || row.product || row.productName || '');
      const name = productMap.get(pid)?.name || row.productName || row.product || pid;
      return [pid, { label: name, value: pid }];
    })).values());
    return [{ label: 'All Products', value: '' }, ...unique];
  }, [summaryRows, productMap]);

  const warehouseOptions = useMemo(() => {
    const unique = Array.from(new Map(summaryRows.map((row: any): [string, { label: string; value: string }] => {
      const wid = String(row.warehouseId || row.warehouse || row.warehouseName || '');
      const name = warehouseMap.get(wid)?.name || row.warehouseName || row.warehouse || wid;
      return [wid, { label: name, value: wid }];
    })).values());
    return [{ label: 'All Warehouses', value: '' }, ...unique];
  }, [summaryRows, warehouseMap]);

  const statusOptions = useMemo(() => {
    return [
      { label: 'All Status', value: '' },
      { label: 'In Stock', value: 'In Stock' },
      { label: 'Low Stock', value: 'Low Stock' },
      { label: 'Out Of Stock', value: 'Out Of Stock' },
      { label: 'Reserved', value: 'Reserved' },
    ];
  }, []);

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
    const total = summaryRows.length;
    const available = summaryRows.filter((row: any) => (Number(row.availableQty ?? row.available) || 0) > 0).length;
    const reserved = summaryRows.filter((row: any) => (Number(row.reservedQty ?? row.reserved) || 0) > 0).length;
    const low = summaryRows.filter((row: any) => {
      const avail = Number(row.availableQty ?? row.available) || 0;
      const threshold = Number(row.min_stock ?? row.lowStockThreshold ?? 5) || 5;
      return avail > 0 && avail <= threshold;
    }).length;
    const out = summaryRows.filter((row: any) => (Number(row.availableQty ?? row.available) || 0) <= 0).length;
    const inventoryValue = summaryRows.reduce((sum: number, row: any) => {
      const avail = Number(row.availableQty ?? row.available) || 0;
      const product = row.productId ? productMap.get(String(row.productId)) as any : null;
      const cost = Number(product?.cost) || 0;
      return sum + avail * cost;
    }, 0);
    return { total, available, reserved, low, out, inventoryValue };
  }, [summaryRows, productMap]);

  // ── Sync helper ──────────────────────────────────────────────
  function syncQueueParams(nextState: {
    q?: string;
    warehouse?: string;
    category?: string;
    product?: string;
    status?: string;
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
    const warehouse = nextState.warehouse ?? warehouseF;
    const category = nextState.category ?? catF;
    const product = nextState.product ?? productF;
    const status = nextState.status ?? statusF;
    const createdBy = nextState.createdBy ?? createdByF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (warehouse) next.set('warehouse', warehouse); else next.delete('warehouse');
    if (category) next.set('category', category); else next.delete('category');
    if (product) next.set('product', product); else next.delete('product');
    if (status) next.set('status', status); else next.delete('status');
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
    let list = [...summaryRows];

    // KPI filter
    if (activeKpi) {
      list = list.filter((row: any) => {
        const avail = Number(row.availableQty ?? row.available) || 0;
        const reserved = Number(row.reservedQty ?? row.reserved) || 0;
        switch (activeKpi) {
          case 'available':
            return avail > 0;
          case 'reserved':
            return reserved > 0;
          case 'low':
            return avail > 0 && avail <= (Number(row.min_stock ?? row.lowStockThreshold ?? 5) || 5);
          case 'out':
            return avail <= 0;
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
          row.productName, row.product, productMap.get(String(row.productId || ''))?.name,
          row.warehouseName, row.warehouse, warehouseMap.get(String(row.warehouseId || ''))?.name,
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes(q);
      });
    }

    // Filters
    if (warehouseF) {
      list = list.filter((row: any) =>
        String(row.warehouseId || row.warehouse || row.warehouseName || '') === warehouseF ||
        warehouseMap.get(String(row.warehouseId || ''))?.name === warehouseF
      );
    }
    if (catF) {
      list = list.filter((row: any) => {
        const cat = row.category || productMap.get(String(row.productId || ''))?.category;
        return cat === catF;
      });
    }
    if (productF) {
      list = list.filter((row: any) =>
        String(row.productId || row.product || row.productName || '') === productF ||
        productMap.get(String(row.productId || ''))?.name === productF
      );
    }
    if (statusF) {
      list = list.filter((row: any) => stockSummaryStatus(row) === statusF);
    }
    if (createdByF) {
      list = list.filter((row: any) => String(row.createdBy || '').toLowerCase().trim() === String(createdByF).toLowerCase().trim());
    }

    // Date range
    if (dateRange !== 'all') {
      list = list.filter((row: any) => isInDateRange(row.updatedAt || row.createdAt, dateRange as any, customFrom, customTo));
    }

    // Sort
    list.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case 'product': {
          const na = productMap.get(String(a.productId || ''))?.name || a.productName || a.product || '';
          const nb = productMap.get(String(b.productId || ''))?.name || b.productName || b.product || '';
          cmp = na.localeCompare(nb);
          break;
        }
        case 'warehouse': {
          const wa = warehouseMap.get(String(a.warehouseId || ''))?.name || a.warehouseName || a.warehouse || '';
          const wb = warehouseMap.get(String(b.warehouseId || ''))?.name || b.warehouseName || b.warehouse || '';
          cmp = wa.localeCompare(wb);
          break;
        }
        case 'available':
          cmp = (Number(a.availableQty ?? a.available) || 0) - (Number(b.availableQty ?? b.available) || 0);
          break;
        case 'reserved':
          cmp = (Number(a.reservedQty ?? a.reserved) || 0) - (Number(b.reservedQty ?? b.reserved) || 0);
          break;
        default:
          cmp = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
      }
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [summaryRows, deferredSearch, warehouseF, catF, productF, statusF, createdByF, dateRange, customFrom, customTo, activeKpi, productMap, warehouseMap]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── URL sync for open param ──────────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = summaryRows.find((row: any) => row.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() =>
      document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }),
    0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, summaryRows]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !warehouseF && !catF && !productF && !statusF && !createdByF && dateRange === 'all';
  }, [activeKpi, search, warehouseF, catF, productF, statusF, createdByF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (warehouseF) count++;
    if (catF) count++;
    if (productF) count++;
    if (statusF) count++;
    if (createdByF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, warehouseF, catF, productF, statusF, createdByF, dateRange, activeKpi]);

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
      if (warehouseF) next.set('warehouse', warehouseF); else next.delete('warehouse');
      if (catF) next.set('category', catF); else next.delete('category');
      if (productF) next.set('product', productF); else next.delete('product');
      if (statusF) next.set('status', statusF); else next.delete('status');
      if (createdByF) next.set('createdBy', createdByF); else next.delete('createdBy');
      if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
      if (customFrom) next.set('from', customFrom); else next.delete('from');
      if (customTo) next.set('to', customTo); else next.delete('to');
      if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
      if (page > 1) next.set('page', String(page)); else next.delete('page');
      if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
      setSearchParams(next, { replace });
    },
    [activeKpi, catF, createdByF, customFrom, customTo, dateRange, page, perPage, productF, search, searchParams, setSearchParams, statusF, warehouseF],
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
    setWarehouseF('');
    setCatF('');
    setProductF('');
    setStatusF('');
    setCreatedByF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({
      q: '', warehouse: '', category: '', product: '', status: '', createdBy: '',
      date: 'all', from: '', to: '', kpi: '', page: 1,
    });
  }

  function openAdjustStock(record: any) {
    if (!record) return;
    setAdjustForm({
      ...STOCK_FORM_DEFAULT,
      productId: record.productId || '',
      product: productLabel(record, productMap),
      warehouseId: record.warehouseId || '',
      warehouse: warehouseLabel(record, warehouseMap),
      type: stockSummaryStatus(record) === 'Out Of Stock' ? 'IN' : 'OUT',
      qty: String(Number(record.availableQty ?? record.available ?? 1) || 1),
      unit: record.unit || productMap.get(String(record.productId || ''))?.unit || 'PCS',
      reference: record.reference || record.sourceId || '',
      notes: record.notes || '',
      date: new Date().toISOString().split('T')[0],
    });
    setAdjustOpen(true);
  }

  function openAddStock(record?: any) {
    // Navigate to stock-ledger page, which is the transaction log
    // For now, open adjust modal for the record
    if (record) openAdjustStock(record);
  }

  function exportSelected() {
    const rows = summaryRows.filter((row: any) => selected.has(row.id));
    if (!rows.length) return toast.error('No items selected');
    exportStockCSV(rows);
    toast.success(`Exported ${rows.length} stock record${rows.length > 1 ? 's' : ''}`);
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => deleteStockMutation.mutateAsync(id)));
      toast.success(`Deleted ${ids.length} stock records`);
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
    { label: 'TOTAL', value: stats.total, key: '', icon: <Package className="h-4 w-4" />, description: `${stats.total} stock records` },
    { label: 'AVAILABLE', value: stats.available, key: 'available', icon: <Package className="h-4 w-4" />, description: 'Items with stock > 0' },
    { label: 'RESERVED', value: stats.reserved, key: 'reserved', icon: <Package className="h-4 w-4" />, description: 'Items with reservations' },
    { label: 'LOW STOCK', value: stats.low, key: 'low', icon: <Package className="h-4 w-4" />, description: 'Below threshold' },
    { label: 'OUT OF STOCK', value: stats.out, key: 'out', icon: <Package className="h-4 w-4" />, description: 'Zero available' },
    { label: 'INVENTORY VALUE', value: fmtCurrency(stats.inventoryValue, company?.currencySymbol || '₹'), key: 'value', icon: <DollarSign className="h-4 w-4" />, description: 'Total stock value (cost)' },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <StockPageBoundary>
      <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
        {/* ── Premium Workspace Hero ─────────────────────────── */}
        <WorkspaceHero
          title="Stock"
          icon={<Package className="h-6 w-6" />}
          breadcrumbs={['Home', 'Inventory', 'Stock']}
          statusText="Last sync · Realtime Connected"
          statusDotColor="var(--color-success)"
          className="gap-3"
          actions={
            <>
              <Button variant="outline" size="sm" icon={<BookOpen className="h-4 w-4" />} onClick={() => navigate('/stock-ledger')}>
                View Ledger
              </Button>
              <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
                Refresh
              </Button>
              <Button size="sm" data-tour="stock-create" icon={<Plus className="h-4 w-4" />} onClick={() => {
                setAdjustForm({ ...STOCK_FORM_DEFAULT });
                setAdjustOpen(true);
              }}>
                Adjust Stock
              </Button>
            </>
          }
        />

        {/* ── Premium Clickable KPI Cards ────────────────────── */}
        <div data-tour="stock-kpi" className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
          {KPI_TILES.map((k) => (
            <PremiumKpi
              key={k.key}
              label={k.label}
              value={k.value}
              icon={k.icon}
              description={k.description}
              onClick={
                k.key === 'value'
                  ? undefined
                  : () => {
                      const nextKpi = activeKpi === k.key ? '' : k.key;
                      setActiveKpi(nextKpi);
                      setPage(1);
                      syncQueueParams({ kpi: nextKpi, page: 1 });
                    }
              }
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
                aria-label="Search stock"
                data-tour="stock-search"
                placeholder="Search product, warehouse, category..."
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
                aria-label="Warehouse"
                value={warehouseF}
                onChange={(e) => { setWarehouseF(e.target.value); setPage(1); syncQueueParams({ warehouse: e.target.value, page: 1 }); }}
                options={warehouseOptions}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Category"
                value={catF}
                onChange={(e) => { setCatF(e.target.value); setPage(1); syncQueueParams({ category: e.target.value, page: 1 }); }}
                options={catOptions}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Product"
                value={productF}
                onChange={(e) => { setProductF(e.target.value); setPage(1); syncQueueParams({ product: e.target.value, page: 1 }); }}
                options={productOptions}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Status"
                value={statusF}
                onChange={(e) => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
                options={statusOptions}
                className="w-[110px] h-8 py-1"
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
                  {warehouseF && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{warehouseF}</span>
                  )}
                  {catF && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{catF}</span>
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
                {selected.size} item{selected.size > 1 ? 's' : ''} selected
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
                  icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                  onClick={() => {
                    const first = summaryRows.find((row: any) => selected.has(row.id));
                    if (first) openAdjustStock(first);
                  }}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30"
                >
                  Adjust
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
            <div data-tour="stock-table" className="min-h-0 flex-1 overflow-auto scroll-pt-10">
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
                    sorted={sortKey === 'product'}
                    desc={sortDesc}
                    onSort={() => sort('product')}
                    style={{ width: '22%', minWidth: 180 }}
                  >
                    PRODUCT
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'warehouse'}
                    desc={sortDesc}
                    onSort={() => sort('warehouse')}
                    style={{ width: 130, minWidth: 130 }}
                  >
                    WAREHOUSE
                  </Th>
                  <Th style={{ width: 100, minWidth: 100 }}>CATEGORY</Th>
                  <Th
                    sortable
                    sorted={sortKey === 'available'}
                    desc={sortDesc}
                    onSort={() => sort('available')}
                    style={{ width: 100, minWidth: 100 }}
                  >
                    AVAILABLE
                  </Th>
                  <Th
                    sortable
                    sorted={sortKey === 'reserved'}
                    desc={sortDesc}
                    onSort={() => sort('reserved')}
                    style={{ width: 100, minWidth: 100 }}
                  >
                    RESERVED
                  </Th>
                  <Th style={{ width: 100, minWidth: 100 }}>INCOMING</Th>
                  <Th style={{ width: 100, minWidth: 100 }}>REORDER</Th>
                  <Th style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                  <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
                </Thead>
                <Tbody>
                  {isLoading ? (
                    <SkeletonRows cols={10} />
                  ) : paginated.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-14 text-center">
                        <EmptyState
                          icon={<Package className="h-9 w-9" />}
                          title={
                            search || warehouseF || catF || productF || statusF
                              ? 'No stock records match filters'
                              : 'No stock records yet'
                          }
                          description={
                            search || warehouseF || catF || productF || statusF
                              ? undefined
                              : 'Stock records are created automatically when products are received.'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    paginated.map((row: any) => {
                      const product = row.productId ? productMap.get(String(row.productId)) as Product | undefined : undefined;
                      const available = Number(row.availableQty ?? row.available) || 0;
                      const reserved = Number(row.reservedQty ?? row.reserved) || 0;
                      const incoming = Number(row.incomingQty ?? row.incoming ?? row.pendingQty) || 0;
                      const minStock = Number(row.min_stock ?? row.lowStockThreshold ?? product?.lowStockThreshold ?? 5) || 5;
                      const status = stockSummaryStatus(row);
                      return (
                        <Tr
                          key={row.id}
                          selected={selected.has(row.id)}
                          data-record-id={row.id}
                          data-tour="stock-row"
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
                              ariaLabel={`Select ${productLabel(row, productMap)}`}
                            />
                          </Td>

                          {/* Product with avatar */}
                          <Td className="py-3 min-w-[180px]">
                            <div className="flex items-center gap-2.5">
                              <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                                {(productLabel(row, productMap) || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-sm font-medium text-[var(--color-text)] leading-tight">
                                  {productLabel(row, productMap)}
                                </span>
                                <span className="text-[11px] text-[var(--color-text-muted)]">
                                  {product?.sku || row.sku || '—'}
                                </span>
                              </div>
                            </div>
                          </Td>

                          {/* Warehouse */}
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">
                            {warehouseLabel(row, warehouseMap)}
                          </Td>

                          {/* Category */}
                          <Td className="py-3">
                            <span className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                              {row.category || product?.category || '—'}
                            </span>
                          </Td>

                          {/* Available */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text)]">
                            {formatNumber(available)}
                          </Td>

                          {/* Reserved */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {formatNumber(reserved)}
                          </Td>

                          {/* Incoming */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {formatNumber(incoming)}
                          </Td>

                          {/* Reorder Level */}
                          <Td className="py-3 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {formatNumber(minStock)}
                          </Td>

                          {/* Status */}
                          <Td className="py-3">
                            <span data-interactive onClick={(e) => e.stopPropagation()}>
                              {statusBadge(status)}
                            </span>
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

            <div data-tour="stock-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
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

      {/* ── Adjust Stock Modal ──────────────────────────────── */}
      <Modal
        open={adjustOpen}
        onClose={() => {
          setAdjustOpen(false);
          setAdjustForm({ ...STOCK_FORM_DEFAULT });
        }}
        title="Adjust Stock"
        size="lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveStockMutation.isPending) {
              if (!adjustForm.productId || !adjustForm.qty) {
                toast.error('Product and qty required');
                return;
              }
              saveStockMutation.mutate(adjustForm);
            }
          }}
            className="space-y-5"
          >
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Transaction Type</label>
              <select
                value={adjustForm.type}
                onChange={(event) => setAdjustForm({ ...adjustForm, type: event.target.value as 'IN' | 'OUT' })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              >
                <option value="IN">IN (Stock In)</option>
                <option value="OUT">OUT (Stock Out)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Product *</label>
                <select
                  required
                  value={adjustForm.productId}
                  onChange={(event) => {
                    const p = productsForStock.find((item: any) => item.id === event.target.value);
                    setAdjustForm({ ...adjustForm, productId: event.target.value, product: p?.name || '', unit: p?.unit || 'PCS' });
                  }}
                  className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                >
                  <option value="">Select Product</option>
                  {productsForStock.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Warehouse *</label>
                <select
                  required
                  value={adjustForm.warehouseId}
                  onChange={(event) => {
                    const w = warehousesForStock.find((item: any) => item.id === event.target.value);
                    setAdjustForm({ ...adjustForm, warehouseId: event.target.value, warehouse: w?.name || '' });
                  }}
                  className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                >
                  <option value="">Select Warehouse</option>
                  {warehousesForStock.map((w: any) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Quantity *</label>
                <input
                  type="number" min="1" required
                  value={adjustForm.qty}
                  onChange={(event) => setAdjustForm({ ...adjustForm, qty: event.target.value })}
                  className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Date</label>
                <input
                  type="date"
                  value={adjustForm.date}
                  onChange={(event) => setAdjustForm({ ...adjustForm, date: event.target.value })}
                  className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Reference</label>
              <input
                value={adjustForm.reference}
                onChange={(event) => setAdjustForm({ ...adjustForm, reference: event.target.value })}
                placeholder="Optional reference"
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Notes</label>
              <textarea
                value={adjustForm.notes}
                onChange={(event) => setAdjustForm({ ...adjustForm, notes: event.target.value })}
                rows={2}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] min-h-[50px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" type="button" onClick={() => setAdjustOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saveStockMutation.isPending}>Save Entry</Button>
            </div>
          </form>
        </Modal>

        {/* ── Stock Details Modal ──────────────────────────────── */}
        <StockModalBoundary open={Boolean(viewItem)} onClose={closeView}>
          <StockDetailsModal
            open={Boolean(viewItem)}
            mode="summary"
            record={viewItem}
            productMap={productMap as Map<string, any>}
            warehouseMap={warehouseMap as Map<string, any>}
            userMap={userMap as Map<string, any>}
            onClose={closeView}
            onAdjust={(record) => openAdjustStock(record)}
            onAddStock={(record) => openAddStock(record)}
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
          title={delId === '__bulk__' ? 'Delete Stock Records' : 'Delete Stock Record'}
          message={
            delId === '__bulk__'
              ? `Delete ${selected.size} stock records? This action cannot be undone.`
              : 'Delete this stock record?'
          }
        />
      </div>
    </StockPageBoundary>
  );
}
