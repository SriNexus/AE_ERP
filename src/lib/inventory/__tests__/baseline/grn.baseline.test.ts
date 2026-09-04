/**
 * grn.baseline.test.ts — INVENTORY-03 (rewritten from the INVENTORY-00 baseline)
 * ============================================================================
 *
 * INVENTORY-00 froze the BROKEN behavior of goodsReceiptWorkflow
 * (non-idempotent random GRN id, full-replace PO items, no atomic boundary).
 * INVENTORY-03 fixed all three, so this file is rewritten to characterize the
 * FIXED demo-branch behavior — the same intentional-expectation-change pattern
 * INVENTORY-01 applied to dispatchOut.baseline.test.ts.
 *
 *   - P1-1 : deterministic per-line ledger id + deterministic GRN doc id ->
 *            a re-submitted identical receipt is a no-op (no second stock IN).
 *   - P1-2 / INV-13 : PO `receivedQty` is INCREMENTED off the fresh PO, and a
 *            receipt that would push Σ received over ordered is rejected.
 *   - P1-5 : demo branch writes stock (summary + ledger) per line, THEN the PO,
 *            THEN the GRN doc last as the "fully applied" marker (resumable).
 *
 * Full transaction / concurrency proof: grnReceiptTransaction.emulator.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ canDo: vi.fn(() => true), counter: 0 }));

vi.mock('../../../firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: { PURCHASE_ORDERS: 'purchase_orders', GOODS_RECEIPTS: 'goods_receipts', WAREHOUSES: 'warehouses', STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products' },
}));
vi.mock('../../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteCompanyId: () => 'COMP-1',
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../../sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })) } }));
vi.mock('../../../casePropagation', () => ({ propagateCaseIdFromChain: vi.fn() }));
vi.mock('../../../workflow', async () => {
  const actual = await vi.importActual<any>('../../../workflow');
  return { ...actual, logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []), resolveWorkflowCompanyId: () => 'COMP-1' };
});

import { createGoodsReceipt } from '../../../../features/procurement/services/goodsReceiptWorkflow';

const PO_ID = 'PO-1';
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  mocks.canDo.mockReturnValue(true);
  col('purchase_orders')[PO_ID] = {
    id: PO_ID, purchaseOrderId: PO_ID, vendorId: 'VEN-1', vendorName: 'Vendor', companyId: 'COMP-1', status: 'Sent', statusHistory: [],
    items: [{ productId: 'P-1', product: 'Panel', qty: 10, unit: 'Nos', receivedQty: 0 }, { productId: 'P-2', product: 'Inverter', qty: 2, unit: 'Nos', receivedQty: 1 }],
  };
  col('warehouses')['WH-1'] = { id: 'WH-1', name: 'Main', companyId: 'COMP-1', isDeleted: false };
  col('products')['P-1'] = { id: 'P-1', companyId: 'COMP-1', isDeleted: false };
  col('products')['P-2'] = { id: 'P-2', companyId: 'COMP-1', isDeleted: false };
});
const form = (quantities: Record<number, string>) => ({ purchaseOrderId: PO_ID, projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: '', quantities });

describe('INVENTORY-03 FIXED BASELINE — goodsReceiptWorkflow', () => {
  it('P1-5: demo branch writes stock+ledger per line, then PO, then GRN doc last', async () => {
    const order: string[] = [];
    const fs = await import('../../../firestore');
    (fs.createDocWithId as any).mockImplementation(async (c: string, id: string, data: any) => { order.push(`create:${c}`); col(c)[id] = { ...data, id }; });
    (fs.updateDocById as any).mockImplementation(async (c: string, id: string, patch: any) => { order.push(`update:${c}`); col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; });

    await createGoodsReceipt(form({ 0: '4', 1: '1' }) as any);
    expect(order).toEqual([
      'create:stock', 'create:stock_ledger', 'create:stock', 'create:stock_ledger',
      'update:purchase_orders', 'create:goods_receipts',
    ]);
  });

  it('P1-1: re-running the SAME receipt against the SAME PO snapshot does NOT apply stock IN again', async () => {
    await createGoodsReceipt(form({ 0: '4' }) as any);
    col('purchase_orders')[PO_ID].items[0].receivedQty = 0; // client never saw the update
    await createGoodsReceipt(form({ 0: '4' }) as any);
    expect(Object.values(col('stock_ledger'))).toHaveLength(1); // FIXED: applied once
    expect(Object.keys(col('goods_receipts'))).toHaveLength(1);
  });

  it('P1-2 / INV-13: receivedQty is incremented off the fresh PO; combined over-receipt is rejected', async () => {
    await createGoodsReceipt(form({ 0: '7' }) as any);
    expect(col('purchase_orders')[PO_ID].items[0].receivedQty).toBe(7);
    await expect(createGoodsReceipt(form({ 0: '7' }) as any)).rejects.toThrow(/exceeds remaining|Over-receipt/);
    expect(col('purchase_orders')[PO_ID].items[0].receivedQty).toBe(7); // unchanged
  });

  it('rejects a receipt against a non-receivable PO and writes nothing', async () => {
    col('purchase_orders')[PO_ID].status = 'Draft';
    await expect(createGoodsReceipt(form({ 0: '1' }) as any)).rejects.toThrow('Sent or Partially Received');
    expect(col('stock_ledger')).toEqual({});
  });
});
