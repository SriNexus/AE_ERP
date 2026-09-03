/**
 * stockIn.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ==============================================================
 *
 * Freezes the CURRENT behavior of src/lib/stockWorkflow.ts `stockIn()`
 * (the non-Firebase / demo branch — `firebaseEnv.isConfigured === false`).
 *
 * This is characterization only. Where current behavior is a known defect it
 * is asserted here with a `// BASELINE: ...` comment so a later phase can see
 * the "before" state. DO NOT change production behavior to make anything here
 * "better" — that is the job of INVENTORY-01 / 03 / 05.
 *
 * Known-defect coverage in this file:
 *   - P1-1 : stockIn has NO sourceId idempotency — calling it twice with the
 *            same sourceId writes two ledger rows and increments stock twice.
 *   - P0-3 : `reservedQty` is only carried forward, never computed/changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  resolveWriteGroupId: vi.fn(() => 'grp-1'),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(async () => []),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  getState: vi.fn(() => ({ user: { id: 'user-1', companyId: 'comp-1' }, company: { id: 'comp-1' }, activeCompanyId: 'comp-1' })),
  idCounter: 0,
}));

vi.mock('../../../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  resolveWriteGroupId: mocks.resolveWriteGroupId,
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
  firebaseEnv: { isConfigured: false }, // exercise the demo / non-transactional branch
}));

import { stockIn } from '../../../stockWorkflow';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idCounter = 0;
  mocks.getState.mockReturnValue({ user: { id: 'user-1', companyId: 'comp-1' }, company: { id: 'comp-1' }, activeCompanyId: 'comp-1' });
  mocks.resolveWorkflowCompanyId.mockReturnValue('comp-1');
  mocks.resolveWriteGroupId.mockReturnValue('grp-1');
  mocks.getAll.mockResolvedValue([]);
  mocks.getOne.mockResolvedValue({ id: 'SUM-comp-1-P-1-W-1', availableQty: 5, reservedQty: 3 });
});

describe('INVENTORY-00 BASELINE — stockWorkflow.stockIn (demo branch)', () => {
  it('increments the stock summary and appends a matching ledger row', async () => {
    const result = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 7, unit: 'PCS', sourceType: 'purchase', sourceId: 'PO-1' });

    expect(result).toEqual({
      stockId: 'SUM-comp-1-P-1-W-1',
      ledgerId: 'STK-1',
      transactionId: 'TXN-2',
      beforeQty: 5,
      afterQty: 12,
    });

    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(1, 'stock', 'SUM-comp-1-P-1-W-1', expect.objectContaining({
      availableQty: 12,
      productId: 'P-1',
      warehouseId: 'W-1',
      companyId: 'comp-1',
      isDeleted: false,
    }));
    expect(mocks.createDocWithId).toHaveBeenNthCalledWith(2, 'stock_ledger', 'STK-1', expect.objectContaining({
      type: 'IN',
      qty: 7,
      beforeQty: 5,
      afterQty: 12,
      sourceType: 'purchase',
      sourceId: 'PO-1',
      createdBy: 'user-1',
    }));
  });

  it('BASELINE (P0-3): reservedQty is carried forward UNCHANGED — stockIn never touches it', async () => {
    mocks.getOne.mockResolvedValue({ id: 'SUM-comp-1-P-1-W-1', availableQty: 5, reservedQty: 3 });
    await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 10, unit: 'PCS', sourceType: 'purchase' });

    const summaryWrite = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'stock')?.[2] as Record<string, unknown>;
    expect(summaryWrite.reservedQty).toBe(3); // unchanged input value, not recomputed
    expect(summaryWrite.availableQty).toBe(15);
  });

  it('BASELINE (P1-1): NO idempotency — calling stockIn twice with the SAME sourceId increments twice and writes two ledger rows', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'SUM-comp-1-P-1-W-1', availableQty: 5, reservedQty: 0 });
    const first = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'purchase', sourceId: 'DUP-KEY' });
    expect(first.afterQty).toBe(9);

    mocks.getOne.mockResolvedValueOnce({ id: 'SUM-comp-1-P-1-W-1', availableQty: 9, reservedQty: 0 });
    const second = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 4, unit: 'PCS', sourceType: 'purchase', sourceId: 'DUP-KEY' });
    expect(second.afterQty).toBe(13); // BASELINE: applied a SECOND time (should have been a no-op)

    const ledgerWrites = mocks.createDocWithId.mock.calls.filter((c) => c[0] === 'stock_ledger');
    expect(ledgerWrites).toHaveLength(2); // BASELINE: two ledger rows for one logical event
    expect(ledgerWrites.every((c) => (c[2] as Record<string, unknown>).sourceId === 'DUP-KEY')).toBe(true);
  });

  it('validates its inputs (throws before any write)', async () => {
    await expect(stockIn({ productId: '', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('Product is required');
    await expect(stockIn({ productId: 'P-1', warehouseId: '', qty: 1, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('Warehouse is required');
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 0, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('greater than zero');
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: -3, unit: 'PCS', sourceType: 'purchase' })).rejects.toThrow('greater than zero');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('BASELINE: re-uses an existing legacy summary doc-id for the same (company, product, warehouse) tuple', async () => {
    mocks.getAll.mockResolvedValue([{ id: 'LEGACY-STK-42', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', isDeleted: false }]);
    mocks.getOne.mockResolvedValue({ id: 'LEGACY-STK-42', availableQty: 100, reservedQty: 0 });

    const r = await stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'adjustment' });
    expect(r.stockId).toBe('LEGACY-STK-42'); // not the canonical SUM- id
  });

  it('BASELINE: throws when two non-deleted summaries exist for the same tuple (duplicate-summary guard)', async () => {
    mocks.getAll.mockResolvedValue([
      { id: 'STK-A', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', isDeleted: false },
      { id: 'STK-B', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', isDeleted: false },
    ]);
    await expect(stockIn({ productId: 'P-1', warehouseId: 'W-1', qty: 1, unit: 'PCS', sourceType: 'adjustment' }))
      .rejects.toThrow('Duplicate stock summaries');
  });
});
