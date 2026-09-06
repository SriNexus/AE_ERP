import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-09 follow-up — Product create/edit must succeed against a DEPLOYED
 * Firestore ruleset that predates the `resource == null` guard (i.e. it
 * hard-denies a transaction `get()` of a not-yet-created `products/{id}` or
 * `product_sku_locks/{id}`). `createProductWithSkuLock` / `updateProductWithSkuLock`
 * try the strict transaction first and, ONLY on a rules PERMISSION_DENIED,
 * fall back to a best-effort uniqueness check + a read-free atomic `writeBatch`.
 *
 * This exercises the CONFIGURED branch (`firebaseEnv.isConfigured === true`) with
 * `firebase/firestore` mocked — the emulator suites cover the transaction path
 * against the real rules; this covers the client-side fallback logic.
 */

const fsMocks = vi.hoisted(() => {
  const batch = { set: vi.fn(), commit: vi.fn(async () => undefined) };
  return {
    batch,
    runTransaction: vi.fn(),
    writeBatch: vi.fn(() => batch),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
    counter: 0,
  };
});

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ __col: col, __id: id, id }),
  serverTimestamp: () => ({ __ts: true }),
  runTransaction: fsMocks.runTransaction,
  writeBatch: fsMocks.writeBatch,
  getDoc: fsMocks.getDoc,
}));

vi.mock('../../../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: true },
  COLLECTIONS: { PRODUCTS: 'products', PRODUCT_SKU_LOCKS: 'product_sku_locks' },
}));

const firestoreStore: Record<string, Record<string, any>> = {};
const fcol = (name: string) => (firestoreStore[name] = firestoreStore[name] || {});
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { fcol(c)[id] = { ...(fcol(c)[id] || { id }), ...patch }; }),
  deleteDocById: vi.fn(),
  getOne: vi.fn(async (c: string, id: string) => (fcol(c)[id] ? { ...fcol(c)[id] } : null)),
  getAll: vi.fn(async () => []),
  genId: { generic: (p = 'ID') => `${p}-${++fsMocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
  resolveWriteCompanyId: () => 'CO-1',
  fmtDate: (v: unknown) => String(v || ''),
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/workflow', () => ({ stockSummaryId: () => 'SUM' }));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (sel?: any) => (sel ? sel({ activeCompanyId: 'CO-1' }) : { activeCompanyId: 'CO-1' }),
  useCurrentUser: () => ({ id: 'U-1' }),
}));
vi.mock('../../../../lib/notifications', () => ({ notifyRoleUsers: vi.fn() }));

import { createProductWithSkuLock, updateProductWithSkuLock } from '../useInventory';
import { SkuLockConflictError } from '../../../../lib/inventory/skuLock';

const PERMISSION_DENIED = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const OPTS = { companyId: 'CO-1', groupId: 'GRP-1', actorId: 'U-1' };

beforeEach(() => {
  for (const k of Object.keys(firestoreStore)) delete firestoreStore[k];
  fsMocks.counter = 0;
  fsMocks.batch.set.mockClear();
  fsMocks.batch.commit.mockClear();
  fsMocks.writeBatch.mockClear();
  fsMocks.runTransaction.mockReset();
  fsMocks.getDoc.mockReset();
  fsMocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
});

describe('createProductWithSkuLock — stale-ruleset fallback', () => {
  it('transaction denied by rules -> falls back to a read-free writeBatch that creates product + lock', async () => {
    fsMocks.runTransaction.mockRejectedValue(PERMISSION_DENIED);

    await expect(
      createProductWithSkuLock('PRD-1', { name: 'Panel', sku: 'abc-1', price: 100 }, OPTS),
    ).resolves.toBeUndefined();

    expect(fsMocks.writeBatch).toHaveBeenCalledTimes(1);
    const targets = fsMocks.batch.set.mock.calls.map((c) => (c[0] as any).__col);
    expect(targets).toEqual(expect.arrayContaining(['products', 'product_sku_locks']));
    // the product doc carries the resolved tenant, never a UI sentinel
    const productWrite = fsMocks.batch.set.mock.calls.find((c) => (c[0] as any).__col === 'products')![1] as any;
    expect(productWrite).toMatchObject({ companyId: 'CO-1', groupId: 'GRP-1', createdBy: 'U-1', isDeleted: false });
    expect(fsMocks.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('blank SKU -> fallback writes only the product (no lock)', async () => {
    fsMocks.runTransaction.mockRejectedValue(PERMISSION_DENIED);
    await createProductWithSkuLock('PRD-2', { name: 'No SKU', sku: '', price: 10 }, OPTS);
    const targets = fsMocks.batch.set.mock.calls.map((c) => (c[0] as any).__col);
    expect(targets).toEqual(['products']);
  });

  it('fallback still rejects a SKU already held by another product (lock doc exists and is readable)', async () => {
    fsMocks.runTransaction.mockRejectedValue(PERMISSION_DENIED);
    fsMocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ productId: 'OTHER', isDeleted: false }) });

    await expect(
      createProductWithSkuLock('PRD-3', { name: 'Dup', sku: 'taken', price: 1 }, OPTS),
    ).rejects.toBeInstanceOf(SkuLockConflictError);
    expect(fsMocks.batch.commit).not.toHaveBeenCalled();
  });

  it('a real SKU conflict thrown INSIDE the transaction is surfaced, never retried as a fallback', async () => {
    fsMocks.runTransaction.mockImplementation(async (_db: unknown, fn: any) => {
      const get = vi.fn()
        .mockResolvedValueOnce({ exists: () => false, data: () => undefined })                       // productRef — no collision
        .mockResolvedValueOnce({ exists: () => true, data: () => ({ productId: 'OTHER', isDeleted: false }) }); // lockRef — held by another
      return fn({ get, set: vi.fn() });
    });
    await expect(
      createProductWithSkuLock('PRD-4', { name: 'Dup', sku: 'taken', price: 1 }, OPTS),
    ).rejects.toBeInstanceOf(SkuLockConflictError);
    expect(fsMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('a NON-permission transaction failure is re-thrown, not swallowed by the fallback', async () => {
    fsMocks.runTransaction.mockRejectedValue(new Error('network unavailable'));
    await expect(
      createProductWithSkuLock('PRD-5', { name: 'X', sku: 'y', price: 1 }, OPTS),
    ).rejects.toThrow(/network unavailable/);
    expect(fsMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('transaction SUCCEEDS (ruleset has the guard) -> the fallback is never invoked', async () => {
    fsMocks.runTransaction.mockImplementation(async (_db: unknown, fn: any) => fn({
      get: async () => ({ exists: () => false, data: () => undefined }),
      set: vi.fn(),
    }));
    await createProductWithSkuLock('PRD-6', { name: 'OK', sku: 'ok-1', price: 1 }, OPTS);
    expect(fsMocks.writeBatch).not.toHaveBeenCalled();
  });
});

describe('updateProductWithSkuLock — stale-ruleset fallback (SKU change)', () => {
  beforeEach(() => {
    fcol('products')['PRD-E1'] = { id: 'PRD-E1', name: 'A', sku: 'OLD-1', companyId: 'CO-1' };
  });

  it('SKU change with the transaction denied -> writeBatch claims the new lock + releases the old, product still updated', async () => {
    fsMocks.runTransaction.mockRejectedValue(PERMISSION_DENIED);
    // getDoc(nextLockRef) -> not exists ; getDoc(oldLockRef) -> owned by this product
    fsMocks.getDoc
      .mockResolvedValueOnce({ exists: () => false, data: () => undefined })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ productId: 'PRD-E1', isDeleted: false }) });

    await updateProductWithSkuLock('PRD-E1', { name: 'A', sku: 'NEW-1', price: 2 }, { companyId: 'CO-1', actorId: 'U-1' });

    expect(fsMocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(fsMocks.batch.commit).toHaveBeenCalledTimes(1);
    expect(fcol('products')['PRD-E1']).toMatchObject({ sku: 'NEW-1' });
  });

  it('SKU unchanged -> plain update, no transaction, no batch', async () => {
    await updateProductWithSkuLock('PRD-E1', { name: 'A v2', sku: 'OLD-1', price: 3 }, { companyId: 'CO-1', actorId: 'U-1' });
    expect(fsMocks.runTransaction).not.toHaveBeenCalled();
    expect(fsMocks.writeBatch).not.toHaveBeenCalled();
    expect(fcol('products')['PRD-E1']).toMatchObject({ name: 'A v2' });
  });
});
