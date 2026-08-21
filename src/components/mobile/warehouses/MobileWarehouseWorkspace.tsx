import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeftRight, Download, Edit2, Mail, MessageCircle, Package, Phone, Plus, Target, Trash2, Warehouse as WarehouseIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { INDIAN_STATES } from '../../../config/company';
import { useProducts } from '../../../features/inventory/hooks/useInventory';
import { useDeleteWarehouse, useSaveWarehouse, useWarehouses } from '../../../features/warehouses/hooks/useWarehouses';
import { WAREHOUSE_FORM_DEFAULT, WAREHOUSE_STATUS_OPTIONS, warehouseGeoToForm, parseWarehouseGeo, type Warehouse, type WarehouseForm } from '../../../features/warehouses/types';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll, updateDocById } from '../../../lib/firestore';
import { getMovementsByWarehouse, summarizeMovements, type InventoryMovement } from '../../../lib/inventoryMovements';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { Product } from '../../../types';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

type Mode = 'records' | 'create';
type MobileWarehouse = Warehouse & Record<string, any>;
type WarehouseFilters = {
  search: string;
  status: string;
  type: string;
  capacity: string;
  date: string;
};
type WarehouseMetrics = {
  used: number;
  reserved: number;
  available: number | null;
  capacity: number | null;
  utilization: number | null;
  productCount: number;
  rows: any[];
  hasInventory: boolean;
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

function parseCapacity(raw?: string) {
  if (!raw) return null;
  const numeric = String(raw).replace(/,/g, '').match(/[\d.]+/);
  if (!numeric) return null;
  const value = Number(numeric[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function warehouseType(warehouse: MobileWarehouse) {
  return warehouse.warehouseType || warehouse.type || warehouse.category || 'General';
}

function warehouseLocation(warehouse: MobileWarehouse) {
  return [warehouse.city, warehouse.state].filter(Boolean).join(', ') || warehouse.location || 'Location not set';
}

function warehouseAddress(warehouse: MobileWarehouse) {
  return [warehouse.address, warehouse.city, warehouse.state, warehouse.pincode].filter(Boolean).join(', ') || 'Address not set';
}

function warehousePhone(warehouse: MobileWarehouse, fallback?: string) {
  return warehouse.managerPhone || warehouse.phone || warehouse.contactPhone || fallback || '';
}

function warehouseEmail(warehouse: MobileWarehouse, fallback?: string) {
  return warehouse.managerEmail || warehouse.email || warehouse.contactEmail || fallback || '';
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function matchesWarehouseEntity(warehouse: MobileWarehouse, row: any) {
  const aliases = new Set([warehouse.id, warehouse.name, warehouse.code].map(normalize).filter(Boolean));
  return [row.warehouseId, row.warehouseName, row.warehouse, row.locationId, row.location].some((value) => aliases.has(normalize(value)));
}

function metricsFor(warehouse: MobileWarehouse, stockRows: any[]): WarehouseMetrics {
  const rows = stockRows.filter((row) => row.isDeleted !== true && matchesWarehouseEntity(warehouse, row));
  const productIds = new Set<string>();
  let used = 0;
  let reserved = 0;
  rows.forEach((row) => {
    const available = Number(row.availableQty ?? row.available ?? row.qty ?? row.quantity) || 0;
    const reservedQty = Number(row.reservedQty ?? row.reserved) || 0;
    used += available + reservedQty;
    reserved += reservedQty;
    if (row.productId || row.product) productIds.add(String(row.productId || row.product));
  });
  const capacity = parseCapacity(warehouse.capacity);
  const available = capacity === null ? null : Math.max(0, capacity - used);
  const utilization = capacity ? Math.min(999, (used / capacity) * 100) : null;
  return {
    used,
    reserved,
    available,
    capacity,
    utilization,
    productCount: productIds.size,
    rows,
    hasInventory: used > 0 || reserved > 0 || productIds.size > 0,
  };
}

function capacityStatus(metrics: WarehouseMetrics) {
  if (metrics.utilization === null) return 'Capacity not set';
  if (metrics.utilization >= 100) return 'Full';
  if (metrics.utilization >= 80) return 'Low Capacity';
  if (metrics.used > 0) return 'Utilized';
  return 'Available';
}

function filterWarehouses(warehouses: MobileWarehouse[], filters: WarehouseFilters, stockRows: any[]) {
  const term = filters.search.trim().toLowerCase();
  return warehouses
    .filter((warehouse) => {
      const metrics = metricsFor(warehouse, stockRows);
      if (filters.status !== ALL && (warehouse.status || 'Active') !== filters.status) return false;
      if (filters.type !== ALL && warehouseType(warehouse) !== filters.type) return false;
      if (filters.capacity !== ALL && capacityStatus(metrics) !== filters.capacity) return false;
      if (!isInDateRange(warehouse.updatedAt || warehouse.createdAt, filters.date)) return false;
      if (!term) return true;
      return [
        warehouse.id,
        warehouse.name,
        warehouse.code,
        warehouse.address,
        warehouse.city,
        warehouse.state,
        warehouse.pincode,
        warehouse.managerName,
        warehouse.managerPhone,
        warehouse.company,
        warehouse.companyName,
        warehouseType(warehouse),
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function exportWarehousesCSV(rows: MobileWarehouse[], stockRows: any[]) {
  const headers = ['ID', 'Name', 'Code', 'Type', 'Manager', 'Location', 'Status', 'Capacity', 'Used', 'Available', 'Products', 'Created'];
  const lines = rows.map((row) => {
    const metrics = metricsFor(row, stockRows);
    return [
      row.id,
      row.name,
      row.code,
      warehouseType(row),
      row.managerName || '',
      warehouseLocation(row),
      row.status || 'Active',
      metrics.capacity ?? row.capacity ?? '',
      metrics.used,
      metrics.available ?? '',
      metrics.productCount,
      row.createdAt ? fmtDate(row.createdAt) : '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF' + [headers.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  link.download = 'warehouses.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function formFromWarehouse(warehouse: MobileWarehouse): WarehouseForm {
  return {
    name: warehouse.name || '',
    code: warehouse.code || '',
    address: warehouse.address || '',
    city: warehouse.city || '',
    state: warehouse.state || '',
    pincode: warehouse.pincode || '',
    managerName: warehouse.managerName || '',
    managerPhone: warehouse.managerPhone || '',
    capacity: warehouse.capacity || '',
    status: warehouse.status || 'Active',
    notes: warehouse.notes || '',
    ...warehouseGeoToForm(warehouse),
  };
}

export function MobileWarehouseWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((state) => state.company);
  const keys = queryKeys.forCompany(activeCompanyId);
  const perms = usePermissions();
  const { data: warehouses = [], isLoading, error, refetch } = useWarehouses();
  const { data: products = [] } = useProducts();
  const { data: stockRows = [] } = useQuery({ queryKey: keys.stock, queryFn: () => getAll(COLLECTIONS.STOCK), staleTime: 30000 });
  const { data: dispatches = [] } = useQuery({ queryKey: keys.dispatchAll, queryFn: () => getAll(COLLECTIONS.DISPATCH), staleTime: 60000 });
  const { data: users = [] } = useQuery({ queryKey: queryKeys.global.users, queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 300000 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<MobileWarehouse | null>(null);
  const [viewWarehouse, setViewWarehouse] = useState<MobileWarehouse | null>(null);
  const [form, setForm] = useState<WarehouseForm>({ ...WAREHOUSE_FORM_DEFAULT });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MobileWarehouse | null>(null);
  const [statusTarget, setStatusTarget] = useState<MobileWarehouse | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('Active');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferIds, setTransferIds] = useState<string[]>([]);
  const [transferManagerId, setTransferManagerId] = useState('');
  const [transferNote, setTransferNote] = useState('');

  const canCreate = perms.canCreate('warehouses');
  const canEdit = perms.canEdit('warehouses');
  const canDelete = perms.canDelete('warehouses');
  const canExport = perms.canExport('warehouses') || canEdit || canCreate;
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';
  const createParam = params.get('create') || '';

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingWarehouse(null);
    setForm({ ...WAREHOUSE_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, params]);

  useEffect(() => {
    const openId = params.get('open');
    if (!openId || viewWarehouse || !warehouses.length) return;
    const found = (warehouses as MobileWarehouse[]).find((warehouse) => warehouse.id === openId);
    if (found) setViewWarehouse(found);
  }, [params, viewWarehouse, warehouses]);

  const filters = useMemo<WarehouseFilters>(() => ({
    search: params.get('q') || params.get('search') || '',
    status: params.get('status') || ALL,
    type: params.get('type') || ALL,
    capacity: params.get('capacity') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredWarehouses = useMemo(() => filterWarehouses(warehouses as MobileWarehouse[], filters, stockRows as any[]), [filters, stockRows, warehouses]);
  const paginatedWarehouses = useMemo(() => filteredWarehouses.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredWarehouses, page]);
  const selectedRows = useMemo(() => (warehouses as MobileWarehouse[]).filter((warehouse) => selected.has(warehouse.id)), [selected, warehouses]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredWarehouses.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredWarehouses.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set((warehouses as MobileWarehouse[]).map((warehouse) => warehouse.id));
      const next = new Set(Array.from(current).filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [warehouses]);

  const saveWarehouse = useSaveWarehouse(editingWarehouse?.id || null, () => {
    closeForm();
    void refetch();
  });
  const deleteWarehouse = useDeleteWarehouse();

  const statusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) => Promise.all(ids.map((id) => updateDocById(COLLECTIONS.WAREHOUSES, id, { status }))),
    onSuccess: (_, variables) => {
      void qc.invalidateQueries({ queryKey: ['warehouses'] });
      void qc.invalidateQueries({ queryKey: keys.warehouses });
      toast.success(`Marked ${variables.ids.length} warehouse${variables.ids.length === 1 ? '' : 's'} ${variables.status}`);
      setSelected(new Set());
      setBulkStatusOpen(false);
      setStatusTarget(null);
      closeWarehouse();
    },
    onError: (e: any) => toast.error(e.message || 'Status update failed'),
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const manager = (users as any[]).find((user) => user.id === transferManagerId);
      if (!manager) throw new Error('Select a manager');
      await Promise.all(transferIds.map((id) => {
        const warehouse = (warehouses as MobileWarehouse[]).find((row) => row.id === id);
        const notes = transferNote.trim()
          ? [warehouse?.notes, `Transfer: ${transferNote.trim()}`].filter(Boolean).join('\n\n')
          : warehouse?.notes || '';
        return updateDocById(COLLECTIONS.WAREHOUSES, id, {
          managerId: manager.id,
          managerName: manager.name || manager.displayName || manager.email || manager.id,
          managerPhone: manager.phone || manager.mobile || '',
          notes,
        });
      }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['warehouses'] });
      void qc.invalidateQueries({ queryKey: keys.warehouses });
      toast.success('Warehouse manager assigned');
      setTransferOpen(false);
      setTransferIds([]);
      setTransferManagerId('');
      setTransferNote('');
      setSelected(new Set());
      closeWarehouse();
    },
    onError: (e: any) => toast.error(e.message || 'Transfer failed'),
  });

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function openById(warehouseId: string) {
    const next = new URLSearchParams(params);
    next.set('open', warehouseId);
    setParams(next, { replace: true });
  }

  function openWarehouse(warehouse: MobileWarehouse) {
    setViewWarehouse(warehouse);
    openById(warehouse.id);
  }

  function closeWarehouse() {
    setViewWarehouse(null);
    if (params.get('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }

  function closeForm() {
    setFormOpen(false);
    setEditingWarehouse(null);
    setForm({ ...WAREHOUSE_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') navigate('/app', { replace: true });
    if (createParam === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) return setConfirmClose(true);
    closeForm();
  }

  function openCreate() {
    setEditingWarehouse(null);
    setForm({ ...WAREHOUSE_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }

  function openEdit(warehouse: MobileWarehouse) {
    closeWarehouse();
    setEditingWarehouse(warehouse);
    setForm(formFromWarehouse(warehouse));
    setDirty(false);
    setFormOpen(true);
  }

  function updateForm(patch: Partial<WarehouseForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Warehouse name is required');
    const geo = parseWarehouseGeo({
      latitude: form.latitude,
      longitude: form.longitude,
      geofenceRadiusMeters: form.geofenceRadiusMeters,
    });
    saveWarehouse.mutate({
      ...form,
      ...geo,
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      capacity: form.capacity.trim(),
    });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startTransfer(ids: string[]) {
    if (!ids.length) return toast.error('Select at least one warehouse');
    closeWarehouse();
    setTransferIds(ids);
    setTransferManagerId('');
    setTransferNote('');
    setTransferOpen(true);
  }

  async function deleteRows(rows: MobileWarehouse[]) {
    const blocked = rows.filter((warehouse) => metricsFor(warehouse, stockRows as any[]).hasInventory);
    const deletable = rows.filter((warehouse) => !metricsFor(warehouse, stockRows as any[]).hasInventory);
    if (blocked.length) toast.error(`${blocked.length} warehouse${blocked.length === 1 ? '' : 's'} blocked because stock exists`);
    if (!deletable.length) return;
    await Promise.all(deletable.map((warehouse) => deleteWarehouse.mutateAsync(warehouse.id)));
    setSelected(new Set());
    setDeleteTarget(null);
    closeWarehouse();
  }

  if (mode === 'create') {
    return (
      <WarehouseDialogs
        formOpen={formOpen}
        form={form}
        dirty={dirty}
        saving={saveWarehouse.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Warehouses</h1>
        </div>

        {selected.size > 0 ? (
          <Card className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-bold text-[var(--color-primary-text)]">{selected.size} selected</p>
              {canExport ? <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportWarehousesCSV(selectedRows, stockRows as any[])}>Export</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => statusMutation.mutate({ ids: Array.from(selected), status: 'Inactive' })}>Archive</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => startTransfer(Array.from(selected))}>Assign</Button> : null}
              {canEdit ? <Button size="xs" variant="outline" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => setBulkStatusOpen(true)}>Status</Button> : null}
              {canDelete ? <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteTarget(selectedRows[0])}>Delete</Button> : null}
              <button type="button" className="text-xs font-medium text-[var(--color-text-muted)]" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </Card>
        ) : null}

        {error ? (
          <Card className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Warehouses could not be loaded. <button type="button" className="font-bold underline" onClick={() => refetch()}>Retry</button>
          </Card>
        ) : null}

        <div className="space-y-2">
          {isLoading ? Array.from({ length: 5 }).map((_, index) => <WarehouseSkeletonCard key={index} />) : null}
          {!isLoading && !paginatedWarehouses.length ? (
            <Card className="rounded-xl p-6 text-center">
              <Target className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
              <p className="mt-3 text-sm font-bold text-[var(--color-text)]">
                {(filters.search || filters.status !== ALL || filters.type !== ALL || filters.capacity !== ALL || filters.date !== 'all')
                  ? 'No warehouses found'
                  : 'No warehouses yet'}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {(filters.search || filters.status !== ALL || filters.type !== ALL || filters.capacity !== ALL || filters.date !== 'all')
                  ? 'Clear search or filters to view the full list.'
                  : 'Create your first warehouse to start managing inventory locations.'}
              </p>
              {!filters.search && filters.status === ALL && filters.type === ALL && filters.capacity === ALL && filters.date === 'all' && canCreate ? (
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate} className="mt-3">Create First Warehouse</Button>
              ) : null}
            </Card>
          ) : null}
          {paginatedWarehouses.map((warehouse) => (
            <WarehouseCard
              key={warehouse.id}
              warehouse={warehouse}
              selected={selected.has(warehouse.id)}
              metrics={metricsFor(warehouse, stockRows as any[])}
              phone={warehousePhone(warehouse, companyPhone)}
              email={warehouseEmail(warehouse, companyEmail)}
              onSelect={() => toggleSelect(warehouse.id)}
              onView={() => openWarehouse(warehouse)}
            />
          ))}
        </div>

        <Pagination page={page} total={filteredWarehouses.length} perPage={PER_PAGE} onChange={changePage} />
      </div>

      <WarehouseDialogs
        formOpen={formOpen}
        form={form}
        dirty={dirty}
        saving={saveWarehouse.isPending}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onFormChange={updateForm}
        onSubmit={submitForm}
      />

      <WarehouseViewModal
        warehouse={viewWarehouse}
        metrics={viewWarehouse ? metricsFor(viewWarehouse, stockRows as any[]) : null}
        products={products as Product[]}
        stockRows={stockRows as any[]}
        dispatches={dispatches as any[]}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
        companyPhone={companyPhone}
        companyEmail={companyEmail}
        onClose={closeWarehouse}
        onEdit={openEdit}
        onStatus={(warehouse) => setStatusTarget(warehouse)}
        onTransfer={(warehouse) => startTransfer([warehouse.id])}
        onDelete={(warehouse) => setDeleteTarget(warehouse)}
        onExport={(warehouse) => exportWarehousesCSV([warehouse], stockRows as any[])}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => statusTarget && statusMutation.mutate({ ids: [statusTarget.id], status: statusTarget.status === 'Inactive' ? 'Active' : 'Inactive' })}
        loading={statusMutation.isPending}
        title="Change Warehouse Status"
        message={`Mark this warehouse ${statusTarget?.status === 'Inactive' ? 'Active' : 'Inactive'}?`}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteRows(selected.size ? selectedRows : deleteTarget ? [deleteTarget] : [])}
        loading={deleteWarehouse.isPending}
        title="Delete Warehouse"
        message={selected.size > 1 ? `Delete ${selected.size} selected warehouses? Warehouses with stock will be skipped.` : 'Delete this warehouse? This is only allowed when no stock exists.'}
      />

      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Warehouse Status" size="full">
        <div className="space-y-4">
          <Select label="Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={WAREHOUSE_STATUS_OPTIONS} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setBulkStatusOpen(false)}>Cancel</Button>
            <Button className="flex-1" loading={statusMutation.isPending} onClick={() => statusMutation.mutate({ ids: Array.from(selected), status: bulkStatus })}>Apply</Button>
          </div>
        </div>
      </Modal>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Assign Manager" size="full">
        <div className="space-y-4">
          <Section title="Warehouses">
            <p className="text-sm text-[var(--color-text-secondary)]">{transferIds.length} selected for manager assignment.</p>
          </Section>
          <Section title="Manager">
            <Select
              label="Manager"
              value={transferManagerId}
              onChange={(event) => setTransferManagerId(event.target.value)}
              options={[
                { label: 'Select manager...', value: '' },
                ...(users as any[])
                  .filter((user) => user.isDeleted !== true && user.status !== 'Inactive')
                  .map((user) => ({ label: user.name || user.displayName || user.email || user.id, value: user.id })),
              ]}
            />
            <Textarea label="Transfer Note" value={transferNote} onChange={(event) => setTransferNote(event.target.value)} rows={3} />
          </Section>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button className="flex-1" loading={transferMutation.isPending} onClick={() => transferMutation.mutate()}>Assign</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function WarehouseCard({ warehouse, selected, metrics, phone, email, onSelect, onView }: {
  warehouse: MobileWarehouse;
  selected: boolean;
  metrics: WarehouseMetrics;
  phone: string;
  email: string;
  onSelect: () => void;
  onView: () => void;
}) {
  const utilization = metrics.utilization ?? 0;
  const capacityLabel = metrics.capacity ? `${formatNumber(metrics.used)} / ${formatNumber(metrics.capacity)} (${formatNumber(utilization)}%)` : `${formatNumber(metrics.used)} used`;
  const capacityVariant = utilization >= 100 ? 'danger' : utilization >= 80 ? 'warning' : 'success';
  return (
    <Card className={cn('rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]', selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40')}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" aria-label={`Select ${warehouse.name}`} />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{warehouse.name || 'Untitled Warehouse'}</p>
          <p className="mt-0.5 truncate font-mono text-xs font-medium text-[var(--color-text-muted)]">{warehouse.code || warehouse.id}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{warehouseType(warehouse)}</p>
            <p className="truncate">{warehouse.managerName || 'Manager not assigned'}</p>
            <p className="truncate">{warehouseLocation(warehouse)}</p>
            <p className="truncate">{capacityLabel}</p>
          </div>
          {metrics.capacity ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
              <div className={cn('h-full rounded-full', utilization >= 100 ? 'bg-red-500' : utilization >= 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, utilization)}%` }} />
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(warehouse.status || 'Active')}
            <Badge variant={capacityVariant}>{capacityStatus(metrics)}</Badge>
            <Badge variant="info">{metrics.productCount} products</Badge>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsappHref(phone)} target="_blank" rel="noreferrer" aria-label="WhatsApp warehouse" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !phone && 'pointer-events-none opacity-40')}><MessageCircle className="h-4 w-4" /></a>
          <a href={email ? `mailto:${email}?subject=${encodeURIComponent(warehouse.name || 'Warehouse')}` : undefined} aria-label="Email warehouse" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}><Mail className="h-4 w-4" /></a>
          <a href={phone ? `tel:${phone}` : undefined} aria-label="Call warehouse" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}><Phone className="h-4 w-4" /></a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function WarehouseSkeletonCard() {
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

function WarehouseDialogs({ formOpen, form, dirty, saving, confirmClose, onCloseForm, onDiscard, onKeepEditing, onFormChange, onSubmit }: {
  formOpen: boolean;
  form: WarehouseForm;
  dirty: boolean;
  saving: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onFormChange: (patch: Partial<WarehouseForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title="Warehouse" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Section title="Warehouse Information">
            <Input label="Warehouse Name" required value={form.name} onChange={(event) => onFormChange({ name: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Warehouse Code" value={form.code} onChange={(event) => onFormChange({ code: event.target.value.toUpperCase() })} />
              <Input label="Capacity" inputMode="decimal" value={form.capacity} onChange={(event) => onFormChange({ capacity: event.target.value })} />
            </div>
            <Select label="Status" value={form.status} onChange={(event) => onFormChange({ status: event.target.value })} options={WAREHOUSE_STATUS_OPTIONS} />
          </Section>
          <Section title="Address">
            <Textarea label="Address" value={form.address} onChange={(event) => onFormChange({ address: event.target.value })} rows={3} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={form.city} onChange={(event) => onFormChange({ city: event.target.value })} />
              <Select label="State" value={form.state} onChange={(event) => onFormChange({ state: event.target.value })} options={[{ label: 'Select state...', value: '' }, ...INDIAN_STATES.map((state) => ({ label: state, value: state }))]} />
            </div>
            <Input label="Pincode" inputMode="numeric" value={form.pincode} onChange={(event) => onFormChange({ pincode: event.target.value })} />
          </Section>
          <Section title="Manager">
            <Input label="Manager Name" value={form.managerName} onChange={(event) => onFormChange({ managerName: event.target.value })} />
            <Input label="Manager Phone" inputMode="tel" value={form.managerPhone} onChange={(event) => onFormChange({ managerPhone: event.target.value })} />
          </Section>
          <Section title="Geo-Fence / Attendance Location">
            <p className="text-xs text-[var(--color-text-muted)]">
              Configure GPS coordinates for geo-fenced attendance check-in/check-out.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Latitude" inputMode="decimal" placeholder="e.g. 18.5204" value={form.latitude} onChange={(event) => onFormChange({ latitude: event.target.value })} />
              <Input label="Longitude" inputMode="decimal" placeholder="e.g. 73.8567" value={form.longitude} onChange={(event) => onFormChange({ longitude: event.target.value })} />
            </div>
            <Input label="Geofence Radius (meters)" inputMode="decimal" placeholder="e.g. 200" value={form.geofenceRadiusMeters} onChange={(event) => onFormChange({ geofenceRadiusMeters: event.target.value })} />
          </Section>
          <Section title="Notes">
            <Textarea label="Notes" value={form.notes} onChange={(event) => onFormChange({ notes: event.target.value })} rows={4} />
          </Section>
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function WarehouseViewModal({ warehouse, metrics, products, stockRows, dispatches, canEdit, canDelete, canExport, companyPhone, companyEmail, onClose, onEdit, onStatus, onTransfer, onDelete, onExport }: {
  warehouse: MobileWarehouse | null;
  metrics: WarehouseMetrics | null;
  products: Product[];
  stockRows: any[];
  dispatches: any[];
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  companyPhone: string;
  companyEmail: string;
  onClose: () => void;
  onEdit: (warehouse: MobileWarehouse) => void;
  onStatus: (warehouse: MobileWarehouse) => void;
  onTransfer: (warehouse: MobileWarehouse) => void;
  onDelete: (warehouse: MobileWarehouse) => void;
  onExport: (warehouse: MobileWarehouse) => void;
}) {
  const { data: movements = [] } = useQuery({
    queryKey: ['warehouse-movements', warehouse?.id],
    queryFn: () => getMovementsByWarehouse(warehouse!.id, 20),
    enabled: Boolean(warehouse?.id),
    staleTime: 30000,
  });

  if (!warehouse || !metrics) return null;
  const phone = warehousePhone(warehouse, companyPhone);
  const email = warehouseEmail(warehouse, companyEmail);
  const productById = new Map((products as any[]).map((product) => [product.id, product]));
  const relatedProducts = metrics.rows
    .map((row) => productById.get(row.productId) || { id: row.productId || row.product || row.id, name: row.productName || row.product || 'Product', unit: row.unit })
    .filter((product, index, array) => product?.id && array.findIndex((entry) => entry.id === product.id) === index);
  const relatedDispatches = dispatches.filter((dispatch) => matchesWarehouseEntity(warehouse, dispatch) || dispatch.items?.some((item: any) => matchesWarehouseEntity(warehouse, item)));
  const movementSummary = summarizeMovements(movements as InventoryMovement[]);
  const activity = [
    { type: 'Created', desc: 'Warehouse record created', date: warehouse.createdAt, userName: warehouse.createdByName || warehouse.createdBy || 'System' },
    ...(warehouse.updatedAt ? [{ type: 'Updated', desc: 'Warehouse was updated', date: warehouse.updatedAt, userName: warehouse.updatedByName || warehouse.updatedBy || 'System' }] : []),
    ...metrics.rows.slice(0, 4).map((row) => ({ type: 'Stock', desc: `${row.productName || row.product || row.productId || 'Product'} · ${Number(row.availableQty ?? row.available) || 0} available`, date: row.updatedAt || row.createdAt, userName: 'Inventory' })),
  ];

  return (
    <Modal open={!!warehouse} onClose={onClose} title={warehouse.name} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(warehouse.status || 'Active')}
            <Badge variant={metrics.utilization !== null && metrics.utilization >= 80 ? 'warning' : 'success'}>{capacityStatus(metrics)}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Used Capacity" value={metrics.capacity ? `${formatNumber(metrics.used)} / ${formatNumber(metrics.capacity)}` : formatNumber(metrics.used)} />
            <Detail label="Products" value={String(metrics.productCount)} />
          </div>
        </section>

        <Section title="Warehouse Information">
          <Detail label="Warehouse Name" value={warehouse.name || 'Not available'} />
          <Detail label="Warehouse Code" value={warehouse.code || warehouse.id} />
          <Detail label="Warehouse Type" value={warehouseType(warehouse)} />
          <Detail label="Status" value={warehouse.status || 'Active'} />
        </Section>

        <Section title="Manager & Contact">
          <Detail label="Manager" value={warehouse.managerName || 'Not assigned'} />
          <Detail label="Phone" value={phone || 'Not available'} />
          <Detail label="Email" value={email || 'Not available'} />
        </Section>

        <Section title="Address">
          <Detail label="Address" value={warehouseAddress(warehouse)} />
          <Detail label="City" value={warehouse.city || 'Not available'} />
          <Detail label="State" value={warehouse.state || 'Not available'} />
          <Detail label="Pincode" value={warehouse.pincode || 'Not available'} />
        </Section>

        <Section title="Capacity Information">
          <Detail label="Total Capacity" value={metrics.capacity ? formatNumber(metrics.capacity) : warehouse.capacity || 'Not set'} />
          <Detail label="Used Capacity" value={formatNumber(metrics.used)} />
          <Detail label="Available Capacity" value={metrics.available === null ? 'Not set' : formatNumber(metrics.available)} />
          <Detail label="Reserved Capacity" value={formatNumber(metrics.reserved)} />
          <Detail label="Utilization" value={metrics.utilization === null ? 'Not set' : `${formatNumber(metrics.utilization)}%`} />
        </Section>

        <Section title="Stock Summary">
          <Detail label="Products Stored" value={String(metrics.productCount)} />
          <Detail label="Stock Rows" value={String(metrics.rows.length)} />
          <Detail label="Movement Count" value={String(movementSummary.count)} />
          <Detail label="Net Movement" value={formatNumber(movementSummary.netQty)} />
        </Section>

        <Section title="Related Products">
          {relatedProducts.length ? relatedProducts.slice(0, 8).map((product: any) => {
            const row = stockRows.find((stock) => matchesWarehouseEntity(warehouse, stock) && stock.productId === product.id);
            return (
              <div key={product.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                <p className="text-sm font-semibold text-[var(--color-text)]">{product.name || product.productName || product.id}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{Number(row?.availableQty ?? row?.available) || 0} available · {Number(row?.reservedQty ?? row?.reserved) || 0} reserved</p>
              </div>
            );
          }) : <p className="text-sm text-[var(--color-text-muted)]">No products stored in this warehouse.</p>}
        </Section>

        <Section title="Recent Stock Movements">
          {(movements as InventoryMovement[]).length ? (movements as InventoryMovement[]).slice(0, 8).map((movement) => (
            <div key={movement.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{movement.productName || movement.productId || 'Stock movement'}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{movement.movementType || movement.type || 'Movement'} · {formatNumber(movement.qty)} {movement.date || movement.createdAt ? `· ${fmtDate(movement.date || movement.createdAt || '')}` : ''}</p>
            </div>
          )) : <p className="text-sm text-[var(--color-text-muted)]">No recent stock movements.</p>}
        </Section>

        <Section title="Related Dispatch">
          {relatedDispatches.length ? relatedDispatches.slice(0, 6).map((dispatch) => (
            <div key={dispatch.id} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              <p className="text-sm font-semibold text-[var(--color-text)]">{dispatch.dispatchNumber || dispatch.id}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{dispatch.status || 'Dispatch'} · {dispatch.customerName || dispatch.customer || 'Customer not set'}</p>
            </div>
          )) : <p className="text-sm text-[var(--color-text-muted)]">No related dispatch records.</p>}
        </Section>

        <Section title="Description & Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{warehouse.notes || warehouse.description || 'No notes recorded.'}</p>
        </Section>

        <Section title="Attachments">
          <p className="text-sm text-[var(--color-text-muted)]">{warehouse.attachmentName || warehouse.fileName || 'No attachments available.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${warehouse.name || 'Warehouse'} Timeline`} entries={activity} />
        </Section>

        <Section title="Audit Information">
          <Detail label="Created By" value={warehouse.createdByName || warehouse.createdBy || 'System'} />
          <Detail label="Created" value={warehouse.createdAt ? fmtDate(warehouse.createdAt) : 'Not available'} />
          <Detail label="Updated" value={warehouse.updatedAt ? fmtDate(warehouse.updatedAt) : 'Not available'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {phone ? <a className={linkButtonClass} href={`tel:${phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {phone ? <a className={linkButtonClass} href={whatsappHref(phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a> : null}
          {email ? <a className={linkButtonClass} href={`mailto:${email}?subject=${encodeURIComponent(warehouse.name || 'Warehouse')}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canExport ? <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => onExport(warehouse)}>Export</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(warehouse)}>Edit</Button> : null}
          {canEdit ? <Button variant="outline" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => onTransfer(warehouse)}>Assign</Button> : null}
          {canEdit ? <Button variant="outline" icon={<Archive className="h-4 w-4" />} onClick={() => onStatus(warehouse)}>Status</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(warehouse)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3><div className="mt-3 space-y-3">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p></div>;
}

export default MobileWarehouseWorkspace;
