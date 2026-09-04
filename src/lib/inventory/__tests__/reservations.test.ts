import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INVENTORY-07 — reservation participants + lifecycle (demo / non-configured
 * branch). Real Firestore-transaction atomicity + rules are proven in
 * stockReservationTransaction.emulator.test.ts.
 */

const store: Record<string, Record<string, any>> = {};
const col = (name: string) => (store[name] = store[name] || {});
const mocks = vi.hoisted(() => ({ counter: 0 }));

vi.mock('../../firebase', () => ({
  db: {},
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: { STOCK: 'stock', STOCK_LEDGER: 'stock_ledger', STOCK_RESERVATIONS: 'stock_reservations' },
}));
vi.mock('../../firestore', () => ({
  createDocWithId: vi.fn(async (c: string, id: string, data: any) => { col(c)[id] = { ...data, id }; }),
  updateDocById: vi.fn(async (c: string, id: string, patch: any) => { col(c)[id] = { ...(col(c)[id] || { id }), ...patch }; }),
  getOne: vi.fn(async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id] } : null)),
  getAll: vi.fn(async (c: string, constraints?: any[]) => {
    let rows = Object.values(col(c)).map((d) => ({ ...d }));
    for (const w of constraints || []) {
      if (w && w.__where) rows = rows.filter((r: any) => r[w.field] === w.value);
    }
    return rows;
  }),
  genId: { generic: (p: string) => `${p}-${++mocks.counter}` },
  resolveWriteGroupId: () => 'GRP-1',
}));
vi.mock('../../sanitizer', () => ({ sanitizeFirestoreData: (x: any) => x }));
vi.mock('../../stockWorkflow', () => ({ resolveStockSummaryDocumentId: (canonical: string, matches: any[]) => matches.find((m) => m.isDeleted !== true)?.id || canonical }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' }) } }));
vi.mock('../../workflow', async () => {
  const actual = await vi.importActual<any>('../../workflow');
  return { ...actual, resolveWorkflowCompanyId: () => 'COMP-1' };
});
vi.mock('firebase/firestore', () => ({ where: (field: string, _op: string, value: unknown) => ({ __where: true, field, value }) }));

import { applyStockMovement, applyStockMovements } from '../stockMovementEngine';
import {
  buildReserveInputs, reserveParticipant, fetchOrderReservations,
  buildDispatchConsumeInputs, buildCancelReleaseInputs, reservationUpdateParticipant,
  reservationRemainder,
} from '../reservations';

const WH = 'WH-1';
const COMPANY = 'COMP-1';

async function seedStock(productId: string, qty: number) {
  await applyStockMovement({
    movementType: 'OPENING_STOCK', productId, warehouseId: WH, qty, unit: 'PCS',
    sourceType: 'opening', sourceId: `SEED-${productId}`, companyId: COMPANY,
  });
}

async function reservePi(opts: { orderId: string; piId: string; lines: Array<{ productId: string; qty: number }> }) {
  const { inputs, metaByKey } = buildReserveInputs({
    companyId: COMPANY, actorId: 'U-1', orderId: opts.orderId, piId: opts.piId, warehouseId: WH,
    lines: opts.lines.map((l) => ({ orderLineKey: l.productId, productId: l.productId, unit: 'PCS', qty: l.qty })),
  });
  const participant = reserveParticipant({
    companyId: COMPANY, groupId: 'GRP-1', orderId: opts.orderId, piId: opts.piId,
    actorId: 'U-1', nowIso: new Date().toISOString(), metaByKey,
  });
  return applyStockMovements(inputs, participant);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mocks.counter = 0;
});

describe('INVENTORY-07 — reserve on PI paid', () => {
  it('M1/M2: creates a stock_reservations doc atomically with the SALES_RESERVE movement', async () => {
    await seedStock('P-1', 10);
    const batch = await reservePi({ orderId: 'ORD-1', piId: 'PI-1', lines: [{ productId: 'P-1', qty: 4 }] });
    expect(batch.applied).toBe(true);

    const reservations = Object.values(col('stock_reservations'));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      orderId: 'ORD-1', piId: 'PI-1', productId: 'P-1', warehouseId: WH,
      qtyRequested: 4, qtyReserved: 4, qtyConsumed: 0, qtyReleased: 0, status: 'active',
    });
    const summary = Object.values(col('stock'))[0] as any;
    expect(summary).toMatchObject({ onHandQty: 10, reservedQty: 4, availableQty: 6 });
  });

  it('M3: partial reservation — reserves what is available, records the shortfall shape', async () => {
    await seedStock('P-2', 3);
    const { inputs, metaByKey } = buildReserveInputs({
      companyId: COMPANY, actorId: 'U-1', orderId: 'ORD-2', piId: 'PI-2', warehouseId: WH,
      lines: [{ orderLineKey: 'P-2', productId: 'P-2', unit: 'PCS', qty: 7 }],
    });
    const batch = await applyStockMovements(inputs, reserveParticipant({
      companyId: COMPANY, groupId: 'GRP-1', orderId: 'ORD-2', piId: 'PI-2', actorId: 'U-1', nowIso: 'now', metaByKey,
    }));
    const r = batch.results[0];
    const granted = r.reservedAfter - r.reservedBefore;
    expect(granted).toBe(3);
    expect(metaByKey.get(r.idempotencyKey)!.qtyRequested - granted).toBe(4); // shortfall
    expect((Object.values(col('stock_reservations'))[0] as any).qtyReserved).toBe(3);
  });

  it('M4 (serialized): a second PI for the last units reserves only the remainder + shortfall', async () => {
    // The demo branch is NOT transactional — true concurrency (two racing
    // runTransactions) is proven in stockReservationTransaction.emulator.test.ts.
    // Serialized, the clamp still enforces total reserved <= onHand.
    await seedStock('P-3', 10);
    const a = await reservePi({ orderId: 'ORD-A', piId: 'PI-A', lines: [{ productId: 'P-3', qty: 7 }] });
    const b = await reservePi({ orderId: 'ORD-B', piId: 'PI-B', lines: [{ productId: 'P-3', qty: 7 }] });
    const grantedA = a.results[0].reservedAfter - a.results[0].reservedBefore;
    const grantedB = b.results[0].reservedAfter - b.results[0].reservedBefore;
    expect(grantedA).toBe(7);
    expect(grantedB).toBe(3);
    const summary = Object.values(col('stock'))[0] as any;
    expect(summary.reservedQty).toBe(10);
    expect(summary.reservedQty).toBeLessThanOrEqual(summary.onHandQty);
  });

  it('M7: a retried PI payment reserves nothing further (idempotent)', async () => {
    await seedStock('P-4', 10);
    await reservePi({ orderId: 'ORD-4', piId: 'PI-4', lines: [{ productId: 'P-4', qty: 5 }] });
    const again = await reservePi({ orderId: 'ORD-4', piId: 'PI-4', lines: [{ productId: 'P-4', qty: 5 }] });
    expect(again.results[0].applied).toBe(false);
    expect(Object.values(col('stock_reservations'))).toHaveLength(1);
    expect((Object.values(col('stock'))[0] as any).reservedQty).toBe(5);
  });
});

describe('INVENTORY-07 — dispatch consume + cancel release', () => {
  it('M5: dispatch consume reduces the reservation remainder and reservedQty atomically', async () => {
    await seedStock('P-5', 10);
    await reservePi({ orderId: 'ORD-5', piId: 'PI-5', lines: [{ productId: 'P-5', qty: 6 }] });
    const reservations = await fetchOrderReservations('ORD-5');
    expect(reservations).toHaveLength(1);

    const outInputs = [{
      movementType: 'DISPATCH_OUT' as const, productId: 'P-5', warehouseId: WH, qty: 6, unit: 'PCS',
      sourceType: 'dispatch', sourceId: 'DSP-5', lineKey: 'P-5', companyId: COMPANY,
    }];
    const consumeInputs = buildDispatchConsumeInputs({
      companyId: COMPANY, actorId: 'U-1', dispatchId: 'DSP-5', orderId: 'ORD-5', warehouseId: WH,
      verifiedLines: [{ productId: 'P-5', unit: 'PCS', verifiedQty: 6 }], reservations,
    });
    await applyStockMovements(
      [...outInputs, ...consumeInputs],
      reservationUpdateParticipant({ reservations, mode: 'consume', matchSourceType: 'dispatch_consume', actorId: 'U-1', nowIso: 'now' }),
    );

    const summary = Object.values(col('stock'))[0] as any;
    expect(summary).toMatchObject({ onHandQty: 4, reservedQty: 0, availableQty: 4 });
    const rsv = Object.values(col('stock_reservations'))[0] as any;
    expect(rsv).toMatchObject({ qtyConsumed: 6, status: 'consumed' });
    expect(reservationRemainder(rsv)).toBe(0);
  });

  it('M5 partial dispatch: consumes only the verified qty, remainder stays reserved', async () => {
    await seedStock('P-6', 10);
    await reservePi({ orderId: 'ORD-6', piId: 'PI-6', lines: [{ productId: 'P-6', qty: 8 }] });
    const reservations = await fetchOrderReservations('ORD-6');
    const consumeInputs = buildDispatchConsumeInputs({
      companyId: COMPANY, actorId: 'U-1', dispatchId: 'DSP-6', orderId: 'ORD-6', warehouseId: WH,
      verifiedLines: [{ productId: 'P-6', unit: 'PCS', verifiedQty: 3 }], reservations,
    });
    await applyStockMovements(
      [
        { movementType: 'DISPATCH_OUT' as const, productId: 'P-6', warehouseId: WH, qty: 3, unit: 'PCS', sourceType: 'dispatch', sourceId: 'DSP-6', lineKey: 'P-6', companyId: COMPANY },
        ...consumeInputs,
      ],
      reservationUpdateParticipant({ reservations, mode: 'consume', matchSourceType: 'dispatch_consume', actorId: 'U-1', nowIso: 'now' }),
    );
    const summary = Object.values(col('stock'))[0] as any;
    expect(summary).toMatchObject({ onHandQty: 7, reservedQty: 5, availableQty: 2 });
    const rsv = Object.values(col('stock_reservations'))[0] as any;
    expect(rsv).toMatchObject({ qtyConsumed: 3, status: 'partial' });
  });

  it('M6: cancel releases the unconsumed remainder via SALES_RELEASE, marks the reservation released', async () => {
    await seedStock('P-7', 10);
    await reservePi({ orderId: 'ORD-7', piId: 'PI-7', lines: [{ productId: 'P-7', qty: 6 }] });
    const reservations = await fetchOrderReservations('ORD-7');
    const releaseInputs = buildCancelReleaseInputs({ companyId: COMPANY, actorId: 'U-1', orderId: 'ORD-7', reservations });
    const batch = await applyStockMovements(
      releaseInputs,
      reservationUpdateParticipant({ reservations, mode: 'release', matchSourceType: 'order_cancel', actorId: 'U-1', nowIso: 'now' }),
    );
    expect(batch.applied).toBe(true);
    const summary = Object.values(col('stock'))[0] as any;
    expect(summary).toMatchObject({ onHandQty: 10, reservedQty: 0, availableQty: 10 });
    expect((Object.values(col('stock_reservations'))[0] as any)).toMatchObject({ qtyReleased: 6, status: 'released' });
  });

  it('M7: repeated cancel-release is idempotent (deterministic release ledger id)', async () => {
    await seedStock('P-8', 10);
    await reservePi({ orderId: 'ORD-8', piId: 'PI-8', lines: [{ productId: 'P-8', qty: 5 }] });
    let reservations = await fetchOrderReservations('ORD-8');
    await applyStockMovements(buildCancelReleaseInputs({ companyId: COMPANY, actorId: 'U-1', orderId: 'ORD-8', reservations }),
      reservationUpdateParticipant({ reservations, mode: 'release', matchSourceType: 'order_cancel', actorId: 'U-1', nowIso: 'now' }));
    reservations = await fetchOrderReservations('ORD-8');
    const second = await applyStockMovements(buildCancelReleaseInputs({ companyId: COMPANY, actorId: 'U-1', orderId: 'ORD-8', reservations }),
      reservationUpdateParticipant({ reservations, mode: 'release', matchSourceType: 'order_cancel', actorId: 'U-1', nowIso: 'now' }));
    // remainder is already 0 → no release inputs built at all
    expect(second.results.every((r) => !r.applied)).toBe(true);
    expect((Object.values(col('stock'))[0] as any).reservedQty).toBe(0);
  });

  it('M10: a pre-07 order with no reservation dispatches normally (consume = 0)', async () => {
    await seedStock('P-9', 10);
    const reservations = await fetchOrderReservations('ORD-NONE');
    expect(reservations).toHaveLength(0);
    const consumeInputs = buildDispatchConsumeInputs({
      companyId: COMPANY, actorId: 'U-1', dispatchId: 'DSP-9', orderId: 'ORD-NONE', warehouseId: WH,
      verifiedLines: [{ productId: 'P-9', unit: 'PCS', verifiedQty: 4 }], reservations,
    });
    expect(consumeInputs).toHaveLength(0);
    await applyStockMovement({ movementType: 'DISPATCH_OUT', productId: 'P-9', warehouseId: WH, qty: 4, unit: 'PCS', sourceType: 'dispatch', sourceId: 'DSP-9', lineKey: 'P-9', companyId: COMPANY });
    expect((Object.values(col('stock'))[0] as any)).toMatchObject({ onHandQty: 6, reservedQty: 0, availableQty: 6 });
  });
});
