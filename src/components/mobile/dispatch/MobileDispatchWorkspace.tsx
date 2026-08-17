import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  Edit2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Truck,
  UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { DISPATCH_STATUSES } from '../../../config/company';
import { COLLECTIONS } from '../../../lib/firebase';
import { deleteDocById, fmtDate, getAll, getOne, updateDocById } from '../../../lib/firestore';
import {
  approveDispatch,
  closeDispatch,
  confirmDelivery,
  executeAndVerifyDispatch,
  requestDispatch,
  validateDispatchIntegrity,
} from '../../../lib/dispatchWorkflow';
import { logActivity } from '../../../lib/workflow';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';
const FORM0 = { orderId: '', customerId: '', customer: '', warehouseId: '', warehouse: '', vehicleNo: '', driverName: '', driverPhone: '', transporterId: '', lrNumber: '', notes: '', projectId: '', projectName: '' };

type Mode = 'records' | 'create';
type DispatchMode = 'view' | 'edit' | 'verify' | 'execute';
type MobileDispatch = Record<string, any>;
type DispatchFilters = {
  search: string;
  status: string;
  warehouse: string;
  assigned: string;
  priority: string;
  customer: string;
  date: string;
};
type EditDraft = {
  id: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  transporterId: string;
  lrNumber: string;
  notes: string;
  assignedToId: string;
  assignedToName: string;
  priority: string;
  date: string;
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

function dispatchNumber(row: MobileDispatch) {
  return String(row.dispatchNumber || row.dispatchNo || row.id || 'Dispatch');
}

function orderNumber(row: MobileDispatch, orderMap?: Map<string, any>) {
  const order = orderMap?.get(String(row.orderId || ''));
  return row.orderNumber || row.orderNo || order?.orderNumber || order?.orderNo || row.orderId || 'Order not linked';
}

function dispatchCustomer(row: MobileDispatch) {
  return row.customerName || row.customer || 'Customer not set';
}

function dispatchWarehouse(row: MobileDispatch) {
  return row.warehouseName || row.warehouse || 'Warehouse not set';
}

function dispatchAssigned(row: MobileDispatch) {
  return row.assignedToName || row.ownerName || row.createdByName || 'System';
}

function dispatchPriority(row: MobileDispatch) {
  return row.priority || 'Normal';
}

function dispatchProgress(row: MobileDispatch) {
  const status = normalize(row.status);
  const approval = normalize(row.approvalStatus);
  if (status === 'closed' || status === 'delivered') return 100;
  if (status === 'dispatched' || status === 'in transit') return 80;
  if (approval === 'approved' && status === 'pending verification') return 60;
  if (approval === 'pending') return 20;
  return 40;
}

function workflowState(row: MobileDispatch) {
  const status = normalize(row.status);
  const approval = normalize(row.approvalStatus);
  if (status === 'closed' || status === 'delivered') return 'completed';
  if (status === 'dispatched' || status === 'in transit') return 'executed';
  if (row.verifiedBy || row.deliveryConfirmed) return 'verified';
  if (approval === 'approved' && status === 'pending verification') return 'ready';
  return 'pending';
}

function dispatchPhone(row: MobileDispatch, customers: any[], fallback?: string) {
  const customer = customers.find((entry) => entry.id === row.customerId);
  return row.driverPhone || row.customerPhone || customer?.phone || customer?.mobile || fallback || '';
}

function dispatchEmail(row: MobileDispatch, customers: any[], fallback?: string) {
  const customer = customers.find((entry) => entry.id === row.customerId);
  return row.customerEmail || customer?.email || fallback || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function filterDispatches(rows: MobileDispatch[], filters: DispatchFilters) {
  const term = filters.search.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filters.status !== ALL && row.status !== filters.status && row.approvalStatus !== filters.status) return false;
      if (filters.warehouse !== ALL && dispatchWarehouse(row) !== filters.warehouse && row.warehouseId !== filters.warehouse) return false;
      if (filters.assigned !== ALL && dispatchAssigned(row) !== filters.assigned && row.assignedToId !== filters.assigned) return false;
      if (filters.priority !== ALL && dispatchPriority(row) !== filters.priority) return false;
      if (filters.customer !== ALL && dispatchCustomer(row) !== filters.customer && row.customerId !== filters.customer) return false;
      if (!isInDateRange(row.date || row.createdAt, filters.date)) return false;
      if (!term) return true;
      return [
        row.id,
        row.orderId,
        row.dispatchNumber,
        row.dispatchNo,
        dispatchCustomer(row),
        dispatchWarehouse(row),
        dispatchAssigned(row),
        row.vehicleNo,
        row.driverName,
        row.driverPhone,
        row.lrNumber,
        row.status,
        row.approvalStatus,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => (toDate(b.updatedAt || b.createdAt || b.date)?.getTime() || 0) - (toDate(a.updatedAt || a.createdAt || a.date)?.getTime() || 0));
}

function exportDispatchCsv(rows: MobileDispatch[]) {
  const headers = ['Dispatch No', 'Customer', 'Order', 'Warehouse', 'Approval', 'Status', 'Date', 'Vehicle', 'Driver', 'LR', 'Priority'];
  const lines = rows.map((row) => [
    dispatchNumber(row),
    dispatchCustomer(row),
    row.orderId || '',
    dispatchWarehouse(row),
    row.approvalStatus || '',
    row.status || '',
    row.date ? fmtDate(row.date) : '',
    row.vehicleNo || '',
    row.driverName || '',
    row.lrNumber || '',
    dispatchPriority(row),
  ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  link.download = 'dispatch.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function dispatchErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('invalid otp')) return 'Invalid OTP';
  if (lower.includes('already consumed')) return 'OTP already used';
  if (lower.includes('delivered or closed') || lower.includes('already closed')) return 'Dispatch already delivered';
  if (lower.includes('active company')) return 'Company missing';
  return message || 'Dispatch update failed';
}

export function MobileDispatchWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const company = useAppStore((state) => state.company);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();

  const { data: dispatches = [], isLoading, error, refetch } = useQuery({ queryKey: keys.dispatchAll, queryFn: () => getAll(COLLECTIONS.DISPATCH), staleTime: 30000 });
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: customers = [] } = useQuery({ queryKey: keys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60000 });
  const { data: products = [] } = useQuery({ queryKey: keys.productsAll, queryFn: () => getAll(COLLECTIONS.PRODUCTS), staleTime: 60000 });
  const { data: warehouses = [] } = useQuery({ queryKey: keys.warehouses, queryFn: () => getAll(COLLECTIONS.WAREHOUSES), staleTime: 300000 });
  const { data: stockRows = [] } = useQuery({ queryKey: keys.stock, queryFn: () => getAll(COLLECTIONS.STOCK), staleTime: 30000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });
  const { data: users = [] } = useQuery({ queryKey: queryKeys.global.users, queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });
  const { data: projects = [] } = useQuery({ queryKey: keys.projectsRoot, queryFn: () => getAll(COLLECTIONS.PROJECTS), staleTime: 60000 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [requestOpen, setRequestOpen] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [items, setItems] = useState<any[]>([]);
  const [createdDispatch, setCreatedDispatch] = useState<{ dispatchId: string; deliveryOTP: string } | null>(null);
  const [viewDispatch, setViewDispatch] = useState<MobileDispatch | null>(null);
  const [viewMode, setViewMode] = useState<DispatchMode>('view');
  const [deleteTarget, setDeleteTarget] = useState<MobileDispatch | null>(null);
  const createParam = params.get('create') || '';

  const orderMap = useMemo(() => new Map((orders as any[]).map((order) => [String(order.id), order])), [orders]);
  const productMap = useMemo(() => new Map((products as any[]).map((product) => [String(product.id), product])), [products]);
  const warehouseMap = useMemo(() => new Map((warehouses as any[]).map((warehouse) => [String(warehouse.id), warehouse])), [warehouses]);
  const canCreate = perms.canCreate('dispatch');
  const canEdit = perms.canEdit('dispatch');
  const canDelete = perms.canDelete('dispatch');
  const canExport = perms.canExport('dispatch') || canEdit || canCreate;
  const canApprove = perms.canApprove('dispatch') || canEdit;
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';

  useEffect(() => {
    if (mode === 'create') setRequestOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setForm({ ...FORM0 });
    setItems([]);
    setRequestOpen(true);
  }, [mode, params]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewDispatch || !dispatches.length) return;
    const found = (dispatches as MobileDispatch[]).find((row) => row.id === openId);
    if (found) setViewDispatch(found);
  }, [dispatches, params, viewDispatch]);

  const filters = useMemo<DispatchFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    status: params.get('status') || ALL,
    warehouse: params.get('warehouse') || ALL,
    assigned: params.get('assigned') || ALL,
    priority: params.get('priority') || ALL,
    customer: params.get('customer') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredDispatches = useMemo(() => filterDispatches(dispatches as MobileDispatch[], filters), [dispatches, filters]);
  const paginatedDispatches = useMemo(() => filteredDispatches.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredDispatches, page]);
  const selectedRows = useMemo(() => filteredDispatches.filter((row) => selected.has(row.id)), [filteredDispatches, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredDispatches.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredDispatches.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set((dispatches as MobileDispatch[]).map((row) => row.id));
      const next = new Set(Array.from(current).filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dispatches]);

  const createDispatch = useMutation({
    mutationFn: (payload: any) => requestDispatch(payload),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      void qc.invalidateQueries({ queryKey: keys.dispatchRoot });
      toast.success('Dispatch request submitted');
      setRequestOpen(false);
      setForm({ ...FORM0 });
      setItems([]);
      setCreatedDispatch(result);
      if (result?.dispatchId) openById(result.dispatchId);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDispatch(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      toast.success('Dispatch approved');
      setViewDispatch((current) => current ? { ...current, approvalStatus: 'Approved' } : current);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const executeMutation = useMutation({
    mutationFn: ({ dispatch, verifiedItems }: { dispatch: MobileDispatch; verifiedItems: any[] }) => executeAndVerifyDispatch(dispatch, verifiedItems),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      void qc.invalidateQueries({ queryKey: keys.ordersAll });
      void qc.invalidateQueries({ queryKey: keys.stock });
      void qc.invalidateQueries({ queryKey: keys.stockLedger });
      toast.success('Dispatch verified and executed');
      setViewDispatch((current) => current ? { ...current, status: 'Dispatched' } : current);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => closeDispatch(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      void qc.invalidateQueries({ queryKey: keys.ordersAll });
      toast.success('Dispatch closed');
      setViewDispatch((current) => current ? { ...current, status: 'Closed' } : current);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const confirmDeliveryMutation = useMutation({
    mutationFn: ({ id, otp }: { id: string; otp: string }) => confirmDelivery(id, otp),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      void qc.invalidateQueries({ queryKey: keys.ordersAll });
      toast.success('Delivery confirmed');
      setViewDispatch((current) => current ? { ...current, status: 'Delivered', deliveryConfirmed: true } : current);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const saveEditMutation = useMutation({
    mutationFn: async (draft: EditDraft) => {
      await updateDocById(COLLECTIONS.DISPATCH, draft.id, {
        vehicleNo: draft.vehicleNo,
        driverName: draft.driverName,
        driverPhone: draft.driverPhone,
        transporterId: draft.transporterId,
        lrNumber: draft.lrNumber,
        notes: draft.notes,
        assignedToId: draft.assignedToId || null,
        assignedToName: draft.assignedToName || '',
        priority: draft.priority || 'Normal',
        date: draft.date || undefined,
        updatedAt: new Date().toISOString(),
        updatedBy: useAppStore.getState().user?.id || 'system',
      });
      await logActivity('Dispatch', 'Updated Dispatch', draft.id, { entityName: draft.id, actionLabel: 'Updated dispatch' });
    },
    onSuccess: (_, draft) => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      toast.success('Dispatch updated');
      setViewDispatch((current) => current && current.id === draft.id ? { ...current, ...draft } : current);
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const integrityMutation = useMutation({
    mutationFn: (id: string) => validateDispatchIntegrity(id),
    onSuccess: (result) => result.valid ? toast.success('Dispatch integrity check passed') : toast.error(result.issues.join('\n')),
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.DISPATCH, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispatchAll });
      toast.success('Dispatch deleted');
      setSelected(new Set());
      setDeleteTarget(null);
      closeDispatchView();
    },
    onError: (e: any) => toast.error(dispatchErrorMessage(e)),
  });

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function openById(id: string) {
    const next = new URLSearchParams(params);
    next.set('open', id);
    setParams(next, { replace: true });
  }

  function openDispatch(row: MobileDispatch, nextMode: DispatchMode = 'view') {
    setViewDispatch(row);
    setViewMode(nextMode);
    openById(row.id);
  }

  function closeDispatchView() {
    setViewDispatch(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }

  function closeRequestForm() {
    setRequestOpen(false);
    setForm({ ...FORM0 });
    setItems([]);
    if (mode === 'create') navigate('/app', { replace: true });
    if (createParam === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function loadOrderForDispatch(orderId: string) {
    const order = (orders as any[]).find((entry) => entry.id === orderId);
    if (!order) {
      setForm({ ...FORM0 });
      setItems([]);
      return;
    }
    setForm({
      ...form,
      orderId: order.id,
      customerId: order.customerId || '',
      customer: order.customer || order.customerName || '',
    });
    setItems((order.items || []).map((item: any) => {
      const product = productMap.get(String(item.productId || ''));
      const pending = Math.max(0, Number(item.pendingQty ?? item.qty ?? item.quantity) - Number(item.dispatchedQty || 0));
      return {
        productId: item.productId || '',
        product: item.product || item.productName || product?.name || '',
        requestedQty: pending,
        maxQty: pending,
        trackingType: item.trackingType || product?.trackingType || 'none',
        unit: item.unit || product?.unit || 'PCS',
      };
    }).filter((item: any) => item.maxQty > 0));
  }

  function submitDispatchRequest(event: React.FormEvent) {
    event.preventDefault();
    const payload = { ...form, items: items.filter((item) => Number(item.requestedQty) > 0) };
    if (!payload.orderId || !payload.warehouseId || !payload.items.length) return toast.error('Order, warehouse and dispatch quantities are required');
    createDispatch.mutate(payload);
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function printChallan(dispatch: MobileDispatch) {
    const toastId = toast.loading('Preparing challan...');
    try {
      const fullCompany = await getOne(COLLECTIONS.COMPANIES, dispatch.companyId || company?.id) || company;
      const { DocumentTemplateResolver, triggerPrint } = await import('../../../templates/documents/resolver');
      const html = DocumentTemplateResolver(fullCompany as any, 'DISPATCH CHALLAN', dispatch);
      triggerPrint(html);
      toast.success('Challan ready', { id: toastId });
    } catch {
      toast.error('Failed to generate challan', { id: toastId });
    }
  }

  if (mode === 'create') {
    return (
      <DispatchRequestSheet
        open={requestOpen}
        form={form}
        items={items}
        orders={orders as any[]}
        warehouses={warehouses as any[]}
        projects={projects as any[]}
        submitting={createDispatch.isPending}
        onClose={closeRequestForm}
        onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onItemsChange={setItems}
        onOrderSelect={loadOrderForDispatch}
        onSubmit={submitDispatchRequest}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3" data-tour="dispatch-table">
        <div className="flex items-center justify-between gap-3">
          <h1 data-tour="mobile-dispatch-header" className="text-xl font-bold tracking-tight text-[var(--color-text)]">Dispatch</h1>
        </div>

        {selected.size > 0 ? (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canExport ? <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportDispatchCsv(selectedRows)}>Export</Button> : null}
              {selected.size === 1 && canEdit ? <Button size="xs" variant="outline" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => openDispatch(selectedRows[0], 'edit')}>Assign</Button> : null}
              {selected.size === 1 && canEdit ? <Button size="xs" variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => openDispatch(selectedRows[0], 'verify')}>Verify</Button> : null}
              {selected.size === 1 && canEdit ? <Button size="xs" variant="outline" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => openDispatch(selectedRows[0], 'execute')}>Execute</Button> : null}
              {canDelete ? <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteTarget(selectedRows[0])}>Delete</Button> : null}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </Card>
        ) : null}

        {error ? (
          <Card className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Dispatch records could not be loaded. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button>
          </Card>
        ) : null}

        <div className="space-y-2">
          {isLoading ? Array.from({ length: 5 }).map((_, index) => <DispatchSkeletonCard key={index} />) : null}
          {!isLoading && !paginatedDispatches.length ? (
            <Card className="rounded-xl p-6 text-center">
              <Target className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
              <p className="mt-3 text-sm font-bold text-[var(--color-text)]">
                {filters.search || filters.status !== ALL || filters.warehouse !== ALL || filters.assigned !== ALL || filters.priority !== ALL || filters.customer !== ALL || filters.date !== 'all'
                  ? 'No dispatches match your filters.'
                  : 'No dispatches exist.'}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {filters.search || filters.status !== ALL || filters.warehouse !== ALL || filters.assigned !== ALL || filters.priority !== ALL || filters.customer !== ALL || filters.date !== 'all'
                  ? 'Try clearing filters to see all dispatch records.'
                  : 'Create a dispatch to start the logistics workflow.'}
              </p>
              {!filters.search && filters.status === ALL && filters.warehouse === ALL && filters.assigned === ALL && filters.priority === ALL && filters.customer === ALL && filters.date === 'all' && canCreate ? (
                <Button
                  size="sm"
                  variant="primary"
                  data-tour="dispatch-create"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => { setForm({ ...FORM0 }); setItems([]); setRequestOpen(true); }}
                  className="mt-3"
                >
                  Create Your First Dispatch
                </Button>
              ) : null}
            </Card>
          ) : null}
          {paginatedDispatches.map((dispatch) => (
            <DispatchCard
              key={dispatch.id}
              dispatch={dispatch}
              selected={selected.has(dispatch.id)}
              orderMap={orderMap}
              phone={dispatchPhone(dispatch, customers as any[], companyPhone)}
              email={dispatchEmail(dispatch, customers as any[], companyEmail)}
              onSelect={() => toggleSelect(dispatch.id)}
              onView={() => openDispatch(dispatch, 'view')}
            />
          ))}
        </div>

        <div data-tour="dispatch-pagination">
          <Pagination page={page} total={filteredDispatches.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      </div>

      <DispatchRequestSheet
        open={requestOpen}
        form={form}
        items={items}
        orders={orders as any[]}
        warehouses={warehouses as any[]}
        projects={projects as any[]}
        submitting={createDispatch.isPending}
        onClose={closeRequestForm}
        onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onItemsChange={setItems}
        onOrderSelect={loadOrderForDispatch}
        onSubmit={submitDispatchRequest}
      />

      <DispatchViewSheet
        dispatch={viewDispatch}
        mode={viewMode}
        users={users as any[]}
        orders={orders as any[]}
        invoices={invoices as any[]}
        stockRows={stockRows as any[]}
        warehouseMap={warehouseMap}
        orderMap={orderMap}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
        canConfirmDelivery={Boolean(user?.role && /(sales|dispatch|account|warehouse)/i.test(user.role))}
        savingEdit={saveEditMutation.isPending}
        approving={approveMutation.isPending}
        executing={executeMutation.isPending}
        closing={closeMutation.isPending}
        confirmingDelivery={confirmDeliveryMutation.isPending}
        checkingIntegrity={integrityMutation.isPending}
        companyPhone={companyPhone}
        companyEmail={companyEmail}
        onClose={closeDispatchView}
        onSaveEdit={(draft) => saveEditMutation.mutate(draft)}
        onApprove={(dispatch) => approveMutation.mutate(dispatch.id)}
        onExecute={(dispatch, verifiedItems) => executeMutation.mutate({ dispatch, verifiedItems })}
        onCloseDispatch={(dispatch) => closeMutation.mutate(dispatch.id)}
        onConfirmDelivery={(dispatch, otp) => confirmDeliveryMutation.mutate({ id: dispatch.id, otp })}
        onIntegrity={(dispatch) => integrityMutation.mutate(dispatch.id)}
        onPrint={printChallan}
        onDelete={(dispatch) => setDeleteTarget(dispatch)}
        onExport={(dispatch) => exportDispatchCsv([dispatch])}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const rows = selected.size ? selectedRows : deleteTarget ? [deleteTarget] : [];
          rows.forEach((row) => deleteMutation.mutate(row.id));
        }}
        loading={deleteMutation.isPending}
        title="Delete Dispatch"
        message="Delete selected dispatch record? Desktop currently does not reverse stock on delete."
      />

      <Modal open={Boolean(createdDispatch)} onClose={() => setCreatedDispatch(null)} title="Dispatch Created" size="full">
        {createdDispatch ? (
          <div className="space-y-4">
            <Section title="Dispatch">
              <Detail label="Dispatch Number" value={createdDispatch.dispatchId} />
              <Detail label="Delivery OTP" value={createdDispatch.deliveryOTP} />
            </Section>
            <Button className="w-full" onClick={() => { void navigator.clipboard?.writeText(createdDispatch.deliveryOTP); toast.success('OTP copied'); }}>Copy OTP</Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function DispatchCard({ dispatch, selected, orderMap, phone, email, onSelect, onView }: {
  dispatch: MobileDispatch;
  selected: boolean;
  orderMap: Map<string, any>;
  phone: string;
  email: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const progress = dispatchProgress(dispatch);
  return (     <Card data-tour="dispatch-row-view" className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${dispatchNumber(dispatch)}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{dispatchNumber(dispatch)}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-[var(--color-text-muted)]">{dispatchCustomer(dispatch)}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-text-muted)]">{orderNumber(dispatch, orderMap)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{dispatchWarehouse(dispatch)}</p>
            <p className="truncate">{dispatch.date ? fmtDate(dispatch.date) : 'Date not set'}</p>
            <p className="truncate">{(dispatch.items || []).length} items</p>
            <p className="truncate">{dispatch.driverName || dispatch.vehicleNo || 'Driver not assigned'}</p>
          </div>
          {dispatch.projectId && (
            <p className="mt-1.5">
              <span className="inline-flex items-center rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                {dispatch.projectName || String(dispatch.projectId).slice(0, 8)}
              </span>
            </p>
          )}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
            <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(dispatch.approvalStatus || 'Pending')}
            {statusBadge(dispatch.status || 'Pending Verification')}
            <Badge variant={dispatchPriority(dispatch).toLowerCase().includes('urgent') || dispatchPriority(dispatch).toLowerCase().includes('high') ? 'danger' : 'info'}>{workflowState(dispatch)}</Badge>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp dispatch" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !phone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={email ? `mailto:${email}?subject=${encodeURIComponent(dispatchNumber(dispatch))}` : undefined} aria-label="Email dispatch" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call dispatch" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function DispatchSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

function DispatchRequestSheet({ open, form, items, orders, warehouses, submitting, onClose, onFormChange, onItemsChange, onOrderSelect, onSubmit, projects: projectsProp = [] }: {
  open: boolean;
  form: typeof FORM0;
  items: any[];
  orders: any[];
  warehouses: any[];
  submitting: boolean;
  onClose: () => void;
  onFormChange: (patch: Partial<typeof FORM0>) => void;
  onItemsChange: React.Dispatch<React.SetStateAction<any[]>>;
  onOrderSelect: (orderId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  projects?: any[];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Create Dispatch" size="full">
      <form onSubmit={onSubmit} className="space-y-4">            <Section title="Source Details">
          <Select label="Order" required value={form.orderId} onChange={(event) => onOrderSelect(event.target.value)} options={[{ label: 'Select order...', value: '' }, ...orders.filter((order) => order.status !== 'Dispatched').map((order) => ({ label: `${order.orderNumber || order.orderNo || order.id} - ${order.customer || order.customerName || ''}`, value: order.id }))]} />
          <Select label="Warehouse" required value={form.warehouseId} onChange={(event) => {
            const warehouse = warehouses.find((entry) => entry.id === event.target.value);
            onFormChange({ warehouseId: event.target.value, warehouse: warehouse?.name || '' });
          }} options={[{ label: 'Select warehouse...', value: '' }, ...warehouses.map((warehouse) => ({ label: warehouse.name || warehouse.id, value: warehouse.id }))]} />
          <Select label="Link to Project" value={form.projectId || ''} onChange={(event) => {
            const project = (projectsProp || []).find((entry) => entry.id === event.target.value);
            onFormChange({ projectId: event.target.value, projectName: project?.projectId || project?.name || '' });
          }} options={[{ label: 'Not linked to project', value: '' }, ...(projectsProp || []).map((project) => ({ label: `${project.projectId || project.id} - ${project.customerName || project.customer || ''}`, value: project.id }))]} />
        </Section>

        <Section title="Product Allocation">
          {items.length ? (
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`${item.productId}-${index}`} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-bold text-[var(--color-text)]">{item.product || item.productId}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Pending {formatNumber(Number(item.maxQty) || 0)} {item.unit || ''} · Tracking {item.trackingType || 'none'}</p>
                  <Input label="Dispatch Quantity" inputMode="decimal" value={String(item.requestedQty ?? 0)} onChange={(event) => {
                    const value = Math.min(Number(item.maxQty) || 0, Math.max(0, Number(event.target.value) || 0));
                    onItemsChange((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, requestedQty: value } : entry));
                  }} />
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">Select an order to allocate pending products.</p>}
        </Section>

        <Section title="Driver & Vehicle">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Vehicle No" value={form.vehicleNo} onChange={(event) => onFormChange({ vehicleNo: event.target.value })} />
            <Input label="Driver Name" value={form.driverName} onChange={(event) => onFormChange({ driverName: event.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Driver Phone" inputMode="tel" value={form.driverPhone} onChange={(event) => onFormChange({ driverPhone: event.target.value })} />
            <Input label="LR Number" value={form.lrNumber} onChange={(event) => onFormChange({ lrNumber: event.target.value })} />
          </div>
        </Section>

        <Section title="Shipping Details">
          <Textarea label="Remarks" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} rows={3} />
        </Section>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" loading={submitting}>Submit</Button>
        </div>
      </form>
    </Modal>
  );
}

function DispatchViewSheet({ dispatch, mode, users, orders, invoices, stockRows, warehouseMap, orderMap, canEdit, canDelete, canApprove, canConfirmDelivery, savingEdit, approving, executing, closing, confirmingDelivery, checkingIntegrity, companyPhone, companyEmail, onClose, onSaveEdit, onApprove, onExecute, onCloseDispatch, onConfirmDelivery, onIntegrity, onPrint, onDelete, onExport }: {
  dispatch: MobileDispatch | null;
  mode: DispatchMode;
  users: any[];
  orders: any[];
  invoices: any[];
  stockRows: any[];
  warehouseMap: Map<string, any>;
  orderMap: Map<string, any>;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canConfirmDelivery: boolean;
  savingEdit: boolean;
  approving: boolean;
  executing: boolean;
  closing: boolean;
  confirmingDelivery: boolean;
  checkingIntegrity: boolean;
  companyPhone: string;
  companyEmail: string;
  onClose: () => void;
  onSaveEdit: (draft: EditDraft) => void;
  onApprove: (dispatch: MobileDispatch) => void;
  onExecute: (dispatch: MobileDispatch, verifiedItems: any[]) => void;
  onCloseDispatch: (dispatch: MobileDispatch) => void;
  onConfirmDelivery: (dispatch: MobileDispatch, otp: string) => void;
  onIntegrity: (dispatch: MobileDispatch) => void;
  onPrint: (dispatch: MobileDispatch) => void;
  onDelete: (dispatch: MobileDispatch) => void;
  onExport: (dispatch: MobileDispatch) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'operations' | 'timeline'>(mode === 'view' ? 'overview' : 'operations');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [verifiedItems, setVerifiedItems] = useState<any[]>([]);
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (!dispatch) return;
    setTab(mode === 'view' ? 'overview' : 'operations');
    setDraft({
      id: dispatch.id,
      vehicleNo: dispatch.vehicleNo || '',
      driverName: dispatch.driverName || '',
      driverPhone: dispatch.driverPhone || '',
      transporterId: dispatch.transporterId || '',
      lrNumber: dispatch.lrNumber || '',
      notes: dispatch.notes || '',
      assignedToId: dispatch.assignedToId || '',
      assignedToName: dispatch.assignedToName || '',
      priority: dispatch.priority || 'Normal',
      date: String(dispatch.date || new Date().toISOString()).slice(0, 10),
    });
    setVerifiedItems((dispatch.items || []).map((item: any) => ({
      ...item,
      verifiedQty: Number(item.verifiedQty || item.requestedQty || 0),
      serialInput: Array.isArray(item.serials) ? item.serials.join(', ') : '',
      barcodeInput: Array.isArray(item.barcodes) ? item.barcodes.join(', ') : '',
    })));
    setOtp('');
  }, [dispatch, mode]);

  if (!dispatch || !draft) return null;
  const readOnly = ['Delivered', 'Closed'].includes(dispatch.status);
  const order = orderMap.get(String(dispatch.orderId || ''));
  const relatedInvoices = invoices.filter((invoice) => invoice.orderId === dispatch.orderId || invoice.sourceOrderId === dispatch.orderId);
  const warehouse = warehouseMap.get(String(dispatch.warehouseId || ''));
  const requestedTotal = verifiedItems.reduce((sum, item) => sum + (Number(item.requestedQty) || 0), 0);
  const verifiedTotal = verifiedItems.reduce((sum, item) => sum + (Number(item.verifiedQty) || 0), 0);
  const phone = dispatch.driverPhone || companyPhone;
  const email = companyEmail;
  const activity = [
    { type: 'Requested', desc: 'Dispatch request created', date: dispatch.createdAt || dispatch.date, userName: dispatch.createdByName || dispatch.createdBy || 'System' },
    ...(dispatch.approvalStatus === 'Approved' ? [{ type: 'Approved', desc: 'Dispatch approved for warehouse verification', date: dispatch.updatedAt || dispatch.date, userName: dispatch.updatedByName || 'System' }] : []),
    ...(dispatch.dispatchedAt ? [{ type: 'Dispatched', desc: 'Stock deducted and dispatch executed', date: dispatch.dispatchedAt, userName: dispatch.verifiedBy || 'Warehouse' }] : []),
    ...(dispatch.deliveryConfirmed ? [{ type: 'Delivered', desc: 'Delivery confirmed by OTP', date: dispatch.deliveredAt, userName: dispatch.deliveredBy || 'System' }] : []),
    ...(dispatch.closedAt ? [{ type: 'Closed', desc: 'Dispatch closed and reconciled', date: dispatch.closedAt, userName: dispatch.closedBy || 'System' }] : []),
  ];

  function updateVerified(index: number, patch: Record<string, any>) {
    setVerifiedItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    onSaveEdit(draft);
  }

  function submitExecute() {
    const nextItems = verifiedItems.map((item) => ({
      ...item,
      serials: String(item.serialInput || '').split(',').map((value) => value.trim()).filter(Boolean),
      barcodes: String(item.barcodeInput || '').split(',').map((value) => value.trim()).filter(Boolean),
    }));
    if (!dispatch) return;
    onExecute(dispatch, nextItems);
  }

  return (
    <Modal open={!!dispatch} onClose={onClose} title={dispatchNumber(dispatch)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(dispatch.approvalStatus || 'Pending')}
            {statusBadge(dispatch.status || 'Pending Verification')}
            <Badge variant={dispatchPriority(dispatch).toLowerCase().includes('high') || dispatchPriority(dispatch).toLowerCase().includes('urgent') ? 'danger' : 'info'}>{dispatchPriority(dispatch)}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Customer" value={dispatchCustomer(dispatch)} />
            <Detail label="Progress" value={`${dispatchProgress(dispatch)}%`} />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-1">
            {(['overview', 'operations', 'timeline'] as const).map((key) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={cn('rounded-lg px-2 py-2 text-xs font-bold capitalize transition-colors', tab === key ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)]')}>{key}</button>
            ))}
          </div>
        </section>

        {tab === 'overview' ? (
          <>
            <Section title="Dispatch Information">
              <Detail label="Dispatch Number" value={dispatchNumber(dispatch)} />
              <Detail label="Order Number" value={orderNumber(dispatch, orderMap)} />
              <Detail label="Dispatch Date" value={dispatch.date ? fmtDate(dispatch.date) : 'Not set'} />
              <Detail label="Workflow Stage" value={workflowState(dispatch)} />
            </Section>
            <Section title="Customer Information">
              <Detail label="Customer" value={dispatchCustomer(dispatch)} />
              <Detail label="Customer ID" value={dispatch.customerId || 'Not available'} />
            </Section>
            <Section title="Order Information">
              <Detail label="Order" value={order?.orderNumber || order?.orderNo || dispatch.orderId || 'Not linked'} />
              <Detail label="Order Status" value={order?.status || 'Not available'} />
              <Detail label="Payment Status" value={order?.paymentStatus || 'Not available'} />
            </Section>
            <Section title="Invoice Information">
              {relatedInvoices.length ? relatedInvoices.map((invoice) => <Detail key={invoice.id} label={invoice.invoiceNumber || invoice.piNumber || invoice.id} value={invoice.paymentStatus || invoice.status || 'Pending'} />) : <p className="text-sm text-[var(--color-text-muted)]">No linked invoices.</p>}
            </Section>
            <Section title="Warehouse Information">
              <Detail label="Warehouse" value={dispatchWarehouse(dispatch)} />
              <Detail label="Warehouse Code" value={warehouse?.code || 'Not available'} />
              <Detail label="Location" value={[warehouse?.city, warehouse?.state].filter(Boolean).join(', ') || 'Not available'} />
            </Section>
            <DispatchItemsSection dispatch={dispatch} stockRows={stockRows} />
            <Section title="Driver & Vehicle">
              <Detail label="Driver" value={dispatch.driverName || 'Not assigned'} />
              <Detail label="Driver Phone" value={dispatch.driverPhone || 'Not available'} />
              <Detail label="Vehicle" value={dispatch.vehicleNo || 'Not assigned'} />
              <Detail label="LR Number" value={dispatch.lrNumber || 'Not available'} />
            </Section>
            <Section title="Tracking Information">
              <Detail label="Delivery Status" value={dispatch.deliveryConfirmed ? 'Delivered' : dispatch.status || 'Pending'} />
              <Detail label="OTP Generated" value={dispatch.deliveryOTPGeneratedAt ? fmtDate(dispatch.deliveryOTPGeneratedAt) : 'Not available'} />
              <Detail label="OTP Expires" value={dispatch.deliveryOTPExpiresAt ? fmtDate(dispatch.deliveryOTPExpiresAt) : 'Not available'} />
            </Section>
          </>
        ) : null}

        {tab === 'operations' ? (
          <>
            <Section title="Edit Dispatch">
              <form onSubmit={submitEdit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Vehicle No" value={draft.vehicleNo} onChange={(event) => setDraft({ ...draft, vehicleNo: event.target.value })} />
                  <Input label="Driver Name" value={draft.driverName} onChange={(event) => setDraft({ ...draft, driverName: event.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Driver Phone" value={draft.driverPhone} onChange={(event) => setDraft({ ...draft, driverPhone: event.target.value })} />
                  <Input label="LR Number" value={draft.lrNumber} onChange={(event) => setDraft({ ...draft, lrNumber: event.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Assigned User" value={draft.assignedToId} onChange={(event) => {
                    const assigned = users.find((entry) => entry.id === event.target.value);
                    setDraft({ ...draft, assignedToId: event.target.value, assignedToName: assigned?.name || assigned?.email || '' });
                  }} options={[{ label: 'Unassigned', value: '' }, ...users.filter((entry) => entry.isDeleted !== true).map((entry) => ({ label: entry.name || entry.email || entry.id, value: entry.id }))]} />
                  <Select label="Priority" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} options={['Low', 'Normal', 'High', 'Urgent'].map((value) => ({ label: value, value }))} />
                </div>
                <Input label="Dispatch Date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
                <Textarea label="Notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} />
                {canEdit && !readOnly ? <Button className="w-full" type="submit" loading={savingEdit}>Save Changes</Button> : null}
              </form>
            </Section>

            <Section title="Approval">
              <Button className="w-full" variant="outline" disabled={!canApprove || readOnly || dispatch.approvalStatus === 'Approved'} loading={approving} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onApprove(dispatch)}>Approve Dispatch</Button>
            </Section>

            <Section title="Picking, Packing & Quality Check">
              <div className="space-y-3">
                {verifiedItems.map((item, index) => {
                  const requested = Number(item.requestedQty || item.qty || 0) || 0;
                  return (
                    <div key={`${item.productId}-${index}`} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <p className="text-sm font-bold text-[var(--color-text)]">{item.product || item.productId}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Requested {formatNumber(requested)} {item.unit || ''} · Tracking {item.trackingType || 'none'}</p>
                      <Input label="Picked / Packed / Verified Qty" inputMode="decimal" value={String(item.verifiedQty ?? 0)} onChange={(event) => updateVerified(index, { verifiedQty: Math.min(requested, Math.max(0, Number(event.target.value) || 0)) })} />
                      {(item.trackingType || '').includes('serial') ? <Textarea label="Serial Numbers" value={item.serialInput || ''} onChange={(event) => updateVerified(index, { serialInput: event.target.value })} rows={2} /> : null}
                      {(item.trackingType || '').includes('barcode') ? <Textarea label="Barcodes" value={item.barcodeInput || ''} onChange={(event) => updateVerified(index, { barcodeInput: event.target.value })} rows={2} /> : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Detail label="Requested" value={formatNumber(requestedTotal)} />
                <Detail label="Verified" value={formatNumber(verifiedTotal)} />
              </div>
              {canEdit && !readOnly ? <Button className="mt-3 w-full" loading={executing} disabled={dispatch.approvalStatus !== 'Approved'} icon={<ArrowLeftRight className="h-4 w-4" />} onClick={submitExecute}>Execute Dispatch</Button> : null}
            </Section>

            <Section title="Delivery Confirmation">
              <Input label="Delivery OTP" inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} />
              {canConfirmDelivery && !readOnly ? <Button className="w-full" loading={confirmingDelivery} disabled={otp.length !== 6} onClick={() => onConfirmDelivery(dispatch, otp)}>Confirm Delivery</Button> : null}
            </Section>

            <Section title="Workflow Actions">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" icon={<Search className="h-4 w-4" />} loading={checkingIntegrity} onClick={() => onIntegrity(dispatch)}>Integrity</Button>
                <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(dispatch)}>Print</Button>
                <Button variant="outline" icon={<Archive className="h-4 w-4" />} loading={closing} disabled={readOnly || !['Dispatched', 'Delivered'].includes(dispatch.status)} onClick={() => onCloseDispatch(dispatch)}>Close</Button>
                {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(dispatch)}>Delete</Button> : null}
              </div>
            </Section>
          </>
        ) : null}

        {tab === 'timeline' ? (
          <>
            <Section title="Timeline">
              <MobileTimelinePreview title={`${dispatchNumber(dispatch)} Timeline`} entries={activity} />
            </Section>
            <Section title="Activities & Notes">
              <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{dispatch.notes || 'No notes recorded.'}</p>
            </Section>
            <Section title="Attachments">
              <p className="text-sm text-[var(--color-text-muted)]">{dispatch.attachmentName || dispatch.fileName || 'No attachments available.'}</p>
            </Section>
            <Section title="Audit Information">
              <Detail label="Created By" value={dispatch.createdByName || dispatch.createdBy || 'System'} />
              <Detail label="Created" value={dispatch.createdAt ? fmtDate(dispatch.createdAt) : 'Not available'} />
              <Detail label="Updated" value={dispatch.updatedAt ? fmtDate(dispatch.updatedAt) : 'Not available'} />
            </Section>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <a className={linkButtonClass} href={`mailto:${email}?subject=${encodeURIComponent(dispatchNumber(dispatch))}`}><Mail className="h-4 w-4" />Email</a> : null}
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => onExport(dispatch)}>Export</Button>
        </div>
      </div>
    </Modal>
  );
}

function DispatchItemsSection({ dispatch, stockRows }: { dispatch: MobileDispatch; stockRows: any[] }) {
  return (
    <Section title="Product List & Stock Allocation">
      {dispatch.items?.length ? (
        <div className="space-y-2">
          {dispatch.items.map((item: any, index: number) => {
            const stock = stockRows.find((row) => row.productId === item.productId && row.warehouseId === dispatch.warehouseId);
            const requested = Number(item.requestedQty || item.qty || 0) || 0;
            const verified = Number(item.verifiedQty || 0) || 0;
            return (
              <div key={`${item.productId}-${index}`} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                <p className="text-sm font-semibold text-[var(--color-text)]">{item.product || item.productId}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Requested {formatNumber(requested)} · Picked/Packed {formatNumber(verified)} · Remaining {formatNumber(Math.max(0, requested - verified))}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Available {formatNumber(Number(stock?.availableQty ?? stock?.available) || 0)} · Reserved {formatNumber(Number(stock?.reservedQty ?? stock?.reserved) || 0)}</p>
              </div>
            );
          })}
        </div>
      ) : <p className="text-sm text-[var(--color-text-muted)]">No dispatch items.</p>}
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

export default MobileDispatchWorkspace;
