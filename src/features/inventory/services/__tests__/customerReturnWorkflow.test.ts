import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-10 (§10e) — Customer Return / RMA, demo / non-configured engine
 * branch. Real transaction atomicity + rules are proven in
 * customerReturnTransaction.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../../../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', CUSTOMER_RETURNS: 'customer_returns',
    ORDERS: 'orders', DISPATCH: 'dispatch', PRODUCTS: 'products', WAREHOUSES: 'warehouses',
  },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p = 'ID') => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'U-1', role: 'Warehouse' }, activeCompanyId: 'CO-1' }) } }));
vi.mock('../../../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../../../lib/workflow');
  return { ...actual, logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []), resolveWorkflowCompanyId: () => 'CO-1' };
});

import { applyStockMovement } from '../../../../lib/inventory/stockMovementEngine';
import { createCustomerReturn } from '../customerReturnWorkflow';

const CO = 'CO-1';
const WH = 'WH-1';

function seedRefs() {
  col('products')['P-1'] = { id: 'P-1', companyId: CO, name: 'Panel', isDeleted: false };
  col('warehouses')[WH] = { id: WH, companyId: CO, name: 'Main WH', isDeleted: false };
  col('orders')['ORD-1'] = { id: 'ORD-1', companyId: CO, isDeleted: false };
  col('dispatch')['DSP-1'] = {
    id: 'DSP-1', companyId: CO, orderId: 'ORD-1', warehouseId: WH, warehouse: 'Main WH',
    items: [{ productId: 'P-1', product: 'Panel', unit: 'PCS', verifiedQty: 10 }],
    isDeleted: false,
  };
}
async function seedStock(productId: string, warehouseId: string, qty: number) {
  await applyStockMovement({ movementType: 'OPENING_STOCK', productId, warehouseId, qty, unit: 'PCS', sourceType: 'opening', sourceId: `S-${warehouseId}-${productId}`, companyId: CO });
}
const summary = (productId: string, warehouseId: string) =>
  Object.values(col('stock')).find((s: any) => s.productId === productId && s.warehouseId === warehouseId) as any;
const ledgerFor = (returnId: string) => Object.values(col('stock_ledger')).filter((r: any) => r.referenceId === returnId) as any[];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  seedRefs();
});

describe('INVENTORY-10 (§10e) — customer return / RMA', () => {
  it('a resellable-only return restocks onHand and creates one SALES_RETURN_IN ledger row', async () => {
    await seedStock('P-1', WH, 50);
    const rec = await createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 3, condition: 'resellable' }] },
      'RET-1'
    );
    expect(rec.status).toBe('processed');
    expect(summary('P-1', WH).onHandQty).toBe(53);
    const rows = ledgerFor('RET-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].movementType).toBe('SALES_RETURN_IN');
    expect(col('customer_returns')['RET-1']).toBeTruthy();
  });

  it('a damaged-condition line restocks then immediately writes off (net onHand unchanged) with BOTH ledger rows', async () => {
    await seedStock('P-1', WH, 50);
    await createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 4, condition: 'damaged', damageReasonCode: 'damaged' }] },
      'RET-2'
    );
    expect(summary('P-1', WH).onHandQty).toBe(50); // +4 return, -4 write-off
    const rows = ledgerFor('RET-2');
    expect(rows.map((r: any) => r.movementType).sort()).toEqual(['DAMAGE_OUT', 'SALES_RETURN_IN']);
  });

  it('a mixed return (one resellable + one damaged line) applies both correctly', async () => {
    col('products')['P-2'] = { id: 'P-2', companyId: CO, name: 'Inverter', isDeleted: false };
    col('dispatch')['DSP-1'].items.push({ productId: 'P-2', product: 'Inverter', unit: 'PCS', verifiedQty: 5 });
    await seedStock('P-1', WH, 50);
    await seedStock('P-2', WH, 20);
    await createCustomerReturn(
      {
        orderId: 'ORD-1', dispatchId: 'DSP-1',
        items: [
          { productId: 'P-1', qty: 2, condition: 'resellable' },
          { productId: 'P-2', qty: 1, condition: 'damaged', damageReasonCode: 'expired' },
        ],
      },
      'RET-3'
    );
    expect(summary('P-1', WH).onHandQty).toBe(52);
    expect(summary('P-2', WH).onHandQty).toBe(20); // +1 -1
    expect(ledgerFor('RET-3')).toHaveLength(3); // 1 return leg + 1 return leg + 1 damage leg
  });

  it('rejects when the dispatch does not belong to the order', async () => {
    col('dispatch')['DSP-1'].orderId = 'ORD-OTHER';
    await expect(createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 1, condition: 'resellable' }] },
      'RET-4'
    )).rejects.toThrow(/does not belong to order/i);
  });

  it('rejects a product that was not part of the dispatch', async () => {
    await expect(createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-NOPE', qty: 1, condition: 'resellable' }] },
      'RET-5'
    )).rejects.toThrow(/was not part of dispatch/i);
  });

  it('rejects a quantity exceeding the dispatched quantity', async () => {
    await expect(createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 999, condition: 'resellable' }] },
      'RET-6'
    )).rejects.toThrow(/exceeds the dispatched quantity/i);
  });

  it('rejects a damaged line with no damage reason', async () => {
    await expect(createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 1, condition: 'damaged' }] },
      'RET-7'
    )).rejects.toThrow(/damage reason is required/i);
  });

  it('rejects a damaged line with an invalid damage reason', async () => {
    await expect(createCustomerReturn(
      { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 1, condition: 'damaged', damageReasonCode: 'oops' as any }] },
      'RET-8'
    )).rejects.toThrow(/reason must be one of/i);
  });

  it('retrying the SAME returnId is idempotent (no double restock)', async () => {
    await seedStock('P-1', WH, 50);
    const input = { orderId: 'ORD-1', dispatchId: 'DSP-1', items: [{ productId: 'P-1', qty: 3, condition: 'resellable' as const }] };
    await createCustomerReturn(input, 'RET-9');
    expect(summary('P-1', WH).onHandQty).toBe(53);
    await createCustomerReturn(input, 'RET-9'); // retry, same id
    expect(summary('P-1', WH).onHandQty).toBe(53); // unchanged
    expect(ledgerFor('RET-9')).toHaveLength(1); // no duplicate row
  });
});
