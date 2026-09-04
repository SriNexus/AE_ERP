import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-08 — warehouse transfer workflow (demo / non-configured engine
 * branch). Real Firestore-transaction atomicity + rules are proven in
 * stockTransferTransaction.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../../../../lib/firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', STOCK_TRANSFERS: 'stock_transfers',
    WAREHOUSES: 'warehouses', PRODUCTS: 'products', AUDIT_LOGS: 'audit_logs',
  },
}));
vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string, constraints: any[] = []) => {
    let rows = Object.values(col(c)).map((d) => ({ ...d }));
    for (const w of constraints) if (w && w.__where) rows = rows.filter((r: any) => r[w.field] === w.value);
    return rows;
  }),
  genId: { generic: (p = 'ID') => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../../../lib/sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../../../lib/permissions', () => ({ canDo: () => true }));
vi.mock('../../../../lib/stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'WH-U' }, activeCompanyId: 'CO-1' }) } }));
vi.mock('../../../../lib/workflow', async () => {
  const actual = await vi.importActual<any>('../../../../lib/workflow');
  return {
    ...actual,
    logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []),
    resolveWorkflowCompanyId: () => 'CO-1',
    text: (v: unknown) => (typeof v === 'string' ? v : ''),
  };
});
vi.mock('firebase/firestore', () => ({ where: (field: string, _op: string, value: unknown) => ({ __where: true, field, value }) }));

import { applyStockMovement } from '../../../../lib/inventory/stockMovementEngine';
import { createTransfer, shipTransfer, receiveTransfer, cancelTransfer, listTransfers } from '../warehouseTransferWorkflow';

const CO = 'CO-1';
const WH_A = 'WH-A';
const WH_B = 'WH-B';

function seedRefs() {
  col('warehouses')[WH_A] = { id: WH_A, companyId: CO, name: 'Warehouse A', isDeleted: false };
  col('warehouses')[WH_B] = { id: WH_B, companyId: CO, name: 'Warehouse B', isDeleted: false };
  col('warehouses')['WH-X'] = { id: 'WH-X', companyId: 'CO-OTHER', name: 'Foreign', isDeleted: false };
  col('products')['P-1'] = { id: 'P-1', companyId: CO, name: 'Panel', isDeleted: false };
  col('products')['P-2'] = { id: 'P-2', companyId: CO, name: 'Inverter', isDeleted: false };
  col('products')['P-X'] = { id: 'P-X', companyId: 'CO-OTHER', name: 'Foreign product', isDeleted: false };
}
async function seedStock(productId: string, warehouseId: string, qty: number) {
  await applyStockMovement({ movementType: 'OPENING_STOCK', productId, warehouseId, qty, unit: 'PCS', sourceType: 'opening', sourceId: `S-${warehouseId}-${productId}`, companyId: CO });
}
const summary = (productId: string, warehouseId: string) => Object.values(col('stock')).find((s: any) => s.productId === productId && s.warehouseId === warehouseId) as any;
const ledgerFor = (transferId: string) => Object.values(col('stock_ledger')).filter((r: any) => r.transferId === transferId) as any[];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
  seedRefs();
});

describe('INVENTORY-08 — basic lifecycle', () => {
  it('1-2: create draft — no stock effect, no ledger', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    expect(t.status).toBe('draft');
    expect(summary('P-1', WH_A).onHandQty).toBe(10);
    expect(Object.keys(col('stock_ledger')).filter((k) => k.includes(t.id))).toHaveLength(0);
  });

  it('3-12: ship then receive — paired TRANSFER_OUT/IN sharing transferId, sum to zero (INV-11)', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });

    await shipTransfer(t.id);
    expect(summary('P-1', WH_A).onHandQty).toBe(5);
    expect(summary('P-1', WH_B)).toBeUndefined();
    const shipped = await listTransfers();
    expect(shipped[0].status).toBe('in_transit');
    const out = ledgerFor(t.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ movementType: 'TRANSFER_OUT', direction: 'OUT', qty: 5, transferId: t.id });

    await receiveTransfer(t.id);
    expect(summary('P-1', WH_A).onHandQty).toBe(5);
    expect(summary('P-1', WH_B).onHandQty).toBe(5);
    const both = ledgerFor(t.id);
    expect(both).toHaveLength(2);
    const net = both.reduce((n, r) => n + (r.direction === 'IN' ? r.qty : -r.qty), 0);
    expect(net).toBe(0); // INV-11
    expect(both.every((r) => r.transferId === t.id)).toBe(true);
    expect((await listTransfers())[0].status).toBe('received');
  });
});

describe('INVENTORY-08 — validation', () => {
  const mk = (over: Partial<Parameters<typeof createTransfer>[0]>) =>
    createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }], ...over });

  it('13: same source/destination rejected', async () => { await expect(mk({ toWarehouseId: WH_A })).rejects.toThrow(/different/i); });
  it('14: cross-company destination rejected', async () => { await expect(mk({ toWarehouseId: 'WH-X' })).rejects.toThrow(/different company|cross-company/i); });
  it('15: unknown warehouse rejected', async () => { await expect(mk({ toWarehouseId: 'WH-NOPE' })).rejects.toThrow(/does not exist/i); });
  it('16: unknown product rejected', async () => { await expect(mk({ items: [{ productId: 'P-NOPE', qty: 1, unit: 'PCS' }] })).rejects.toThrow(/does not exist/i); });
  it('17: wrong-company product rejected', async () => { await expect(mk({ items: [{ productId: 'P-X', qty: 1, unit: 'PCS' }] })).rejects.toThrow(/different company/i); });
  it('18: zero / negative quantity rejected', async () => {
    await expect(mk({ items: [{ productId: 'P-1', qty: 0, unit: 'PCS' }] })).rejects.toThrow(/greater than zero/i);
    await expect(mk({ items: [{ productId: 'P-1', qty: -3, unit: 'PCS' }] })).rejects.toThrow(/greater than zero/i);
  });

  it('19: insufficient source stock — ship rejected', async () => {
    await seedStock('P-1', WH_A, 2);
    const t = await mk({ items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    await expect(shipTransfer(t.id)).rejects.toThrow(/Insufficient stock|Cannot ship/i);
    expect(summary('P-1', WH_A).onHandQty).toBe(2); // unchanged
    expect((await listTransfers())[0].status).toBe('draft');
  });

  it('20: a multi-item ship where one line is short commits NOTHING (demo branch atomicity)', async () => {
    await seedStock('P-1', WH_A, 10);
    await seedStock('P-2', WH_A, 1);
    const t = await mk({ items: [{ productId: 'P-1', qty: 3, unit: 'PCS' }, { productId: 'P-2', qty: 5, unit: 'PCS' }] });
    await expect(shipTransfer(t.id)).rejects.toThrow();
    expect(summary('P-1', WH_A).onHandQty).toBe(10);
    expect(summary('P-2', WH_A).onHandQty).toBe(1);
    expect(ledgerFor(t.id)).toHaveLength(0);
    expect((await listTransfers())[0].status).toBe('draft');
  });
});

describe('INVENTORY-08 — idempotency', () => {
  it('21: double ship — source reduced once, one TRANSFER_OUT, stays in_transit', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 4, unit: 'PCS' }] });
    await shipTransfer(t.id);
    const r2 = await shipTransfer(t.id);
    expect(r2.alreadyShipped).toBe(true);
    expect(summary('P-1', WH_A).onHandQty).toBe(6);
    expect(ledgerFor(t.id)).toHaveLength(1);
  });

  it('23: double receive — destination increased once, one TRANSFER_IN', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 4, unit: 'PCS' }] });
    await shipTransfer(t.id);
    await receiveTransfer(t.id);
    const r2 = await receiveTransfer(t.id);
    expect(r2.alreadyReceived).toBe(true);
    expect(summary('P-1', WH_B).onHandQty).toBe(4);
    expect(ledgerFor(t.id).filter((r) => r.direction === 'IN')).toHaveLength(1);
  });

  it('25-26: double cancel of an in-transit transfer — one compensating return, no duplicate stock', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 6, unit: 'PCS' }] });
    await shipTransfer(t.id);
    expect(summary('P-1', WH_A).onHandQty).toBe(4);
    await cancelTransfer(t.id, 'lost driver');
    const r2 = await cancelTransfer(t.id, 'again');
    expect(r2.alreadyCancelled).toBe(true);
    expect(summary('P-1', WH_A).onHandQty).toBe(10); // returned exactly once
    expect(ledgerFor(t.id).filter((r) => r.sourceType === 'transfer_cancel')).toHaveLength(1);
    expect((await listTransfers())[0].status).toBe('cancelled');
  });
});

describe('INVENTORY-08 — cancellation', () => {
  it('27: cancel a draft — no movement', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    await cancelTransfer(t.id);
    expect((await listTransfers())[0].status).toBe('cancelled');
    expect(summary('P-1', WH_A).onHandQty).toBe(10);
    expect(ledgerFor(t.id)).toHaveLength(0);
  });

  it('a received transfer cannot be cancelled', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    await shipTransfer(t.id);
    await receiveTransfer(t.id);
    await expect(cancelTransfer(t.id)).rejects.toThrow(/received transfer cannot be cancelled/i);
  });
});

describe('INVENTORY-08 — partial receipt / loss in transit', () => {
  it('32-37: ship 10, receive 8 — source −10, dest +8, 2-unit discrepancy stays visible + is not silently erased', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 10, unit: 'PCS' }] });
    await shipTransfer(t.id);
    const r = await receiveTransfer(t.id, { 'P-1': 8 });
    expect(r.shortfallQty).toBe(2);

    expect(summary('P-1', WH_A).onHandQty).toBe(0);
    expect(summary('P-1', WH_B).onHandQty).toBe(8);

    const rec = (await listTransfers())[0];
    expect(rec.status).toBe('received');
    expect(rec.hasShortfall).toBe(true);
    expect(rec.shortfallQty).toBe(2);
    expect(rec.items[0]).toMatchObject({ shippedQty: 10, receivedQty: 8 });

    // pair does not balance — an identified, explained discrepancy of -2
    const net = ledgerFor(t.id).reduce((n, l) => n + (l.direction === 'IN' ? l.qty : -l.qty), 0);
    expect(net).toBe(-2);
  });

  it('receiving more than shipped is rejected', async () => {
    await seedStock('P-1', WH_A, 10);
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    await shipTransfer(t.id);
    await expect(receiveTransfer(t.id, { 'P-1': 9 })).rejects.toThrow(/exceeds the shipped quantity/i);
  });
});

describe('INVENTORY-08 — reservation compatibility (Phase 07)', () => {
  it('45-46: a TRANSFER_OUT that would drop onHand below reservedQty is rejected (INV-3); availableQty stays valid otherwise', async () => {
    await seedStock('P-1', WH_A, 10);
    // reserve 8 at WH_A
    await applyStockMovement({ movementType: 'SALES_RESERVE', productId: 'P-1', warehouseId: WH_A, qty: 8, unit: 'PCS', sourceType: 'proforma_invoice', sourceId: 'PI-1', lineKey: 'P-1', companyId: CO });
    expect(summary('P-1', WH_A)).toMatchObject({ onHandQty: 10, reservedQty: 8, availableQty: 2 });

    // transfer 5 → would leave onHand 5 < reserved 8 → INV-3 abort
    const t = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 5, unit: 'PCS' }] });
    await expect(shipTransfer(t.id)).rejects.toThrow(/Over-reservation|Cannot ship/i);
    expect(summary('P-1', WH_A)).toMatchObject({ onHandQty: 10, reservedQty: 8, availableQty: 2 });

    // transfer 2 → leaves onHand 8 == reserved 8, available 0 → allowed
    const t2 = await createTransfer({ fromWarehouseId: WH_A, toWarehouseId: WH_B, items: [{ productId: 'P-1', qty: 2, unit: 'PCS' }] });
    await shipTransfer(t2.id);
    expect(summary('P-1', WH_A)).toMatchObject({ onHandQty: 8, reservedQty: 8, availableQty: 0 });
  });
});
