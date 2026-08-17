/**
 * Products Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total, Active, Low Stock, Out Of Stock, Reserved, Inventory Value)
 * - Leads-style search + inline filters (Date, Status, Category, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Change Status, Delete)
 * - ProductDetailsModal for detail view
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 * - Link to standalone Categories page
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAll, deleteDocById, updateDocById, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { useAppStore } from '../store/useAppStore';
import { queryKeys } from '../lib/queryKeys';
import {
  exportProductsCSV,
  useDeleteProduct,
  useProducts,
  useSaveProduct,
  PRODUCT_FORM_DEFAULT,
  type ProductForm,
} from '../features/inventory/hooks/useInventory';
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
import { CSVImportModal } from '../components/shared/CSVImportModal';
import { ProductDetailsModal } from '../features/inventory/components/ProductDetailsModal';
import {
  Boxes,
  Plus,
  RefreshCw,
  Download,
  UploadCloud,
  Trash2,
  ListChecks,
  Target,
  Package,
  AlertTriangle,
  Tag,
  DollarSign,
  Eye,
  X,
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
export default function Products() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { company } = useAppStore();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);

  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [catF, setCatF] = useState(() => searchParams.get('category') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');

  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table ────────────────────────────────────────────────────
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const userClosedRef = useRef(false);

  // ── Mutations state ──────────────────────────────────────────
  const [viewItem, setViewItem] = useState<Product | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>({ ...PRODUCT_FORM_DEFAULT });
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('Active');
  const [showImport, setShowImport] = useState(false);

  // ── Queries ──────────────────────────────────────────────────
  const { data: products = [], isLoading, refetch } = useProducts();
  const openParam = searchParams.get('open') || '';

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories-list', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.PRODUCT_CATEGORIES),
    staleTime: 300_000,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['company-users-products', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
  });

  const { data: stockRows = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).stock,
    queryFn: () => getAll(COLLECTIONS.STOCK),
    staleTime: 30_000,
  });

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({ ...PRODUCT_FORM_DEFAULT });
  }

  const saveMut = useSaveProduct(editId, closeForm);
  const deleteMut = useDeleteProduct();

  // ── Computed data ────────────────────────────────────────────
  const availableByProduct = useMemo(() => {
    const map = new Map<string, number>();
    ((stockRows as any[]) || []).forEach((row) => {
      const pid = String(row.productId || '');
      if (!pid) return;
      map.set(pid, (map.get(pid) || 0) + (Number(row.availableQty ?? row.available) || 0));
    });
    return map;
  }, [stockRows]);

  const reservedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    ((stockRows as any[]) || []).forEach((row) => {
      const pid = String(row.productId || '');
      if (!pid) return;
      map.set(pid, (map.get(pid) || 0) + (Number(row.reservedQty ?? row.reserved) || 0));
    });
    return map;
  }, [stockRows]);

  const catOptions = useMemo(() => {
    const live = (categories as any[])
      .map((c: any) => c.name || c.category || c.id)
      .filter(Boolean);
    const unique = Array.from(new Set(live)) as string[];
    return [
      { label: 'All Categories', value: '' },
      ...unique.map((c) => ({ label: c, value: c })),
    ];
  }, [categories]);

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
    const total = (products as Product[]).length;
    const active = (products as Product[]).filter((p) => (p.status || 'Active') === 'Active').length;
    const low = (products as Product[]).filter((p) => {
      const avail = availableByProduct.get(p.id) || 0;
      const threshold = Number((p as any).lowStockThreshold) || 5;
      return avail > 0 && avail < threshold;
    }).length;
    const outOfStock = (products as Product[]).filter((p) => {
      const avail = availableByProduct.get(p.id) || 0;
      return avail <= 0;
    }).length;
    const reserved = (products as Product[]).filter((p) => {
      const res = reservedByProduct.get(p.id) || 0;
      return res > 0;
    }).length;
    const inventoryValue = (products as Product[]).reduce((sum, p) => {
      const avail = availableByProduct.get(p.id) || 0;
      const cost = Number((p as any).cost) || 0;
      return sum + avail * cost;
    }, 0);
    return { total, active, low, outOfStock, reserved, inventoryValue };
  }, [products, availableByProduct, reservedByProduct]);

  // ── Sync helper ──────────────────────────────────────────────
  function syncQueueParams(nextState: {
    q?: string;
    status?: string;
    category?: string;
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
    const status = nextState.status ?? statusF;
    const category = nextState.category ?? catF;
    const createdBy = nextState.createdBy ?? createdByF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (category) next.set('category', category); else next.delete('category');
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
    let list = [...(products as any[])];

    // KPI filter
    if (activeKpi) {
      list = list.filter((p: any) => {
        const avail = availableByProduct.get(p.id) || 0;
        const threshold = Number(p.lowStockThreshold) || 5;
        switch (activeKpi) {
          case 'active':
            return (p.status || 'Active') === 'Active';
          case 'low':
            return avail > 0 && avail < threshold;
          case 'out':
            return avail <= 0;
          case 'reserved':
            return (reservedByProduct.get(p.id) || 0) > 0;
          default:
            return true;
        }
      });
    }

    // Search
    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter((p: any) =>
        [p.name, p.sku, p.category, p.hsn].some((v: any) =>
          String(v || '').toLowerCase().includes(q)
        )
      );
    }

    // Status
    if (statusF) {
      list = list.filter((p: any) =>
        statusF === 'Low Stock'
          ? (availableByProduct.get(p.id) || 0) < (Number(p.lowStockThreshold) || 5)
          : (p.status || 'Active') === statusF
      );
    }

    // Category
    if (catF) list = list.filter((p: any) => p.category === catF);

    // Created By
    if (createdByF) list = list.filter((p: any) => p.createdBy === createdByF);

    // Date range
    if (dateRange !== 'all') {
      list = list.filter((p: any) => isInDateRange(p.createdAt, dateRange as any, customFrom, customTo));
    }

    // Sort
    list.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'sku':
          cmp = (a.sku || '').localeCompare(b.sku || '');
          break;
        case 'category':
          cmp = (a.category || '').localeCompare(b.category || '');
          break;
        case 'price':
          cmp = (Number(a.price) || 0) - (Number(b.price) || 0);
          break;
        case 'stock':
          cmp = (availableByProduct.get(a.id) || 0) - (availableByProduct.get(b.id) || 0);
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
      }
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [products, deferredSearch, statusF, catF, createdByF, dateRange, customFrom, customTo, activeKpi, availableByProduct, reservedByProduct, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── URL sync for open param ──────────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (products as any[]).find((p: any) => p.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() =>
      document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }),
    0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, products]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !catF && !createdByF && dateRange === 'all';
  }, [activeKpi, search, statusF, catF, createdByF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (catF) count++;
    if (createdByF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, catF, createdByF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }),
  []);

  const toggleAll = () =>
    setSelected((s) =>
      s.size === paginated.length ? new Set() : new Set(paginated.map((p: any) => p.id)),
    );
  const allSel = selected.size === paginated.length && paginated.length > 0;

  const closeView = useCallback(() => {
    userClosedRef.current = true;
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [openParam, searchParams, setSearchParams]);

  const openView = useCallback(
    (p: any, replace = false) => {
      userClosedRef.current = false;
      setViewItem(p);
      if (!p?.id) return;
      const next = new URLSearchParams(searchParams);
      next.set('open', p.id);
      if (search) next.set('q', search); else next.delete('q');
      if (statusF) next.set('status', statusF); else next.delete('status');
      if (catF) next.set('category', catF); else next.delete('category');
      if (createdByF) next.set('createdBy', createdByF); else next.delete('createdBy');
      if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
      if (customFrom) next.set('from', customFrom); else next.delete('from');
      if (customTo) next.set('to', customTo); else next.delete('to');
      if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
      if (page > 1) next.set('page', String(page)); else next.delete('page');
      if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
      setSearchParams(next, { replace });
    },
    [activeKpi, catF, createdByF, customFrom, customTo, dateRange, page, perPage, search, searchParams, setSearchParams, statusF],
  );

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, p: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openView(p);
  }
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, p: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openView(p);
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
    setStatusF('');
    setCatF('');
    setCreatedByF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({
      q: '', status: '', category: '', createdBy: '',
      date: 'all', from: '', to: '', kpi: '', page: 1,
    });
  }

  function openEdit(p: any) {
    closeView();
    setForm({
      name: p.name || '',
      sku: p.sku || '',
      category: p.category || '',
      price: String(p.price || ''),
      mrp: String(p.mrp || ''),
      cost: String(p.cost || ''),
      discount: String(p.discount || ''),
      tax: String(p.tax || ''),
      unit: p.unit || 'PCS',
      hsn: p.hsn || '',
      description: p.description || '',
      trackingType: p.trackingType || 'none',
      company: p.company || '',
      status: p.status || 'Active',
      lowStockThreshold: String(p.lowStockThreshold || 5),
      specs: p.specs ? JSON.stringify(p.specs) : '',
    });
    setEditId(p.id);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveMut.isPending) return;
    if (!form.name || !form.category || !form.price) return toast.error('Name, category and price required');
    saveMut.mutate(form);
  }

  function exportSelected() {
    const rows = (products as any[]).filter((p) => selected.has(p.id));
    if (!rows.length) return toast.error('No products selected');
    exportProductsCSV(rows);
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.PRODUCTS, id)));
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      toast.success(`Deleted ${ids.length} products`);
      setSelected(new Set());
    } catch (error: any) {
      toast.error(error?.message || 'Delete failed');
    }
  }

  async function applyBulkStatus() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!bulkStatus) return toast.error('Select a status');
    try {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.PRODUCTS, id, { status: bulkStatus })));
      qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).productsRoot });
      toast.success(`Updated ${ids.length} products`);
      setShowBulkStatus(false);
      setSelected(new Set());
    } catch (error: any) {
      toast.error(error?.message || 'Status update failed');
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
    { label: 'TOTAL', value: stats.total, key: '', icon: <Package className="h-4 w-4" />, description: `${stats.total} total products` },
    { label: 'ACTIVE', value: stats.active, key: 'active', icon: <Boxes className="h-4 w-4" />, description: 'Active products' },
    { label: 'LOW STOCK', value: stats.low, key: 'low', icon: <AlertTriangle className="h-4 w-4" />, description: 'Below threshold' },
    { label: 'OUT OF STOCK', value: stats.outOfStock, key: 'out', icon: <Tag className="h-4 w-4" />, description: 'Zero available' },
    { label: 'RESERVED', value: stats.reserved, key: 'reserved', icon: <Package className="h-4 w-4" />, description: 'Products with reservations' },
    { label: 'INVENTORY VALUE', value: fmtCurrency(stats.inventoryValue, company?.currencySymbol || '₹'), key: 'value', icon: <DollarSign className="h-4 w-4" />, description: 'Total stock value (cost)' },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Products"
        icon={<Boxes className="h-6 w-6" />}
        breadcrumbs={['Home', 'Inventory', 'Products']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => setShowImport(true)}>
              Upload CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/categories')}>
              Categories
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...PRODUCT_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
              Add Product
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
              aria-label="Search products"
              placeholder="Search name, SKU, category, HSN..."
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
              aria-label="Status"
              value={statusF}
              onChange={(e) => {
                const v = e.target.value;
                setStatusF(v);
                if (v && activeKpi && v !== activeKpi) {
                  setActiveKpi('');
                  setPage(1);
                  syncQueueParams({ status: v, kpi: '', page: 1 });
                } else {
                  setPage(1);
                  syncQueueParams({ status: v, page: 1 });
                }
              }}
              options={[
                { label: 'All Status', value: '' },
                { label: 'Active', value: 'Active' },
                { label: 'Inactive', value: 'Inactive' },
                { label: 'Low Stock', value: 'Low Stock' },
              ]}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Category"
              value={catF}
              onChange={(e) => { setCatF(e.target.value); setPage(1); syncQueueParams({ category: e.target.value, page: 1 }); }}
              options={catOptions}
              className="w-[120px] h-8 py-1"
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
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
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
              {selected.size} product{selected.size > 1 ? 's' : ''} selected
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
                icon={<ListChecks className="h-3.5 w-3.5" />}
                onClick={() => setShowBulkStatus(true)}
                className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30"
              >
                Change Status
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
            {showBulkStatus && (
              <div className="flex w-full items-center gap-2 pt-2">
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  data-interactive
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
                <Button size="sm" onClick={applyBulkStatus}>Apply</Button>
              </div>
            )}
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
                    indeterminate={selected.size > 0 && !allSel}
                    onChange={toggleAll}
                    ariaLabel="Select visible products"
                  />
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'name'}
                  desc={sortDesc}
                  onSort={() => sort('name')}
                  style={{ width: '25%', minWidth: 200 }}
                >
                  NAME
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'sku'}
                  desc={sortDesc}
                  onSort={() => sort('sku')}
                  style={{ width: 120, minWidth: 120 }}
                >
                  SKU
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'category'}
                  desc={sortDesc}
                  onSort={() => sort('category')}
                  style={{ width: 130, minWidth: 130 }}
                >
                  CATEGORY
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'price'}
                  desc={sortDesc}
                  onSort={() => sort('price')}
                  style={{ width: 110, minWidth: 110 }}
                >
                  PRICE
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'stock'}
                  desc={sortDesc}
                  onSort={() => sort('stock')}
                  style={{ width: 100, minWidth: 100 }}
                >
                  STOCK
                </Th>
                <Th style={{ width: 110, minWidth: 110 }}>STATUS</Th>
                <Th
                  sortable
                  sorted={sortKey === 'createdAt'}
                  desc={sortDesc}
                  onSort={() => sort('createdAt')}
                  style={{ width: 90, minWidth: 90 }}
                >
                  CREATED
                </Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={9} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center">
                      <EmptyState
                        icon={<Package className="h-9 w-9" />}
                        title={
                          search || statusF || catF
                            ? 'No products match filters'
                            : 'No products yet'
                        }
                        description={
                          search || statusF || catF
                            ? undefined
                            : 'Add your first product to get started.'
                        }
                        action={
                          !search && !statusF && !catF
                            ? (
                              <Button
                                size="sm"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => {
                                  setForm({ ...PRODUCT_FORM_DEFAULT });
                                  setEditId(null);
                                  setShowForm(true);
                                }}
                                className="mt-2"
                              >
                                Add Your First Product
                              </Button>
                            )
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((p: any) => {
                    const avail = availableByProduct.get(p.id) || 0;
                    const reservedCount = reservedByProduct.get(p.id) || 0;
                    return (
                      <Tr
                        key={p.id}
                        selected={selected.has(p.id)}
                        data-record-id={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleRowClick(e, p)}
                        onKeyDown={(e) => handleRowKeyDown(e, p)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                            ariaLabel={`Select ${p.name}`}
                          />
                        </Td>

                        {/* Name + Avatar */}
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(p.name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{p.name || '—'}</span>
                            </div>
                          </div>
                        </Td>

                        {/* SKU */}
                        <Td className="py-3 font-mono text-[12px] text-[var(--color-text-muted)]">{p.sku || '—'}</Td>

                        {/* Category */}
                        <Td className="py-3">
                          <span className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                            {p.category || '—'}
                          </span>
                        </Td>

                        {/* Price */}
                        <Td className="py-3 font-semibold text-sm">{fmtCurrency(p.price, company?.currencySymbol || '₹')}</Td>

                        {/* Stock */}
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-[var(--color-text)]">{avail}</span>
                            {reservedCount > 0 && (
                              <span className="text-[10px] text-[var(--color-text-muted)]">({reservedCount} res.)</span>
                            )}
                          </div>
                        </Td>

                        {/* Status */}
                        <Td className="py-3">
                          <span data-interactive onClick={(e) => e.stopPropagation()}>
                            {statusBadge(p.status || 'Active')}
                          </span>
                        </Td>

                        {/* Created */}
                        <Td className="py-3">
                          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                            {formatCreatedDate(p.createdAt)}
                          </div>
                        </Td>

                        {/* Actions */}
                        <Td className="py-3" align="right">
                          <Button
                            size="xs"
                            variant="outline"
                            icon={<Eye className="h-3 w-3" />}
                            onClick={(e) => { e.stopPropagation(); openView(p); }}
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

      {/* ── Product Form Modal ───────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Product' : 'Add Product'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Product Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">SKU</label>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Category *</label>
              <input
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Electronics"
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Price *</label>
              <input
                required type="number" min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">MRP</label>
              <input
                type="number" min="0"
                value={form.mrp}
                onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Cost</label>
              <input
                type="number" min="0"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Tax (%)</label>
              <input
                type="number" min="0" max="100"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Unit</label>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              >
                <option value="PCS">PCS</option>
                <option value="KG">KG</option>
                <option value="LTR">LTR</option>
                <option value="MTR">MTR</option>
                <option value="BOX">BOX</option>
                <option value="SET">SET</option>
                <option value="NOS">NOS</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">HSN Code</label>
            <input
              value={form.hsn}
              onChange={(e) => setForm({ ...form, hsn: e.target.value })}
              className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] min-h-[60px]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" loading={saveMut.isPending}>
              {editId ? 'Update' : 'Add Product'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Product Details Modal ────────────────────────────── */}
      <ProductDetailsModal
        key={viewItem?.id || 'product-modal-closed'}
        open={!!viewItem}
        product={viewItem}
        onClose={closeView}
        onEdit={(product) => openEdit(product)}
        onDuplicate={(product) => {
          closeView();
          setForm({
            name: `${product.name || 'Product'} Copy`,
            sku: '',
            category: product.category || '',
            price: String(product.price || ''),
            mrp: String(product.mrp || ''),
            cost: String(product.cost || ''),
            discount: String(product.discount || ''),
            tax: String(product.tax || ''),
            unit: product.unit || 'PCS',
            hsn: product.hsn || '',
            description: product.description || '',
            trackingType: product.trackingType || 'none',
            company: product.company || '',
            status: product.status || 'Active',
            lowStockThreshold: String(product.lowStockThreshold || 5),
            specs: product.specs ? JSON.stringify(product.specs) : '',
          });
          setEditId(null);
          setShowForm(true);
        }}
        onDelete={(product) => setDelId(product.id)}
        currencySymbol={company?.currencySymbol || '₹'}
      />

      {/* ── CSV Import Modal ─────────────────────────────────── */}
      {showImport && (
        <CSVImportModal collection="products" onClose={() => setShowImport(false)} onSuccess={() => refetch()} />
      )}

      {/* ── Delete Confirmation ──────────────────────────────── */}
      <ConfirmDialog
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={async () => {
          try {
            if (delId === '__bulk__') {
              await bulkDelete();
            } else if (delId) {
              await deleteMut.mutateAsync(delId);
              if (viewItem?.id === delId) closeView();
            }
            setDelId(null);
          } catch {}
        }}
        loading={deleteMut.isPending}
        title={delId === '__bulk__' ? 'Delete Products' : 'Delete Product'}
        message={
          delId === '__bulk__'
            ? `Delete ${selected.size} products? This action cannot be undone.`
            : 'Delete this product? Stock entries will not be removed.'
        }
      />
    </div>
  );
}
