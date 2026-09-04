/**
 * INVENTORY-09 (§A) — closes the documented gap where the generic REST API's
 * `products` create/update bypasses the SKU-uniqueness lock the desktop/mobile
 * SDK write path (`useInventory.ts`) enforces.
 *
 * Verified active gap: `products` is registered WITHOUT `readOnly` in
 * `api/_lib/registry.ts`, so `handleCreate`/`handleUpdate` in `api/[entity].ts`
 * / `api/[entity]/[id].ts` reach a real, authenticated Admin-SDK write
 * (`requirePermission(user, 'create'|'edit', 'products')` already gates it —
 * unlike the neutered `stock`/`stock_ledger` entities from INVENTORY-02, this
 * one is NOT read-only). A caller with `products:create`/`edit` permission
 * could otherwise create/rename a product to any SKU, including one already
 * claimed by another product through the normal app UI.
 *
 * ONE authoritative normalization/id scheme — `src/lib/inventory/skuLock.ts`
 * (PURE, zero Firebase imports) is shared with the client SDK path; this file
 * only adds the Admin-SDK transaction mechanics for the two runtimes that
 * cannot share a Firestore SDK instance (client SDK in the browser vs.
 * Admin SDK in this Vercel function).
 */
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeSku, productSkuLockId, lockHeldByAnotherProduct, type ProductSkuLockDoc } from '../../src/lib/inventory/skuLock';

const PRODUCTS = 'products';
const PRODUCT_SKU_LOCKS = 'product_sku_locks';

export class SkuConflictError extends Error {
  code = 'SKU_CONFLICT' as const;
}

/**
 * Create a product via the Admin SDK, claiming its SKU lock atomically in the
 * SAME transaction (mirrors `createProductWithSkuLock`'s configured branch).
 * Throws `SkuConflictError` if another product already holds the SKU in this
 * company. `id` collision uses Firestore's own transactional read-before-write
 * (never a `set`/merge over an existing doc — P1-7).
 */
export async function createProductWithSkuLockAdmin(
  db: Firestore,
  id: string,
  docData: Record<string, unknown>,
  companyId: string,
): Promise<void> {
  const normalizedSku = normalizeSku(docData.sku);
  const productRef = db.collection(PRODUCTS).doc(id);
  const lockRef = normalizedSku ? db.collection(PRODUCT_SKU_LOCKS).doc(productSkuLockId(companyId, normalizedSku)) : null;

  await db.runTransaction(async (tx) => {
    const productSnap = await tx.get(productRef);
    if (productSnap.exists) {
      throw Object.assign(new Error('ALREADY_EXISTS'), { code: 'ALREADY_EXISTS' });
    }
    if (lockRef) {
      const lockSnap = await tx.get(lockRef);
      const lock = lockSnap.exists ? (lockSnap.data() as ProductSkuLockDoc) : null;
      if (lockHeldByAnotherProduct(lock, id)) {
        throw new SkuConflictError(`SKU "${String(docData.sku)}" is already used by another product in this company`);
      }
    }
    tx.set(productRef, { ...docData, id });
    if (lockRef) {
      tx.set(lockRef, {
        id: lockRef.id, companyId, sku: normalizedSku, productId: id, isDeleted: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  });
}

/**
 * Update a product via the Admin SDK, swapping its SKU lock atomically when
 * `updateData.sku` is present and differs from the stored value (mirrors
 * `updateProductWithSkuLock`'s configured branch). A no-op on the lock when
 * the SKU is absent from the update body or unchanged.
 */
export async function updateProductWithSkuLockAdmin(
  db: Firestore,
  id: string,
  updateData: Record<string, unknown>,
  existing: Record<string, unknown>,
  companyId: string,
): Promise<void> {
  const productRef = db.collection(PRODUCTS).doc(id);
  if (!('sku' in updateData)) {
    await productRef.update(updateData);
    return;
  }
  const oldSku = normalizeSku(existing.sku);
  const newSku = normalizeSku(updateData.sku);
  if (oldSku === newSku) {
    await productRef.update(updateData);
    return;
  }

  const nextLockRef = newSku ? db.collection(PRODUCT_SKU_LOCKS).doc(productSkuLockId(companyId, newSku)) : null;
  const oldLockRef = oldSku ? db.collection(PRODUCT_SKU_LOCKS).doc(productSkuLockId(companyId, oldSku)) : null;

  await db.runTransaction(async (tx) => {
    const nextLockSnap = nextLockRef ? await tx.get(nextLockRef) : null;
    if (nextLockSnap) {
      const lock = nextLockSnap.exists ? (nextLockSnap.data() as ProductSkuLockDoc) : null;
      if (lockHeldByAnotherProduct(lock, id)) {
        throw new SkuConflictError(`SKU "${String(updateData.sku)}" is already used by another product in this company`);
      }
    }
    const oldLockSnap = oldLockRef ? await tx.get(oldLockRef) : null;

    if (nextLockRef) {
      tx.set(nextLockRef, {
        id: nextLockRef.id, companyId, sku: newSku, productId: id,
        createdAt: nextLockSnap?.exists ? (nextLockSnap.data() as ProductSkuLockDoc).createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(), isDeleted: false,
      }, { merge: true });
    }
    if (oldLockRef && oldLockSnap?.exists && (oldLockSnap.data() as ProductSkuLockDoc).productId === id) {
      tx.set(oldLockRef, { isDeleted: true, releasedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    }
    tx.update(productRef, updateData);
  });
}
