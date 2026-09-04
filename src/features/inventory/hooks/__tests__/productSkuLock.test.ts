import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-09 — product SKU lock + master-data id-collision guard (demo /
 * non-configured branch). Real Firestore-transaction concurrency is proven in
 * productSkuLock.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../../../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    PRODUCTS: 'products', PRODUCT_CATEGORIES: 'product_categories', PRODUCT_SKU_LOCKS: 'product_sku_locks',
    STOCK: 'stock', ORDERS: 'orders', QUOTATIONS: 'quotations', PURCHASE_ORDERS: 'purchase_orders',
    WAREHOUSES: 'warehouses', DISPATCH: 'dispatch', GOODS_RECEIPTS: 'goods_receipts', VENDORS: 'vendors',
  },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  deleteDocById: vi.fn(async (c: string, id: string) => { col(c)[id] = { ...(col(c)[id] || { id }), isDeleted: true }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p = 'ID') => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
  resolveWriteCompanyId: () => 'CO-1',
  fmtDate: (v: unknown) => String(v || ''),
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/workflow', () => ({ stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}` }));
vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (sel?: any) => (sel ? sel({ activeCompanyId: 'CO-1' }) : { activeCompanyId: 'CO-1' }),
  useCurrentUser: () => ({ id: 'U-1' }),
}));
vi.mock('../../../../lib/notifications', () => ({ notifyRoleUsers: vi.fn() }));

import { createProductWithSkuLock, updateProductWithSkuLock, assertMasterDataIdAvailable } from '../useInventory';

const CO = 'CO-1';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
});

describe('INVENTORY-09 — product SKU lock (§7)', () => {
  it('creates a product + claims its SKU lock', async () => {
    await createProductWithSkuLock('P-1', { name: 'Panel', sku: 'abc-001', price: 100 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    expect(col('products')['P-1']).toMatchObject({ name: 'Panel', sku: 'abc-001' });
    const lock = Object.values(col('product_sku_locks'))[0] as any;
    expect(lock).toMatchObject({ sku: 'ABC-001', productId: 'P-1', isDeleted: false });
  });

  it('blank SKU is allowed — no lock created', async () => {
    await createProductWithSkuLock('P-2', { name: 'No SKU', sku: '', price: 10 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    expect(Object.keys(col('product_sku_locks'))).toHaveLength(0);
  });

  it('duplicate SKU (same company) rejected', async () => {
    await createProductWithSkuLock('P-3', { name: 'A', sku: 'X-1', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    await expect(
      createProductWithSkuLock('P-4', { name: 'B', sku: 'x-1', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' }),
    ).rejects.toThrow(/already used/i);
    expect(col('products')['P-4']).toBeUndefined();
  });

  it('same SKU across different companies is allowed', async () => {
    await createProductWithSkuLock('P-5', { name: 'A', sku: 'SHARED', price: 1 }, { companyId: 'CO-A', groupId: 'GRP-A', actorId: 'U-1' });
    await createProductWithSkuLock('P-6', { name: 'B', sku: 'SHARED', price: 1 }, { companyId: 'CO-B', groupId: 'GRP-B', actorId: 'U-1' });
    expect(col('products')['P-5']).toBeDefined();
    expect(col('products')['P-6']).toBeDefined();
  });

  it('editing a product while retaining its own SKU works (no lock churn)', async () => {
    await createProductWithSkuLock('P-7', { name: 'A', sku: 'KEEP-1', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    await updateProductWithSkuLock('P-7', { name: 'A v2', sku: 'KEEP-1', price: 2 }, { companyId: CO, actorId: 'U-1' });
    expect(col('products')['P-7']).toMatchObject({ name: 'A v2', sku: 'KEEP-1' });
    expect(Object.values(col('product_sku_locks'))).toHaveLength(1);
  });

  it('editing product A to product B\'s SKU is rejected', async () => {
    await createProductWithSkuLock('P-8', { name: 'A', sku: 'AAA', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    await createProductWithSkuLock('P-9', { name: 'B', sku: 'BBB', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    await expect(updateProductWithSkuLock('P-9', { name: 'B', sku: 'AAA', price: 1 }, { companyId: CO, actorId: 'U-1' }))
      .rejects.toThrow(/already used/i);
    expect(col('products')['P-9'].sku).toBe('BBB');
  });

  it('SKU change releases the old lock and claims the new one atomically', async () => {
    await createProductWithSkuLock('P-10', { name: 'A', sku: 'OLD-1', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    await updateProductWithSkuLock('P-10', { name: 'A', sku: 'NEW-1', price: 1 }, { companyId: CO, actorId: 'U-1' });
    const locks = Object.values(col('product_sku_locks')) as any[];
    const oldLock = locks.find((l) => l.sku === 'OLD-1');
    const newLock = locks.find((l) => l.sku === 'NEW-1');
    expect(oldLock).toMatchObject({ isDeleted: true, productId: 'P-10' });
    expect(newLock).toMatchObject({ isDeleted: false, productId: 'P-10' });

    // the released OLD-1 SKU can now be reused by a different product
    await createProductWithSkuLock('P-11', { name: 'C', sku: 'OLD-1', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' });
    expect(col('products')['P-11']).toBeDefined();
  });

  it('a failed create (id collision) leaves no stale lock', async () => {
    col('products')['P-12'] = { id: 'P-12', name: 'Existing' };
    await expect(createProductWithSkuLock('P-12', { name: 'New', sku: 'ZZZ', price: 1 }, { companyId: CO, groupId: 'GRP-1', actorId: 'U-1' }))
      .rejects.toThrow(/collision/i);
    expect(Object.keys(col('product_sku_locks'))).toHaveLength(0);
  });
});

describe('INVENTORY-09 — master-data id collision guard (P1-7, §10)', () => {
  it('a collision cannot silently overwrite/merge an existing master record', async () => {
    col('products')['PRD-EXIST'] = { id: 'PRD-EXIST', name: 'Original', sku: 'ORIG' };
    await expect(assertMasterDataIdAvailable('products', 'PRD-EXIST', 'Product')).rejects.toThrow(/collision/i);
    // the record is untouched
    expect(col('products')['PRD-EXIST']).toMatchObject({ name: 'Original', sku: 'ORIG' });
  });

  it('a genuinely free id passes', async () => {
    await expect(assertMasterDataIdAvailable('products', 'PRD-FREE', 'Product')).resolves.toBeUndefined();
  });
});
