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
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', STOCK_RESERVATIONS: 'stock_reservations' },
}));
vi.mock('../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
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
import { applyStockMovement, applyStockMovements } from '../stockMovementEngine';
import { buildIdempotencyKey, movementLedgerId } from '../idempotency';
import { MOVEMENT_TYPES, REASON_CODE_REQUIRED, type MovementParticipant } from '../types';

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

describe('INVENTORY-07 — SALES_RESERVE / SALES_RELEASE + availableQty semantics', () => {
  const seed = (qty: number) => applyStockMovement({ ...base, movementType: 'OPENING_STOCK', qty, sourceType: 'opening', sourceId: 'SEED' });

  it('M2: SALES_RESERVE bumps reservedQty, leaves onHandQty, drops availableQty', async () => {
    await seed(10);
    const r = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 4, sourceType: 'proforma_invoice', sourceId: 'PI-1', lineKey: 'L1' });
    expect(r).toMatchObject({ applied: true, direction: 'RESERVE', onHandBefore: 10, onHandAfter: 10, reservedBefore: 0, reservedAfter: 4, availableAfter: 6 });
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 10, reservedQty: 4, availableQty: 6 });
  });

  it('M8 / INV-3: a reserve that would exceed onHandQty is REJECTED (no backorder)', async () => {
    await seed(5);
    await expect(applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 8, sourceType: 'proforma_invoice', sourceId: 'PI-2', lineKey: 'L' }))
      .rejects.toThrow(/Over-reservation/);
    expect(col('stock')[SUM]).toMatchObject({ reservedQty: 0 });
  });

  it('M3: clampToStock reserves only what is available, reports the shortfall via reservedAfter', async () => {
    await seed(3);
    const r = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 7, sourceType: 'proforma_invoice', sourceId: 'PI-3', lineKey: 'L', clampToStock: true });
    expect(r.reservedAfter - r.reservedBefore).toBe(3);   // granted
    expect(7 - (r.reservedAfter - r.reservedBefore)).toBe(4); // shortfall
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 3, reservedQty: 3, availableQty: 0 });
  });

  it('clampToStock with zero available is a benign no-op — no ledger row', async () => {
    await seed(2);
    await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 2, sourceType: 'proforma_invoice', sourceId: 'PI-a', lineKey: 'L' });
    const before = Object.keys(col('stock_ledger')).length;
    const r = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 5, sourceType: 'proforma_invoice', sourceId: 'PI-b', lineKey: 'L2', clampToStock: true });
    expect(r.applied).toBe(false);
    expect(Object.keys(col('stock_ledger')).length).toBe(before);
  });

  it('M6: SALES_RELEASE decreases reservedQty, restores availableQty; INV-2 floors at 0 via clamp', async () => {
    await seed(10);
    await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 6, sourceType: 'proforma_invoice', sourceId: 'PI-4', lineKey: 'L' });
    const rel = await applyStockMovement({ ...base, movementType: 'SALES_RELEASE', qty: 10, sourceType: 'order_cancel', sourceId: 'ORD-4', lineKey: 'P-1', clampToStock: true });
    expect(rel.reservedBefore - rel.reservedAfter).toBe(6);   // released only what was held
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 10, reservedQty: 0, availableQty: 10 });
  });

  it('M7: repeat reserve / release is idempotent (deterministic ledger id)', async () => {
    await seed(10);
    const a = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 4, sourceType: 'proforma_invoice', sourceId: 'PI-5', lineKey: 'L' });
    const b = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 4, sourceType: 'proforma_invoice', sourceId: 'PI-5', lineKey: 'L' });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    expect(col('stock')[SUM].reservedQty).toBe(4);
  });

  it('M1/M5: dispatch OUT + reservation consume in ONE batch → onHand−, reserved−, INV-3 holds on the end state', async () => {
    await seed(10);
    await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 6, sourceType: 'proforma_invoice', sourceId: 'PI-6', lineKey: 'L' });
    const batch = await applyStockMovements([
      { ...base, movementType: 'DISPATCH_OUT', qty: 6, sourceType: 'dispatch', sourceId: 'DSP-6', lineKey: 'P-1' },
      { ...base, movementType: 'SALES_RELEASE', qty: 6, sourceType: 'dispatch_consume', sourceId: 'DSP-6', lineKey: 'P-1', clampToStock: true },
    ]);
    expect(batch.applied).toBe(true);
    expect(col('stock')[SUM]).toMatchObject({ onHandQty: 4, reservedQty: 0, availableQty: 4 });
  });

  it('M9: reservationsEnabled:false → the engine skips RESERVE entirely (reservedQty inert, available == onHand, no ledger row)', async () => {
    await seed(10);
    const before = Object.keys(col('stock_ledger')).length;
    const r = await applyStockMovement({ ...base, movementType: 'SALES_RESERVE', qty: 4, sourceType: 'proforma_invoice', sourceId: 'PI-7', lineKey: 'L', reservationsEnabled: false });
    expect(r.applied).toBe(false);
    expect(Object.keys(col('stock_ledger')).length).toBe(before);
    expect(col('stock')[SUM]).toMatchObject({ reservedQty: 0, availableQty: 10, onHandQty: 10 });
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

  it('legacy dual-write: type / referenceType / referenceId / date / beforeQty / afterQty present alongside movementType / direction', async () => {
    await applyStockMovement({ ...base, movementType: 'PURCHASE_RECEIPT', qty: 8, sourceType: 'goods_receipt', sourceId: 'GRN-L', lineKey: 0 });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({
      movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 8,
      onHandBefore: 0, onHandAfter: 8, reservedBefore: 0, reservedAfter: 0,
      idempotencyKey: 'PURCHASE_RECEIPT:goods_receipt:GRN-L:0',
      // legacy
      type: 'IN', referenceType: 'goods_receipt', referenceId: 'GRN-L',
      beforeQty: 0, afterQty: 8,
      transactionId: expect.any(String), isDeleted: false,
    });
    expect(row.date).toBeTruthy();
    expect(row.movementAt).toBeTruthy();
  });

  it('ledgerExtra: caller pass-through fields land on the ledger row (legacy consumer compat)', async () => {
    await applyStockMovement({
      ...base, movementType: 'PURCHASE_RECEIPT', qty: 3, sourceType: 'goods_receipt', sourceId: 'GRN-X', lineKey: 0,
      ledgerExtra: { referenceType: 'GoodsReceipt', purchaseOrderId: 'PO-9', grnLineIndex: 0 },
    });
    const row = Object.values(col('stock_ledger'))[0] as any;
    expect(row).toMatchObject({ referenceType: 'GoodsReceipt', purchaseOrderId: 'PO-9', grnLineIndex: 0, movementType: 'PURCHASE_RECEIPT' });
  });
});

describe('INVENTORY-05a.1 — generic transaction participant', () => {
  const poParticipant = (poId: string, opts: { validate?: (po: any) => boolean | void; onCommit?: (po: any, applied: number) => void } = {}): MovementParticipant<any> => ({
    async read(ctx) { return ctx.get('purchase_orders', poId); },
    validate(po, plan) {
      if (opts.validate) return opts.validate(po);
      // default: over-receipt guard against the authoritative PO
      const appliedQty = plan.filter((p) => p.applied).reduce((s, p) => s + p.qty, 0);
      const ordered = Number(po?.items?.[0]?.qty) || 0;
      const received = Number(po?.items?.[0]?.receivedQty) || 0;
      if (received + appliedQty > ordered + 1e-6) throw new Error('over-receipt');
    },
    commit(po, plan, writer) {
      const applied = plan.filter((p) => p.applied).reduce((s, p) => s + p.qty, 0);
      opts.onCommit?.(po, applied);
      writer.set('purchase_orders', poId, {
        items: [{ ...po.items[0], receivedQty: (Number(po.items[0].receivedQty) || 0) + applied }],
      }, { merge: true });
    },
  });

  beforeEach(() => { store['purchase_orders'] = { 'PO-1': { id: 'PO-1', items: [{ productId: 'P-1', qty: 10, receivedQty: 0 }] } }; });

  it('participant reads an authoritative doc, validates, and commits its OWN write atomically with stock + ledger', async () => {
    const seen: any[] = [];
    const r = await applyStockMovements(
      [{ ...base, movementType: 'PURCHASE_RECEIPT', qty: 6, sourceType: 'goods_receipt', sourceId: 'GRN-P1', lineKey: 0 }],
      poParticipant('PO-1', { onCommit: (po, applied) => seen.push([po.id, applied]) }),
    );
    expect(r).toMatchObject({ applied: true, skipped: false });
    expect(seen).toEqual([['PO-1', 6]]);
    expect(col('stock')[SUM].onHandQty).toBe(6);
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
    expect(col('purchase_orders')['PO-1'].items[0].receivedQty).toBe(6);
  });

  it('participant.validate throwing aborts the whole batch — no stock, no ledger, no participant write', async () => {
    col('purchase_orders')['PO-1'].items[0].receivedQty = 8;
    await expect(applyStockMovements(
      [{ ...base, movementType: 'PURCHASE_RECEIPT', qty: 5, sourceType: 'goods_receipt', sourceId: 'GRN-P2', lineKey: 0 }],
      poParticipant('PO-1'),
    )).rejects.toThrow('over-receipt');
    expect(col('stock')).toEqual({});
    expect(col('stock_ledger')).toEqual({});
    expect(col('purchase_orders')['PO-1'].items[0].receivedQty).toBe(8);
  });

  it('participant.validate returning false skips the batch BENIGNLY — nothing written, results marked skipped', async () => {
    const r = await applyStockMovements(
      [{ ...base, movementType: 'DISPATCH_OUT', qty: 1, sourceType: 'dispatch', sourceId: 'DSP-P', lineKey: 'P-1' }],
      { read: () => ({}), validate: () => false, commit: () => { throw new Error('commit must not run'); } },
    );
    expect(r).toMatchObject({ applied: false, skipped: true });
    expect(r.results[0]).toMatchObject({ applied: false, skipped: true });
    expect(col('stock')).toEqual({});
    expect(col('stock_ledger')).toEqual({});
  });

  it('a participant may NOT write stock / stock_ledger — the engine is the sole owner', async () => {
    await expect(applyStockMovements(
      [{ ...base, movementType: 'PURCHASE_RECEIPT', qty: 1, sourceType: 'goods_receipt', sourceId: 'GRN-P3', lineKey: 0 }],
      { read: () => ({}), commit: (_c, _p, writer) => writer.set('stock', SUM, { onHandQty: 999 }) },
    )).rejects.toThrow(/sole owner|may not write/);
  });

  it('idempotent with a participant: the same movement twice applies stock once and the participant sees applied 0 the second time', async () => {
    const calls: number[] = [];
    const mv = { ...base, movementType: 'PURCHASE_RECEIPT' as const, qty: 4, sourceType: 'goods_receipt', sourceId: 'GRN-P4', lineKey: 0 };
    await applyStockMovements([mv], poParticipant('PO-1', { onCommit: (_po, applied) => calls.push(applied) }));
    // a re-submitted identical receipt (same deterministic idempotency key)
    const second = await applyStockMovements([mv], poParticipant('PO-1', { onCommit: (_po, applied) => calls.push(applied) }));
    expect(second.applied).toBe(false);              // nothing applied the 2nd time
    expect(calls).toEqual([4]);                      // commit only ran when there was something to apply
    expect(col('stock')[SUM].onHandQty).toBe(4);     // NOT 8
    expect(Object.values(col('stock_ledger'))).toHaveLength(1);
    expect(col('purchase_orders')['PO-1'].items[0].receivedQty).toBe(4);  // NOT 8 — idempotent replay is a no-op
  });

  it('multi-line batch: all lines + the participant write commit together (one PO update reflecting every line)', async () => {
    col('purchase_orders')['PO-1'].items = [{ productId: 'P-1', qty: 10, receivedQty: 0 }, { productId: 'P-2', qty: 5, receivedQty: 0 }];
    const participant: MovementParticipant<any> = {
      async read(ctx) { return ctx.get('purchase_orders', 'PO-1'); },
      commit(po, plan, writer) {
        const items = po.items.map((it: any, idx: number) => {
          const add = plan.filter((p) => p.applied && p.input.lineKey === idx).reduce((s, p) => s + p.qty, 0);
          return { ...it, receivedQty: (Number(it.receivedQty) || 0) + add };
        });
        writer.set('purchase_orders', 'PO-1', { items }, { merge: true });
      },
    };
    const r = await applyStockMovements([
      { ...base, productId: 'P-1', movementType: 'PURCHASE_RECEIPT', qty: 10, sourceType: 'goods_receipt', sourceId: 'GRN-M', lineKey: 0 },
      { ...base, productId: 'P-2', movementType: 'PURCHASE_RECEIPT', qty: 5, sourceType: 'goods_receipt', sourceId: 'GRN-M', lineKey: 1 },
    ], participant);
    expect(r.results.map((x) => x.applied)).toEqual([true, true]);
    expect(col('purchase_orders')['PO-1'].items.map((it: any) => it.receivedQty)).toEqual([10, 5]);
    expect(Object.values(col('stock_ledger'))).toHaveLength(2);
  });
});
