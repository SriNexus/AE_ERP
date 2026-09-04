/**
 * Stock Transfers — desktop workspace (INVENTORY-08).
 *
 * View / create / ship / receive / cancel warehouse-to-warehouse transfers.
 * All stock effects go through the shared `warehouseTransferWorkflow` (which
 * routes every physical change through the movement engine). Presentation only —
 * no business logic lives here.
 */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, PackageCheck, Send, Ban, Plus, Trash2 } from 'lucide-react';
import {
  Button, Card, CardBody, CardHeader, EmptyState, Input, Modal, Select, Textarea,
  Table, Thead, Th, Tbody, Tr, Td, SkeletonRows, WorkspaceHero,
} from '../components/ui';
import { statusBadge } from '../components/ui/Badge';
import { canDo } from '../lib/permissions';
import { fmtDateTime } from '../lib/firestore';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import { useProducts } from '../features/inventory/hooks/useInventory';
import {
  useStockTransfers, useCreateTransfer, useShipTransfer, useReceiveTransfer, useCancelTransfer,
} from '../features/warehouses/hooks/useStockTransfers';
import { STOCK_TRANSFER_STATUS_LABELS, type StockTransferRecord } from '../features/warehouses/types/stockTransfer';

type Line = { productId: string; qty: string; unit: string };
const EMPTY_LINE: Line = { productId: '', qty: '', unit: 'PCS' };

export default function WarehouseTransfersWorkspace() {
  const canView = canDo('view', 'stock');
  const canCreate = canDo('create', 'stock');
  const canEdit = canDo('edit', 'stock');

  const { data: transfers = [], isLoading } = useStockTransfers();
  const { data: warehouses = [] } = useWarehouses();
  const { data: products = [] } = useProducts();

  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<StockTransferRecord | null>(null);

  const createMut = useCreateTransfer(() => setCreateOpen(false));
  const shipMut = useShipTransfer();
  const receiveMut = useReceiveTransfer();
  const cancelMut = useCancelTransfer();

  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  const warehouseName = (id: string) => (warehouses as any[]).find((w) => w.id === id)?.name || id;
  const productName = (id: string) => (products as any[]).find((p) => p.id === id)?.name || id;

  const rows = useMemo(
    () => (transfers as StockTransferRecord[]).filter((t) => !statusFilter || t.status === statusFilter),
    [transfers, statusFilter],
  );

  const resetForm = () => { setFromWh(''); setToWh(''); setNotes(''); setLines([{ ...EMPTY_LINE }]); };

  const submitCreate = () => {
    createMut.mutate({
      fromWarehouseId: fromWh,
      toWarehouseId: toWh,
      notes: notes.trim() || undefined,
      items: lines
        .filter((l) => l.productId && Number(l.qty) > 0)
        .map((l) => ({ productId: l.productId, product: productName(l.productId), qty: Number(l.qty), unit: l.unit || 'PCS' })),
    });
  };

  if (!canView) {
    return <div className="p-8"><EmptyState title="No access" description="You do not have permission to view stock transfers." /></div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <WorkspaceHero
        title="Stock Transfers"
        subtitle="Move stock between warehouses of the same company"
        icon={<ArrowLeftRight className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[{ label: 'All statuses', value: '' }, ...Object.entries(STOCK_TRANSFER_STATUS_LABELS).map(([v, l]) => ({ label: l, value: v }))]}
            />
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => { resetForm(); setCreateOpen(true); }}>New Transfer</Button>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader><span className="text-sm font-semibold">Transfers ({rows.length})</span></CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>FROM</Th>
                <Th>TO</Th>
                <Th>ITEMS</Th>
                <Th>STATUS</Th>
                <Th>SHIPPED</Th>
                <Th>RECEIVED</Th>
                <Th align="right">ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={7} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState title="No transfers" description="Create a transfer to move stock between two warehouses." /></td></tr>
                ) : (
                  rows.map((t) => (
                    <Tr key={t.id} role="button" tabIndex={0} onClick={() => setDetail(t)}>
                      <Td>{t.fromWarehouseName || warehouseName(t.fromWarehouseId)}</Td>
                      <Td>{t.toWarehouseName || warehouseName(t.toWarehouseId)}</Td>
                      <Td>{t.items?.length || 0} · {(t.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0)} units</Td>
                      <Td>{statusBadge(STOCK_TRANSFER_STATUS_LABELS[t.status] || t.status)}{t.hasShortfall ? <span className="ml-2 text-[11px] font-semibold text-amber-600">short {t.shortfallQty}</span> : null}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">{t.shippedAt ? fmtDateTime(t.shippedAt) : '—'}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">{t.receivedAt ? fmtDateTime(t.receivedAt) : '—'}</Td>
                      <Td align="right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && t.status === 'draft' && (
                            <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} loading={shipMut.isPending} onClick={() => shipMut.mutate(t.id)}>Ship</Button>
                          )}
                          {canEdit && t.status === 'in_transit' && (
                            <Button size="sm" icon={<PackageCheck className="h-3.5 w-3.5" />} onClick={() => setDetail(t)}>Receive</Button>
                          )}
                          {canEdit && (t.status === 'draft' || t.status === 'in_transit') && (
                            <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} loading={cancelMut.isPending}
                              onClick={() => cancelMut.mutate({ transferId: t.id, reason: '' })}>Cancel</Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Stock Transfer" size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={createMut.isPending} disabled={!fromWh || !toWh || fromWh === toWh || !lines.some((l) => l.productId && Number(l.qty) > 0)}
              onClick={submitCreate}>Create Transfer</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="From warehouse" value={fromWh} onChange={(e) => setFromWh(e.target.value)}
              options={[{ label: 'Select…', value: '' }, ...(warehouses as any[]).map((w) => ({ label: w.name, value: w.id }))]} />
            <Select label="To warehouse" value={toWh} onChange={(e) => setToWh(e.target.value)}
              options={[{ label: 'Select…', value: '' }, ...(warehouses as any[]).filter((w) => w.id !== fromWh).map((w) => ({ label: w.name, value: w.id }))]} />
          </div>
          {fromWh && toWh && fromWh === toWh && <p className="text-xs text-red-600">Source and destination must be different.</p>}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Items</span>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_90px_80px_36px] items-end gap-2">
                <Select value={line.productId} onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, productId: e.target.value } : l))}
                  options={[{ label: 'Select product…', value: '' }, ...(products as any[]).map((p) => ({ label: p.name, value: p.id }))]} />
                <Input type="number" min="0" placeholder="Qty" value={line.qty}
                  onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, qty: e.target.value } : l))} />
                <Input placeholder="Unit" value={line.unit}
                  onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, unit: e.target.value } : l))} />
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={lines.length === 1}
                  onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} />
              </div>
            ))}
            <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}>Add item</Button>
          </div>
          <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Modal>

      {/* Detail / receive modal */}
      {detail && (
        <TransferDetailModal
          key={detail.id}
          transfer={detail}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onShip={() => { shipMut.mutate(detail.id); setDetail(null); }}
          onReceive={(q) => { receiveMut.mutate({ transferId: detail.id, receivedQuantities: q }); setDetail(null); }}
          onCancel={(reason) => { cancelMut.mutate({ transferId: detail.id, reason }); setDetail(null); }}
          shipping={shipMut.isPending}
          receiving={receiveMut.isPending}
          cancelling={cancelMut.isPending}
        />
      )}
    </div>
  );
}

function TransferDetailModal(props: {
  transfer: StockTransferRecord;
  canEdit: boolean;
  onClose: () => void;
  onShip: () => void;
  onReceive: (q: Record<string, number>) => void;
  onCancel: (reason: string) => void;
  shipping: boolean; receiving: boolean; cancelling: boolean;
}) {
  const t = props.transfer;
  const [recv, setRecv] = useState<Record<string, string>>(() =>
    Object.fromEntries((t.items || []).map((it) => [it.productId, String(it.shippedQty ?? it.qty)])));
  const [cancelReason, setCancelReason] = useState('');

  return (
    <Modal open onClose={props.onClose} title={`Transfer ${t.id}`} size="lg">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge(STOCK_TRANSFER_STATUS_LABELS[t.status] || t.status)}
          <span className="text-[var(--color-text-muted)]">{t.fromWarehouseName} → {t.toWarehouseName}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
          {t.shippedAt && <span>Shipped {fmtDateTime(t.shippedAt)} by {t.shippedBy}</span>}
          {t.receivedAt && <span>Received {fmtDateTime(t.receivedAt)} by {t.receivedBy}</span>}
          {t.cancelledAt && <span>Cancelled {fmtDateTime(t.cancelledAt)} by {t.cancelledBy}</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--color-bg-sunken)] text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Shipped</th>
                <th className="px-3 py-2 text-right">{t.status === 'in_transit' ? 'Receiving' : 'Received'}</th>
              </tr>
            </thead>
            <tbody>
              {(t.items || []).map((it) => (
                <tr key={it.productId} className="border-t border-[var(--color-border-subtle)]">
                  <td className="px-3 py-2 font-medium">{it.product || it.productId}</td>
                  <td className="px-3 py-2 text-right">{it.qty}</td>
                  <td className="px-3 py-2 text-right">{it.shippedQty ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {t.status === 'in_transit' && props.canEdit ? (
                      <input type="number" min="0" max={it.shippedQty ?? it.qty}
                        className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-right"
                        value={recv[it.productId] ?? ''}
                        onChange={(e) => setRecv((p) => ({ ...p, [it.productId]: e.target.value }))} />
                    ) : (it.receivedQty ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {t.hasShortfall && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {t.shortfallQty} unit(s) lost in transit — resolve with a stock reconciliation (RECONCILE_ADJUST) at {t.fromWarehouseName}.
          </div>
        )}

        {props.canEdit && (t.status === 'draft' || t.status === 'in_transit') && (
          <div className="flex flex-col gap-2 border-t border-[var(--color-border-subtle)] pt-3">
            <div className="flex flex-wrap gap-2">
              {t.status === 'draft' && (
                <Button icon={<Send className="h-4 w-4" />} loading={props.shipping} onClick={props.onShip}>Ship transfer</Button>
              )}
              {t.status === 'in_transit' && (
                <Button icon={<PackageCheck className="h-4 w-4" />} loading={props.receiving}
                  onClick={() => props.onReceive(Object.fromEntries(Object.entries(recv).map(([k, v]) => [k, Number(v) || 0])))}>
                  Receive transfer
                </Button>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Input label="Cancel reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <Button variant="ghost" icon={<Ban className="h-4 w-4" />} loading={props.cancelling}
                onClick={() => props.onCancel(cancelReason.trim())}>
                {t.status === 'in_transit' ? 'Cancel & return to source' : 'Cancel'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
