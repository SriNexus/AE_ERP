import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-10 — Opening Stock (§10a) + Damage/Write-off (§10b), demo /
 * non-configured engine branch. Real concurrency proof for the opening-stock
 * guard is in stockOperations.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0, role: 'Warehouse' }));

vi.mock('../../../../lib/firebase', () => ({
  db: {}, firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products', WAREHOUSES: 'warehouses' },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'U-1', role: mocks.role }, activeCompanyId: 'CO-1' }) } }));
vi.mock('../../../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../../../lib/workflow');
  return { ...actual, logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []), resolveWorkflowCompanyId: () => 'CO-1' };
});

import { applyOpeningStock, applyDamageWriteOff, DAMAGE_APPROVAL_THRESHOLD_QTY } from '../stockOperationsWorkflow';

const summary = () => Object.values(col('stock'))[0] as any;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  mocks.role = 'Warehouse';
  col('products')['P-1'] = { id: 'P-1', companyId: 'CO-1', name: 'Panel', price: 100, isDeleted: false };
  col('warehouses')['WH-1'] = { id: 'WH-1', companyId: 'CO-1', name: 'Main WH', isDeleted: false };
});

describe('INVENTORY-10 — Opening Stock (§10a)', () => {
  it('records opening stock once', async () => {
    const r = await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 50, unit: 'PCS' });
    expect(r.applied).toBe(true);
    expect(summary()).toMatchObject({ onHandQty: 50, availableQty: 50 });
  });

  it('a second opening-stock entry for the SAME product+warehouse is rejected', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 50, unit: 'PCS' });
    await expect(applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 10, unit: 'PCS' }))
      .rejects.toThrow(/already been recorded/i);
    expect(summary().onHandQty).toBe(50); // unchanged
  });

  it('opening stock for a DIFFERENT warehouse is independent', async () => {
    col('warehouses')['WH-2'] = { id: 'WH-2', companyId: 'CO-1', name: 'Second WH', isDeleted: false };
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 50, unit: 'PCS' });
    const r2 = await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-2', qty: 20, unit: 'PCS' });
    expect(r2.applied).toBe(true);
  });

  it('rejects a deleted / cross-company product', async () => {
    col('products')['P-2'] = { id: 'P-2', companyId: 'CO-OTHER', name: 'Foreign', isDeleted: false };
    await expect(applyOpeningStock({ productId: 'P-2', warehouseId: 'WH-1', qty: 5, unit: 'PCS' }))
      .rejects.toThrow(/different company/i);
  });

  it('rejects a zero/negative quantity', async () => {
    await expect(applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 0, unit: 'PCS' })).rejects.toThrow(/greater than zero/i);
  });
});

describe('INVENTORY-10 — Damage / Write-off (§10b)', () => {
  it('writes off stock with a reason code from the taxonomy', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 100, unit: 'PCS' });
    const r = await applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: 5, unit: 'PCS', reasonCode: 'damaged' });
    expect(r.applied).toBe(true);
    expect(summary().onHandQty).toBe(95);
  });

  it('rejects a reason code outside the fixed taxonomy', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 100, unit: 'PCS' });
    await expect(applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: 5, unit: 'PCS', reasonCode: 'oops' as any }))
      .rejects.toThrow(/reason must be one of/i);
  });

  it('a below-threshold write-off by a non-Admin role succeeds', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 1000, unit: 'PCS' });
    mocks.role = 'Warehouse';
    const r = await applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: 10, unit: 'PCS', reasonCode: 'expired' });
    expect(r.applied).toBe(true);
  });

  it('a write-off ABOVE the qty threshold by a non-Admin role is rejected', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 1000, unit: 'PCS' });
    mocks.role = 'Warehouse';
    await expect(applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: DAMAGE_APPROVAL_THRESHOLD_QTY + 1, unit: 'PCS', reasonCode: 'lost' }))
      .rejects.toThrow(/require Admin approval/i);
  });

  it('the SAME above-threshold write-off by an Admin succeeds', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 1000, unit: 'PCS' });
    mocks.role = 'Admin';
    const r = await applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: DAMAGE_APPROVAL_THRESHOLD_QTY + 1, unit: 'PCS', reasonCode: 'lost' });
    expect(r.applied).toBe(true);
  });

  it('a high-VALUE write-off (price x qty) by a non-Admin is also rejected even under the qty threshold', async () => {
    col('products')['P-1'].price = 100000; // 1 unit already exceeds the value threshold
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 1000, unit: 'PCS' });
    mocks.role = 'Sales';
    await expect(applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: 1, unit: 'PCS', reasonCode: 'theft' }))
      .rejects.toThrow(/require Admin approval/i);
  });

  it('an insufficient-stock write-off is rejected (INV-1, via the engine)', async () => {
    await applyOpeningStock({ productId: 'P-1', warehouseId: 'WH-1', qty: 3, unit: 'PCS' });
    await expect(applyDamageWriteOff({ productId: 'P-1', warehouseId: 'WH-1', qty: 5, unit: 'PCS', reasonCode: 'damaged' }))
      .rejects.toThrow(/Insufficient stock/i);
  });
});
