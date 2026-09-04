import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * goodsReceiptWorkflow.test.ts — INVENTORY-03
 * ==========================================
 * Exercises the FIXED demo/non-configured branch of createGoodsReceipt:
 * deterministic per-line ledger ids, incremental PO receivedQty, over-receipt
 * rejection (INV-13), and double-submit idempotency (P1-1 / J9). The Firestore
 * transaction / concurrency guarantees for the configured branch are proven
 * against the emulator in grnReceiptTransaction.emulator.test.ts.
 */

// ---- in-memory Firestore for the demo branch ----
const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});

const mocks = vi.hoisted(() => ({
  canDo: vi.fn(() => true),
  getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })),
  txnCounter: 0,
}));

vi.mock('../../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    PURCHASE_ORDERS: 'purchase_orders', GOODS_RECEIPTS: 'goods_receipts', WAREHOUSES: 'warehouses',
    STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', PRODUCTS: 'products',
  },
}));
vi.mock('../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.txnCounter}` },
  resolveWriteCompanyId: () => 'COMP-1',
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../lib/permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../lib/stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../../lib/casePropagation', () => ({ propagateCaseIdFromChain: vi.fn() }));
vi.mock('../../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../../lib/workflow');
  return {
    ...actual,
    logActivity: vi.fn(),
    notifyUsers: vi.fn(),
    usersByRole: vi.fn(async () => []),
    resolveWorkflowCompanyId: () => 'COMP-1',
  };
});

import { calculateReceiptState, createGoodsReceipt, goodsReceiptDeterministicId } from './goodsReceiptWorkflow';

const PO_ID = 'PO-1';
function seedPO(overrides: any = {}) {
  col('purchase_orders')[PO_ID] = {
    id: PO_ID, purchaseOrderId: PO_ID, vendorId: 'VEN-1', vendorName: 'Vendor', companyId: 'COMP-1',
    status: 'Sent', statusHistory: [],
    items: [
      { productId: 'P-1', product: 'Panel', qty: 10, unit: 'Nos', receivedQty: 0 },
      { productId: 'P-2', product: 'Inverter', qty: 2, unit: 'Nos', receivedQty: 1 },
    ],
    ...overrides,
  };
}
function seedRefs() {
  col('warehouses')['WH-1'] = { id: 'WH-1', name: 'Main Warehouse', companyId: 'COMP-1', isDeleted: false };
  col('products')['P-1'] = { id: 'P-1', companyId: 'COMP-1', isDeleted: false };
  col('products')['P-2'] = { id: 'P-2', companyId: 'COMP-1', isDeleted: false };
}
const form = (quantities: Record<number, string>) => ({ purchaseOrderId: PO_ID, projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: 'Delivery', quantities });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.txnCounter = 0;
  mocks.canDo.mockReturnValue(true);
  seedPO();
  seedRefs();
});

describe('INVENTORY-03 — goodsReceiptWorkflow (demo branch)', () => {
  it('calculateReceiptState: per-line over-receipt guard vs (ordered - previouslyReceived)', () => {
    const po = { ...col('purchase_orders')[PO_ID] } as any;
    expect(calculateReceiptState(po, { 0: '4' })).toMatchObject({ status: 'PartiallyReceived', items: [{ receivedQty: 4, remainingQty: 6 }, { receivedQty: 1, remainingQty: 1 }] });
    expect(calculateReceiptState(po, { 0: '10', 1: '1' }).status).toBe('Received');
    expect(() => calculateReceiptState(po, { 0: '11' })).toThrow('exceeds remaining');
    expect(() => calculateReceiptState(po, { 1: '2' })).toThrow('exceeds remaining');
  });

  it('J6: full receipt -> one ledger row per line, PO Received, receivedQty == ordered', async () => {
    await createGoodsReceipt(form({ 0: '10', 1: '1' }) as any);
    const po = col('purchase_orders')[PO_ID];
    expect(po.status).toBe('Received');
    expect(po.items[0].receivedQty).toBe(10);
    expect(po.items[1].receivedQty).toBe(2);
    const ledgers = Object.values(col('stock_ledger'));
    expect(ledgers).toHaveLength(2);
    expect(ledgers.every((l: any) => l.type === 'IN')).toBe(true);
    expect(col('stock')[grnStockId('P-1')].availableQty).toBe(10);
    expect(col('stock')[grnStockId('P-1')].onHandQty).toBe(10);
  });

  it('INVENTORY-05b: new GRN ledger rows carry the Phase-05a unified schema + legacy compat fields', async () => {
    await createGoodsReceipt(form({ 0: '4' }) as any);
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({
      movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 4,
      onHandBefore: 0, onHandAfter: 4, reservedBefore: 0, reservedAfter: 0,
      // legacy compat (consumers + reconcileMissingGrnDocs)
      type: 'IN', referenceType: 'GoodsReceipt', purchaseOrderId: PO_ID,
      beforeQty: 0, afterQty: 4, grnLineIndex: 0, grnPreviouslyReceivedQty: 0,
    });
    expect(row.idempotencyKey).toMatch(/^PURCHASE_RECEIPT:goods_receipt:GRN-PO-1-[a-z0-9]+:0$/);
    expect(row.id).toBe(`STKMV-${encodeURIComponent(row.idempotencyKey)}`);
  });

  it('J7: partial then second partial -> receivedQty increments, PO stays PartiallyReceived then Received', async () => {
    await createGoodsReceipt(form({ 0: '4' }) as any);
    let po = col('purchase_orders')[PO_ID];
    expect(po.status).toBe('PartiallyReceived');
    expect(po.items[0].receivedQty).toBe(4);
    // second partial receipt against the moved-on PO
    await createGoodsReceipt(form({ 0: '6', 1: '1' }) as any);
    po = col('purchase_orders')[PO_ID];
    expect(po.items[0].receivedQty).toBe(10);
    expect(po.items[1].receivedQty).toBe(2);
    expect(po.status).toBe('Received');
    expect(col('stock')[grnStockId('P-1')].availableQty).toBe(10);
    expect(Object.values(col('stock_ledger'))).toHaveLength(3);
  });

  it('J8 / INV-13: over-receipt is rejected with no stock mutation', async () => {
    col('purchase_orders')[PO_ID].items[0].receivedQty = 8;
    await expect(createGoodsReceipt(form({ 0: '3' }) as any)).rejects.toThrow(/exceeds remaining|Over-receipt/);
    expect(col('stock')).toEqual({});
    expect(col('stock_ledger')).toEqual({});
    expect(col('purchase_orders')[PO_ID].items[0].receivedQty).toBe(8);
  });

  it('J9 (P1-1): double-submitting the SAME receipt applies stock IN exactly once', async () => {
    await createGoodsReceipt(form({ 0: '4' }) as any);
    // identical request again — deterministic GRN id => second call returns the existing GRN, no new stock
    const grnId = goodsReceiptDeterministicId(PO_ID, [{ lineIndex: 0, previouslyReceivedQty: 0, qty: 4 }]);
    // simulate the client not having refreshed the PO: reset receivedQty to the pre-submit snapshot
    col('purchase_orders')[PO_ID].items[0].receivedQty = 0;
    await createGoodsReceipt(form({ 0: '4' }) as any);
    expect(Object.keys(col('goods_receipts'))).toEqual([grnId]);
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
    expect(col('stock')[grnStockId('P-1')].availableQty).toBe(4);
  });

  it('rejects receipts against non-receivable purchase orders', async () => {
    col('purchase_orders')[PO_ID].status = 'Draft';
    await expect(createGoodsReceipt(form({ 0: '1' }) as any)).rejects.toThrow('Sent or Partially Received');
    expect(col('stock_ledger')).toEqual({});
  });

  it('rejects a receipt when the received product belongs to another company (P1-6 slice)', async () => {
    col('products')['P-1'].companyId = 'COMP-OTHER';
    await expect(createGoodsReceipt(form({ 0: '1' }) as any)).rejects.toThrow('different company');
  });

  it('permission check is client-side canDo (create stock + edit purchase_orders)', async () => {
    mocks.canDo.mockReturnValue(false);
    await expect(createGoodsReceipt(form({ 0: '1' }) as any)).rejects.toThrow('permission');
  });
});

function grnStockId(productId: string) {
  return `SUM-COMP-1-${productId}-WH-1`;
}
