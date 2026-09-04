import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-07 — `markPIAsPaid` reservation trigger (M1). Runs the real movement
 * engine (demo branch) + the real `reserveStockForPaidOrder` orchestration.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', STOCK_RESERVATIONS: 'stock_reservations',
    ORDERS: 'orders', PROFORMA_INVOICES: 'proforma_invoices', PAYMENTS: 'payments', AUDIT_LOGS: 'audit_logs',
  },
}));
vi.mock('../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string, constraints: any[] = []) => {
    let rows = Object.values(col(c)).map((d) => ({ ...d }));
    for (const w of constraints) if (w && w.__where) rows = rows.filter((r: any) => r[w.field] === w.value);
    return rows;
  }),
  genId: { generic: (p = 'ID') => `${p}-${++mocks.counter}`, invoice: () => 'INV-x', payment: () => 'PAY-x' },
  resolveWriteGroupId: () => 'GRP-1',
  resolveWriteCompanyId: () => 'CO-1',
  resolveWriteCompanyCode: () => 'AE-01',
}));
vi.mock('../sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'ACC-1' }, activeCompanyId: 'CO-1', company: { id: 'CO-1' } }) } }));
vi.mock('../workflow', async () => {
  const actual = await vi.importActual<any>('../workflow');
  return {
    ...actual,
    logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []),
    resolveWorkflowCompanyId: () => 'CO-1',
    text: (v: unknown) => (typeof v === 'string' ? v : ''),
  };
});
vi.mock('../documentNumbering', () => ({ getNextDocumentNumber: vi.fn(), resolveDocumentDefaults: vi.fn() }));
vi.mock('firebase/firestore', () => ({ where: (field: string, _op: string, value: unknown) => ({ __where: true, field, value }) }));

import { markPIAsPaid } from '../invoiceWorkflow';
import { applyStockMovement } from '../inventory/stockMovementEngine';

async function seedStock(productId: string, warehouseId: string, qty: number) {
  await applyStockMovement({ movementType: 'OPENING_STOCK', productId, warehouseId, qty, unit: 'PCS', sourceType: 'opening', sourceId: `S-${productId}`, companyId: 'CO-1' });
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
});

describe('INVENTORY-07 — markPIAsPaid reservation trigger', () => {
  it('M1: reserves stock at the order fulfilment warehouse + creates the reservation doc + marks the PI paid', async () => {
    await seedStock('P-1', 'WH-1', 10);
    col('orders')['ORD-1'] = { id: 'ORD-1', companyId: 'CO-1', warehouseId: 'WH-1', items: [{ productId: 'P-1', product: 'Panel', qty: 4, unit: 'PCS' }] };
    col('proforma_invoices')['PI-1'] = { id: 'PI-1', companyId: 'CO-1', orderId: 'ORD-1', customer: 'ACME', items: [{ productId: 'P-1', product: 'Panel', qty: 4, unit: 'PCS' }] };

    const res = await markPIAsPaid('PI-1');

    expect(col('proforma_invoices')['PI-1'].paymentStatus).toBe('Paid');
    expect(col('orders')['ORD-1'].stockBlocked).toBe(true);
    expect(col('orders')['ORD-1'].reservationStatus).toBe('reserved');
    expect(col('orders')['ORD-1'].fulfilmentWarehouseId).toBe('WH-1');
    const summary = Object.values(col('stock'))[0] as any;
    expect(summary).toMatchObject({ onHandQty: 10, reservedQty: 4, availableQty: 6 });
    const rsv = Object.values(col('stock_reservations'))[0] as any;
    expect(rsv).toMatchObject({ orderId: 'ORD-1', piId: 'PI-1', productId: 'P-1', qtyReserved: 4, status: 'active' });
    expect((res as any).reservation.reservedTotal).toBe(4);
  });

  it('M3: short stock reserves the available qty and records order.stockShortfall — payment still succeeds', async () => {
    await seedStock('P-2', 'WH-1', 3);
    col('orders')['ORD-2'] = { id: 'ORD-2', companyId: 'CO-1', warehouseId: 'WH-1', items: [{ productId: 'P-2', product: 'Inverter', qty: 7, unit: 'PCS' }] };
    col('proforma_invoices')['PI-2'] = { id: 'PI-2', companyId: 'CO-1', orderId: 'ORD-2', items: [{ productId: 'P-2', product: 'Inverter', qty: 7, unit: 'PCS' }] };

    await markPIAsPaid('PI-2');

    expect(col('proforma_invoices')['PI-2'].paymentStatus).toBe('Paid');
    expect(col('orders')['ORD-2'].reservationStatus).toBe('partial');
    expect(col('orders')['ORD-2'].stockShortfall).toEqual([
      expect.objectContaining({ productId: 'P-2', requestedQty: 7, reservedQty: 3, shortfallQty: 4 }),
    ]);
    expect((Object.values(col('stock'))[0] as any).reservedQty).toBe(3);
  });

  it('M7: a retried markPIAsPaid does not reserve twice', async () => {
    await seedStock('P-3', 'WH-1', 10);
    col('orders')['ORD-3'] = { id: 'ORD-3', companyId: 'CO-1', warehouseId: 'WH-1', items: [{ productId: 'P-3', qty: 5, unit: 'PCS' }] };
    col('proforma_invoices')['PI-3'] = { id: 'PI-3', companyId: 'CO-1', orderId: 'ORD-3', items: [{ productId: 'P-3', qty: 5, unit: 'PCS' }] };

    await markPIAsPaid('PI-3');
    await markPIAsPaid('PI-3');

    expect(Object.values(col('stock_reservations'))).toHaveLength(1);
    expect((Object.values(col('stock'))[0] as any).reservedQty).toBe(5);
  });

  it('decision 2: no fulfilment warehouse → reservation deferred, payment NOT failed', async () => {
    col('orders')['ORD-4'] = { id: 'ORD-4', companyId: 'CO-1', items: [{ productId: 'P-4', qty: 2, unit: 'PCS' }] };
    col('proforma_invoices')['PI-4'] = { id: 'PI-4', companyId: 'CO-1', orderId: 'ORD-4', items: [{ productId: 'P-4', qty: 2, unit: 'PCS' }] };

    const res = await markPIAsPaid('PI-4');

    expect(col('proforma_invoices')['PI-4'].paymentStatus).toBe('Paid');
    expect(col('orders')['ORD-4'].reservationStatus).toBe('deferred_no_warehouse');
    expect(Object.values(col('stock_reservations'))).toHaveLength(0);
    expect((res as any).reservation.deferred).toBe(true);
  });
});
