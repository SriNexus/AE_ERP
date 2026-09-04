/**
 * INVENTORY-11 (§11a) — Dispatch serial-number uniqueness lock.
 *
 * PURE, zero-import module — mirrors `skuLock.ts`'s "one implementation,
 * deterministic doc id IS the uniqueness check" pattern exactly.
 *
 * `dispatch_serials/{companyId}_{normalizedSerial}` — deterministic, so a
 * transaction's `get()` of the lock doc IS the uniqueness check (same shape
 * as `product_sku_locks` / `customer_phone_locks`). Serial uniqueness is
 * PER COMPANY (Plan §14 11a: "replace the full getAll(DISPATCH) scan with a
 * dispatch_serials/{companyId}_{normalizedSerial} lock collection, written
 * in the dispatch-verify txn") — a blank serial is never locked, matching
 * the SKU-lock precedent for an absent value.
 */

/** Deterministic normalization — identical for claim / check / release. */
export function normalizeSerial(serial: unknown): string {
  return String(serial ?? '').trim().toUpperCase();
}

/** Deterministic, company-scoped lock doc id. `encodeURIComponent` on both
 *  halves keeps the id reversible/injective (mirrors `productSkuLockId`/
 *  `movementLedgerId`). */
export function dispatchSerialLockId(companyId: string, normalizedSerial: string): string {
  return `${encodeURIComponent(String(companyId || ''))}_${encodeURIComponent(normalizedSerial)}`;
}

export interface DispatchSerialLockDoc {
  id: string;
  companyId: string;
  groupId?: string;
  serial: string;
  dispatchId: string;
  productId: string;
  warehouseId?: string;
  orderId?: string;
  projectId?: string;
  status: 'assigned';
  isDeleted?: boolean;
  createdAt?: unknown;
  createdBy?: string;
}

/** True when a lock doc represents an ACTIVE claim by a dispatch other than `dispatchId`. */
export function lockHeldByAnotherDispatch(lock: Partial<DispatchSerialLockDoc> | null | undefined, dispatchId: string): boolean {
  return !!lock && lock.isDeleted !== true && lock.dispatchId !== dispatchId;
}
