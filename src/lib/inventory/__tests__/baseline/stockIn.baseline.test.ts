/**
 * stockIn.baseline.test.ts — INVENTORY-00 baseline, REWRITTEN for INVENTORY-05d
 * ===========================================================================
 *
 * INVENTORY-00 froze the pre-engine behaviour of `stockWorkflow.stockIn` (its
 * own demo transaction, its own `stockSummaryId`, no idempotency). INVENTORY-05d
 * makes `stockIn` a THIN WRAPPER over the movement engine — the single stock
 * writer (P1-4). This file now characterizes the migrated behaviour (same
 * intentional-expectation-change pattern INVENTORY-01/03 applied to the
 * dispatchOut / grn baselines).
 *
 *   - `stockIn` performs NO transaction of its own — it calls `applyStockMovement`.
 *   - sourceType maps: purchase → PURCHASE_RECEIPT, return → SALES_RETURN_IN,
 *     adjustment → ADJUSTMENT_IN (with a reasonCode).
 *   - `reservedQty` is still only carried forward (P0-3 — Phase 07).
 *   - manual adds are still NOT idempotent (a fresh idempotency key per call
 *     unless an explicit `sourceId` is given).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(async () => []),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  getState: vi.fn(() => ({ user: { id: 'user-1', companyId: 'comp-1' }, activeCompanyId: 'comp-1' })),
  idCounter: 0,
}));

vi.mock('../../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  resolveWriteGroupId: () => 'grp-1',
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}` },
}));
vi.mock('../../../workflow', () => ({
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  usersByRole: mocks.usersByRole,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
  stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}`,
  text: (v: unknown) => (typeof v === 'string' ? v : ''),
}));
vi.mock('../../../sanitizer', () => ({ sanitizeFirestoreData: (x: unknown) => x }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', DISPATCH: 'dispatch', ORDERS: 'orders' },
  firebaseEnv: { isConfigured: false },
}));

import { stockIn } from '../../../stockWorkflow';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.idCounter = 0;
  vi.clearAllMocks();
});

function seedSummary(id: string, availableQty: number, reservedQty = 0) {
  col('stock')[id] = { id, companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty, reservedQty, isDeleted: false };
}

describe('INVENTORY-05d — stockWorkflow.stockIn (via the movement engine)', () => {
  it('increments on-hand and writes a PURCHASE_RECEIPT ledger row', async () => {
    seedSummary('SUM-comp-1-P-1-W-1', 5, 1);
    const r = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 7, unit: 'PCS', sourceType: 'purchase', sourceId: 'PO-1' });
    expect(r).toMatchObject({ stockId: 'SUM-comp-1-P-1-W-1', beforeQty: 5, afterQty: 12 });
    expect(col('stock')['SUM-comp-1-P-1-W-1']).toMatchObject({ onHandQty: 12, availableQty: 12, reservedQty: 1 });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({ movementType: 'PURCHASE_RECEIPT', direction: 'IN', type: 'IN', qty: 7, sourceType: 'purchase', sourceId: 'PO-1' });
  });

  it('BASELINE (P0-3): reservedQty is carried forward UNCHANGED', async () => {
    seedSummary('SUM-comp-1-P-1-W-1', 5, 3);
    await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 10, unit: 'PCS', sourceType: 'purchase' });
    expect(col('stock')['SUM-comp-1-P-1-W-1']).toMatchObject({ onHandQty: 15, reservedQty: 3 });
  });

  it('an adjustment maps to ADJUSTMENT_IN and carries a reasonCode', async () => {
    await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'adjustment', notes: 'cycle count' });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({ movementType: 'ADJUSTMENT_IN', direction: 'IN', reasonCode: 'cycle count' });
  });

  it('a return maps to SALES_RETURN_IN', async () => {
    await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 2, unit: 'PCS', sourceType: 'return', sourceId: 'RET-1' });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({ movementType: 'SALES_RETURN_IN', direction: 'IN' });
  });

  it('NO idempotency for a manual add without an explicit sourceId — two calls, two ledger rows, incremented twice', async () => {
    seedSummary('SUM-comp-1-P-1-W-1', 5, 0);
    const a = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'adjustment', notes: 'x' });
    const b = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'adjustment', notes: 'x' });
    expect(a.afterQty).toBe(9);
    expect(b.afterQty).toBe(13);          // applied a SECOND time (Phase-00 baseline: no idempotency)
    expect(Object.values(col('stock_ledger'))).toHaveLength(2);
  });

  it('an explicit sourceId makes the movement idempotent (engine dedup — improvement over the -00 baseline)', async () => {
    seedSummary('SUM-comp-1-P-1-W-1', 5, 0);
    const a = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'purchase', sourceId: 'PO-DUP' });
    const b = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'purchase', sourceId: 'PO-DUP' });
    expect(a.afterQty).toBe(9);
    expect(b.afterQty).toBe(9);            // no-op
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
  });

  it('validates its inputs (throws before any write)', async () => {
    await expect(stockIn({ productId: '', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('Product is required');
    await expect(stockIn({ productId: 'P-1', warehouseId: '', qty: 1, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('Warehouse is required');
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 0, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('greater than zero');
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: -3, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('greater than zero');
    expect(col('stock_ledger')).toEqual({});
  });

  it('reuses an existing legacy summary doc id for the same (company, product, warehouse) tuple', async () => {
    seedSummary('LEGACY-STK-42', 100, 0);
    col('stock')['LEGACY-STK-42'].id = 'LEGACY-STK-42';
    const r = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'adjustment', notes: 'x' });
    expect(r.stockId).toBe('LEGACY-STK-42');
  });

  it('throws when two non-deleted summaries exist for the same tuple (duplicate-summary guard)', async () => {
    col('stock')['STK-A'] = { id: 'STK-A', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', isDeleted: false, availableQty: 1 };
    col('stock')['STK-B'] = { id: 'STK-B', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', isDeleted: false, availableQty: 1 };
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'adjustment', notes: 'x' }))
      .rejects.toThrow('Duplicate stock summaries');
  });
});
