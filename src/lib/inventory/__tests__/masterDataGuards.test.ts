import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-09 (§11–§14) — master-data delete guards. READ-ONLY: every test
 * asserts these functions never write anything (spies on createDocWithId /
 * updateDocById / deleteDocById remain uncalled).
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(), updateDocById: vi.fn(), deleteDocById: vi.fn(),
}));

vi.mock('../../firebase', () => ({
  COLLECTIONS: {
    STOCK: 'stock', ORDERS: 'orders', QUOTATIONS: 'quotations', PURCHASE_ORDERS: 'purchase_orders',
    PRODUCTS: 'products', DISPATCH: 'dispatch', GOODS_RECEIPTS: 'goods_receipts', VENDORS: 'vendors',
  },
}));
vi.mock('../../firestore', () => ({
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  createDocWithId: mocks.createDocWithId, updateDocById: mocks.updateDocById, deleteDocById: mocks.deleteDocById,
}));

import {
  checkProductDeleteGuard, checkCategoryDeleteGuard, checkWarehouseDeleteGuard, checkVendorDeleteGuard,
} from '../masterDataGuards';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
});

function assertNoWrites() {
  expect(mocks.createDocWithId).not.toHaveBeenCalled();
  expect(mocks.updateDocById).not.toHaveBeenCalled();
  expect(mocks.deleteDocById).not.toHaveBeenCalled();
}

describe('INVENTORY-09 — product delete guard (§11)', () => {
  it('an empty product (no stock, no open refs) is allowed', async () => {
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
    assertNoWrites();
  });

  it('a product with positive on-hand stock is blocked', async () => {
    col('stock')['S-1'] = { productId: 'P-1', onHandQty: 5, isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/on-hand stock/i);
    assertNoWrites();
  });

  it('zero-stock summary does not block', async () => {
    col('stock')['S-2'] = { productId: 'P-1', onHandQty: 0, isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
  });

  it('an open order referencing the product blocks deletion', async () => {
    col('orders')['O-1'] = { id: 'O-1', status: 'Pending', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/open order/i);
  });

  it('a Delivered/Cancelled order does NOT block (closed)', async () => {
    col('orders')['O-2'] = { id: 'O-2', status: 'Delivered', items: [{ productId: 'P-1' }], isDeleted: false };
    col('orders')['O-3'] = { id: 'O-3', status: 'Cancelled', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
  });

  it('an open quotation referencing the product blocks deletion', async () => {
    col('quotations')['Q-1'] = { id: 'Q-1', status: 'Sent', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/open quotation/i);
  });

  it('a Rejected/Expired/Converted quotation does NOT block', async () => {
    col('quotations')['Q-2'] = { id: 'Q-2', status: 'Rejected', items: [{ productId: 'P-1' }], isDeleted: false };
    col('quotations')['Q-3'] = { id: 'Q-3', status: 'Converted to Order', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
  });

  it('an open purchase order referencing the product blocks deletion', async () => {
    col('purchase_orders')['PO-1'] = { id: 'PO-1', status: 'Sent', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/open purchase order/i);
  });

  it('a Received/Cancelled PO does NOT block', async () => {
    col('purchase_orders')['PO-2'] = { id: 'PO-2', status: 'Received', items: [{ productId: 'P-1' }], isDeleted: false };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
  });

  it('a soft-deleted referencing document does not block', async () => {
    col('orders')['O-4'] = { id: 'O-4', status: 'Pending', items: [{ productId: 'P-1' }], isDeleted: true };
    const r = await checkProductDeleteGuard('P-1');
    expect(r.blocked).toBe(false);
  });
});

describe('INVENTORY-09 — category delete guard (§12)', () => {
  it('a category with no linked products is deletable', async () => {
    const r = await checkCategoryDeleteGuard({ id: 'CAT-1', name: 'Electronics' });
    expect(r.blocked).toBe(false);
    assertNoWrites();
  });

  it('a category linked by categoryId is blocked', async () => {
    col('products')['P-1'] = { id: 'P-1', categoryId: 'CAT-1', category: 'Electronics', isDeleted: false };
    const r = await checkCategoryDeleteGuard({ id: 'CAT-1', name: 'Electronics' });
    expect(r.blocked).toBe(true);
  });

  it('a legacy product linked only by name (no categoryId yet) also blocks', async () => {
    col('products')['P-2'] = { id: 'P-2', category: 'Electronics', isDeleted: false };
    const r = await checkCategoryDeleteGuard({ id: 'CAT-1', name: 'Electronics' });
    expect(r.blocked).toBe(true);
  });

  it('cross-company / unrelated products with a different name do not block', async () => {
    col('products')['P-3'] = { id: 'P-3', category: 'Hardware', isDeleted: false };
    const r = await checkCategoryDeleteGuard({ id: 'CAT-1', name: 'Electronics' });
    expect(r.blocked).toBe(false);
  });
});

describe('INVENTORY-09 — warehouse delete guard (§13)', () => {
  it('an empty warehouse is deletable', async () => {
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(false);
    assertNoWrites();
  });

  it('a warehouse with positive on-hand stock is blocked', async () => {
    col('stock')['S-1'] = { warehouseId: 'WH-1', onHandQty: 3, isDeleted: false };
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/on-hand stock/i);
  });

  it('an open dispatch against the warehouse is blocked', async () => {
    col('dispatch')['D-1'] = { id: 'D-1', warehouseId: 'WH-1', status: 'Dispatched', isDeleted: false };
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/open dispatch/i);
  });

  it('a Closed/Returned dispatch does NOT block', async () => {
    col('dispatch')['D-2'] = { id: 'D-2', warehouseId: 'WH-1', status: 'Closed', isDeleted: false };
    col('dispatch')['D-3'] = { id: 'D-3', warehouseId: 'WH-1', status: 'Returned', isDeleted: false };
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(false);
  });

  it('a GRN against a still-receivable PO blocks (open goods-receipt activity)', async () => {
    col('goods_receipts')['G-1'] = { id: 'G-1', warehouseId: 'WH-1', purchaseOrderId: 'PO-1', isDeleted: false };
    col('purchase_orders')['PO-1'] = { id: 'PO-1', status: 'PartiallyReceived', isDeleted: false };
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/open goods receipt/i);
  });

  it('a warehouse with only completed historical records (Received PO) can still be archived', async () => {
    col('goods_receipts')['G-2'] = { id: 'G-2', warehouseId: 'WH-1', purchaseOrderId: 'PO-2', isDeleted: false };
    col('purchase_orders')['PO-2'] = { id: 'PO-2', status: 'Received', isDeleted: false };
    const r = await checkWarehouseDeleteGuard('WH-1');
    expect(r.blocked).toBe(false);
  });
});

describe('INVENTORY-09 — vendor delete guard (§14)', () => {
  it('a vendor with no purchase orders is deletable', async () => {
    const r = await checkVendorDeleteGuard('V-1');
    expect(r.blocked).toBe(false);
    assertNoWrites();
  });

  it('a vendor with a non-cancelled PO is blocked', async () => {
    col('purchase_orders')['PO-1'] = { id: 'PO-1', vendorId: 'V-1', status: 'Sent', isDeleted: false };
    const r = await checkVendorDeleteGuard('V-1');
    expect(r.blocked).toBe(true);
  });

  it('a vendor whose only PO is Cancelled is deletable — historical PO preserved (not deleted)', async () => {
    col('purchase_orders')['PO-2'] = { id: 'PO-2', vendorId: 'V-1', status: 'Cancelled', isDeleted: false };
    const r = await checkVendorDeleteGuard('V-1');
    expect(r.blocked).toBe(false);
    assertNoWrites();
    expect(col('purchase_orders')['PO-2']).toBeDefined(); // untouched
  });

  it('a vendor with a Received (real, closed) PO is still blocked — historical procurement preserved', async () => {
    col('purchase_orders')['PO-3'] = { id: 'PO-3', vendorId: 'V-1', status: 'Received', isDeleted: false };
    const r = await checkVendorDeleteGuard('V-1');
    expect(r.blocked).toBe(true);
  });
});
