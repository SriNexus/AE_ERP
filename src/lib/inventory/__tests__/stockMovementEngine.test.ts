import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-05a — stock movement engine unit tests (demo / non-configured branch).
 * The real Firestore transaction + current-rules compatibility is proven in
 * stockMovementEngine.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0, getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })) }));

vi.mock('../../firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger' },
}));
vi.mock('../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string) => Object.values(col(c)).map((d) => ({ ...d }))),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../workflow', async () => {
  const actual = await vi.importActual<any>('../../workflow');
  return { ...actual, resolveWorkflowCompanyId: () => 'COMP-1' };
});

import { readFileSync } from 'node:fs';
import { applyStockMovement } from '../stockMovementEngine';
import { buildIdempotencyKey, movementLedgerId } from '../idempotency';
import { MOVEMENT_TYPES, REASON_CODE_REQUIRED } from '../types';

describe('INVENTORY-05a — stockSummaryId consolidation (pure de-dup)', () => {
  it('there is ONE stockSummaryId — useInventory imports it, no local copy', () => {
    const src = readFileSync('src/features/inventory/hooks/useInventory.ts', 'utf8');
    expect(src).toContain("import { stockSummaryId } from '../../../lib/workflow'");
    expect(src).not.toMatch(/function\s+stockSummaryId\s*\(/);
  });

  it('the shared stockSummaryId produces the identical string the local copy did', async () => {
    const { stockSummaryId } = await vi.importActual<any>('../../workflow');
    const localFormula = (c: string, p: string, w: string) => {
      const part = (v: string) => encodeURIComponent(v || 'default');
      return `SUM-${part(c)}-${part(p)}-${part(w)}`;
    };
    for (const [c, p, w] of [['COMP-1', 'P-1', 'WH-1'], ['', 'x', ''], ['a b', 'c/d', 'e:f'], ['C', 'P', 'W']]) {
      expect(stockSummaryId(c, p, w)).toBe(localFormula(c, p, w));
    }
  });
});

const SUM = 'SUM-COMP-1-P-1-WH-1';
const base = { productId: 'P-1', warehouseId: 'WH-1', unit: 'Nos', sourceType: 'manual', sourceId: 'REQ-1' };

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
});

describe('INVENTORY-05a — applyStockMovement (movement + quantities)', () => {
  it('IN movement: creates the summary + one ledger row, onHand 0 -> qty', async () => {
    const r = await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 10, sourceType: 'goods_receipt', sourceId: 'GRN-1', lineKey: 0 });
    expect(r).toMatchObject({ applied: true, direction: 'IN', onHandBefore: 0, onHandAfter: 10, reservedBefore: 0, reservedAfter: 0, availableAfter: 10 });
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 10, availableQty: 10, reservedQty: 0, groupId: 'GRP-1' });
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
  });

  it('OUT movement: onHand decremented, availableQty tracks onHandQty', async () => {
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 10, sourceType: 'opening', sourceId: 'OPN-1' });
    const r = await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 4, sourceType: 'dispatch', sourceId: 'DSP-1', lineKey: 'P-1' });
    expect(r).toMatchObject({ applied: true, direction: 'OUT', onHandBefore: 10, onHandAfter: 6, availableAfter: 6 });
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 6, availableQty: 6 });
    expect(Object.values(col('stock_ledger'))).toHaveLength(2);
  });

  it('INV-1: an OUT below zero is REJECTED and writes nothing', async () => {
    await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 2, sourceType: 'opening', sourceId: 'OPN-1' });
    await expect(applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 5, sourceType: 'dispatch', sourceId: 'DSP-9' }))
      .rejects.toThrow(/Insufficient stock|onHandQty/i);
    expect(col('stock')[SUM].onHandQty).toBe(2);
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
  });

  it('rejects a zero / non-finite quantity', async () => {
    await expect(applyStockMovement({ ...base, movementType: 'ADJUSTMENT_IN', qty: 0, reasonCode: 'x', sourceType: 'manual', sourceId: 'A' })).rejects.toThrow(/greater than zero/);
    await expect(applyStockMovement({ ...base, movementType: 'ADJUSTMENT_IN', qty: Number.NaN, reasonCode: 'x', sourceType: 'manual', sourceId: 'B' })).rejects.toThrow(/finite/);
    await expect(applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: -3, sourceType: 'goods_receipt', sourceId: 'C' })).rejects.toThrow(/greater than zero/);
  });

  it('ADJUSTMENT_*/DAMAGE_OUT/RECONCILE_ADJUST require a reasonCode', async () => {
    for (const mt of REASON_CODE_REQUIRED) {
      await expect(applyStockMovement({ ...base, movementType: mt, qty: 1, sourceType: 'manual', sourceId: `NR-${mt}` })).rejects.toThrow(/reasonCode/);
    }
  });

  it('Phase-05 model: reservedQty stays 0 and availableQty == onHandQty across a run', async () => {
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 20, sourceType: 'goods_receipt', sourceId: 'GRN-A', lineKey: 0 });
    await applyStockMovement({ ...base, movementType: 'DISPATCH_OUT', qty: 5, sourceType: 'dispatch', sourceId: 'DSP-A', lineKey: 'P-1' });
    await applyStockMovement({ ...base, movementType: 'SALES_RETURN_IN', qty: 2, sourceType: 'order_cancel', sourceId: 'ORD-A', lineKey: 'DSP-A:P-1' });
    const s = col('stock')[SUM];
    expect(s.reservedQty).toBe(0);
    expect(s.availableQty).toBe(s.onHandQty);
    expect(s.onHandQty).toBe(17);
  });

  it('every movement type resolves a direction and computes before/after', async () => {
    const IN_TYPES = ['PURCHASE_RECEIPT', 'OPENING_STOCK', 'ADJUSTMENT_IN', 'SALES_RETURN_IN', 'TRANSFER_IN'];
    for (const mt of MOVEMENT_TYPES) {
      for (const k of Object.keys(store)) delete store[k];
      const reservations = mt === 'SALES_RESERVE' || mt === 'SALES_RELEASE';
      const reason = REASON_CODE_REQUIRED.includes(mt) ? { reasonCode: 'r' } : {};
      // seed on-hand so an OUT / a RESERVE / a RELEASE has something to work against
      await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 50, sourceType: 'opening', sourceId: 'SEED', reservationsEnabled: reservations });
      if (mt === 'SALES_RELEASE') {
        await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 5, sourceType: 'proforma_invoice', sourceId: 'PI-x', lineKey: 'L', reservationsEnabled: true });
      }
      const r = await applyStockMovement({ ...base, movementType: mt, qty: 3, sourceType: 'src', sourceId: `S-${mt}`, lineKey: 'L', reservationsEnabled: reservations, ...reason });
      expect(r.applied).toBe(true);
      const expectedDir = mt === 'RECONCILE_ADJUST' ? 'IN' : (IN_TYPES.includes(mt) ? 'IN' : mt === 'SALES_RESERVE' ? 'RESERVE' : mt === 'SALES_RELEASE' ? 'RELEASE' : 'OUT');
      expect(r.direction).toBe(expectedDir);
    }
  });
});

describe('INVENTORY-05a — idempotency (INV-7 / INV-8)', () => {
  it('the same movement applied twice: one stock change, one ledger row', async () => {
    const mv = { ...base, movementType: 'PURCHASE_RECEIPT' as const, qty: 7, sourceType: 'goods_receipt', sourceId: 'GRN-DUP', lineKey: 2 };
    const first = await applyStockMovement(mv);
    const second = await applyStockMovement(mv);
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second).toMatchObject({ onHandBefore: 0, onHandAfter: 7, ledgerId: first.ledgerId });
    expect(col('stock')[SUM].onHandQty).toBe(7);      // NOT 14
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
  });

  it('deterministic + injective ledger id', () => {
    expect(buildIdempotencyKey('DISPATCH_OUT', 'dispatch', 'DSP-1', 'P-1')).toBe('DISPATCH_OUT:dispatch:DSP-1:P-1');
    expect(buildIdempotencyKey('OPENING_STOCK', 'opening', 'OPN-1')).toBe('OPENING_STOCK:opening:OPN-1');
    const a = movementLedgerId('DISPATCH_OUT:dispatch:DSP-1:P-1');
    const b = movementLedgerId('DISPATCH_OUT:dispatch:DSP-1:P-2');
    expect(a).not.toBe(b);
    expect(a.startsWith('STKMV-')).toBe(true);
    expect(a).not.toContain('/');
  });

  it('an explicit idempotencyKey overrides the computed one', async () => {
    const r = await applyStockMovement({ ...base, movementType: 'ADJUSTMENT_IN', qty: 1, reasonCode: 'r', sourceType: 'manual', sourceId: 'x', idempotencyKey: 'ADJUSTMENT_IN:manual:custom-req-123' });
    expect(r.idempotencyKey).toBe('ADJUSTMENT_IN:manual:custom-req-123');
    expect(r.ledgerId).toBe(movementLedgerId('ADJUSTMENT_IN:manual:custom-req-123'));
  });
});

describe('INVENTORY-05a — tenant + ledger shape', () => {
  it('companyId + groupId are stamped on both the summary and the ledger row', async () => {
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 5, sourceType: 'goods_receipt', sourceId: 'GRN-T', lineKey: 0 });
    expect(col('stock')[SUM]).toMatchObject({ companyId: 'COMP-1', groupId: 'GRP-1' });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({ companyId: 'COMP-1', groupId: 'GRP-1', warehouseId: 'WH-1', productId: 'P-1' });
  });

  it('explicit companyId overrides the resolved tenant', async () => {
    const r = await applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty: 1, companyId: 'COMP-OTHER', sourceType: 'opening', sourceId: 'O' });
    expect(r.companyId).toBe('COMP-OTHER');
    expect(col('stock')['SUM-COMP-OTHER-P-1-WH-1']).toBeTruthy();
  });

  it('legacy dual-write: type / referenceType / referenceId / date present alongside movementType / direction', async () => {
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 8, sourceType: 'goods_receipt', sourceId: 'GRN-L', lineKey: 0 });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({
      movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 8,
      onHandBefore: 0, onHandAfter: 8, reservedBefore: 0, reservedAfter: 0,
      idempotencyKey: 'PURCHASE_RECEIPT:goods_receipt:GRN-L:0',
      // legacy
      type: 'IN', referenceType: 'goods_receipt', referenceId: 'GRN-L',
      transactionId: expect.any(String), isDeleted: false,
    });
    expect(row.date).toBeTruthy();
    expect(row.movementAt).toBeTruthy();
  });
});
