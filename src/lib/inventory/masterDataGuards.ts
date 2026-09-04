/**
 * INVENTORY-09 — Master-data delete guards (P2-5).
 *
 * A GUARD, not a cascade: every function here is READ-ONLY (it only decides
 * whether the caller's subsequent `deleteDocById` — a soft `isDeleted: true`
 * update — is safe). None of these ever mutate stock, the ledger, orders,
 * quotations, purchase orders, or historical documents. The movement engine
 * remains untouched and is the only place `stock` / `stock_ledger` are written.
 *
 * "Open" status sets are derived from the EXISTING state machines already in
 * the codebase (never invented):
 *   - order:      QuotationsWorkspace's own "active order" filter — open
 *                 unless `Delivered` or `Cancelled`.
 *   - quotation:  QuotationsWorkspace's own "active quotation" filter — open
 *                 unless `Rejected`, `Expired`, or `Converted to Order`.
 *   - PO:         `PURCHASE_ORDER_TRANSITIONS` (purchaseOrderWorkflow.ts) —
 *                 `Received` / `Cancelled` are terminal (no further
 *                 transitions); everything else (`Draft` / `Sent` /
 *                 `PartiallyReceived`) is open.
 *   - dispatch:   `TERMINAL_DISPATCH_STATUSES` minus the mid-flight states a
 *                 warehouse must stay reachable for — `Closed` and `Returned`
 *                 are the only states with no further warehouse-side action;
 *                 `Pending Verification` / `Dispatched` / `In Transit` /
 *                 `Delivered` are all still "open" against that warehouse.
 *   - GRN:        `GoodsReceiptRecord` has NO status field of its own — a GRN
 *                 is an immutable point-in-time receipt, never itself
 *                 "open" or "closed" (verified against
 *                 `src/features/procurement/types/index.ts`). The read
 *                 signal this module uses instead: a GRN against warehouse W
 *                 whose PARENT PURCHASE ORDER is still receivable means more
 *                 receiving into W is expected — that PO/warehouse pairing is
 *                 the "open GRN activity" the plan refers to.
 */

import { getAll } from '../firestore';
import { COLLECTIONS } from '../firebase';

const OPEN_ORDER_EXCLUDED_STATUSES = new Set(['Delivered', 'Cancelled']);
const OPEN_QUOTATION_EXCLUDED_STATUSES = new Set(['Rejected', 'Expired', 'Converted to Order']);
const OPEN_PO_EXCLUDED_STATUSES = new Set(['Received', 'Cancelled']);
const OPEN_DISPATCH_EXCLUDED_STATUSES = new Set(['Closed', 'Returned']);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function itemsReferenceProduct(items: unknown, productId: string): boolean {
  return Array.isArray(items) && items.some((it) => String((it as { productId?: unknown })?.productId || '') === productId);
}

export interface GuardResult {
  blocked: boolean;
  reason?: string;
}

/**
 * INVENTORY-09 (§11) — a product may be soft-deleted only when it has no
 * positive on-hand stock and no open order / quotation / PO reference.
 */
export async function checkProductDeleteGuard(productId: string): Promise<GuardResult> {
  const [stockRows, orders, quotations, purchaseOrders] = await Promise.all([
    getAll<{ productId?: string; onHandQty?: number; availableQty?: number; available?: number; isDeleted?: boolean }>(COLLECTIONS.STOCK).catch(() => []),
    getAll<{ items?: unknown; status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.ORDERS).catch(() => []),
    getAll<{ items?: unknown; status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.QUOTATIONS).catch(() => []),
    getAll<{ items?: unknown; status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.PURCHASE_ORDERS).catch(() => []),
  ]);

  const positiveStock = stockRows.some((s) =>
    s.isDeleted !== true && s.productId === productId
    && num(s.onHandQty ?? s.availableQty ?? s.available) > 1e-6);
  if (positiveStock) return { blocked: true, reason: 'This product still has on-hand stock in at least one warehouse.' };

  const openOrder = orders.find((o) => o.isDeleted !== true && !OPEN_ORDER_EXCLUDED_STATUSES.has(String(o.status || ''))
    && itemsReferenceProduct(o.items, productId));
  if (openOrder) return { blocked: true, reason: `This product is referenced by open order ${openOrder.id}.` };

  const openQuotation = quotations.find((q) => q.isDeleted !== true && !OPEN_QUOTATION_EXCLUDED_STATUSES.has(String(q.status || ''))
    && itemsReferenceProduct(q.items, productId));
  if (openQuotation) return { blocked: true, reason: `This product is referenced by open quotation ${openQuotation.id}.` };

  const openPo = purchaseOrders.find((po) => po.isDeleted !== true && !OPEN_PO_EXCLUDED_STATUSES.has(String(po.status || ''))
    && itemsReferenceProduct(po.items, productId));
  if (openPo) return { blocked: true, reason: `This product is referenced by open purchase order ${openPo.id}.` };

  return { blocked: false };
}

/**
 * INVENTORY-09 (§12) — a category may be soft-deleted only when no
 * non-deleted product still links to it — by the stable `categoryId` (the
 * authoritative FK) or, for a product that predates the Phase-09 backfill,
 * by the legacy `category` display-name string. Reuses the SAME matching
 * predicate `CategoriesWorkspace.tsx`'s own product-count / merge features
 * already use (`categoryKeys`/`normalize` in `categoryWorkspaceUtils.ts`) —
 * one definition of "linked", not a second one.
 */
export async function checkCategoryDeleteGuard(
  category: { id: string; name?: string; parentCategory?: string },
): Promise<GuardResult> {
  const { categoryKeys, normalize } = await import('../../features/categories/utils/categoryWorkspaceUtils');
  const products = await getAll<{ categoryId?: string; category?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.PRODUCTS).catch(() => []);
  const aliases = new Set(categoryKeys(category));
  const linked = products.find((p) => p.isDeleted !== true
    && (aliases.has(normalize(p.categoryId)) || aliases.has(normalize(p.category))));
  if (linked) return { blocked: true, reason: `This category is still linked to product ${linked.id}.` };
  return { blocked: false };
}

/**
 * INVENTORY-09 (§13) — a warehouse may be soft-deleted only when it has no
 * positive on-hand stock, no open dispatch, and no open goods-receipt
 * activity (see the module doc comment for how "open GRN" is derived).
 */
export async function checkWarehouseDeleteGuard(warehouseId: string): Promise<GuardResult> {
  const [stockRows, dispatches, grns, purchaseOrders] = await Promise.all([
    getAll<{ warehouseId?: string; onHandQty?: number; availableQty?: number; available?: number; isDeleted?: boolean }>(COLLECTIONS.STOCK).catch(() => []),
    getAll<{ warehouseId?: string; status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.DISPATCH).catch(() => []),
    getAll<{ warehouseId?: string; purchaseOrderId?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.GOODS_RECEIPTS).catch(() => []),
    getAll<{ status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.PURCHASE_ORDERS).catch(() => []),
  ]);

  const positiveStock = stockRows.some((s) =>
    s.isDeleted !== true && s.warehouseId === warehouseId
    && num(s.onHandQty ?? s.availableQty ?? s.available) > 1e-6);
  if (positiveStock) return { blocked: true, reason: 'This warehouse still holds on-hand stock.' };

  const openDispatch = dispatches.find((d) => d.isDeleted !== true && d.warehouseId === warehouseId
    && !OPEN_DISPATCH_EXCLUDED_STATUSES.has(String(d.status || '')));
  if (openDispatch) return { blocked: true, reason: `This warehouse has an open dispatch (${openDispatch.id}).` };

  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const openGrn = grns.find((g) => {
    if (g.isDeleted === true || g.warehouseId !== warehouseId) return false;
    const po = poById.get(String(g.purchaseOrderId || ''));
    return !!po && po.isDeleted !== true && !OPEN_PO_EXCLUDED_STATUSES.has(String(po.status || ''));
  });
  if (openGrn) return { blocked: true, reason: `This warehouse has an open goods receipt (${openGrn.id}) against a purchase order still being received.` };

  return { blocked: false };
}

/**
 * INVENTORY-09 (§14) — a vendor may be soft-deleted only when it has no
 * non-cancelled purchase order (Draft / Sent / PartiallyReceived / Received
 * are all real procurement history — only `Cancelled` releases the vendor).
 */
export async function checkVendorDeleteGuard(vendorId: string): Promise<GuardResult> {
  const purchaseOrders = await getAll<{ vendorId?: string; status?: string; isDeleted?: boolean; id: string }>(COLLECTIONS.PURCHASE_ORDERS).catch(() => []);
  const blocking = purchaseOrders.find((po) => po.isDeleted !== true && po.vendorId === vendorId && String(po.status || '') !== 'Cancelled');
  if (blocking) return { blocked: true, reason: `This vendor has a non-cancelled purchase order (${blocking.id}).` };
  return { blocked: false };
}
