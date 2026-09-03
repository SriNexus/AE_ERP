/**
 * grn.baseline.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * ===========================================================
 *
 * Freezes the CURRENT behavior of
 * src/features/procurement/services/goodsReceiptWorkflow.ts
 * (`calculateReceiptState`, `createGoodsReceipt`).
 *
 * Characterization only. DO NOT fix anything here.
 *
 * Known-defect coverage:
 *   - P1-1 : each createGoodsReceipt mints a fresh random GRN id, so the
 *            per-line stockIn `sourceId` differs on every call -> re-running
 *            the same receipt applies stock IN again (no idempotency).
 *   - P1-2 : the over-receipt guard reads `previouslyReceivedQty` off the PO
 *            snapshot; PO `items[]` is then written by full replace, so two
 *            concurrent receipts can both pass and the last write wins.
 *   - P1-5 : stockIn per line, THEN the GRN doc, THEN the PO update — three
 *            separate awaited writes, no atomic boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  getOne: vi.fn(),
  updateDocById: vi.fn(),
  stockIn: vi.fn(),
  canDo: vi.fn(() => true),
  logActivity: vi.fn(),
  notifyUsers: vi.fn(),
  usersByRole: vi.fn(async () => []),
  propagateCaseIdFromChain: vi.fn(),
  getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })),
  grnCounter: 0,
}));

vi.mock('../../../firebase', () => ({
  db: {},
  COLLECTIONS: { PURCHASE_ORDERS: 'purchase_orders', GOODS_RECEIPTS: 'goods_receipts', WAREHOUSES: 'warehouses' },
}));
vi.mock('../../../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
  genId: { generic: () => `GRN-${++mocks.grnCounter}` }, // BASELINE: a NEW random id per call
  resolveWriteCompanyId: () => 'COMP-1',
}));
vi.mock('../../../permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../../stockWorkflow', () => ({ stockIn: mocks.stockIn }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../../casePropagation', () => ({ propagateCaseIdFromChain: mocks.propagateCaseIdFromChain }));
vi.mock('../../../workflow', () => ({ logActivity: mocks.logActivity, notifyUsers: mocks.notifyUsers, usersByRole: mocks.usersByRole }));

import { calculateReceiptState, createGoodsReceipt } from '../../../../features/procurement/services/goodsReceiptWorkflow';

const basePO = () => ({
  id: 'PO-1',
  purchaseOrderId: 'PO-1',
  vendorId: 'VEN-1',
  vendorName: 'Vendor',
  companyId: 'COMP-1',
  status: 'Sent',
  statusHistory: [],
  items: [
    { productId: 'P-1', product: 'Panel', qty: 10, unit: 'Nos', receivedQty: 0 },
    { productId: 'P-2', product: 'Inverter', qty: 2, unit: 'Nos', receivedQty: 1 },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grnCounter = 0;
  mocks.canDo.mockReturnValue(true);
  mocks.getOne.mockImplementation(async (col: string) => (col === 'purchase_orders' ? basePO() : { id: 'WH-1', name: 'Main Warehouse' }));
  mocks.stockIn.mockImplementation(async ({ productId }: any) => ({ stockId: `SUM-${productId}`, ledgerId: `LED-${productId}`, transactionId: `TX-${productId}` }));
});

describe('INVENTORY-00 BASELINE — goodsReceiptWorkflow', () => {
  it('calculateReceiptState: per-line over-receipt guard vs (ordered - previouslyReceived)', () => {
    expect(calculateReceiptState(basePO() as any, { 0: '4' })).toMatchObject({
      status: 'PartiallyReceived',
      items: [
        { receivedQty: 4, remainingQty: 6 },
        { receivedQty: 1, remainingQty: 1 },
      ],
    });
    expect(calculateReceiptState(basePO() as any, { 0: '10', 1: '1' }).status).toBe('Received');
    expect(() => calculateReceiptState(basePO() as any, { 0: '11' })).toThrow('exceeds remaining');
    expect(() => calculateReceiptState(basePO() as any, { 1: '2' })).toThrow('exceeds remaining'); // already 1 of 2 received
  });

  it('createGoodsReceipt: stockIn per received line -> GRN doc -> PO full-replace update (three separate writes)', async () => {
    const callOrder: string[] = [];
    mocks.stockIn.mockImplementation(async ({ productId }: any) => { callOrder.push(`stockIn:${productId}`); return { stockId: `SUM-${productId}`, ledgerId: 'L', transactionId: 'T' }; });
    mocks.createDocWithId.mockImplementation(async (col: string) => { callOrder.push(`create:${col}`); });
    mocks.updateDocById.mockImplementation(async (col: string) => { callOrder.push(`update:${col}`); });

    await createGoodsReceipt({ purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: 'Delivery', quantities: { 0: '4', 1: '1' } } as any);

    // BASELINE (P1-5): sequential, no transaction wrapping stock + GRN + PO.
    expect(callOrder).toEqual(['stockIn:P-1', 'stockIn:P-2', 'create:goods_receipts', 'update:purchase_orders']);

    expect(mocks.stockIn).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'P-1', warehouseId: 'WH-1', qty: 4, sourceType: 'purchase',
      sourceId: expect.stringContaining('purchase_order:PO-1:goods_receipt:GRN-1:line:0'),
    }));
    // BASELINE: PO items written by FULL REPLACE (last-write-wins).
    expect(mocks.updateDocById).toHaveBeenCalledWith('purchase_orders', 'PO-1', expect.objectContaining({
      items: expect.any(Array),
      status: 'PartiallyReceived',
    }));
  });

  it('BASELINE (P1-1): re-running the SAME receipt applies stock IN AGAIN — new GRN id => new sourceId, no dedup', async () => {
    const q = { purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: '', quantities: { 0: '4' } } as any;

    await createGoodsReceipt(q);
    await createGoodsReceipt(q); // identical request, submitted again

    expect(mocks.stockIn).toHaveBeenCalledTimes(2); // BASELINE: applied twice
    const sourceIds = mocks.stockIn.mock.calls.map((c) => (c[0] as any).sourceId);
    expect(sourceIds[0]).toContain('goods_receipt:GRN-1');
    expect(sourceIds[1]).toContain('goods_receipt:GRN-2'); // different key -> nothing can dedup it
  });

  it('BASELINE (P1-2): the over-receipt guard reads previouslyReceivedQty off the PO SNAPSHOT — concurrent receipts both see the stale value', async () => {
    // Simulate two receipts started against the same PO snapshot (receivedQty 0
    // on line 0). Both compute remainingBefore = 10 and both pass.
    const snapshot = basePO();
    mocks.getOne.mockImplementation(async (col: string) => (col === 'purchase_orders' ? JSON.parse(JSON.stringify(snapshot)) : { id: 'WH-1', name: 'Main' }));

    const state1 = calculateReceiptState(JSON.parse(JSON.stringify(snapshot)) as any, { 0: '7' });
    const state2 = calculateReceiptState(JSON.parse(JSON.stringify(snapshot)) as any, { 0: '7' });

    // Each in isolation is "valid" (7 <= 10) even though 7 + 7 = 14 > 10 ordered.
    expect(state1.items[0].receivedQty).toBe(7);
    expect(state2.items[0].receivedQty).toBe(7);
    // BASELINE: nothing in this layer prevents the combined over-receipt.
  });

  it('rejects a receipt against a non-receivable PO and does not call stockIn', async () => {
    mocks.getOne.mockImplementation(async (col: string) => (col === 'purchase_orders' ? { ...basePO(), status: 'Draft' } : { id: 'WH-1', name: 'Main' }));
    await expect(
      createGoodsReceipt({ purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: '', quantities: { 0: '1' } } as any),
    ).rejects.toThrow('Sent or Partially Received');
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });

  it('BASELINE: permission check is client-side canDo only (create stock + edit purchase_orders)', async () => {
    mocks.canDo.mockReturnValue(false);
    await expect(
      createGoodsReceipt({ purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: '', quantities: { 0: '1' } } as any),
    ).rejects.toThrow('permission');
  });
});
