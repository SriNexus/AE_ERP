/**
 * dispatchOut.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ===================================================================
 *
 * Freezes the CURRENT behavior of src/lib/dispatchWorkflow.ts
 * `executeAndVerifyDispatch()` — the stock-OUT path — in the demo branch
 * (`firebaseEnv.isConfigured === false`).
 *
 * Characterization only. DO NOT fix anything here.
 *
 * Known-defect coverage:
 *   - P0-1 : the OUT path is a sequential read -> check -> write -> ledger,
 *            NOT a runTransaction. Under concurrency it oversells / loses
 *            updates. Verifying the same line twice decrements twice.
 *   - P0-3 : `reservedQty` is only carried forward, never consumed.
 *   - P1-6 : no product/warehouse existence check — a missing stock row is
 *            the only signal, surfaced as "Stock not found".
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
  genId: { generic: (p = 'GEN') => `${p}-${++mocks.idCounter}`, dispatch: () => 'DSP-X' },
}));
vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', DISPATCH: 'dispatch', ORDERS: 'orders', PROJECTS: 'projects' },
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
  text: (v: unknown) => (typeof v === 'string' ? v : ''),
  timestampMillis: () => 0,
  usersByRole: mocks.usersByRole,
}));
vi.mock('../../../casePropagation', () => ({ propagateCaseIdFromChain: vi.fn() }));
vi.mock('../../../projectLifecycle', () => ({ buildProjectStageAdvancePatch: () => ({}) }));

import { executeAndVerifyDispatch } from '../../../dispatchWorkflow';

function dispatchDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DSP-1',
    orderId: 'ORD-1',
    companyId: 'comp-1',
    warehouseId: 'W-1',
    warehouse: 'Main',
    customer: 'Customer A',
    status: 'Pending Verification',
    items: [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 0, serials: [] }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idCounter = 0;
  mocks.getState.mockReturnValue({ user: { id: 'user-1' }, activeCompanyId: 'comp-1', company: { id: 'comp-1' } });
  mocks.resolveWriteCompanyId.mockReturnValue('comp-1');
  mocks.stockRows = [{ id: 'SUM-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty: 10, reservedQty: 4 }];
  mocks.getAll.mockImplementation(async (col: string) => {
    if (col === 'stock') return mocks.stockRows;
    if (col === 'dispatch') return []; // assertNoDuplicateSerials scan
    return [];
  });
  mocks.getOne.mockImplementation(async (col: string, id: string) => {
    if (col === 'orders' && id === 'ORD-1') {
      return { id: 'ORD-1', items: [{ productId: 'P-1', qty: 5, dispatchedQty: 0, pendingQty: 5 }] };
    }
    return null;
  });
});

describe('INVENTORY-00 BASELINE — dispatchWorkflow.executeAndVerifyDispatch (stock OUT, demo branch)', () => {
  it('decrements stock availableQty and appends an OUT ledger row (schema B)', async () => {
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);

    expect(mocks.updateDocById).toHaveBeenCalledWith('stock', 'SUM-1', expect.objectContaining({ availableQty: 7 }));
    const ledger = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'stock_ledger')?.[2] as Record<string, unknown>;
    expect(ledger).toMatchObject({
      type: 'OUT',
      qty: 3,
      beforeQty: 10,
      afterQty: 7,
      referenceType: 'Dispatch',
      referenceId: 'DSP-1',
    });
    // BASELINE (schema B): the OUT ledger row carries NO sourceType / sourceId / idempotencyKey.
    expect(ledger.sourceType).toBeUndefined();
    expect(ledger.sourceId).toBeUndefined();
    expect(ledger.idempotencyKey).toBeUndefined();
  });

  it('BASELINE (P0-3): reservedQty is carried forward, never consumed by the OUT', async () => {
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);
    const stockWrite = mocks.updateDocById.mock.calls.find((c) => c[0] === 'stock')?.[2] as Record<string, unknown>;
    expect(stockWrite.reservedQty).toBe(4); // unchanged
    expect(stockWrite.availableQty).toBe(7);
  });

  it('BASELINE (P0-1): the OUT path is sequential getAll -> updateDocById -> createDocWithId — NOT a runTransaction', async () => {
    const order: string[] = [];
    mocks.getAll.mockImplementation(async (col: string) => { order.push(`getAll:${col}`); return col === 'stock' ? mocks.stockRows : []; });
    mocks.updateDocById.mockImplementation(async (col: string) => { order.push(`update:${col}`); });
    mocks.createDocWithId.mockImplementation(async (col: string) => { order.push(`create:${col}`); });

    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 2, serials: [] }]);

    // The stock read, the summary write, and the ledger write are three
    // independent calls with no atomic boundary between them.
    const stockSeq = order.filter((o) => /stock/.test(o));
    expect(stockSeq).toEqual(['getAll:stock', 'update:stock', 'create:stock_ledger']);
  });

  it('BASELINE (P0-1): verifying the SAME dispatch line twice decrements stock TWICE (no idempotency)', async () => {
    // Round 1
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);
    expect(mocks.updateDocById).toHaveBeenCalledWith('stock', 'SUM-1', expect.objectContaining({ availableQty: 7 }));

    // Round 2 — same dispatch, same line. Nothing rejects the repeat; stock drops again.
    mocks.stockRows = [{ id: 'SUM-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty: 7, reservedQty: 4 }];
    await executeAndVerifyDispatch(dispatchDoc({ status: 'Dispatched' }), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 3, serials: [] }]);
    expect(mocks.updateDocById).toHaveBeenCalledWith('stock', 'SUM-1', expect.objectContaining({ availableQty: 4 }));

    const outRows = mocks.createDocWithId.mock.calls.filter((c) => c[0] === 'stock_ledger');
    expect(outRows).toHaveLength(2); // BASELINE: two OUT rows for one logical dispatch line
  });

  it('throws "Insufficient stock" when available < verifiedQty (non-transactional pre-read check)', async () => {
    mocks.stockRows = [{ id: 'SUM-1', companyId: 'comp-1', productId: 'P-1', warehouseId: 'W-1', availableQty: 2, reservedQty: 0 }];
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 5, serials: [] }]),
    ).rejects.toThrow('Insufficient stock');
  });

  it('BASELINE (P1-6): a missing stock row is the only "product/warehouse not valid" signal', async () => {
    mocks.stockRows = [];
    await expect(
      executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-GONE', product: 'Ghost', unit: 'PCS', verifiedQty: 1, serials: [] }]),
    ).rejects.toThrow('Stock not found');
  });

  it('updates the order line dispatchedQty/pendingQty and sets dispatch status', async () => {
    await executeAndVerifyDispatch(dispatchDoc(), [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 5, serials: [] }]);
    expect(mocks.updateDocById).toHaveBeenCalledWith('orders', 'ORD-1', expect.objectContaining({
      items: [expect.objectContaining({ productId: 'P-1', dispatchedQty: 5, pendingQty: 0 })],
      status: 'Dispatched',
    }));
    expect(mocks.updateDocById).toHaveBeenCalledWith('dispatch', 'DSP-1', expect.objectContaining({ status: 'Dispatched' }));
  });
});
