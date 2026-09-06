/**
 * INVENTORY-09 — Product SKU uniqueness lock (P1-7 / §7).
 *
 * PURE, zero-import module (mirrors `stockReconciliationMath.ts`'s "one
 * implementation, many runtimes" pattern) — safe to import from the browser
 * bundle (`src/features/inventory/hooks/useInventory.ts`) AND from the Vercel
 * serverless API (`api/[entity].ts`, `api/[entity]/[id].ts`), which run in a
 * plain Node.js runtime and cannot import `src/lib/firebase.ts` (client-SDK
 * top-level side effects — see `collections.ts`'s own doc comment).
 *
 * `product_sku_locks/{companyId}_{normalizedSku}` — deterministic, so a
 * transaction's `get()` of the lock doc IS the uniqueness check (mirrors
 * `customer_phone_locks` exactly). SKU uniqueness is PER COMPANY; a blank SKU
 * is never locked (no uniqueness constraint on an absent SKU).
 */

/** Deterministic normalization — identical for create / edit / check. */
export function normalizeSku(sku: unknown): string {
  return String(sku ?? '').trim().toUpperCase();
}

/** Deterministic, company-scoped lock doc id. `encodeURIComponent` on both
 *  halves keeps the id reversible/injective (mirrors `movementLedgerId`). */
export function productSkuLockId(companyId: string, normalizedSku: string): string {
  return `${encodeURIComponent(String(companyId || ''))}_${encodeURIComponent(normalizedSku)}`;
}

export interface ProductSkuLockDoc {
  id: string;
  companyId: string;
  groupId?: string;
  sku: string;
  productId: string;
  isDeleted: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  releasedAt?: unknown;
}

/** True when a lock doc represents an ACTIVE claim by a product other than `productId`. */
export function lockHeldByAnotherProduct(lock: Partial<ProductSkuLockDoc> | null | undefined, productId: string): boolean {
  return !!lock && lock.isDeleted !== true && lock.productId !== productId;
}

/**
 * A genuine SKU-uniqueness conflict (this SKU is already held by another
 * product in the same company) — as opposed to any other failure the
 * create/edit path may hit (a rules PERMISSION_DENIED, a network error, …).
 * A dedicated class so the caller's fallback path can tell "the user must
 * pick a different SKU" apart from "retry with a different mechanism".
 */
export class SkuLockConflictError extends Error {
  readonly code = 'sku-conflict';
  constructor(sku: unknown) {
    super(`SKU "${String(sku ?? '')}" is already used by another product in this company`);
    this.name = 'SkuLockConflictError';
  }
}
