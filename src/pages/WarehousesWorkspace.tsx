/**
 * Warehouses Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total, Active, Occupied, Available Capacity, Inventory Value, Under Maintenance)
 * - Leads-style search + inline filters (Date, Status, Location, Type, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Transfer Manager, Delete)
 * - WarehouseDetailsModal for detail view
 * - WarehouseTransferModal for manager transfer
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Warehouse as WarehouseIcon,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  Users,
  Target,
  MapPin,
  Package,
  AlertTriangle,
  DollarSign,
  Eye,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

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
import { WarehouseDetailsModal, WarehouseTransferModal } from '../features/warehouses/components/WarehouseModals';
import { WarehouseFormComponent } from '../features/warehouses/components/WarehouseForm';
import { useWarehouses, useSaveWarehouse, useDeleteWarehouse } from '../features/warehouses/hooks/useWarehouses';
import { WAREHOUSE_FORM_DEFAULT, WAREHOUSE_STATUS_OPTIONS, warehouseGeoToForm, parseWarehouseGeo, type Warehouse, type WarehouseForm } from '../features/warehouses/types';
import {
  downloadWarehouseCsv,
  downloadWarehouseReport,
  formatCapacityLabel,
  formatNumber,
  isRowOpenIgnored,
  matchesWarehouseEntity,
  normalizeText,
  parseCapacity,
  recencyDotClass,
  toDateValue,
  warehouseLocation,
  warehouseType,
} from '../features/warehouses/utils/warehouseWorkspaceUtils';
import { useProducts } from '../features/inventory/hooks/useInventory';
import { useEmployees } from '../features/employees/hooks/useEmployees';
import { buildUserMap, getWarehouseEmployeeCounts } from '../lib/employeeDirectory';
import { COLLECTIONS } from '../lib/firebase';
import { getAll, deleteDocById, updateDocById, fmtCurrency, fmtDate } from '../lib/firestore';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { isInDateRange } from '../lib/dateFilters';

const PER_PAGE = 10;

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '';
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Warehouses() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const company = useAppStore((s) => s.company);
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';

  // ── Filters ──────────────────────────────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [locationF, setLocationF] = useState(() => searchParams.get('location') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
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
  const [viewItem, setViewItem] = useState<Warehouse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<WarehouseForm>({ ...WAREHOUSE_FORM_DEFAULT });
  const [delId, setDelId] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState<{ ids: string[]; label: string } | null>(null);


  // ── Queries ──────────────────────────────────────────────────
  const { data: warehouses = [], isLoading, refetch } = useWarehouses();
  const { data: products = [] } = useProducts();
  const { data: stockSummary = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).stock,
    queryFn: async () => getAll(COLLECTIONS.STOCK),
    staleTime: 30_000,
  });
  const { data: allUsers = [] } = useQuery({
    queryKey: ['company-users-warehouses', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
  });
  // Phase 12: real, query-backed warehouse-wise employee count — previously
  // "warehouse-wise employee count" had zero aggregation code anywhere in
  // this feature; Employee.userId already links to a real User (built by
  // EmployeeDomainService.create()), and that User already carries
  // warehouseId — nothing had ever read through that link before.
  const { data: employees = [] } = useEmployees();

  const saveMut = useSaveWarehouse(editId, () => {
    setShowForm(false);
    setEditId(null);
    setForm({ ...WAREHOUSE_FORM_DEFAULT });
  });
  const deleteMut = useDeleteWarehouse();

  // ── Computed data ────────────────────────────────────────────
  const usersByIdForEmployees = useMemo(() => buildUserMap(allUsers as any[]), [allUsers]);
  const employeeCountByWarehouse = useMemo(
    () => getWarehouseEmployeeCounts(employees as any[], usersByIdForEmployees),
    [employees, usersByIdForEmployees]
  );

  const metricsById = useMemo(() => {
    const stockRows = (stockSummary as any[]).filter((row) => row.isDeleted !== true);
    const costByProduct = new Map<string, number>();
    (products as any[]).forEach((p) => costByProduct.set(p.id, Number(p.cost) || 0));

    const map = new Map<string, {
      used: number;
      reserved: number;
      productIds: Set<string>;
      capacityValue: number | null;
      utilization: number | null;
      freeCapacity: number | null;
      hasInventory: boolean;
      inventoryValue: number;
      employeeCount: number;
    }>();

    (warehouses as any[]).forEach((warehouse) => {
      const rows = stockRows.filter((row) => matchesWarehouseEntity(warehouse, row));
      const used = rows.reduce((sum, row) => sum + (Number(row.availableQty ?? row.available) || 0) + (Number(row.reservedQty ?? row.reserved) || 0), 0);
      const reserved = rows.reduce((sum, row) => sum + (Number(row.reservedQty ?? row.reserved) || 0), 0);
      const productIds = new Set(rows.map((row) => String(row.productId || row.product || row.productName || '')).filter(Boolean));
      const capacityValue = parseCapacity(warehouse.capacity);
      const utilization = capacityValue && capacityValue > 0 ? used / capacityValue : null;
      const freeCapacity = capacityValue !== null ? Math.max(0, capacityValue - used) : null;
      const inventoryValue = rows.reduce((sum, row) => {
        const pid = String(row.productId || '');
        const cost = costByProduct.get(pid) || 0;
        const avail = Number(row.availableQty ?? row.available) || 0;
        return sum + (avail * cost);
      }, 0);
      map.set(warehouse.id, {
        used,
        reserved,
        productIds,
        capacityValue,
        utilization,
        freeCapacity,
        hasInventory: used > 0 || reserved > 0 || productIds.size > 0,
        inventoryValue,
        employeeCount: employeeCountByWarehouse.get(warehouse.id) || 0,
      });
    });
    return map;
  }, [stockSummary, products, warehouses, employeeCountByWarehouse]);

  const managerUsers = useMemo(
    () => (allUsers as any[])
      .filter((u) => !u.isDeleted && u.status !== 'Inactive')
      .filter((u) => ['Admin', 'Director', 'Manager', 'Warehouse', 'Operations'].includes(u.role))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [allUsers],
  );

  const userOptions = useMemo(() => {
    return [
      { label: 'All Users', value: '' },
      ...Array.from(new Map((allUsers as any[]).map((u: any) => [u.id, u])).values())
        .filter((u: any) => u.name || u.email)
        .map((u: any) => ({ label: u.name || u.email, value: u.id })),
    ];
  }, [allUsers]);

  const locationOptions = useMemo(() => {
    const cities = Array.from(new Set((warehouses as any[]).map((w) => w.city).filter(Boolean)));
    return [{ label: 'All Locations', value: '' }, ...cities.map((c) => ({ label: c, value: c }))];
  }, [warehouses]);

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set((warehouses as any[]).map((w) => warehouseType(w)).filter(Boolean)));
    return [{ label: 'All Types', value: '' }, ...types.map((t) => ({ label: t, value: t }))];
  }, [warehouses]);

  // ── Stats (6 KPIs) ──────────────────────────────────────────
  const stats = useMemo(() => {
    const total = (warehouses as any[]).length;
    const active = (warehouses as any[]).filter((w) => (w.status || 'Active') === 'Active').length;
    const occupied = (warehouses as any[]).filter((w) => metricsById.get(w.id)?.hasInventory).length;
    const underMaintenance = (warehouses as any[]).filter((w) => w.status === 'Under Maintenance').length;
    const availableCapacity = (warehouses as any[]).reduce((sum, w) => {
      const m = metricsById.get(w.id);
      return sum + (m?.freeCapacity || 0);
    }, 0);
    const inventoryValue = (warehouses as any[]).reduce((sum, w) => {
      const m = metricsById.get(w.id);
      return sum + (m?.inventoryValue || 0);
    }, 0);
    return { total, active, occupied, availableCapacity, inventoryValue, underMaintenance };
  }, [warehouses, metricsById]);

  // ── Sync helper ──────────────────────────────────────────────
  function syncQueueParams(nextState: {
    q?: string;
    status?: string;
    location?: string;
    type?: string;
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
    const location = nextState.location ?? locationF;
    const type = nextState.type ?? typeF;
    const createdBy = nextState.createdBy ?? createdByF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (location) next.set('location', location); else next.delete('location');
    if (type) next.set('type', type); else next.delete('type');
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
    const q = (deferredSearch || '').toLowerCase().trim();
    let result = (warehouses as any[]).filter((w) => {
      const created = w.createdAt as string | undefined;
      const location = warehouseLocation(w);
      const type = warehouseType(w);
      const metrics = metricsById.get(w.id) || {
        used: 0, reserved: 0, productIds: new Set<string>(),
        capacityValue: null, utilization: null, freeCapacity: null,
        hasInventory: false, inventoryValue: 0,
      };

      // KPI filter
      const kpiMatch =
        !activeKpi ||
        activeKpi === 'total' ||
        (activeKpi === 'active' && (w.status || 'Active') === 'Active') ||
        (activeKpi === 'occupied' && metrics.used > 0) ||
        (activeKpi === 'maintenance' && w.status === 'Under Maintenance');

      // Search
      const searchMatch =
        !q ||
        [w.name, w.code, w.city, w.state, w.managerName, location, type]
          .some((val) => String(val || '').toLowerCase().includes(q));

      // Filters
      const statusMatch = !statusF || normalizeText(w.status || 'Active') === normalizeText(statusF);
      const locationMatch = !locationF || normalizeText(location) === normalizeText(locationF);
      const typeMatch = !typeF || normalizeText(type) === normalizeText(typeF);
      const createdByMatch = !createdByF || w.createdBy === createdByF;
      const dateMatch = isInDateRange(w.createdAt, dateRange as any, customFrom, customTo);

      return kpiMatch && searchMatch && statusMatch && locationMatch && typeMatch && createdByMatch && dateMatch;
    });

    // Sort
    result.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'code':
          cmp = (a.code || '').localeCompare(b.code || '');
          break;
        case 'city':
          cmp = (a.city || '').localeCompare(b.city || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'capacity':
          cmp = (parseCapacity(a.capacity) || 0) - (parseCapacity(b.capacity) || 0);
          break;
        case 'utilization':
          cmp = (metricsById.get(a.id)?.utilization || 0) - (metricsById.get(b.id)?.utilization || 0);
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          break;
      }
      return sortDesc ? -cmp : cmp;
    });

    return result;
  }, [activeKpi, createdByF, customFrom, customTo, dateRange, locationF, metricsById, search, sortDesc, sortKey, statusF, typeF, warehouses]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page, perPage]);

  const paginated = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  // ── URL-driven open ──────────────────────────────────────────
  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    const openId = openParam;
    if (!openId || isLoading) return;
    const target = (warehouses as any[]).find((w) => w.id === openId);
    if (!target) return;
    setViewItem(target);
    window.setTimeout(() =>
      document.querySelector(`[data-record-id="${CSS.escape(openId)}"]`)?.scrollIntoView({ block: 'center' }),
    0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam, isLoading, warehouses]);

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !statusF && !locationF && !typeF && !createdByF && dateRange === 'all';
  }, [activeKpi, search, statusF, locationF, typeF, createdByF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (statusF) count++;
    if (locationF) count++;
    if (typeF) count++;
    if (createdByF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, statusF, locationF, typeF, createdByF, dateRange, activeKpi]);

  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }),
  []);

  const toggleAll = () =>
    setSelected((s) =>
      s.size === paginated.length ? new Set() : new Set(paginated.map((w: any) => w.id)),
    );
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function closeView() {
    userClosedRef.current = true;
    setViewItem(null);
    if (!openParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  function openView(w: any, replace = false) {
    userClosedRef.current = false;
    setViewItem(w);
    if (!w?.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('open', w.id);
    if (search) next.set('q', search); else next.delete('q');
    if (statusF) next.set('status', statusF); else next.delete('status');
    if (locationF) next.set('location', locationF); else next.delete('location');
    if (typeF) next.set('type', typeF); else next.delete('type');
    if (createdByF) next.set('createdBy', createdByF); else next.delete('createdBy');
    if (dateRange && dateRange !== 'all') next.set('date', dateRange); else next.delete('date');
    if (customFrom) next.set('from', customFrom); else next.delete('from');
    if (customTo) next.set('to', customTo); else next.delete('to');
    if (activeKpi) next.set('kpi', activeKpi); else next.delete('kpi');
    if (page > 1) next.set('page', String(page)); else next.delete('page');
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage)); else next.delete('perPage');
    setSearchParams(next, { replace });
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, w: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openView(w);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, w: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openView(w);
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
    setLocationF('');
    setTypeF('');
    setCreatedByF('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setActiveKpi('');
    setPage(1);
    syncQueueParams({
      q: '', status: '', location: '', type: '', createdBy: '',
      date: 'all', from: '', to: '', kpi: '', page: 1,
    });
  }

  function openEdit(w: any) {
    closeView();
    setForm({
      name: w.name || '',
      code: w.code || '',
      address: w.address || '',
      city: w.city || '',
      state: w.state || '',
      pincode: w.pincode || '',
      managerName: w.managerName || '',
      managerPhone: w.managerPhone || '',
      capacity: String(w.capacity || ''),
      status: w.status || 'Active',
      notes: w.notes || '',
      ...warehouseGeoToForm(w),
    });
    setEditId(w.id);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveMut.isPending) return;
    if (!form.name) return toast.error('Warehouse name is required');
    // Parse geo fields from string form to validated numbers for Firestore
    const geo = parseWarehouseGeo({
      latitude: form.latitude,
      longitude: form.longitude,
      geofenceRadiusMeters: form.geofenceRadiusMeters,
    });
    saveMut.mutate({
      ...form,
      ...geo,
    });
  }

  function exportSelected() {
    const rows = (warehouses as any[]).filter((w) => selected.has(w.id)).map((w) => {
      const m = metricsById.get(w.id);
      return {
        ...w,
        usedLabel: m ? formatNumber(m.used) : '—',
        availableLabel: m ? formatNumber(m.freeCapacity) : '—',
        productCount: m?.productIds.size || 0,
      };
    });
    if (!rows.length) return toast.error('No warehouses selected');
    downloadWarehouseCsv(rows);
    setSelected(new Set());
  }

  function handleTransferConfirm(payload: { managerId: string; managerName: string; managerPhone: string; note: string }) {
    if (!showTransfer) return;
    const ids = showTransfer.ids;
    Promise.all(
      ids.map((id) => updateDocById(COLLECTIONS.WAREHOUSES, id, {
        managerName: payload.managerName,
        managerPhone: payload.managerPhone,
        notes: payload.note || undefined,
      })),
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(`Transferred ${ids.length} warehouse${ids.length > 1 ? 's' : ''} to ${payload.managerName}`);
      setShowTransfer(null);
      setSelected(new Set());
    }).catch((error: any) => toast.error(error?.message || 'Transfer failed'));
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.WAREHOUSES, id)));
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(`Deleted ${ids.length} warehouse${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
    } catch (error: any) {
      toast.error(error?.message || 'Delete failed');
    }
  }

  // ── Date options ────────────────────────────────────────────
  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'this_week' },
    { label: 'Last 30 days', value: 'this_month' },
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
    { label: 'TOTAL', value: stats.total, key: '', icon: <WarehouseIcon className="h-4 w-4" />, description: `${stats.total} total warehouses` },
    { label: 'ACTIVE', value: stats.active, key: 'active', icon: <WarehouseIcon className="h-4 w-4" />, description: 'Active warehouses' },
    { label: 'OCCUPIED', value: stats.occupied, key: 'occupied', icon: <Package className="h-4 w-4" />, description: 'Warehouses with stock' },
    { label: 'FREE CAPACITY', value: formatNumber(stats.availableCapacity), key: 'capacity', icon: <MapPin className="h-4 w-4" />, description: 'Total available capacity' },
    { label: 'INVENTORY VALUE', value: fmtCurrency(stats.inventoryValue, company?.currencySymbol || '₹'), key: 'value', icon: <DollarSign className="h-4 w-4" />, description: 'Total stock value (cost)' },
    { label: 'MAINTENANCE', value: stats.underMaintenance, key: 'maintenance', icon: <AlertTriangle className="h-4 w-4" />, description: 'Under maintenance' },
  ];

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Warehouses"
        icon={<WarehouseIcon className="h-6 w-6" />}
        breadcrumbs={['Home', 'Inventory', 'Warehouses']}
        statusText="Last sync · Realtime Connected"
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => { setForm({ ...WAREHOUSE_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}
            >
              Add Warehouse
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
              k.key === 'capacity' || k.key === 'value'
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
              aria-label="Search warehouses"
              placeholder="Search name, code, city, manager..."
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
                ...WAREHOUSE_STATUS_OPTIONS,
              ]}
              className="w-[120px] h-8 py-1"
            />
            <Select
              aria-label="Location"
              value={locationF}
              onChange={(e) => { setLocationF(e.target.value); setPage(1); syncQueueParams({ location: e.target.value, page: 1 }); }}
              options={locationOptions}
              className="w-[120px] h-8 py-1"
            />
            <Select
              aria-label="Type"
              value={typeF}
              onChange={(e) => { setTypeF(e.target.value); setPage(1); syncQueueParams({ type: e.target.value, page: 1 }); }}
              options={typeOptions}
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
                {statusF && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{statusF}</span>
                )}
                {locationF && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{locationF}</span>
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
              {selected.size} warehouse{selected.size > 1 ? 's' : ''} selected
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
                icon={<Users className="h-3.5 w-3.5" />}
                onClick={() => setShowTransfer({ ids: Array.from(selected), label: `${selected.size} warehouse${selected.size > 1 ? 's' : ''}` })}
                className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30"
              >
                Assign Manager
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
                    indeterminate={selected.size > 0 && !allSel}
                    onChange={toggleAll}
                    ariaLabel="Select visible warehouses"
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
                  sorted={sortKey === 'code'}
                  desc={sortDesc}
                  onSort={() => sort('code')}
                  style={{ width: 110, minWidth: 110 }}
                >
                  CODE
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'city'}
                  desc={sortDesc}
                  onSort={() => sort('city')}
                  style={{ width: '15%', minWidth: 130 }}
                >
                  LOCATION
                </Th>
                <Th style={{ width: 120, minWidth: 120 }}>MANAGER</Th>
                <Th
                  sortable
                  sorted={sortKey === 'capacity'}
                  desc={sortDesc}
                  onSort={() => sort('capacity')}
                  style={{ width: 110, minWidth: 110 }}
                >
                  CAPACITY
                </Th>
                <Th
                  sortable
                  sorted={sortKey === 'status'}
                  desc={sortDesc}
                  onSort={() => sort('status')}
                  style={{ width: 110, minWidth: 110 }}
                >
                  STATUS
                </Th>
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
                        icon={<WarehouseIcon className="h-9 w-9" />}
                        title={
                          search || statusF || locationF
                            ? 'No warehouses match filters'
                            : 'No warehouses yet'
                        }
                        description={
                          search || statusF || locationF
                            ? undefined
                            : 'Add your first warehouse to get started.'
                        }
                        action={
                          !search && !statusF && !locationF
                            ? (
                              <Button
                                size="sm"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => {
                                  setForm({ ...WAREHOUSE_FORM_DEFAULT });
                                  setEditId(null);
                                  setShowForm(true);
                                }}
                                className="mt-2"
                              >
                                Add Your First Warehouse
                              </Button>
                            )
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((w: any) => {
                    const metrics = metricsById.get(w.id);
                    const used = metrics?.used || 0;
                    const capacityValue = metrics?.capacityValue;
                    const utilization = metrics?.utilization;
                    return (
                      <Tr
                        key={w.id}
                        selected={selected.has(w.id)}
                        data-record-id={w.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleRowClick(e, w)}
                        onKeyDown={(e) => handleRowKeyDown(e, w)}
                        className="transition-colors duration-150"
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(w.id)}
                            onChange={() => toggleSelect(w.id)}
                            ariaLabel={`Select ${w.name}`}
                          />
                        </Td>

                        {/* Name + Avatar */}
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(w.name || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{w.name || '—'}</span>
                            </div>
                          </div>
                        </Td>

                        {/* Code */}
                        <Td className="py-3 font-mono text-[12px] text-[var(--color-text-muted)]">{w.code || '—'}</Td>

                        {/* Location */}
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
                            <span className="text-xs text-[var(--color-text-muted)]">{warehouseLocation(w)}</span>
                          </div>
                        </Td>

                        {/* Manager */}
                        <Td className="py-3">
                          <span className="text-xs text-[var(--color-text)]">{w.managerName || <span className="text-[var(--color-text-disabled)]">—</span>}</span>
                        </Td>

                        {/* Capacity */}
                        <Td className="py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-[var(--color-text)]">{formatCapacityLabel(w.capacity)}</span>
                            {utilization != null && (
                              <div className="flex items-center gap-1">
                                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--color-primary)]"
                                    style={{ width: `${Math.min(100, Math.round(utilization * 100))}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[var(--color-text-muted)]">
                                  {Math.round(utilization * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </Td>

                        {/* Status */}
                        <Td className="py-3">
                          <span data-interactive onClick={(e) => e.stopPropagation()}>
                            {statusBadge(w.status || 'Active')}
                          </span>
                        </Td>

                        {/* Created */}
                        <Td className="py-3">
                          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                            <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(w.createdAt)}`} />
                            {formatCreatedDate(w.createdAt)}
                          </div>
                        </Td>

                        {/* Actions */}
                        <Td className="py-3" align="right">
                          <Button
                            size="xs"
                            variant="outline"
                            icon={<Eye className="h-3 w-3" />}
                            onClick={(e) => { e.stopPropagation(); openView(w); }}
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

      {/* ── Warehouse Form Modal ──────────────────────────────── */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditId(null); setForm({ ...WAREHOUSE_FORM_DEFAULT }); }} title={editId ? 'Edit Warehouse' : 'Add Warehouse'} size="lg">
        <WarehouseFormComponent
          form={form}
          onChange={(f) => setForm(f)}
          onSubmit={handleSubmit}
          onCancel={() => { setShowForm(false); setEditId(null); setForm({ ...WAREHOUSE_FORM_DEFAULT }); }}
          loading={saveMut.isPending}
          isEdit={!!editId}
        />
      </Modal>

      {/* ── Warehouse Details Modal ──────────────────────────── */}
      <WarehouseDetailsModal
        key={viewItem?.id || 'warehouse-modal-closed'}
        open={!!viewItem}
        warehouse={viewItem}
        stockRows={stockSummary as any[]}
        products={products as any[]}
        employeeCount={viewItem ? (metricsById.get(viewItem.id)?.employeeCount || 0) : 0}
        onClose={closeView}
        onEdit={(w) => openEdit(w)}
        onArchive={(w) => {
          updateDocById(COLLECTIONS.WAREHOUSES, w.id, { status: 'Inactive' }).then(() => {
            qc.invalidateQueries({ queryKey: ['warehouses'] });
            toast.success('Warehouse archived');
            closeView();
          }).catch((e: any) => toast.error(e?.message || 'Archive failed'));
        }}
        onTransfer={(w) => setShowTransfer({ ids: [w.id], label: w.name })}
        onExport={(w) => {
          const m = metricsById.get(w.id);
          downloadWarehouseReport(
            w,
            { usedLabel: m ? formatNumber(m.used) : '—', availableLabel: m ? formatNumber(m.freeCapacity) : '—', productCount: m?.productIds.size || 0 },
            [],
            [],
          );
        }}
        onGenerateReport={(w) => {
          const m = metricsById.get(w.id);
          downloadWarehouseReport(
            w,
            { usedLabel: m ? formatNumber(m.used) : '—', availableLabel: m ? formatNumber(m.freeCapacity) : '—', productCount: m?.productIds.size || 0 },
            [],
            [],
          );
        }}
        onDelete={(w) => setDelId(w.id)}
        canDelete={true}
      />

      {/* ── Transfer Modal ────────────────────────────────────── */}
      <WarehouseTransferModal
        open={!!showTransfer}
        targets={showTransfer ? (warehouses as any[]).filter((w) => showTransfer.ids.includes(w.id)) : []}
        currentUsers={managerUsers}
        onClose={() => setShowTransfer(null)}
        onConfirm={handleTransferConfirm}
        saving={false}
      />

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
        title={delId === '__bulk__' ? 'Delete Warehouses' : 'Delete Warehouse'}
        message={
          delId === '__bulk__'
            ? `Delete ${selected.size} warehouses? Stock data will not be removed.`
            : 'Delete this warehouse? Stock data will not be removed.'
        }
      />
    </div>
  );
}
