import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowLeftRight, Download, Edit2, FileText, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { fmtDateTime } from '../../../lib/firestore';
import { getMovementsByWarehouse } from '../../../lib/inventoryMovements';
import { Button } from '../../../components/ui/Button';
import { Badge, statusBadge } from '../../../components/ui/Badge';
import { Input, Select, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PermissionGate } from '../../../components/shared';
import type { Warehouse } from '../types';
import { DetailCard, Field } from './WarehouseWorkspaceParts';
import {
  daysAgoText,
  formatCapacityLabel,
  formatNumber,
  matchesWarehouseEntity,
  parseCapacity,
  warehouseCompany,
  warehouseLocation,
  warehouseType,
} from '../utils/warehouseWorkspaceUtils';
export function WarehouseTransferModal({
  open,
  targets,
  currentUsers,
  onClose,
  onConfirm,
  saving,
}: {
  open: boolean;
  targets: any[];
  currentUsers: any[];
  onClose: () => void;
  onConfirm: (payload: { managerId: string; managerName: string; managerPhone: string; note: string }) => void;
  saving: boolean;
}) {
  const [managerId, setManagerId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setManagerId('');
    setNote('');
  }, [open, targets.length]);

  const options = currentUsers.map((user) => ({ label: user.name, value: user.id }));

  const currentManagers = targets
    .map((target) => target.managerName || 'Unassigned')
    .filter((value, index, array) => array.indexOf(value) === index);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={targets.length > 1 ? 'Transfer Warehouses' : 'Transfer Warehouse'}
      size="sm"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 text-sm">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Selected Warehouses</p>
          <p className="mt-1 font-semibold text-[var(--color-text)]">{targets.length} selected</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Current managers: {currentManagers.join(', ') || 'Unassigned'}</p>
        </div>

        <Select
          label="New Manager"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          options={[{ label: 'Select manager...', value: '' }, ...options]}
        />

        <Textarea
          label="Transfer Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note to append to the warehouse record"
          rows={3}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!managerId) {
                toast.error('Select a manager');
                return;
              }
              const user = currentUsers.find((entry) => entry.id === managerId);
              if (!user) {
                toast.error('Manager not found');
                return;
              }
              onConfirm({
                managerId: user.id,
                managerName: user.name,
                managerPhone: user.phone || '',
                note,
              });
            }}
            loading={saving}
          >
            Confirm Transfer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function WarehouseDetailsModal({
  open,
  warehouse,
  stockRows,
  products,
  employeeCount,
  onClose,
  onEdit,
  onArchive,
  onTransfer,
  onExport,
  onGenerateReport,
  onDelete,
  canDelete,
}: {
  open: boolean;
  warehouse: Warehouse | null;
  stockRows: any[];
  products: any[];
  employeeCount: number;
  onClose: () => void;
  onEdit: (warehouse: Warehouse) => void;
  onArchive: (warehouse: Warehouse) => void;
  onTransfer: (warehouse: Warehouse) => void;
  onExport: (warehouse: Warehouse) => void;
  onGenerateReport: (warehouse: Warehouse) => void;
  onDelete: (warehouse: Warehouse) => void;
  canDelete: boolean;
}) {
  const [tab, setTab] = useState<'overview' | 'inventory' | 'products' | 'movements' | 'activity' | 'notes'>('overview');
  const [productSearch, setProductSearch] = useState('');

  const { data: movements = [] } = useQuery({
    queryKey: ['warehouse-movements', warehouse?.id || 'none'],
    enabled: Boolean(open && warehouse?.id),
    queryFn: () => getMovementsByWarehouse(warehouse!.id, 30),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setTab('overview');
    setProductSearch('');
  }, [open, warehouse?.id]);

  const warehouseProducts = useMemo(() => {
    const warehouseStocks = stockRows.filter((row) => matchesWarehouseEntity(warehouse, row));
    const productById = new Map((products as any[]).map((product: any) => [product.id, product]));
    return warehouseStocks
      .map((row) => {
        const product = row.productId ? productById.get(row.productId) : undefined;
        const available = Number(row.availableQty ?? row.available) || 0;
        const reserved = Number(row.reservedQty ?? row.reserved) || 0;
        const total = available + reserved;
        return {
          id: row.id,
          productId: row.productId,
          product: product?.name || row.productName || '—',
          available,
          reserved,
          total,
          unit: row.unit || product?.unit || 'PCS',
        };
      })
      .sort((a, b) => b.total - a.total)
      .filter((row) => {
        const q = productSearch.toLowerCase();
        if (!q) return true;
        return [row.product, row.productId, row.unit].some((value) => String(value || '').toLowerCase().includes(q));
      });
  }, [products, productSearch, stockRows, warehouse]);

  const movementSummary = useMemo(() => {
    return (movements as any[]).reduce((summary, move) => {
      const qty = Number(move.qty) || 0;
      const type = String(move.type || move.movementType || '').toUpperCase();
      if (type === 'OUT') summary.out += qty;
      else if (type === 'ADJUSTMENT') summary.adjustment += qty;
      else summary.in += qty;
      summary.count += 1;
      return summary;
    }, { in: 0, out: 0, adjustment: 0, count: 0 });
  }, [movements]);

  if (!open || !warehouse) return null;

  const capacityValue = parseCapacity(warehouse.capacity);
  const used = warehouseProducts.reduce((sum, row) => sum + row.total, 0);
  const reserved = warehouseProducts.reduce((sum, row) => sum + row.reserved, 0);
  const availableStock = warehouseProducts.reduce((sum, row) => sum + row.available, 0);
  const freeCapacity = capacityValue !== null ? Math.max(0, capacityValue - used) : null;
  const utilization = capacityValue && capacityValue > 0 ? used / capacityValue : null;
  const createdAt = warehouse.createdAt;
  const updatedAt = warehouse.updatedAt || warehouse.createdAt;
  const statusLabel = warehouse.status || 'Active';
  const isInactive = statusLabel.toLowerCase() === 'inactive';

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--color-border-subtle)] pb-4">          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {(warehouse.name || '?')[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{warehouse.name || 'Warehouse'}</h2>
                  <span>{statusBadge(statusLabel)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span>{warehouseCompany(warehouse)}</span>
                  <span>{warehouseLocation(warehouse)}</span>
                  <span>Capacity: {formatCapacityLabel(warehouse.capacity)}</span>
                  <span>Created: {daysAgoText(createdAt)}</span>
                </div>
              </div>
            </div>
        </div>
      </header>

      <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['overview', 'Overview'],
          ['inventory', 'Inventory'],
          ['products', 'Products'],
          ['movements', 'Movements'],
          ['activity', 'Activity'],
          ['notes', 'Notes'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as any)}
            className={[
              'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
              tab === key
                ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
        {tab === 'overview' && (
          <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              <DetailCard title="Warehouse Information">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Code" value={warehouse.code || '—'} />
                  <Field label="Manager" value={warehouse.managerName || 'Unassigned'} />
                  <Field label="Manager Phone" value={warehouse.managerPhone || '—'} />
                  <Field label="Employees" value={String(employeeCount)} />
                  <Field label="Capacity" value={formatCapacityLabel(warehouse.capacity)} />
                  <Field label="Location" value={warehouseLocation(warehouse)} />
                  <Field label="Company" value={warehouseCompany(warehouse)} />
                  <Field label="Created" value={fmtDateTime(createdAt)} />
                  <Field label="Updated" value={fmtDateTime(updatedAt)} />
                </div>
              </DetailCard>

              <DetailCard title="Address">
                <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text-secondary)]">
                  {[warehouse.address, warehouse.city, warehouse.state, warehouse.pincode].filter(Boolean).join(', ') || 'No address on file'}
                </p>
              </DetailCard>
            </div>

            <aside className="space-y-4">
              <DetailCard title="Usage">
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                      <span>Capacity Used</span>
                      <span>{capacityValue ? `${Math.round((used / capacityValue) * 100)}%` : '—'}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-primary)]"
                        style={{ width: `${Math.min(100, Math.max(0, capacityValue ? (used / capacityValue) * 100 : 0))}%` }}
                      />
                    </div>
                  </div>
                  <Field label="Used" value={formatNumber(used)} />
                  <Field label="Available" value={formatNumber(freeCapacity)} />
                  <Field label="Reserved" value={formatNumber(reserved)} />
                </div>
              </DetailCard>

              <DetailCard title="Quick Facts">
                <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                  <p>Warehouse type: <span className="font-semibold text-[var(--color-text)]">{warehouseType(warehouse)}</span></p>
                  <p>Recent stock movements: <span className="font-semibold text-[var(--color-text)]">{movementSummary.count}</span></p>
                  <p>Created: <span className="font-semibold text-[var(--color-text)]">{daysAgoText(createdAt)}</span></p>
                </div>
              </DetailCard>
            </aside>
          </div>
        )}

        {tab === 'inventory' && (
          <div className="pt-5">
            <DetailCard title="Inventory Summary">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Total Stock" value={formatNumber(used)} />
                <Field label="Reserved" value={formatNumber(reserved)} />
                <Field label="Available" value={formatNumber(availableStock)} />
                <Field label="Products" value={formatNumber(warehouseProducts.length)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Stock In" value={formatNumber(movementSummary.in)} />
                <Field label="Stock Out" value={formatNumber(movementSummary.out)} />
                <Field label="Adjustments" value={formatNumber(movementSummary.adjustment)} />
              </div>
            </DetailCard>
          </div>
        )}

        {tab === 'products' && (
          <div className="pt-5">
            <DetailCard title="Products in Warehouse">
              <div className="mb-3 flex items-center gap-2">
                <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search product..."
                />
              </div>
              {warehouseProducts.length ? (
                <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left">Product</th>
                        <th className="px-3 py-2 text-left">Available</th>
                        <th className="px-3 py-2 text-left">Reserved</th>
                        <th className="px-3 py-2 text-left">Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                      {warehouseProducts.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 font-medium text-[var(--color-text)]">{row.product}</td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatNumber(row.available)}</td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)]">{formatNumber(row.reserved)}</td>
                          <td className="px-3 py-2 text-[var(--color-text-secondary)]">{row.unit || 'PCS'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No product balances found for this warehouse.</p>
              )}
            </DetailCard>
          </div>
        )}

        {tab === 'movements' && (
          <div className="pt-5">
            <DetailCard title="Stock Movements">
              {movements.length ? (
                <div className="space-y-3">
                  {(movements as any[]).slice(0, 15).map((movement, index) => (
                    <div key={movement.id || index} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-[var(--color-text)]">{movement.productName || movement.product || 'Movement'}</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(movement.date || movement.createdAt)}</time>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                          <Badge variant={movement.type === 'OUT' ? 'danger' : movement.type === 'ADJUSTMENT' ? 'warning' : 'success'}>{movement.type || movement.movementType || 'IN'}</Badge>
                          <span>Qty: {movement.qty || 0}</span>
                          <span>{movement.warehouseName || movement.warehouse || warehouse.name}</span>
                          {movement.referenceId ? <span>Ref: {movement.referenceId}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No movements recorded for this warehouse.</p>
              )}
            </DetailCard>
          </div>
        )}

        {tab === 'activity' && (
          <div className="pt-5">
            <DetailCard title="Activity Timeline">
              {movements.length || warehouse.updatedAt ? (
                <div className="space-y-3">
                  <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-[var(--color-text)]">Warehouse created</p>
                        <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(createdAt)}</time>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Initial warehouse record was created.</p>
                    </div>
                  </div>
                  {warehouse.updatedAt && (
                    <div className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text)]">Warehouse updated</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(warehouse.updatedAt)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Metadata or usage data changed.</p>
                      </div>
                    </div>
                  )}
                  {(movements as any[]).slice(0, 8).map((movement, index) => (
                    <div key={movement.id || `move-${index}`} className="flex gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-[var(--color-text)]">{movement.type || movement.movementType || 'Movement'}</p>
                          <time className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmtDateTime(movement.date || movement.createdAt)}</time>
                        </div>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                          {movement.productName || movement.product || 'Stock'} · Qty {movement.qty || 0}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">No activity recorded yet.</p>
              )}
            </DetailCard>
          </div>
        )}

        {tab === 'notes' && (
          <div className="pt-5">
            <DetailCard title="Notes">
              {warehouse.notes ? (
                <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text-secondary)]">{warehouse.notes}</p>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-6 text-sm text-[var(--color-text-muted)]">
                  No notes have been recorded for this warehouse.
                </div>
              )}
            </DetailCard>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PermissionGate module="warehouses" action="edit">
            <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => onEdit(warehouse)}>Edit Warehouse</Button>
          </PermissionGate>
          <PermissionGate module="warehouses" action="edit">
            <Button variant="outline" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => onArchive(warehouse)} disabled={isInactive}>
              {isInactive ? 'Archived' : 'Archive'}
            </Button>
          </PermissionGate>
          <PermissionGate module="warehouses" action="edit">
            <Button variant="outline" size="sm" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => onTransfer(warehouse)}>
              Transfer Stock
            </Button>
          </PermissionGate>
          <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => onExport(warehouse)}>
            Export
          </Button>
          <Button variant="outline" size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => onGenerateReport(warehouse)}>
            Generate Report
          </Button>
          <PermissionGate module="warehouses" action="delete">
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={!canDelete}
              title={canDelete ? 'Delete warehouse' : 'Warehouse has stock data and cannot be deleted'}
              onClick={() => onDelete(warehouse)}
            >
              Delete
            </Button>
          </PermissionGate>
        </div>
      )}
    >
      {body}
    </Modal>
  );
}

