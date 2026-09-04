import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-10 (§10d) — low-stock alerts. Demo / non-configured branch: the
 * engine's own `applyStockMovement` calls `checkLowStockAndNotify` AFTER its
 * transaction commits.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0, notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []) }));

vi.mock('../../firebase', () => ({
  db: {}, firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products' },
}));
vi.mock('../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' }) } }));
vi.mock('../../workflow', async () => {
  const actual = await vi.importActual<any>('../../workflow');
  return { ...actual, resolveWorkflowCompanyId: () => 'COMP-1', notifyUsers: mocks.notifyUsers, usersByRole: mocks.usersByRole };
});

import { applyStockMovement } from '../stockMovementEngine';
import { checkLowStockAndNotify } from '../lowStockAlerts';

const base = { productId: 'P-1', warehouseId: 'WH-1', unit: 'PCS', sourceType: 'manual', sourceId: 'REQ-1' };

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  mocks.notifyUsers.mockClear();
  mocks.usersByRole.mockClear();
});

describe('INVENTORY-10 — low-stock alerts (§10d)', () => {
  it('fires once when an OUT movement crosses the threshold', async () => {
    col('products')['P-1'] = { id: 'P-1', name: 'Panel', lowStockThreshold: 5 };
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'SEED' });
    mocks.notifyUsers.mockClear();

    // 10 -> 3, crosses below threshold 5
    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 7, sourceType: 'dispatch', sourceId: 'DSP-1' });

    expect(mocks.notifyUsers).toHaveBeenCalledTimes(1);
    const [, , title, body] = mocks.notifyUsers.mock.calls[0];
    expect(title).toMatch(/low stock/i);
    expect(body).toContain('Panel');
    expect(body).toContain('3');
  });

  it('does NOT fire again while stock remains below the threshold', async () => {
    col('products')['P-1'] = { id: 'P-1', name: 'Panel', lowStockThreshold: 5 };
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'SEED' });
    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 7, sourceType: 'dispatch', sourceId: 'DSP-1' }); // 10->3, crosses
    mocks.notifyUsers.mockClear();

    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 1, sourceType: 'dispatch', sourceId: 'DSP-2' }); // 3->2, still below
    expect(mocks.notifyUsers).not.toHaveBeenCalled();
  });

  it('fires again on a SECOND genuine crossing after restocking above the threshold', async () => {
    col('products')['P-1'] = { id: 'P-1', name: 'Panel', lowStockThreshold: 5 };
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'SEED' });
    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 7, sourceType: 'dispatch', sourceId: 'DSP-1' }); // 10->3, crosses (1st)
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 20, sourceType: 'goods_receipt', sourceId: 'GRN-1' }); // 3->23, back above
    mocks.notifyUsers.mockClear();

    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 20, sourceType: 'dispatch', sourceId: 'DSP-3' }); // 23->3, crosses (2nd)
    expect(mocks.notifyUsers).toHaveBeenCalledTimes(1);
  });

  it('does not fire for an IN movement (moving away from low stock)', async () => {
    col('products')['P-1'] = { id: 'P-1', name: 'Panel', lowStockThreshold: 5 };
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 2, sourceType: 'opening', sourceId: 'SEED' });
    mocks.notifyUsers.mockClear();
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 3, sourceType: 'goods_receipt', sourceId: 'GRN-2' }); // 2->5
    expect(mocks.notifyUsers).not.toHaveBeenCalled();
  });

  it('does not fire when the product has no threshold configured', async () => {
    col('products')['P-1'] = { id: 'P-1', name: 'Panel' }; // no lowStockThreshold
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'SEED' });
    mocks.notifyUsers.mockClear();
    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 9, sourceType: 'dispatch', sourceId: 'DSP-4' });
    expect(mocks.notifyUsers).not.toHaveBeenCalled();
  });

  it('a notification lookup failure never throws out of the movement call', async () => {
    // no product doc at all -> getOne resolves null -> silently skipped
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'SEED' });
    await expect(applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 9, sourceType: 'dispatch', sourceId: 'DSP-5' }))
      .resolves.toMatchObject({ applied: true });
  });

  it('checkLowStockAndNotify is a pure post-hoc function usable directly on a MovementResult[]', async () => {
    col('products')['P-2'] = { id: 'P-2', name: 'Inverter', lowStockThreshold: 10 };
    await checkLowStockAndNotify([
      { applied: true, movementType: 'DISPATCH_OUT', direction: 'OUT', stockId: 'S', ledgerId: 'L', idempotencyKey: 'K', productId: 'P-2', warehouseId: 'WH-1', companyId: 'COMP-1', qty: 5, onHandBefore: 12, onHandAfter: 7, reservedBefore: 0, reservedAfter: 0, availableAfter: 7 } as any,
    ]);
    expect(mocks.notifyUsers).toHaveBeenCalledTimes(1);
  });
});
