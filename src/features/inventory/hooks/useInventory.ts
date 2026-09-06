// features/inventory/hooks/useInventory.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, getOne, createDocWithId, updateDocById, deleteDocById, genId, fmtDate,
  resolveWriteGroupId, resolveWriteCompanyId,
} from '../../../lib/firestore';
import { COLLECTIONS, db, firebaseEnv } from '../../../lib/firebase';
import { sanitizeFirestoreData } from '../../../lib/sanitizer';
// INVENTORY-05a: single canonical stock-summary identity — the local copy was
// a byte-identical duplicate of this one; deleted so there is ONE source.
import { stockSummaryId } from '../../../lib/workflow';
import { normalizeSku, productSkuLockId, lockHeldByAnotherProduct, SkuLockConflictError, type ProductSkuLockDoc } from '../../../lib/inventory/skuLock';
import { checkProductDeleteGuard } from '../../../lib/inventory/masterDataGuards';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { UNITS } from '../../../config/company';
import toast from 'react-hot-toast';
import { NotificationType, type Product } from '../../../types';
import { notifyRoleUsers } from '../../../lib/notifications';

// ── Products ────────────────────────────────────────────────

export const PRODUCT_FORM_DEFAULT = {
  name: '', sku: '', category: '', categoryId: '', price: '', mrp: '', cost: '',
  discount: '', tax: '', unit: 'PCS', hsn: '', description: '',
  trackingType: 'none', company: '', status: 'Active', lowStockThreshold: '5', specs: '',
};
export type ProductForm = typeof PRODUCT_FORM_DEFAULT;

/**
 * INVENTORY-09 (P1-7): before a `genId.generic()`-keyed master-data create,
 * confirm the id is genuinely free. `createDocWithId` is `setDoc(...,
 * {merge:true})` — a colliding id would SILENTLY MERGE into an existing
 * record instead of failing. `genId.generic` (`{prefix}-{Date.now()}-{rnd}`)
 * makes a real collision astronomically unlikely, but this guard is the
 * difference between "impossible" and "silently corrupts a record" if it
 * ever happens. Scoped to the master-data entities this phase touches
 * (products / categories / warehouses / vendors) — not a global rewrite of
 * `createDocWithId`.
 */
export async function assertMasterDataIdAvailable(collection: string, id: string, entityLabel: string): Promise<void> {
  const existing = await getOne<{ id: string }>(collection, id).catch(() => null);
  if (existing) {
    throw new Error(`${entityLabel} id collision detected (${id}) — refusing to overwrite an existing record. Please retry.`);
  }
}

/**
 * A Firestore rules PERMISSION_DENIED — as opposed to an application-level
 * throw (a real SKU conflict, a validation error) or a transient network
 * fault. Used to decide whether the Product create/edit path should fall
 * back from its transaction (which reads not-yet-created docs) to a
 * read-free write path on a project whose deployed ruleset predates the
 * `resource == null` guard that firestore.rules in this repo carries.
 */
export function isRulesPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'permission-denied' || code === 'PERMISSION_DENIED') return true;
  const message = String((err as { message?: unknown } | null)?.message ?? err ?? '').toLowerCase();
  return message.includes('permission-denied')
    || message.includes('permission_denied')
    || message.includes('missing or insufficient permissions')
    || message.includes('insufficient permissions');
}

/**
 * INVENTORY-09 (§7) — acquire the SKU lock for a NEW product atomically with
 * the product doc itself. A blank SKU is never locked.
 *
 * CONFIGURED branch — two tiers:
 *  1. PREFERRED: one Firestore transaction (mirrors
 *     `createCustomerProjectionInTransaction`) — the strict guarantee that
 *     two concurrent creates of the same (company, SKU) can never both win.
 *  2. FALLBACK (only when tier 1 is denied by a rules PERMISSION_DENIED):
 *     a best-effort uniqueness check + an atomic write-only `writeBatch`
 *     (no reads at all). This runs on a project whose DEPLOYED ruleset
 *     predates the `resource == null` guard that this repo's
 *     `firestore.rules` carries — that guard is what lets a transaction
 *     `get()` a not-yet-created `products/{id}` / `product_sku_locks/{id}`
 *     without the whole transaction being hard-denied. The fallback's
 *     guarantee class is identical to the DEMO branch and to
 *     customer-phone-lock creation on a pre-guard project. It does NOT mask
 *     a genuine cross-tenant / foreign-group denial — the batch's create is
 *     rejected by the very same rule and still throws.
 *
 * DEMO branch: sequential best-effort (unchanged).
 */
export async function createProductWithSkuLock(
  id: string,
  payload: Record<string, unknown>,
  opts: { companyId: string; groupId: string; actorId: string },
): Promise<void> {
  const normalizedSku = normalizeSku(payload.sku);

  if (!firebaseEnv.isConfigured) {
    await assertMasterDataIdAvailable(COLLECTIONS.PRODUCTS, id, 'Product');
    if (normalizedSku) {
      const lockId = productSkuLockId(opts.companyId, normalizedSku);
      const existingLock = await getOne<ProductSkuLockDoc>(COLLECTIONS.PRODUCT_SKU_LOCKS, lockId).catch(() => null);
      if (lockHeldByAnotherProduct(existingLock, id)) {
        throw new SkuLockConflictError(payload.sku);
      }
      await createDocWithId(COLLECTIONS.PRODUCT_SKU_LOCKS, lockId, {
        id: lockId, companyId: opts.companyId, sku: normalizedSku, productId: id, isDeleted: false,
      });
    }
    await createDocWithId(COLLECTIONS.PRODUCTS, id, { ...payload, id, isDeleted: false });
    return;
  }

  const { doc, runTransaction, writeBatch, getDoc, serverTimestamp } = await import('firebase/firestore');
  const productRef = doc(db, COLLECTIONS.PRODUCTS, id);
  const lockRef = normalizedSku ? doc(db, COLLECTIONS.PRODUCT_SKU_LOCKS, productSkuLockId(opts.companyId, normalizedSku)) : null;
  const idCollisionMessage = `Product id collision detected (${id}) — refusing to overwrite an existing record. Please retry.`;
  const productDoc = () => sanitizeFirestoreData({
    ...payload, id, companyId: opts.companyId, ...(opts.groupId ? { groupId: opts.groupId } : {}),
    createdBy: opts.actorId, updatedBy: opts.actorId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), isDeleted: false,
  });
  const lockDoc = () => sanitizeFirestoreData({
    id: lockRef!.id, companyId: opts.companyId, ...(opts.groupId ? { groupId: opts.groupId } : {}),
    sku: normalizedSku, productId: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    updatedBy: opts.actorId, isDeleted: false,
  });

  try {
    await runTransaction(db, async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (productSnap.exists()) throw new Error(idCollisionMessage);
      if (lockRef) {
        const lockSnap = await transaction.get(lockRef);
        if (lockHeldByAnotherProduct(lockSnap.exists() ? lockSnap.data() as ProductSkuLockDoc : null, id)) {
          throw new SkuLockConflictError(payload.sku);
        }
      }
      transaction.set(productRef, productDoc());
      if (lockRef) transaction.set(lockRef, lockDoc());
    });
    return;
  } catch (err) {
    if (err instanceof SkuLockConflictError) throw err;
    if ((err as { message?: string })?.message === idCollisionMessage) throw err;
    if (!isRulesPermissionDenied(err)) throw err;
    // fall through to the read-free FALLBACK path (see the doc comment).
  }

  if (lockRef) {
    const existingLock = await getDoc(lockRef).catch(() => null);
    if (existingLock?.exists() && lockHeldByAnotherProduct(existingLock.data() as ProductSkuLockDoc, id)) {
      throw new SkuLockConflictError(payload.sku);
    }
  }
  const collisionSnap = await getDoc(productRef).catch(() => null);
  if (collisionSnap?.exists()) throw new Error(idCollisionMessage);

  const batch = writeBatch(db);
  batch.set(productRef, productDoc());
  if (lockRef) batch.set(lockRef, lockDoc());
  await batch.commit();
}

/**
 * INVENTORY-09 (§7) — edit a product, swapping its SKU lock atomically when
 * the SKU changes (mirrors `updateCustomerProjectionWithPhoneLock`): the new
 * lock is validated + claimed and the old lock released in ONE transaction;
 * the product doc write follows (same two-step shape the phone-lock pattern
 * uses). Retaining the SAME sku is a no-op on the lock (no transaction).
 */
export async function updateProductWithSkuLock(
  id: string,
  payload: Record<string, unknown>,
  opts: { companyId: string; actorId: string },
): Promise<void> {
  const existing = await getOne<Product & { sku?: string }>(COLLECTIONS.PRODUCTS, id);
  if (!existing) throw new Error('Product not found');
  const oldSku = normalizeSku(existing.sku);
  const newSku = normalizeSku(payload.sku);

  if (oldSku === newSku) {
    await updateDocById(COLLECTIONS.PRODUCTS, id, payload);
    return;
  }

  if (!firebaseEnv.isConfigured) {
    if (newSku) {
      const lockId = productSkuLockId(opts.companyId, newSku);
      const existingLock = await getOne<ProductSkuLockDoc>(COLLECTIONS.PRODUCT_SKU_LOCKS, lockId).catch(() => null);
      if (lockHeldByAnotherProduct(existingLock, id)) {
        throw new SkuLockConflictError(payload.sku);
      }
      await createDocWithId(COLLECTIONS.PRODUCT_SKU_LOCKS, lockId, { id: lockId, companyId: opts.companyId, sku: newSku, productId: id, isDeleted: false });
    }
    if (oldSku) {
      const oldLockId = productSkuLockId(opts.companyId, oldSku);
      const oldLock = await getOne<ProductSkuLockDoc>(COLLECTIONS.PRODUCT_SKU_LOCKS, oldLockId).catch(() => null);
      if (oldLock && oldLock.productId === id) {
        await updateDocById(COLLECTIONS.PRODUCT_SKU_LOCKS, oldLockId, { isDeleted: true });
      }
    }
    await updateDocById(COLLECTIONS.PRODUCTS, id, payload);
    return;
  }

  const { doc, runTransaction, writeBatch, getDoc, serverTimestamp } = await import('firebase/firestore');
  const nextLockRef = newSku ? doc(db, COLLECTIONS.PRODUCT_SKU_LOCKS, productSkuLockId(opts.companyId, newSku)) : null;
  const oldLockRef = oldSku ? doc(db, COLLECTIONS.PRODUCT_SKU_LOCKS, productSkuLockId(opts.companyId, oldSku)) : null;
  const claimNextLock = (createdAt: unknown) => sanitizeFirestoreData({
    id: nextLockRef!.id, companyId: opts.companyId, sku: newSku, productId: id,
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(), updatedBy: opts.actorId, isDeleted: false,
  });
  const releaseOldLock = () => sanitizeFirestoreData({
    isDeleted: true, releasedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: opts.actorId,
  });
  const oldLockOwnedBySelf = (snap: { exists: () => boolean; data: () => unknown } | null | undefined) =>
    !!snap?.exists() && (snap.data() as ProductSkuLockDoc).productId === id;

  try {
    await runTransaction(db, async (transaction) => {
      const nextLockSnap = nextLockRef ? await transaction.get(nextLockRef) : null;
      if (nextLockSnap && lockHeldByAnotherProduct(nextLockSnap.exists() ? nextLockSnap.data() as ProductSkuLockDoc : null, id)) {
        throw new SkuLockConflictError(payload.sku);
      }
      const oldLockSnap = oldLockRef ? await transaction.get(oldLockRef) : null;
      if (nextLockRef) {
        transaction.set(nextLockRef, claimNextLock(nextLockSnap?.exists() ? nextLockSnap.data()!.createdAt : undefined), { merge: true });
      }
      if (oldLockRef && oldLockOwnedBySelf(oldLockSnap)) {
        transaction.set(oldLockRef, releaseOldLock(), { merge: true });
      }
    });
  } catch (err) {
    if (err instanceof SkuLockConflictError) throw err;
    if (!isRulesPermissionDenied(err)) throw err;
    // FALLBACK (see createProductWithSkuLock): the deployed ruleset denies the
    // transaction's get() of the not-yet-created new-SKU lock. Best-effort
    // uniqueness check + a read-free atomic writeBatch.
    const nextExisting = nextLockRef ? await getDoc(nextLockRef).catch(() => null) : null;
    if (nextExisting?.exists() && lockHeldByAnotherProduct(nextExisting.data() as ProductSkuLockDoc, id)) {
      throw new SkuLockConflictError(payload.sku);
    }
    const oldExisting = oldLockRef ? await getDoc(oldLockRef).catch(() => null) : null;
    const batch = writeBatch(db);
    if (nextLockRef) {
      batch.set(nextLockRef, claimNextLock(nextExisting?.exists() ? nextExisting.data()!.createdAt : undefined), { merge: true });
    }
    if (oldLockRef && oldLockOwnedBySelf(oldExisting)) {
      batch.set(oldLockRef, releaseOldLock(), { merge: true });
    }
    await batch.commit();
  }

  await updateDocById(COLLECTIONS.PRODUCTS, id, payload);
}

export const UNIT_OPTIONS = UNITS.map(u => ({ label: u, value: u }));

export const TRACKING_OPTIONS = [
  { label: 'No Verification Required (Qty Only)',   value: 'none' },
  { label: 'Barcode Scan Required',                 value: 'barcode' },
  { label: 'Serial Number Required',                value: 'serial' },
  { label: 'Both Barcode & Serial Required',        value: 'barcode_serial' },
];

export function useProducts() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const result = useQuery({
    queryKey: keys.productsRoot,
    queryFn: () => getAll<Product>(COLLECTIONS.PRODUCTS),
    staleTime: 60_000,
  });

  return {
    ...result,
    data: (result.data || []) as Product[],
    loadMore: async () => undefined,
    hasMore: false,
    loadingMore: false,
  };
}

export function useSaveProduct(editId: string | null, onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (data: ProductForm) => {
      const payload = {
        ...data,
        price:    Number(data.price)    || 0,
        mrp:      Number(data.mrp)      || 0,
        cost:     Number(data.cost)     || 0,
        discount: Number(data.discount) || 0,
        tax:      Number(data.tax)      || 0,
        lowStockThreshold: Number(data.lowStockThreshold) || 5,
        specs: data.specs ? (() => { try { return JSON.parse(data.specs); } catch { return {}; } })() : {},
      };
      // RBAC Master Plan Phase 8: resolveWriteCompanyId() — NOT a raw
      // `activeCompanyId || …` — resolves the neutral sentinels ('group',
      // 'all', 'default') to the real target company, exactly like
      // createDoc()/createDocWithId() and every other write path already do.
      // createProductWithSkuLock() stamps this companyId directly inside a
      // raw runTransaction (no re-sanitizing helper in the path), so the
      // literal 'group' sentinel a GroupAdmin's group-view selection now
      // carries would otherwise be persisted and denied by the rules.
      const companyId = resolveWriteCompanyId();
      if (editId) {
        await updateProductWithSkuLock(editId, payload, { companyId, actorId: user.id });
        await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product updated', `Product ${data.name || editId} was updated.`, 'stock', editId, activeCompanyId);
      } else {
        const id = genId.generic('PRD');
        const groupId = resolveWriteGroupId(companyId);
        await createProductWithSkuLock(id, { ...payload, status: data.status || 'Active', photos: (data as any).photos || [] }, { companyId, groupId, actorId: user.id });
        await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product created', `Product ${data.name || id} was created.`, 'stock', id, activeCompanyId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success(editId ? 'Product updated' : 'Product added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteProduct() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (id: string) => {
      const guard = await checkProductDeleteGuard(id);
      if (guard.blocked) throw new Error(guard.reason || 'This product cannot be deleted right now.');
      await deleteDocById(COLLECTIONS.PRODUCTS, id);
      await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Product deleted', `Product ${id} was deleted.`, 'stock', id, activeCompanyId);
    },
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: keys.productsRoot });
      qc.invalidateQueries({ queryKey: keys.productsAll });
      toast.success('Product deleted');
    },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function exportProductsCSV(products: any[]) {
  const rows = [
    ['ID', 'Name', 'SKU', 'Category', 'Price', 'MRP', 'Cost', 'Discount', 'Tax', 'Unit', 'HSN'],
    ...products.map((p: any) => [p.id, p.name, p.sku, p.category, p.price, p.mrp, p.cost, p.discount, p.tax, p.unit, p.hsn]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'products.csv';
  a.click();
  toast.success('Exported!');
}

// ── Stock ────────────────────────────────────────────────────

export const STOCK_FORM_DEFAULT = {
  productId: '', product: '', warehouseId: '', warehouse: '',
  // INVENTORY-10 (§10a/§10b): 'OPENING' -> applyOpeningStock, 'DAMAGE' ->
  // applyDamageWriteOff. 'IN'/'OUT' keep the pre-existing ADJUSTMENT_IN/OUT path.
  type: 'IN' as 'IN' | 'OUT' | 'OPENING' | 'DAMAGE',
  qty: '', unit: 'PCS', reference: '', notes: '',
  // §10b — required only when type === 'DAMAGE'; one of DAMAGE_REASON_CODES.
  damageReasonCode: '',
  date: new Date().toISOString().split('T')[0],
};
export type StockForm = typeof STOCK_FORM_DEFAULT;

function stockErrorMessage(error: any) {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) return 'Permission denied';
  if (lower.includes('active company')) return 'Company missing';
  if (lower.includes('quantity') || lower.includes('product') || lower.includes('warehouse') || lower.includes('insufficient stock')) return message;
  return 'Stock update failed';
}

function stockSummaryKey(row: any) {
  return `${row.companyId || ''}|${row.productId || ''}|${row.warehouseId || ''}`;
}

function canonicalizeStockSummary(rows: any[]) {
  const byKey = new Map<string, any>();
  rows.forEach((row) => {
    const key = stockSummaryKey(row);
    const canonicalId = stockSummaryId(row.companyId, row.productId, row.warehouseId);
    const current = byKey.get(key);
    if (!current || row.id === canonicalId) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

export function useStock() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.stockLedger, queryFn: () => getAll(COLLECTIONS.STOCK_LEDGER), staleTime: 30_000 });
}

export function useStockSummary() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({ queryKey: keys.stock, queryFn: async () => canonicalizeStockSummary(await getAll(COLLECTIONS.STOCK)), staleTime: 30_000 });
}

export function useSaveStockEntry(onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: StockForm) => {
      const qty = Number(data.qty);
      if (!data.productId) throw new Error('Product is required');
      if (!data.warehouseId) throw new Error('Warehouse is required');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be greater than zero');

      // INVENTORY-10 (§10a/§10b): a dedicated Opening Stock / Damage entry
      // routes through the new workflow-layer guards (double-entry block /
      // reason taxonomy + approval threshold) instead of the plain
      // ADJUSTMENT_IN/OUT path below.
      if (data.type === 'OPENING') {
        const { applyOpeningStock } = await import('../services/stockOperationsWorkflow');
        const result = await applyOpeningStock({
          productId: data.productId, warehouseId: data.warehouseId, qty, unit: data.unit, notes: data.notes,
        });
        await notifyRoleUsers(
          ['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Inventory updated',
          `Opening stock entry ${result.ledgerId} was recorded for ${data.product || data.productId}.`,
          'stock', result.ledgerId, activeCompanyId,
        );
        return;
      }
      if (data.type === 'DAMAGE') {
        if (!data.damageReasonCode) throw new Error('A damage reason is required');
        const { applyDamageWriteOff } = await import('../services/stockOperationsWorkflow');
        const result = await applyDamageWriteOff({
          productId: data.productId, warehouseId: data.warehouseId, qty, unit: data.unit,
          reasonCode: data.damageReasonCode as import('../services/stockOperationsWorkflow').DamageReasonCode,
          notes: data.notes,
        });
        await notifyRoleUsers(
          ['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Inventory updated',
          `Damage write-off ${result.ledgerId} was recorded for ${data.product || data.productId}.`,
          'stock', result.ledgerId, activeCompanyId,
        );
        return;
      }

      // INVENTORY-05d: manual Add / Adjust Stock now goes through the shared
      // movement engine — the single stock writer (P1-4). Manual entries have
      // never been idempotent (INVENTORY-00 baseline), so a fresh idempotency
      // key is minted on every submission.
      const { applyStockMovement } = await import('../../../lib/inventory/stockMovementEngine');
      const movementType = data.type === 'OUT' ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
      const reference = String(data.reference || '').trim();
      const reasonCode = reference || String(data.notes || '').trim() || `Manual stock ${String(data.type).toLowerCase()}`;

      // Canonical write-time tenant — never the raw activeCompanyId. In the
      // GroupAdmin 'group' aggregate view the sentinel would otherwise be
      // stamped as the stock summary's companyId (the same leak class
      // useSaveProduct had before Phase 8) and the rules' warehouseActorCan
      // Create/groupAdminCanCreate would deny the movement.
      // resolveWriteCompanyId() resolves the sentinel to the focused real
      // company (sibling included), and applyStockMovement re-derives the
      // authoritative groupId from it.
      const writeCompanyId = resolveWriteCompanyId();

      const result = await applyStockMovement({
        movementType,
        productId: data.productId,
        warehouseId: data.warehouseId,
        qty,
        unit: data.unit,
        sourceType: 'manual',
        sourceId: reference || genId.generic('STK'),
        idempotencyKey: `${movementType}:manual:${genId.generic('STK')}`,
        companyId: writeCompanyId,
        actorId: user.id,
        reasonCode,
        notes: data.notes,
        ledgerExtra: {
          reference, product: data.product || '', warehouse: data.warehouse || '', date: data.date,
        },
      });

      await notifyRoleUsers(
        ['Warehouse', 'Operations'],
        NotificationType.INVENTORY_UPDATED,
        'Inventory updated',
        `Stock ${data.type} entry ${result.ledgerId} was recorded for ${data.product || data.productId}.`,
        'stock',
        result.ledgerId,
        activeCompanyId
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      qc.invalidateQueries({ queryKey: keys.stock });
      toast.success('Stock entry saved');
      onSuccess();
    },
    onError: (e: any) => toast.error(stockErrorMessage(e)),
  });
}

export function useDeleteStockEntry() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.STOCK_LEDGER, id);
      await notifyRoleUsers(['Warehouse', 'Operations'], NotificationType.INVENTORY_UPDATED, 'Inventory entry deleted', `Stock entry ${id} was deleted.`, 'stock', id, activeCompanyId);
    },
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.stockLedger }); toast.success('Entry deleted'); },
    onError:    (e: any) => toast.error(stockErrorMessage(e)),
  });
}

export function exportStockCSV(entries: any[]) {
  const rows = [
    ['Date', 'Product', 'Warehouse', 'Type', 'Qty', 'Unit', 'Reference'],
    ...entries.map((s: any) => [fmtDate(s.createdAt), s.product, s.warehouse, s.type, s.qty, s.unit, s.reference]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'stock.csv';
  a.click();
  toast.success('Exported!');
}
