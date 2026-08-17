/**
 * Dispatch Page — Desktop Gold Standard (Phase 1)
 * Full Leads parity implementation.
 *
 * Features:
 * - 6 PremiumKpi cards (Total, Scheduled, Verified, In Transit, Delivered, Total Dispatch Value)
 * - Leads-style search + inline filters (Date, Status, Warehouse, Assigned, Type, Priority, Customer, Company, Created By)
 * - UniversalCheckbox for selection
 * - Sortable columns with sticky header
 * - Bulk actions (Export CSV, Assign, Verify, Execute, Archive/Close, Delete)
 * - Row click / View opens the /dispatch/:id record workspace page — the old
 *   dispatch detail popup was retired (Dispatch Workspace Migration; the
 *   Dispatch stage's operational workspace now lives inside the Project
 *   Workspace)
 * - URL sync for all filter state
 * - Type A scroll architecture (no browser scroll)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Truck, Plus, RefreshCw, Eye, X,
  Download, Archive, Trash2, UserPlus, ShieldCheck, ArrowLeftRight, Target, DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../lib/firebase';
import { getAll, deleteDocById, fmtDate, fmtCurrency } from '../lib/firestore';
import { closeDispatch, requestDispatch } from '../lib/dispatchWorkflow';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { statusBadge } from '../components/ui/Badge';
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

import { DispatchRequestModal } from '../features/dispatch/components/DispatchRequestModal';
import {
  DEFAULT_FORM,
  type DateRange,
  dispatchAssigned,
  dispatchCustomer,
  dispatchDisplayNumber,
  dispatchErrorMessage,
  dispatchPriority,
  dispatchType,
  dispatchWarehouse,
  dispatchWorkflowState,
  exportDispatchCsv,
  isInDateRange,
  isInteractiveTarget,
  normalizeText,
  statusMatches,
  toDateValue,
  workflowMatchesKpi,
} from '../features/dispatch/utils/dispatchWorkspaceUtils';

// ── Error boundaries (preserved from existing) ─────────────────
type BoundaryProps = { children: React.ReactNode };
type BoundaryState = { hasError: boolean };

class DispatchPageBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.error('[DispatchPageBoundary]', error); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-enterprise-surface)]">
          <p className="text-sm font-semibold text-[var(--color-text)]">Dispatch page error was contained.</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Reload the page to restore the logistics workspace.</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text-inverse)]"
            onClick={() => window.location.reload()}
          >
            Reload dispatch
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Helper: compute total value of a dispatch from its items ───
function computeDispatchValue(row: any, productMap: Map<string, any>): number {
  if (!Array.isArray(row.items)) return 0;
  return row.items.reduce((sum: number, item: any) => {
    const qty = Number(item.qty || item.requestedQty || item.verifiedQty || 0);
    const product = item.productId ? productMap.get(String(item.productId)) : null;
    const price = Number(product?.price) || 0;
    return sum + qty * price;
  }, 0);
}

// ─────────────────────────────────────────────────────────────────
export default function Dispatch() {
  const qc = useQueryClient();
  const { company } = useAppStore();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectScope = searchParams.get('projectId') || '';

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [dateRange, setDateRange] = useState<DateRange>(() => (searchParams.get('date') || 'all') as DateRange);
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [warehouseF, setWarehouseF] = useState(() => searchParams.get('warehouse') || '');
  const [assignedF, setAssignedF] = useState(() => searchParams.get('assigned') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || '');
  const [priorityF, setPriorityF] = useState(() => searchParams.get('priority') || '');
  const [customerF, setCustomerF] = useState(() => searchParams.get('customer') || '');
  const [companyF, setCompanyF] = useState(() => searchParams.get('company') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [sortKey, setSortKey] = useState(() => searchParams.get('sort') || '');
  const [sortDesc, setSortDesc] = useState(() => searchParams.get('sortDesc') === '1');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || 10));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [showReqForm, setShowReqForm] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [items, setItems] = useState<any[]>([]);
  const [createdDispatch, setCreatedDispatch] = useState<{ dispatchId: string; deliveryOTP: string } | null>(null);

  const [bulkConfirm, setBulkConfirm] = useState<{ action: 'archive' | 'delete'; ids: string[] } | null>(null);

  // ── Queries ──────────────────────────────────────────────────
  const { data: dispatches = [], isLoading, refetch } = useQuery({
    queryKey: qkeys.dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });
  const { data: orders = [] } = useQuery({
    queryKey: qkeys.ordersAll,
    queryFn: () => getAll(COLLECTIONS.ORDERS),
    staleTime: 60_000,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: qkeys.warehouses,
    queryFn: () => getAll(COLLECTIONS.WAREHOUSES),
    staleTime: 300_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: qkeys.productsAll,
    queryFn: () => getAll(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: qkeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  // ── Mutations (preserved from existing) ───────────────────────
  // NOTE: the Dispatch management popup was retired (Dispatch Workspace
  // Migration) — approve / verify & execute / delivery-OTP / close / integrity
  // / edit now run from the Dispatch stage's operational workspace inside the
  // Project Workspace (src/features/projects/components/workspace/stages/
  // ProjectDispatchWorkspace.tsx), which calls the same canonical
  // lib/dispatchWorkflow services. The list page keeps only the create flow.
  const createReq = useMutation({
    mutationFn: async (payload: any) => await requestDispatch(payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: qkeys.dispatchRoot });
      toast.success('Dispatch request submitted');
      setShowReqForm(false);
      setForm({ ...DEFAULT_FORM });
      setItems([]);
      setCreatedDispatch(result);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  // ── Search debounce: 300ms ──────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // ── Computed data ────────────────────────────────────────────
  const productMap = useMemo(() => new Map((products as any[]).map((p: any) => [String(p.id), p])), [products]);
  const warehouseMap = useMemo(() => new Map((warehouses as any[]).map((w: any) => [String(w.id), w])), [warehouses]);

  const userOptions = useMemo(() => {
    return [
      { label: 'All Users', value: '' },
      ...Array.from(new Map((users as any[]).map((u: any) => [u.id, u])).values())
        .filter((u: any) => u.name || u.email)
        .map((u: any) => ({ label: u.name || u.email, value: u.id })),
    ];
  }, [users]);

  const warehouseOptions = useMemo(() => Array.from(new Set((dispatches as any[]).map((row: any) => dispatchWarehouse(row)).filter((v) => v && v !== '—'))).sort(), [dispatches, warehouseMap]);
  const assignedOptions = useMemo(() => Array.from(new Set([
    ...(users as any[]).map((u: any) => u.name || u.email || 'System').filter(Boolean),
    ...(dispatches as any[]).map((row: any) => dispatchAssigned(row)).filter((v) => v && v !== 'System'),
  ])).sort(), [users, dispatches]);
  const typeOptions = useMemo(() => Array.from(new Set((dispatches as any[]).map((row: any) => dispatchType(row)).filter(Boolean))).sort(), [dispatches]);
  const priorityOptions = useMemo(() => Array.from(new Set((dispatches as any[]).map((row: any) => dispatchPriority(row)).filter(Boolean))).sort(), [dispatches]);
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    (dispatches as any[]).forEach((row: any) => {
      if (row.status) set.add(row.status);
      if (row.approvalStatus) set.add(row.approvalStatus);
    });
    return [{ label: 'All Status', value: '' }, ...Array.from(set).sort().map((v) => ({ label: v, value: v }))];
  }, [dispatches]);

  // ── KPI Stats (6 KPIs) ──────────────────────────────────────
  const kpiStats = useMemo(() => {
    const rows = dispatches as any[];
    const total = rows.length;
    const scheduled = rows.filter((r) => workflowMatchesKpi(r, 'pending')).length;
    const verified = rows.filter((r) => workflowMatchesKpi(r, 'verified')).length;
    const inTransit = rows.filter((r) => workflowMatchesKpi(r, 'executed')).length;
    const delivered = rows.filter((r) => workflowMatchesKpi(r, 'completed')).length;
    const totalValue = rows.reduce((sum, r) => sum + computeDispatchValue(r, productMap), 0);
    return { total, scheduled, verified, inTransit, delivered, totalValue };
  }, [dispatches, productMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (dispatches as any[])
      .filter((row: any) => {
        const company = row.companyName || row.company || '—';
        const customer = dispatchCustomer(row);
        const warehouse = dispatchWarehouse(row);
        const assigned = dispatchAssigned(row);
        const type = dispatchType(row);
        const priority = dispatchPriority(row);
        const kpiMatch = workflowMatchesKpi(row, activeKpi);
        const searchMatch = !q || [
          row.id, row.orderId, customer, warehouse, assigned, type, priority,
          row.vehicleNo, row.driverName, row.driverPhone, row.lrNumber,
        ].some((value: any) => normalizeText(value).includes(q));
        const dateMatch = isInDateRange(row.date || row.createdAt, dateRange, customFrom, customTo);
        const statusMatchValue = statusF && !['All Status', 'All'].includes(statusF) ? statusF : '';
        const statusMatch = !statusMatchValue || statusMatches(row, statusMatchValue);
        const warehouseMatch = !warehouseF || normalizeText(warehouse) === normalizeText(warehouseF);
        const assignedMatch = !assignedF || normalizeText(assigned) === normalizeText(assignedF);
        const typeMatch = !typeF || normalizeText(type) === normalizeText(typeF);
        const priorityMatch = !priorityF || normalizeText(priority) === normalizeText(priorityF);
        const customerMatch = !customerF || normalizeText(customer) === normalizeText(customerF);
        const companyMatch = !companyF || normalizeText(company) === normalizeText(companyF);
        const createdByMatch = !createdByF || row.createdBy === createdByF;
        const projectMatch = !projectScope || String(row.projectId || '') === projectScope;
        return projectMatch && kpiMatch && searchMatch && dateMatch && statusMatch && warehouseMatch && assignedMatch && typeMatch && priorityMatch && customerMatch && companyMatch && createdByMatch;
      })
      .sort((a: any, b: any) => {
        if (!sortKey) return (toDateValue(b.date || b.createdAt)?.getTime() || 0) - (toDateValue(a.date || a.createdAt)?.getTime() || 0);
        let cmp = 0;
        switch (sortKey) {
          case 'id':
            cmp = String(dispatchDisplayNumber(a)).localeCompare(String(dispatchDisplayNumber(b)));
            break;
          case 'customer':
            cmp = dispatchCustomer(a).localeCompare(dispatchCustomer(b));
            break;
          case 'warehouse':
            cmp = dispatchWarehouse(a).localeCompare(dispatchWarehouse(b));
            break;
          case 'assigned':
            cmp = dispatchAssigned(a).localeCompare(dispatchAssigned(b));
            break;
          case 'type':
            cmp = dispatchType(a).localeCompare(dispatchType(b));
            break;
          case 'status':
            cmp = (a.status || '').localeCompare(b.status || '');
            break;
          case 'date':
            cmp = (toDateValue(a.date || a.createdAt)?.getTime() || 0) - (toDateValue(b.date || b.createdAt)?.getTime() || 0);
            break;
          default:
            cmp = (toDateValue(b.date || b.createdAt)?.getTime() || 0) - (toDateValue(a.date || a.createdAt)?.getTime() || 0);
        }
        return sortDesc ? -cmp : cmp;
      });
  }, [dispatches, search, dateRange, customFrom, customTo, createdByF, statusF, warehouseF, assignedF, typeF, priorityF, customerF, companyF, activeKpi, projectScope, sortKey, sortDesc]);

  const currentPageRows = filtered.slice((page - 1) * perPage, page * perPage);
  const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
  const selectedCount = selected.size;
  const visibleSelected = currentPageRows.length > 0 && currentPageRows.every((row) => selected.has(row.id));
  const someVisibleSelected = currentPageRows.some((row) => selected.has(row.id));
  const hasActiveFilters = Boolean(search || createdByF || dateRange !== 'all' || statusF || warehouseF || assignedF || typeF || priorityF || customerF || companyF || activeKpi);

  function syncQueueParams(nextState: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(searchParams);
    function getVal(k: string, fallback: string): string {
      if (k in nextState) return String(nextState[k] ?? '');
      return fallback;
    }
    const q = getVal('q', search);
    const date = getVal('date', dateRange);
    const from = getVal('from', customFrom);
    const to = getVal('to', customTo);
    const createdBy = getVal('createdBy', createdByF);
    const status = getVal('status', statusF);
    const warehouse = getVal('warehouse', warehouseF);
    const assigned = getVal('assigned', assignedF);
    const type = getVal('type', typeF);
    const priority = getVal('priority', priorityF);
    const customer = getVal('customer', customerF);
    const companyVal = getVal('company', companyF);
    const kpi = getVal('kpi', activeKpi);
    const sort = getVal('sort', sortKey);
    const sd = nextState.sortDesc !== undefined ? String(nextState.sortDesc) : (sortDesc ? '1' : '0');
    const nextPage = typeof nextState.page === 'number' ? nextState.page : page;
    const nextPerPage = typeof nextState.perPage === 'number' ? nextState.perPage : perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (createdBy) next.set('createdBy', createdBy); else next.delete('createdBy');
    if (status) next.set('status', status); else next.delete('status');
    if (warehouse) next.set('warehouse', warehouse); else next.delete('warehouse');
    if (assigned) next.set('assigned', assigned); else next.delete('assigned');
    if (type) next.set('type', type); else next.delete('type');
    if (priority) next.set('priority', priority); else next.delete('priority');
    if (customer) next.set('customer', customer); else next.delete('customer');
    if (companyVal) next.set('company', companyVal); else next.delete('company');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (sort) next.set('sort', sort); else next.delete('sort');
    if (sd === '1') next.set('sortDesc', '1'); else next.delete('sortDesc');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== 10) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [page, maxPage]);

  function resetFilters() {
    setSearch(''); setSearchInput('');
    setDateRange('all'); setCustomFrom(''); setCustomTo('');
    setCreatedByF(''); setStatusF(''); setWarehouseF('');
    setAssignedF(''); setTypeF(''); setPriorityF('');
    setCustomerF(''); setCompanyF('');
    setActiveKpi(''); setSortKey(''); setSortDesc(false);
    setPage(1);
    syncQueueParams({
      q: '', date: 'all', from: '', to: '', createdBy: '', status: '',
      warehouse: '', assigned: '', type: '', priority: '', customer: '',
      company: '', kpi: '', sort: '', sortDesc: 0, page: 1,
    });
  }

  function refreshCurrent() { refetch(); }

  // Row click / ID / View now open the full /dispatch/:id record workspace
  // page — the Dispatch management popup was retired (Dispatch Workspace
  // Migration).
  function openDispatch(row: any) {
    navigate(`/dispatch/${encodeURIComponent(row?.id || '')}`);
  }

  // Bulk Assign/Verify/Execute need the dispatch's OPERATIONAL workflow, which
  // now lives inside the Project Workspace (Stage 6 — Dispatch card) — send the
  // user there when the dispatch is project-linked, else to the record page.
  function openSingleSelected() {
    if (selectedCount !== 1) { toast.error('Select one dispatch'); return; }
    const id = Array.from(selected)[0];
    const row = (dispatches as any[]).find((entry: any) => entry.id === id);
    if (!row) { toast.error('Selected dispatch not found'); return; }
    if (row?.projectId) navigate(`/projects/${encodeURIComponent(row.projectId)}`);
    else navigate(`/dispatch/${encodeURIComponent(row.id || '')}`);
  }

  function clearSelection() { setSelected(new Set()); }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (visibleSelected) currentPageRows.forEach((row) => next.delete(row.id));
      else currentPageRows.forEach((row) => next.add(row.id));
      return next;
    });
  }

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, row: any) {
    if (isInteractiveTarget(event.target)) return;
    openDispatch(row);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, row: any) {
    if (isInteractiveTarget(event.target)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDispatch(row);
  }

  function sort(k: string) {
    const nextDesc = sortKey === k ? !sortDesc : false;
    setSortKey(k);
    setSortDesc(nextDesc);
    syncQueueParams({ sort: k, sortDesc: nextDesc ? '1' : '' });
  }

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange as DateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  function loadOrderForDispatch(orderId: string) {
    const order = (orders as any[]).find((row: any) => row.id === orderId);
    if (!order) return;
    setForm((prev) => ({ ...prev, orderId, customerId: order.customerId || '', customer: order.customer || '' }));
    const pendingItems = (order.items || [])
      .map((item: any, idx: number) => ({ item, idx }))
      .filter(({ item }: any) => (item.pendingQty || item.qty) > 0)
      .map(({ item, idx }: any) => {
        const product = (products as any[]).find((row: any) => row.id === item.productId);
        return {
          orderLineId: item.lineId || item.id || `idx:${idx}`,
          orderLineIndex: idx,
          productId: item.productId,
          product: item.product,
          requestedQty: item.pendingQty || item.qty,
          maxQty: item.pendingQty || item.qty,
          trackingType: product?.trackingType || 'none',
          unit: item.unit || 'PCS',
        };
      });
    setItems(pendingItems);
  }

  function bulkRows(ids: string[]) {
    return filtered.filter((row) => ids.includes(row.id));
  }

  function bulkArchive() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkConfirm({ action: 'archive', ids });
  }

  function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkConfirm({ action: 'delete', ids });
  }

  async function confirmBulkAction() {
    if (!bulkConfirm) return;
    const { action, ids } = bulkConfirm;
    try {
      if (action === 'archive') {
        for (const id of ids) await closeDispatch(id);
        toast.success('Selected dispatches closed');
      } else if (action === 'delete') {
        for (const id of ids) await deleteDocById(COLLECTIONS.DISPATCH, id);
        toast.success('Selected dispatches deleted');
      }
      qc.invalidateQueries({ queryKey: qkeys.dispatchRoot });
      setBulkConfirm(null);
      clearSelection();
    } catch (error: any) {
      toast.error(dispatchErrorMessage(error));
    }
  }

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 30 days', value: '30d' },
    { label: 'Custom', value: 'custom' },
  ];

  // ── KPI Tiles ────────────────────────────────────────────────
  // Phase 9: DISPATCH VALUE is omitted entirely (not just visually hidden)
  // for roles without view_pricing — Warehouse (the role that physically
  // verifies/loads a dispatch) must not see its selling price.
  const KPI_TILES = [
    { label: 'TOTAL', value: kpiStats.total, key: '', icon: <Truck className="h-4 w-4" />, description: `${kpiStats.total} dispatches` },
    { label: 'SCHEDULED', value: kpiStats.scheduled, key: 'pending', icon: <Target className="h-4 w-4" />, description: 'Pending approval' },
    { label: 'VERIFIED', value: kpiStats.verified, key: 'verified', icon: <ShieldCheck className="h-4 w-4" />, description: 'Verified & ready' },
    { label: 'IN TRANSIT', value: kpiStats.inTransit, key: 'executed', icon: <Truck className="h-4 w-4" />, description: 'Dispatched in transit' },
    { label: 'DELIVERED', value: kpiStats.delivered, key: 'completed', icon: <Target className="h-4 w-4" />, description: 'Delivery confirmed' },
    ...(perms.canViewPricing('dispatch')
      ? [{ label: 'DISPATCH VALUE', value: fmtCurrency(kpiStats.totalValue, company?.currencySymbol || '₹'), key: 'value', icon: <DollarSign className="h-4 w-4" />, description: 'Total value of dispatched items' }]
      : []),
  ];

  const isTotalDefault = !activeKpi && !search && !statusF && !warehouseF && !assignedF && !typeF && !priorityF && !customerF && !companyF && !createdByF && dateRange === 'all';

  const activeFilterCount = [search, statusF, warehouseF, assignedF, typeF, priorityF, customerF, companyF, createdByF, dateRange !== 'all' ? 'x' : '', activeKpi].filter(Boolean).length;

  // ── Render ───────────────────────────────────────────────────
  return (
    <DispatchPageBoundary>
      <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
        {/* ── Premium Workspace Hero ─────────────────────────── */}
        <WorkspaceHero
          title="Dispatch"
          icon={<Truck className="h-6 w-6" />}
          breadcrumbs={['Home', 'Inventory', 'Dispatch']}
          statusText="Last sync · Realtime Connected"
          statusDotColor="var(--color-success)"
          className="gap-3"
          actions={
            <>
              <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={refreshCurrent}>
                Refresh
              </Button>
              {perms.canCreate('dispatch') && (
                <Button size="sm" data-tour="dispatch-create" icon={<Plus className="h-4 w-4" />} onClick={() => setShowReqForm(true)}>
                  Request Dispatch
                </Button>
              )}
            </>
          }
        />

        {/* ── Premium Clickable KPI Cards ────────────────────── */}
        <div data-tour="dispatch-kpi" className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
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
                aria-label="Search dispatches"
                data-tour="dispatch-search"
                placeholder="Search dispatch ID, customer, order, vehicle..."
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
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
                  <input type="date" value={customFrom}
                    onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                  <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                  <input type="date" value={customTo}
                    onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                </div>
              )}
              <Select
                aria-label="Status"
                value={statusF}
                onChange={(e) => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
                options={statusOptions}
                className="w-[110px] h-8 py-1"
              />
              <Select
                aria-label="Warehouse"
                value={warehouseF}
                onChange={(e) => { setWarehouseF(e.target.value); setPage(1); syncQueueParams({ warehouse: e.target.value, page: 1 }); }}
                options={[{ label: 'All Warehouses', value: '' }, ...warehouseOptions.map((v: string) => ({ label: v, value: v }))]}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Assigned"
                value={assignedF}
                onChange={(e) => { setAssignedF(e.target.value); setPage(1); syncQueueParams({ assigned: e.target.value, page: 1 }); }}
                options={[{ label: 'All Assigned', value: '' }, ...assignedOptions.map((v: string) => ({ label: v, value: v }))]}
                className="w-[120px] h-8 py-1"
              />
              <Select
                aria-label="Type"
                value={typeF}
                onChange={(e) => { setTypeF(e.target.value); setPage(1); syncQueueParams({ type: e.target.value, page: 1 }); }}
                options={[{ label: 'All Types', value: '' }, ...typeOptions.map((v: string) => ({ label: v, value: v }))]}
                className="w-[100px] h-8 py-1"
              />
              <Select
                aria-label="Priority"
                value={priorityF}
                onChange={(e) => { setPriorityF(e.target.value); setPage(1); syncQueueParams({ priority: e.target.value, page: 1 }); }}
                options={[{ label: 'All Priorities', value: '' }, ...priorityOptions.map((v: string) => ({ label: v, value: v }))]}
                className="w-[100px] h-8 py-1"
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
                  {activeKpi && activeKpi !== 'value' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                      {KPI_TILES.find((t) => t.key === activeKpi)?.label || activeKpi}
                      <button type="button" onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                    </span>
                  )}
                  {search && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                      S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}
                    </span>
                  )}
                  <button type="button" onClick={resetFilters}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
                    <X className="h-2.5 w-2.5" /> Clear
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              </div>
            </div>
          </CardHeader>

          {/* ── Bulk action bar ──────────────────────────────── */}
          {selectedCount > 0 && (
            <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
              <span className="text-sm font-semibold text-[var(--color-primary-text)]">
                {selectedCount} selected
              </span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => exportDispatchCsv(bulkRows(Array.from(selected)))}
                  className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
                <Button size="sm" variant="outline" icon={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={openSingleSelected} disabled={selectedCount !== 1}
                  className="text-blue-600 border-blue-300 hover:bg-blue-50 dark:border-blue-700 dark:hover:bg-blue-900/30">Assign</Button>
                <Button size="sm" variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  onClick={openSingleSelected} disabled={selectedCount !== 1}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">Verify</Button>
                <Button size="sm" variant="outline" icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
                  onClick={openSingleSelected} disabled={selectedCount !== 1}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Execute</Button>
                <Button size="sm" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} onClick={bulkArchive}
                  className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-900/30">Close</Button>
                <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={bulkDelete}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>
                <button onClick={clearSelection} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">✕ Clear</button>
              </div>
            </div>
          )}

          {/* ── Table + Pagination (unified) ─────────────────── */}
          <div className="px-6 flex-1 flex flex-col min-h-0">
            <div data-tour="dispatch-table" className="min-h-0 flex-1 overflow-auto scroll-pt-10">
              <Table>
                <Thead>
                  <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                    <UniversalCheckbox
                      checked={visibleSelected}
                      indeterminate={someVisibleSelected && !visibleSelected}
                      onChange={toggleVisibleSelection}
                      ariaLabel="Select visible dispatches"
                    />
                  </Th>
                  <Th sortable sorted={sortKey === 'id'} desc={sortDesc} onSort={() => sort('id')} style={{ width: 130, minWidth: 130 }}>DISPATCH ID</Th>
                  <Th sortable sorted={sortKey === 'customer'} desc={sortDesc} onSort={() => sort('customer')} style={{ width: '16%', minWidth: 140 }}>CUSTOMER</Th>
                  <Th sortable sorted={sortKey === 'warehouse'} desc={sortDesc} onSort={() => sort('warehouse')} style={{ width: 120, minWidth: 120 }}>WAREHOUSE</Th>
                  <Th style={{ width: 90, minWidth: 90 }}>VEHICLE</Th>
                  <Th style={{ width: 100, minWidth: 100 }}>DRIVER</Th>
                  <Th sortable sorted={sortKey === 'assigned'} desc={sortDesc} onSort={() => sort('assigned')} style={{ width: 110, minWidth: 110 }}>ASSIGNED</Th>
                  <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: 100, minWidth: 100 }}>STATUS</Th>
                  <Th sortable sorted={sortKey === 'date'} desc={sortDesc} onSort={() => sort('date')} style={{ width: 90, minWidth: 90 }}>DATE</Th>
                  <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
                </Thead>
                <Tbody>
                  {isLoading ? (
                    <SkeletonRows cols={10} />
                  ) : currentPageRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-14 text-center">
                        <EmptyState
                          icon={<Truck className="h-9 w-9" />}
                          title={hasActiveFilters ? 'No dispatches match filters' : 'No dispatches yet'}
                          description={hasActiveFilters ? undefined : 'Create a dispatch request to start the logistics workflow.'}
                          action={
                            !hasActiveFilters && perms.canCreate('dispatch')
                              ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowReqForm(true)} className="mt-2">Create Your First Dispatch</Button>
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    currentPageRows.map((row: any) => {
                      const workflowState = dispatchWorkflowState(row);
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
                              ariaLabel={`Select dispatch ${dispatchDisplayNumber(row)}`}
                            />
                          </Td>

                          <Td className="py-3">
                            <button type="button" data-action onClick={(e) => { e.stopPropagation(); openDispatch(row); }}
                              className="font-mono text-xs font-semibold text-[var(--color-primary-text)] hover:underline text-left">
                              {dispatchDisplayNumber(row)}
                            </button>
                          </Td>

                          <Td className="py-3 text-sm font-medium text-[var(--color-text)]">{dispatchCustomer(row)}</Td>
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{dispatchWarehouse(row)}</Td>
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{row.vehicleNo || '—'}</Td>
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{row.driverName || '—'}</Td>
                          <Td className="py-3 text-xs text-[var(--color-text-secondary)]">{dispatchAssigned(row)}</Td>
                          <Td className="py-3">
                            <span data-interactive onClick={(e) => e.stopPropagation()}>
                              {statusBadge(workflowState.charAt(0).toUpperCase() + workflowState.slice(1))}
                            </span>
                          </Td>
                          <Td className="py-3 text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(row.date || row.createdAt)}</Td>
                          <Td className="py-3" align="right">
                            <Button size="xs" variant="outline" data-tour="dispatch-row-view" icon={<Eye className="h-3 w-3" />}
                              onClick={(e) => { e.stopPropagation(); openDispatch(row); }} data-action>View</Button>
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </Tbody>
              </Table>
            </div>

            <div data-tour="dispatch-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
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

        {/* ── Dispatch Request Modal ───────────────────────────── */}
        <DispatchRequestModal
          open={showReqForm}
          onClose={() => setShowReqForm(false)}
          form={form}
          setForm={setForm}
          items={items}
          setItems={setItems}
          orders={orders as any[]}
          warehouses={warehouses as any[]}
          projects={projects as any[]}
          onOrderSelect={loadOrderForDispatch}
          onSubmit={() => {
            if (createReq.isPending) return;
            createReq.mutate({ ...form, items: items.filter((item) => item.requestedQty > 0) });
          }}
          submitting={createReq.isPending}
        />

        {/* ── Dispatch Management Modal ──────────────────────────
            RETIRED — the Dispatch stage's operational workspace now lives
            inside the Project Workspace (Dispatch Workspace Migration). */}

        {/* ── Bulk Confirm Dialog ──────────────────────────────── */}
        <ConfirmDialog
          open={!!bulkConfirm}
          onClose={() => setBulkConfirm(null)}
          onConfirm={confirmBulkAction}
          loading={false}
          title={bulkConfirm?.action === 'delete' ? 'Delete Dispatches' : 'Close Dispatches'}
          message={
            bulkConfirm?.action === 'delete'
              ? 'Delete the selected dispatches? This cannot be undone.'
              : 'Close the selected dispatches? This will mark them closed where workflow allows.'
          }
          confirmLabel={bulkConfirm?.action === 'delete' ? 'Delete' : 'Close'}
          danger={bulkConfirm?.action === 'delete'}
        />

        {/* ── Dispatch Created Success Modal ───────────────────── */}
        <Modal open={!!createdDispatch} onClose={() => setCreatedDispatch(null)} title="Dispatch Created" size="sm">
          {createdDispatch && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3">
                <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Dispatch No</p>
                <p className="mt-1 font-mono text-base font-bold text-[var(--color-text)]">{createdDispatch.dispatchId}</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3">
                <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Delivery OTP</p>
                <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-[var(--color-text)]">{createdDispatch.deliveryOTP}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline"
                  onClick={() => { void navigator.clipboard?.writeText(createdDispatch.deliveryOTP); toast.success('OTP copied'); }}>Copy</Button>
                <Button type="button" onClick={() => setCreatedDispatch(null)}>Close</Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </DispatchPageBoundary>
  );
}

