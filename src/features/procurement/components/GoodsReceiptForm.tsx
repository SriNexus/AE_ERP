import type React from 'react';
import { Button, Input, Select, Textarea } from '../../../components/ui';
import type { Warehouse } from '../../warehouses/types';
import type { GoodsReceiptFormValues, PurchaseOrderRecord } from '../types';

export function GoodsReceiptForm({ value, orders, warehouses, onChange, onSubmit, onCancel, saving }: { value: GoodsReceiptFormValues; orders: PurchaseOrderRecord[]; warehouses: Warehouse[]; onChange: (value: GoodsReceiptFormValues) => void; onSubmit: (event: React.FormEvent) => void; onCancel: () => void; saving: boolean }) {
  const patch = (next: Partial<GoodsReceiptFormValues>) => onChange({ ...value, ...next });
  const order = orders.find((entry) => entry.id === value.purchaseOrderId);
  return <form className="space-y-5" onSubmit={onSubmit}>
    <div className="grid gap-4 md:grid-cols-3"><Select label="Purchase Order *" required value={value.purchaseOrderId} onChange={(event) => patch({ purchaseOrderId: event.target.value, quantities: {} })} options={[{ label: 'Select sent purchase order…', value: '' }, ...orders.map((entry) => ({ label: `${entry.purchaseOrderId} · ${entry.vendorName}`, value: entry.id }))]} /><Select label="Warehouse *" required value={value.warehouseId} onChange={(event) => patch({ warehouseId: event.target.value })} options={[{ label: 'Select warehouse…', value: '' }, ...warehouses.map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))]} /><Input label="Received Date *" required type="date" value={value.receivedDate} onChange={(event) => patch({ receivedDate: event.target.value })} /></div>
    {order && <div className="space-y-3"><h3 className="text-sm font-semibold text-[var(--color-text)]">Received Quantities</h3>{order.items.map((item, lineIndex) => { const received = Number(item.receivedQty) || 0; const remaining = Math.max(0, item.qty - received); return <div key={`${item.productId}-${lineIndex}`} className="grid items-end gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 md:grid-cols-4"><div className="md:col-span-2"><p className="font-semibold text-[var(--color-text)]">{item.product}</p><p className="text-xs text-[var(--color-text-muted)]">Ordered {item.qty} {item.unit} · Previously received {received} · Remaining {remaining}</p></div><Input label="Receive Now" type="number" min="0" max={remaining} step="0.01" disabled={remaining === 0} value={value.quantities[lineIndex] || ''} onChange={(event) => patch({ quantities: { ...value.quantities, [lineIndex]: event.target.value } })} /><p className="pb-2 text-xs text-[var(--color-text-muted)]">{item.unit}</p></div>; })}</div>}
    <Textarea label="Receipt Notes" value={value.notes} onChange={(event) => patch({ notes: event.target.value })} />
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" loading={saving} disabled={!order}>Post Goods Receipt</Button></div>
  </form>;
}
