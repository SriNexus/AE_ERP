/**
 * cancelOrder.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ===================================================================
 *
 * Freezes the CURRENT behavior of src/lib/stockWorkflow.ts `cancelOrder()`
 * (demo branch — `stockIn` runs for real against mocked firestore).
 *
 * Characterization only. DO NOT fix anything here.
 *
 * Known-defect / structure coverage:
 *   - P2-2 : cancelOrder is a non-atomic multi-step flow (stockIn per item,
 *            then Promise.all dispatch updates, then the order update) and it
 *            does NOT reverse any Proforma / Tax Invoice — it only sets flags.
 *   - idempotency: restoration is keyed on
 *            `CANCEL:{orderId}:{dispatchId}:{productId}` + an existing-return-
 *            ledger scan, so a re-run does not double-restore.
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
  getState: vi.fn(() => ({ user: { id: 'user-1' }, company: { id: 'comp-1' }, activeCompanyId: 'comp-1' })),
  idCounter: 0,
  returnLedgers: [] as any[],
  dispatches: [] as any[],
  order: null as any,
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
  firebaseEnv: { isConfigured: false },
}));

import { cancelOrder } from '../../../stockWorkflow';

const DISPATCHED = () => ({
  id: 'DSP-1', orderId: 'ORD-1', status: 'Dispatched', warehouseId: 'W-1', warehouse: 'Main', isDeleted: false,
  items: [{ productId: 'P-1', unit: 'PCS', verifiedQty: 3 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idCounter = 0;
  mocks.getState.mockReturnValue({ user: { id: 'user-1' }, company: { id: 'comp-1' }, activeCompanyId: 'comp-1' });
  mocks.resolveWorkflowCompanyId.mockReturnValue('comp-1');
  mocks.returnLedgers = [];
  mocks.dispatches = [DISPATCHED()];
  mocks.order = { id: 'ORD-1', customer: 'Customer A', companyId: 'comp-1', status: 'Pending', paidAmount: 500, items: [{ productId: 'P-1', unit: 'PCS', dispatchedQty: 3, pendingQty: 0 }], createdBy: 'creator-1' };

  mocks.getOne.mockImplementation(async (col: string, id: string) => {
    if (col === 'orders' && id === 'ORD-1') return mocks.order;
    if (col === 'stock') return { id, availableQty: 2, reservedQty: 0 };
    return null;
  });
  mocks.getAll.mockImplementation(async (col: string) => {
    if (col === 'dispatch') return mocks.dispatches;
    if (col === 'stock_ledger') return mocks.returnLedgers;
    if (col === 'stock') return [];
    return [];
  });
});

describe('INVENTORY-00 BASELINE — stockWorkflow.cancelOrder', () => {
  it('restores dispatched stock (via stockIn, sourceType "return") and marks the order Cancelled', async () => {
    const result = await cancelOrder('ORD-1', 'Customer request');
    expect(result).toEqual(expect.objectContaining({ orderId: 'ORD-1', refundRequired: true }));

    // stock restored: a return-type IN ledger row keyed CANCEL:ORD-1:DSP-1:P-1
    const returnLedger = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'stock_ledger')?.[2] as Record<string, unknown>;
    expect(returnLedger).toMatchObject({ type: 'IN', sourceType: 'return', sourceId: 'CANCEL:ORD-1:DSP-1:P-1', qty: 3 });

    // dispatch flipped to Returned
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Returned', cancellationOrderId: 'ORD-1' }));

    // order flags
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-1', expect.objectContaining({
      status: 'Cancelled',
      refundRequired: true,
      paymentReconciliationPending: true,
      cancellationStockRestored: true,
    }));
  });

  it('BASELINE (P2-2): cancelOrder touches ONLY orders / dispatch / stock / stock_ledger — it never reads or reverses a PI or tax invoice', async () => {
    await cancelOrder('ORD-1', 'x');
    const collectionsRead = new Set([
      ...mocks.getOne.mock.calls.map((c) => c[0]),
      ...mocks.getAll.mock.calls.map((c) => c[0]),
    ]);
    const collectionsWritten = new Set([
      ...mocks.createDocWithId.mock.calls.map((c) => c[0]),
      ...mocks.updateDocById.mock.calls.map((c) => c[0]),
    ]);
    expect(collectionsRead.has('proforma_invoices')).toBe(false);
    expect(collectionsRead.has('tax_invoices')).toBe(false);
    expect(collectionsWritten.has('proforma_invoices')).toBe(false);
    expect(collectionsWritten.has('tax_invoices')).toBe(false);
  });

  it('BASELINE (idempotency): a pre-existing return ledger for the same CANCEL key means the item is NOT restored again', async () => {
    mocks.returnLedgers = [{ id: 'STK-OLD', type: 'IN', sourceType: 'return', sourceId: 'CANCEL:ORD-1:DSP-1:P-1' }];
    await cancelOrder('ORD-1', 're-run');
    const newReturnRows = mocks.createDocWithId.mock.calls.filter((c) => c[0] === 'stock_ledger');
    expect(newReturnRows).toHaveLength(0); // already restored -> skipped
    // the order is still (re-)marked cancelled
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-1', expect.objectContaining({ status: 'Cancelled' }));
  });

  it('does NOT restore stock for a dispatch that has not left the warehouse', async () => {
    mocks.dispatches = [{ ...DISPATCHED(), status: 'Pending Verification' }];
    await cancelOrder('ORD-1', 'x');
    expect(mocks.createDocWithId.mock.calls.filter((c) => c[0] === 'stock_ledger')).toHaveLength(0);
  });

  it('throws when the order is already cancelled', async () => {
    mocks.order = { ...mocks.order, status: 'Cancelled' };
    await expect(cancelOrder('ORD-1')).rejects.toThrow('already cancelled');
  });

  it('throws when the order does not exist', async () => {
    mocks.getOne.mockImplementation(async () => null);
    await expect(cancelOrder('NOPE')).rejects.toThrow('not found');
  });

  it('BASELINE (P2-2 non-atomic): stock restore, dispatch updates, and the order update are separate awaited steps', async () => {
    const seq: string[] = [];
    mocks.createDocWithId.mockImplementation(async (col: string) => { seq.push(`create:${col}`); });
    mocks.updateDocById.mockImplementation(async (col: string) => { seq.push(`update:${col}`); });
    await cancelOrder('ORD-1', 'x');
    // stock summary + ledger writes (from stockIn) come first, then dispatch, then order — no transaction around them.
    expect(seq.indexOf('create:stock_ledger')).toBeLessThan(seq.indexOf('update:dispatch'));
    expect(seq.indexOf('update:dispatch')).toBeLessThan(seq.indexOf('update:orders'));
  });
});
