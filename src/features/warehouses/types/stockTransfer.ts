/**
 * INVENTORY-08 — Warehouse Transfer types.
 *
 * A `stock_transfers/{TRF-*}` doc moves stock between two warehouses of the SAME
 * company: `draft` → `in_transit` (shipped, `TRANSFER_OUT` at source) →
 * `received` (`TRANSFER_IN` at destination). Both ledger rows of a completed
 * transfer share the `transferId` and their signed sum is 0 (INV-11).
 */

export type StockTransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

export interface StockTransferItem {
  productId: string;
  product?: string;
  qty: number;
  unit: string;
  /** Set at ship time — the quantity that left the source (== qty). */
  shippedQty?: number;
  /** Set at receive time — the quantity that actually arrived (<= shippedQty).
   *  A value below `shippedQty` is a loss in transit (INVENTORY-08 §7). */
  receivedQty?: number;
}

export interface StockTransferRecord {
  id: string;
  companyId: string;
  groupId?: string;
  fromWarehouseId: string;
  fromWarehouseName?: string;
  toWarehouseId: string;
  toWarehouseName?: string;
  /** Denormalised [fromWarehouseId, toWarehouseId] for warehouse-scoped queries/rules. */
  warehouseIds: string[];
  items: StockTransferItem[];
  status: StockTransferStatus;
  /** true once any received line arrived short of what was shipped. */
  hasShortfall?: boolean;
  /** total units lost in transit across all lines (Σ shippedQty − Σ receivedQty). */
  shortfallQty?: number;
  notes?: string;
  shippedBy?: string;
  shippedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  isDeleted?: boolean;
}

/** Units still physically in transit for a transfer (0 unless `in_transit`). */
export function inTransitQty(t: Pick<StockTransferRecord, 'status' | 'items'>): number {
  if (t.status !== 'in_transit') return 0;
  return (t.items || []).reduce((n, it) => n + (Number(it.shippedQty ?? it.qty) || 0), 0);
}

/** Loss-in-transit for a received transfer (Σ shipped − Σ received). */
export function transferShortfall(t: Pick<StockTransferRecord, 'status' | 'items'>): number {
  if (t.status !== 'received') return 0;
  return (t.items || []).reduce((n, it) => {
    const shipped = Number(it.shippedQty ?? it.qty) || 0;
    const received = Number(it.receivedQty ?? shipped) || 0;
    return n + Math.max(0, shipped - received);
  }, 0);
}

export const STOCK_TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  draft: 'Draft',
  in_transit: 'In Transit',
  received: 'Received',
  cancelled: 'Cancelled',
};
