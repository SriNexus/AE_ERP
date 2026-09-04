/**
 * dispatchOut.baseline.test.ts — INVENTORY-00 baseline, UPDATED for INVENTORY-01
 * ============================================================================
 *
 * Pins the behavior of src/lib/dispatchWorkflow.ts `executeAndVerifyDispatch()`
 * (the stock-OUT path) in the demo branch (`firebaseEnv.isConfigured === false`).
 *
 * ── INVENTORY-01 change (P0-1 / P1-6) ────────────────────────────────────────
 * The pre-INVENTORY-01 defects this file used to freeze are now FIXED:
 *   - the OUT path is guarded (status + product/warehouse validation) and, in
 *     the production branch, wrapped in one Firestore transaction;
 *   - the ledger row now has a DETERMINISTIC id (STKOUT-{dispatch}-{product})
 *     and an idempotencyKey, so a retried/duplicate verification is a no-op;
 *   - a dispatch already in a terminal status is rejected.
 * This file now characterizes that fixed behavior (demo branch).
 *
 * Still-deferred (later phases): P1-4 (second manual stock writer), P0-3
 * (reservation — reservedQty is still only carried forward).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  resolveWriteCompanyId: vi.fn(() => 'comp-1'),
  canDo: vi.fn(() => true),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(async () => []),
  resolveWorkflowCompanyId: vi.fn(() => 'comp-1'),
  getState: vi.fn(() => ({ user: { id: 'user-1' }, activeCompanyId: 'comp-1', company: { id: 'comp-1' } })),
  idCounter: 0,
  stockRows: [] as any[],
}));

vi.mock('../../../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  resolveWriteCompanyId: mocks.resolveWriteCompanyId,
  resolveWriteGroupId: () => 'grp-1',
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}`, dispatch: () => 'DSP-X' },
}));
vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', DISPATCH: 'dispatch', ORDERS: 'orders', PROJECTS: 'projects', WAREHOUSES: 'warehouses', PRODUCTS: 'products' },
  firebaseEnv: { isConfigured: false },
}));
vi.mock('../../../sanitizer', () => ({ sanitizeFirestoreData: (x: unknown) => x }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../../permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../../workflow', () => ({
  generateDeliveryOTP: () => '000000',
  hashOTP: async (v: string) => `hash:${v}`,
  isDispatchImmutable: (s: string) => ['Delivered', 'Closed'].includes(s),
  logActivity: mocks.logActivity,
  notifyUsers: mocks.notifyUsers,
  resolveWorkflowCompanyId: mocks.resolveWorkflowCompanyId,
  stockSummaryId: (c: string, p: string, w: string) => `SUM-${c}-${p}-${w}`,
  text: (v: unknown) => (typeof v === 'string' ? v : ''),
  timestampMillis: () => 0,
  usersByRole: mocks.usersByRole,
}));
vi.mock('../../../casePropagation', () => ({ propagateCaseIdFromChain: vi.fn() }));
vi.mock('../../../projectLifecycle', () => ({ buildProjectStageAdvancePatch: () => ({}) }));

import { dispatchOutLedgerId, executeAndVerifyDispatch, TERMINAL_DISPATCH_STATUSES } from '../../../dispatchWorkflow';

function dispatchDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DSP-1', orderId: 'ORD-1', companyId: 'comp-1', warehouseId: 'W-1', warehouse: 'Main', customer: 'Customer A',
    status: 'Pending Verification',
    items: [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 0, serials: [] }],
    ...overrides,
  };
}

/** getOne stub: authoritative dispatch (pending), valid warehouse + product, no prior ledger, no order. */
function stubRefs(opts: { dispatchStatus?: string; ledgerExists?: boolean; product?: any; warehouse?: any; order?: any } = {}) {
  mocks.getOne.mockImplementation(async (col: string, id: string) => {
    if (col === 'dispatch') return { id, status: opts.dispatchStatus ?? 'Pending Verification', companyId: 'comp-1' };
    if (col === 'warehouses') return opts.warehouse === null ? null : (opts.warehouse ?? { id, companyId: 'comp-1', isDeleted: false });
    if (col === 'products') return opts.product === null ? null : (opts.product ?? { id, companyId: 'comp-1', isDeleted: false });
    if (col === 'stock_ledger') return opts.ledgerExists ? { id, type: 'OUT' } : null;
    if (col === 'orders') return opts.order ?? null;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idCounter = 0;
  mocks.getState.mockReturnValue({ user: { id: 'user-1' }, activeCompanyId: 'comp-1', company: { id: 'comp-1' } });
  mocks.resolveWriteCompanyId.mockReturnValue('comp-1');
  mocks.stockRows = [{ id: 'SUM-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty: 10, reservedQty: 4 }];
  mocks.getAll.mockImplementation(async (col: string) => (col === 'stock' ? mocks.stockRows : []));
  stubRefs();
});

describe('INVENTORY-01 BASELINE — dispatchWorkflow.executeAndVerifyDispatch (stock OUT, demo branch)', () => {
  it('INVENTORY-05c: decrements on-hand via the movement engine + appends a DISPATCH_OUT ledger row', async () => {
    const result = await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);

    expect(result).toMatchObject({ dispatchId: 'DSP-1', alreadyVerified: false, applied: [{ productId: 'P-1', appliedQty: 3 }] });
    // INVENTORY-07: availableQty = onHandQty − reservedQty (7 − 4). No matching
    // stock_reservations doc exists, so reservedQty is not consumed here.
    expect(mocks.createDocWithId).toHaveBeenCalledWith('stock', 'SUM-1', expect.objectContaining({ onHandQty: 7, availableQty: 3 }));

    const [ledgerCol, ledgerId, ledger] = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'stock_ledger')!;
    expect(ledgerCol).toBe('stock_ledger');
    expect(ledgerId).toBe(dispatchOutLedgerId('DSP-1', 'P-1'));
    expect(ledgerId).toBe(`STKMV-${encodeURIComponent('DISPATCH_OUT:dispatch:DSP-1:P-1')}`);
    expect(ledger).toMatchObject({
      movementType: 'DISPATCH_OUT', direction: 'OUT', qty: 3, onHandBefore: 10, onHandAfter: 7,
      type: 'OUT', beforeQty: 10, afterQty: 7,
      referenceType: 'Dispatch', referenceId: 'DSP-1',
      sourceType: 'dispatch', sourceId: 'DSP-1',
      idempotencyKey: 'DISPATCH_OUT:dispatch:DSP-1:P-1',
      groupId: 'grp-1',
    });
    // dispatch-doc status flip is the engine participant (atomic with stock)
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Dispatched' }));
  });

  it('INVENTORY-07 (M10): with NO matching reservation, reservedQty is carried forward, availableQty = onHand − reserved', async () => {
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);
    const stockWrite = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'stock')![2] as Record<string, unknown>;
    expect(stockWrite.reservedQty).toBe(4);
    expect(stockWrite.availableQty).toBe(3);
  });

  it('D3 / K3: insufficient stock throws and mutates NOTHING (no stock write, no ledger)', async () => {
    mocks.stockRows = [{ id: 'SUM-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty: 2, reservedQty: 0 }];
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 5, serials: [] }]),
    ).rejects.toThrow('Insufficient stock');
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('stock', expect.anything(), expect.anything());
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('D5 / K5: a prior deterministic ledger row => idempotent no-op, NO second decrement', async () => {
    stubRefs({ ledgerExists: true });
    const result = await executeAndVerifyDispatch(dispatchDoc({ status: 'Pending Verification' }), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);
    expect(result).toMatchObject({ applied: [{ productId: 'P-1', appliedQty: 0 }] });
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('stock', 'SUM-1', expect.objectContaining({ availableQty: expect.any(Number) }));
  });

  it('K5 (status guard): re-verifying an already-terminal dispatch is REJECTED with no mutation', async () => {
    for (const terminal of TERMINAL_DISPATCH_STATUSES) {
      vi.clearAllMocks();
      mocks.getState.mockReturnValue({ user: { id: 'user-1' }, activeCompanyId: 'comp-1', company: { id: 'comp-1' } });
      mocks.resolveWriteCompanyId.mockReturnValue('comp-1');
      mocks.getAll.mockResolvedValue([]);
      stubRefs({ dispatchStatus: terminal });
      await expect(
        executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 1, serials: [] }]),
      ).rejects.toThrow('already been verified');
      expect(mocks.createDocWithId).not.toHaveBeenCalled();
      expect(mocks.updateDocById).not.toHaveBeenCalled();
    }
  });

  it('K6 / P1-6: a soft-deleted product is rejected before any stock mutation', async () => {
    stubRefs({ product: { id: 'P-1', companyId: 'comp-1', isDeleted: true } });
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 1, serials: [] }]),
    ).rejects.toThrow('does not exist or has been removed');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('K6 / P1-6: a missing warehouse is rejected before any stock mutation', async () => {
    stubRefs({ warehouse: null });
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 1, serials: [] }]),
    ).rejects.toThrow('does not exist or has been removed');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('K6 / P1-6: a cross-company product is rejected', async () => {
    stubRefs({ product: { id: 'P-1', companyId: 'comp-2', isDeleted: false } });
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 1, serials: [] }]),
    ).rejects.toThrow('belongs to a different company');
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('K11: a successful verify updates the order line dispatchedQty/pendingQty from the APPLIED qty and sets order status', async () => {
    stubRefs({ order: { id: 'ORD-1', items: [{ productId: 'P-1', qty: 5, dispatchedQty: 0, pendingQty: 5 }] } });
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 5, serials: [] }]);
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-1', expect.objectContaining({
      items: [expect.objectContaining({ productId: 'P-1', dispatchedQty: 5, pendingQty: 0 })],
      status: 'Dispatched',
    }));
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Dispatched' }));
  });

  it('K11: an idempotent no-op verify does NOT re-bump the order dispatched quantity', async () => {
    stubRefs({ ledgerExists: true, order: { id: 'ORD-1', items: [{ productId: 'P-1', qty: 5, dispatchedQty: 5, pendingQty: 0 }] } });
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 5, serials: [] }]);
    // totalApplied === 0 -> the order line update is skipped entirely.
    expect(mocks.updateDocById).not.toHaveBeenCalledWith('orders', expect.anything(), expect.anything());
  });

  it('dispatchOutLedgerId is the movement engine\'s injective id (slashes / spaces encoded)', () => {
    expect(dispatchOutLedgerId('DSP/1', 'P 1')).toBe(`STKMV-${encodeURIComponent('DISPATCH_OUT:dispatch:DSP/1:P 1')}`);
  });
});
