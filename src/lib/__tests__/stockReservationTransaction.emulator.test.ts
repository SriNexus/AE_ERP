/**
 * stockReservationTransaction.emulator.test.ts — INVENTORY-07 (M1–M10, rules)
 * ==========================================================================
 *
 * Proves, against the Firestore emulator + the CURRENT firestore.rules, that:
 *
 *   M1/M2  reserve-on-PI-paid: reservedQty += qty, onHandQty unchanged,
 *          availableQty = onHandQty − reservedQty, and the `stock_reservations`
 *          doc is written in the SAME runTransaction (atomic).
 *   M3     partial reservation clamps to what is available.
 *   M4     two concurrent reservations for the last units → total reserved == the
 *          available units, never an over-reserve, never a lost update.
 *   M5     dispatch consume: reservedQty −= consumed + the reservation doc
 *          `qtyConsumed` moves, atomically with DISPATCH_OUT.
 *   M6     cancel release: reservedQty −= remainder, reservation `qtyReleased`
 *          moves.
 *   M8     INV-3: an un-clamped reserve that would exceed onHandQty aborts the
 *          whole transaction — nothing written.
 *   RULES  reserve as Accounts / Sales is ALLOWED; as a non-privileged role
 *          (Manager) it is DENIED; cross-company reservation DENIED; the
 *          reservation doc's identity is immutable and it cannot be deleted;
 *          the reservation ledger row is immutable.
 *
 * The transaction helpers replicate `applyBatchConfigured` + the reservation
 * participant (Plan §07 C/D).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { buildIdempotencyKey, movementLedgerId } from '../inventory/idempotency';
import { reservationDocId } from '../inventory/reservationConfig';

const PROJECT = 'neozy-stock-reservation-test';
const CO_A = 'CO-RSV-A';
const CO_B = 'CO-RSV-B';
const GRP_A = 'GRP-RSV-A';
const GRP_B = 'GRP-RSV-B';
const WH_A = 'WH-RSV-A';
const WH_B = 'WH-RSV-B';
const P1 = 'PRD-RSV-1';
const SUM_A = `SUM-${CO_A}-${P1}-${WH_A}`;
const EPS = 1e-6;

const ACC = { uid: 'uid-rsv-acc', userId: 'user-rsv-acc', email: 'rsv-acc@t.test' };
const WHU = { uid: 'uid-rsv-wh', userId: 'user-rsv-wh', email: 'rsv-wh@t.test' };
const SALES = { uid: 'uid-rsv-sales', userId: 'user-rsv-sales', email: 'rsv-sales@t.test' };
const MGR = { uid: 'uid-rsv-mgr', userId: 'user-rsv-mgr', email: 'rsv-mgr@t.test' };
const ACC_B = { uid: 'uid-rsv-accB', userId: 'user-rsv-accB', email: 'rsv-accB@t.test' };

let env: RulesTestEnvironment;

async function seed(onHand: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: CO_B, groupId: GRP_B, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });

    const mkUser = (u: typeof ACC, role: string, companyId: string, groupId: string, warehouseId?: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...(warehouseId ? { warehouseId } : {}) }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(ACC, 'Accounts', CO_A, GRP_A);
    await mkUser(WHU, 'Warehouse', CO_A, GRP_A, WH_A);
    await mkUser(SALES, 'Sales', CO_A, GRP_A);
    await mkUser(MGR, 'Manager', CO_A, GRP_A);
    await mkUser(ACC_B, 'Accounts', CO_B, GRP_B);

    await setDoc(doc(db, 'stock', SUM_A), {
      id: SUM_A, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A,
      onHandQty: onHand, availableQty: onHand, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

/** applyBatchConfigured for ONE SALES_RESERVE line + the reservation participant. */
async function reserveTxn(
  db: ReturnType<typeof dbFor>,
  opts: { qty: number; piId: string; orderId: string; lineKey: string; actorId: string; clamp?: boolean; companyId?: string; groupId?: string; warehouseId?: string },
) {
  const companyId = opts.companyId ?? CO_A;
  const groupId = opts.groupId ?? GRP_A;
  const warehouseId = opts.warehouseId ?? WH_A;
  const key = `SALES_RESERVE:proforma_invoice:${opts.piId}:${opts.lineKey}`;
  const ledgerId = movementLedgerId(key);
  const rsvId = reservationDocId(key);
  const stockId = `SUM-${companyId}-${P1}-${warehouseId}`;

  return runTransaction(db, async (tx) => {
    const ledgerRef = doc(db, 'stock_ledger', ledgerId);
    const stockRef = doc(db, 'stock', stockId);
    const rsvRef = doc(db, 'stock_reservations', rsvId);
    const ledgerSnap = await tx.get(ledgerRef);
    const stockSnap = await tx.get(stockRef);
    await tx.get(rsvRef);
    if (ledgerSnap.exists()) {
      const r = ledgerSnap.data() as any;
      return { applied: false, granted: Number(r.qty) || 0, reservedAfter: Number(r.reservedAfter) || 0 };
    }
    const existing = stockSnap.exists() ? stockSnap.data() as any : null;
    const onHand = Number(existing?.onHandQty ?? existing?.availableQty) || 0;
    const reservedBefore = Number(existing?.reservedQty) || 0;
    let granted = opts.qty;
    if (opts.clamp) granted = Math.max(0, Math.min(opts.qty, onHand - reservedBefore));
    if (granted <= EPS) return { applied: false, granted: 0, reservedAfter: reservedBefore };
    const reservedAfter = reservedBefore + granted;
    if (reservedAfter > onHand + EPS) throw new Error('Over-reservation');

    tx.set(stockRef, {
      ...(existing || {}), id: stockId, companyId, groupId, productId: P1, warehouseId, unit: 'PCS',
      onHandQty: onHand, reservedQty: reservedAfter, availableQty: onHand - reservedAfter,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: ledgerId, companyId, groupId, productId: P1, warehouseId, unit: 'PCS',
      movementType: 'SALES_RESERVE', direction: 'RESERVE', qty: granted,
      onHandBefore: onHand, onHandAfter: onHand, reservedBefore, reservedAfter,
      sourceType: 'proforma_invoice', sourceId: opts.piId, idempotencyKey: key,
      actorId: opts.actorId, transactionId: `TXN-${ledgerId}`, movementAt: serverTimestamp(),
      createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      type: 'IN', referenceType: 'ProformaInvoice', referenceId: opts.piId, date: new Date().toISOString(), notes: '',
    });
    tx.set(rsvRef, {
      id: rsvId, companyId, groupId, orderId: opts.orderId, orderLineKey: opts.lineKey,
      productId: P1, warehouseId, unit: 'PCS', qtyRequested: opts.qty, qtyReserved: granted,
      qtyConsumed: 0, qtyReleased: 0, status: 'active', piId: opts.piId, idempotencyKey: key,
      createdAt: new Date().toISOString(), createdBy: opts.actorId, isDeleted: false,
    });
    return { applied: true, granted, reservedAfter };
  });
}

/** DISPATCH_OUT + SALES_RELEASE(consume) + reservation doc update, one txn. */
async function consumeTxn(db: ReturnType<typeof dbFor>, opts: { verifiedQty: number; consumeQty: number; dispatchId: string; rsvId: string; actorId: string }) {
  const outKey = buildIdempotencyKey('DISPATCH_OUT', 'dispatch', opts.dispatchId, P1);
  const relKey = buildIdempotencyKey('SALES_RELEASE', 'dispatch_consume', opts.dispatchId, P1);
  const outId = movementLedgerId(outKey);
  const relId = movementLedgerId(relKey);
  return runTransaction(db, async (tx) => {
    const stockRef = doc(db, 'stock', SUM_A);
    const rsvRef = doc(db, 'stock_reservations', opts.rsvId);
    const stockSnap = await tx.get(stockRef);
    const rsvSnap = await tx.get(rsvRef);
    await tx.get(doc(db, 'stock_ledger', outId));
    await tx.get(doc(db, 'stock_ledger', relId));
    const s = stockSnap.data() as any;
    const onHandAfter = Number(s.onHandQty) - opts.verifiedQty;
    const consume = Math.min(opts.consumeQty, Number(s.reservedQty));
    const reservedAfter = Number(s.reservedQty) - consume;
    if (onHandAfter < -EPS) throw new Error('Insufficient stock');
    if (reservedAfter > onHandAfter + EPS) throw new Error('Over-reservation');
    tx.set(stockRef, { ...s, onHandQty: onHandAfter, reservedQty: reservedAfter, availableQty: onHandAfter - reservedAfter, updatedBy: opts.actorId, updatedAt: serverTimestamp() });
    tx.set(doc(db, 'stock_ledger', outId), { id: outId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, unit: 'PCS', movementType: 'DISPATCH_OUT', direction: 'OUT', qty: opts.verifiedQty, onHandBefore: Number(s.onHandQty), onHandAfter, reservedBefore: Number(s.reservedQty), reservedAfter: Number(s.reservedQty), sourceType: 'dispatch', sourceId: opts.dispatchId, idempotencyKey: outKey, actorId: opts.actorId, transactionId: `TXN-${outId}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false, type: 'OUT', referenceType: 'Dispatch', referenceId: opts.dispatchId, date: new Date().toISOString(), notes: '' });
    tx.set(doc(db, 'stock_ledger', relId), { id: relId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, unit: 'PCS', movementType: 'SALES_RELEASE', direction: 'RELEASE', qty: consume, onHandBefore: onHandAfter, onHandAfter, reservedBefore: Number(s.reservedQty), reservedAfter, sourceType: 'dispatch_consume', sourceId: opts.dispatchId, idempotencyKey: relKey, actorId: opts.actorId, transactionId: `TXN-${relId}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false, type: 'OUT', referenceType: 'Dispatch', referenceId: opts.dispatchId, date: new Date().toISOString(), notes: '' });
    const rv = rsvSnap.data() as any;
    tx.update(rsvRef, { qtyConsumed: (Number(rv.qtyConsumed) || 0) + consume, status: (Number(rv.qtyReserved) - Number(rv.qtyConsumed) - consume) > EPS ? 'partial' : 'consumed', updatedAt: new Date().toISOString(), updatedBy: opts.actorId });
    return { onHandAfter, reservedAfter, consume };
  });
}

async function readState() {
  let out: any = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.summary = (await getDoc(doc(db, 'stock', SUM_A))).data();
    out.reservations = (await getDocs(query(collection(db, 'stock_reservations'), where('companyId', '==', CO_A)))).docs.map((d) => ({ id: d.id, ...d.data() }));
    out.ledger = (await getDocs(query(collection(db, 'stock_ledger'), where('companyId', '==', CO_A)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-07 — reservation transaction (emulator)', () => {
  it('M1/M2: Accounts reserves — reservedQty +, onHand unchanged, available = onHand − reserved, reservation doc atomic', async () => {
    await seed(10);
    const r = await reserveTxn(dbFor(ACC), { qty: 4, piId: 'PI-1', orderId: 'ORD-1', lineKey: P1, actorId: ACC.userId });
    expect(r).toMatchObject({ applied: true, granted: 4 });
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 10, reservedQty: 4, availableQty: 6 });
    expect(s.reservations).toHaveLength(1);
    expect(s.reservations[0]).toMatchObject({ orderId: 'ORD-1', piId: 'PI-1', qtyReserved: 4, qtyConsumed: 0, status: 'active' });
    expect(s.ledger).toHaveLength(1);
    expect(s.ledger[0]).toMatchObject({ movementType: 'SALES_RESERVE', direction: 'RESERVE' });
  });

  it('M3: partial reservation clamps to available (3 of 7)', async () => {
    await seed(3);
    const r = await reserveTxn(dbFor(ACC), { qty: 7, piId: 'PI-2', orderId: 'ORD-2', lineKey: P1, actorId: ACC.userId, clamp: true });
    expect(r.granted).toBe(3);
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 3, reservedQty: 3, availableQty: 0 });
    expect(s.reservations[0]).toMatchObject({ qtyRequested: 7, qtyReserved: 3 });
  });

  it('M4: two concurrent reserves for the last 10 units → total reserved == 10, never an over-reserve', async () => {
    await seed(10);
    const results = await Promise.allSettled([
      reserveTxn(dbFor(ACC), { qty: 7, piId: 'PI-A', orderId: 'ORD-A', lineKey: P1, actorId: ACC.userId, clamp: true }),
      reserveTxn(dbFor(SALES), { qty: 7, piId: 'PI-B', orderId: 'ORD-B', lineKey: P1, actorId: SALES.userId, clamp: true }),
    ]);
    // both transactions succeed (Firestore serialises them on the summary doc);
    // the clamp on the second sees the first's committed reservedQty.
    const granted = results.map((r) => (r.status === 'fulfilled' ? r.value.granted : 0));
    const s = await readState();
    expect(s.summary.reservedQty).toBeLessThanOrEqual(s.summary.onHandQty);
    expect(s.summary.reservedQty).toBe(10);
    expect(granted.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...granted)).toBe(7);
    expect(Math.min(...granted)).toBe(3);
  });

  it('M8 / INV-3: an un-clamped reserve that exceeds onHandQty aborts the whole transaction', async () => {
    await seed(5);
    await expect(reserveTxn(dbFor(ACC), { qty: 8, piId: 'PI-3', orderId: 'ORD-3', lineKey: P1, actorId: ACC.userId }))
      .rejects.toThrow(/Over-reservation/);
    const s = await readState();
    expect(s.summary.reservedQty).toBe(0);
    expect(s.reservations).toHaveLength(0);
    expect(s.ledger).toHaveLength(0);
  });

  it('M7: a retried reserve is an idempotent no-op (deterministic ledger + reservation id)', async () => {
    await seed(10);
    const a = await reserveTxn(dbFor(ACC), { qty: 4, piId: 'PI-4', orderId: 'ORD-4', lineKey: P1, actorId: ACC.userId });
    const b = await reserveTxn(dbFor(ACC), { qty: 4, piId: 'PI-4', orderId: 'ORD-4', lineKey: P1, actorId: ACC.userId });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    const s = await readState();
    expect(s.summary.reservedQty).toBe(4);
    expect(s.reservations).toHaveLength(1);
  });

  it('M5: dispatch consume — Warehouse decrements onHand + reservedQty + the reservation doc, atomically', async () => {
    await seed(10);
    await reserveTxn(dbFor(ACC), { qty: 6, piId: 'PI-5', orderId: 'ORD-5', lineKey: P1, actorId: ACC.userId });
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-5:${P1}`);
    const r = await consumeTxn(dbFor(WHU), { verifiedQty: 6, consumeQty: 6, dispatchId: 'DSP-5', rsvId, actorId: WHU.userId });
    expect(r).toMatchObject({ onHandAfter: 4, reservedAfter: 0, consume: 6 });
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 4, reservedQty: 0, availableQty: 4 });
    expect(s.reservations[0]).toMatchObject({ qtyConsumed: 6, status: 'consumed' });
  });

  it('M5 partial dispatch: consumes only the verified qty, remainder stays reserved', async () => {
    await seed(10);
    await reserveTxn(dbFor(ACC), { qty: 8, piId: 'PI-6', orderId: 'ORD-6', lineKey: P1, actorId: ACC.userId });
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-6:${P1}`);
    await consumeTxn(dbFor(WHU), { verifiedQty: 3, consumeQty: 3, dispatchId: 'DSP-6', rsvId, actorId: WHU.userId });
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 7, reservedQty: 5, availableQty: 2 });
    expect(s.reservations[0]).toMatchObject({ qtyConsumed: 3, status: 'partial' });
  });

  it('M6: cancel release — Accounts releases the remainder, reservation marked released', async () => {
    await seed(10);
    await reserveTxn(dbFor(ACC), { qty: 6, piId: 'PI-7', orderId: 'ORD-7', lineKey: P1, actorId: ACC.userId });
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-7:${P1}`);
    const relKey = buildIdempotencyKey('SALES_RELEASE', 'order_cancel', 'ORD-7', P1);
    const relId = movementLedgerId(relKey);
    const accDb = dbFor(ACC);
    await runTransaction(accDb, async (tx) => {
      const stockRef = doc(accDb, 'stock', SUM_A);
      const rsvRef = doc(accDb, 'stock_reservations', rsvId);
      const sSnap = await tx.get(stockRef);
      const rSnap = await tx.get(rsvRef);
      await tx.get(doc(accDb, 'stock_ledger', relId));
      const s = sSnap.data() as any; const rv = rSnap.data() as any;
      const remainder = Number(rv.qtyReserved) - Number(rv.qtyConsumed) - Number(rv.qtyReleased);
      const reservedAfter = Number(s.reservedQty) - remainder;
      tx.set(stockRef, { ...s, reservedQty: reservedAfter, availableQty: Number(s.onHandQty) - reservedAfter, updatedBy: ACC.userId, updatedAt: serverTimestamp() });
      tx.set(doc(accDb, 'stock_ledger', relId), { id: relId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, unit: 'PCS', movementType: 'SALES_RELEASE', direction: 'RELEASE', qty: remainder, onHandBefore: Number(s.onHandQty), onHandAfter: Number(s.onHandQty), reservedBefore: Number(s.reservedQty), reservedAfter, sourceType: 'order_cancel', sourceId: 'ORD-7', idempotencyKey: relKey, actorId: ACC.userId, transactionId: `TXN-${relId}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: ACC.userId, isDeleted: false, type: 'OUT', referenceType: 'OrderCancel', referenceId: 'ORD-7', date: new Date().toISOString(), notes: '' });
      tx.update(rsvRef, { qtyReleased: Number(rv.qtyReleased) + remainder, status: 'released', updatedAt: new Date().toISOString(), updatedBy: ACC.userId });
    });
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 10, reservedQty: 0, availableQty: 10 });
    expect(s.reservations[0]).toMatchObject({ qtyReleased: 6, status: 'released' });
  });

  it('RULES: a Sales-role actor may reserve (reservation-only stock change)', async () => {
    await seed(10);
    const r = await reserveTxn(dbFor(SALES), { qty: 3, piId: 'PI-S', orderId: 'ORD-S', lineKey: P1, actorId: SALES.userId });
    expect(r.applied).toBe(true);
  });

  it('RULES: a non-privileged role (Manager) is DENIED the reservation-only stock change', async () => {
    await seed(10);
    await expect(reserveTxn(dbFor(MGR), { qty: 3, piId: 'PI-M', orderId: 'ORD-M', lineKey: P1, actorId: MGR.userId })).rejects.toThrow();
  });

  it('RULES: a cross-company actor cannot reserve into another company\'s warehouse', async () => {
    await seed(10);
    await expect(reserveTxn(dbFor(ACC_B), { qty: 3, piId: 'PI-X', orderId: 'ORD-X', lineKey: P1, actorId: ACC_B.userId })).rejects.toThrow();
  });

  it('RULES: the reservation doc identity is immutable and it cannot be deleted; its ledger row is immutable', async () => {
    await seed(10);
    await reserveTxn(dbFor(ACC), { qty: 4, piId: 'PI-IM', orderId: 'ORD-IM', lineKey: P1, actorId: ACC.userId });
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-IM:${P1}`);
    const ledgerId = movementLedgerId(`SALES_RESERVE:proforma_invoice:PI-IM:${P1}`);
    await assertFails(updateDoc(doc(dbFor(ACC), 'stock_reservations', rsvId), { orderId: 'ORD-HIJACK' }));
    await assertFails(updateDoc(doc(dbFor(ACC), 'stock_reservations', rsvId), { qtyReserved: 999 }));
    await assertFails(deleteDoc(doc(dbFor(ACC), 'stock_reservations', rsvId)));
    await assertFails(updateDoc(doc(dbFor(ACC), 'stock_ledger', ledgerId), { qty: 1 }));
  });

  it('SMOKE (B2B/B2C inventory spine): reserve → partial dispatch consume → cancel-remainder release → fully reconciled', async () => {
    // The B2B and B2C flows differ only in the pre-order stages (quotation vs
    // project/survey/engineering); the PI → pay → RESERVE → dispatch → cancel
    // inventory spine is identical, so one emulator run covers both.
    await seed(10);
    // PI paid → reserve 8
    await reserveTxn(dbFor(ACC), { qty: 8, piId: 'PI-E2E', orderId: 'ORD-E2E', lineKey: P1, actorId: ACC.userId, clamp: true });
    let s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 10, reservedQty: 8, availableQty: 2 });

    // Partial dispatch of 5 → onHand 5, reserved 3, reservation partial
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-E2E:${P1}`);
    await consumeTxn(dbFor(WHU), { verifiedQty: 5, consumeQty: 5, dispatchId: 'DSP-E2E', rsvId, actorId: WHU.userId });
    s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 5, reservedQty: 3, availableQty: 2 });
    expect(s.reservations[0]).toMatchObject({ qtyConsumed: 5, status: 'partial' });

    // Order cancelled → release the unconsumed remainder (3); dispatched stock
    // return is a SEPARATE SALES_RETURN_IN (not exercised here).
    const relKey = buildIdempotencyKey('SALES_RELEASE', 'order_cancel', 'ORD-E2E', P1);
    const relId = movementLedgerId(relKey);
    const accDb = dbFor(ACC);
    await runTransaction(accDb, async (tx) => {
      const stockRef = doc(accDb, 'stock', SUM_A);
      const rsvRef = doc(accDb, 'stock_reservations', rsvId);
      const sSnap = await tx.get(stockRef);
      const rSnap = await tx.get(rsvRef);
      await tx.get(doc(accDb, 'stock_ledger', relId));
      const st = sSnap.data() as any; const rv = rSnap.data() as any;
      const remainder = Number(rv.qtyReserved) - Number(rv.qtyConsumed) - Number(rv.qtyReleased);
      const reservedAfter = Number(st.reservedQty) - remainder;
      tx.set(stockRef, { ...st, reservedQty: reservedAfter, availableQty: Number(st.onHandQty) - reservedAfter, updatedBy: ACC.userId, updatedAt: serverTimestamp() });
      tx.set(doc(accDb, 'stock_ledger', relId), { id: relId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, unit: 'PCS', movementType: 'SALES_RELEASE', direction: 'RELEASE', qty: remainder, onHandBefore: Number(st.onHandQty), onHandAfter: Number(st.onHandQty), reservedBefore: Number(st.reservedQty), reservedAfter, sourceType: 'order_cancel', sourceId: 'ORD-E2E', idempotencyKey: relKey, actorId: ACC.userId, transactionId: `TXN-${relId}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: ACC.userId, isDeleted: false, type: 'OUT', referenceType: 'OrderCancel', referenceId: 'ORD-E2E', date: new Date().toISOString(), notes: '' });
      tx.update(rsvRef, { qtyReleased: Number(rv.qtyReleased) + remainder, status: 'released', updatedAt: new Date().toISOString(), updatedBy: ACC.userId });
    });

    s = await readState();
    // Final: onHand 5 (physical shipped 5), reservedQty 0, reservation fully accounted.
    expect(s.summary).toMatchObject({ onHandQty: 5, reservedQty: 0, availableQty: 5 });
    const rv = s.reservations[0];
    expect(Number(rv.qtyConsumed) + Number(rv.qtyReleased)).toBe(8);
    // Reservation reconciliation: reservedQty == Σ(active reservation remainders) == 0
    const remainder = Number(rv.qtyReserved) - Number(rv.qtyConsumed) - Number(rv.qtyReleased);
    expect(remainder).toBe(0);
    expect(Number(s.summary.reservedQty)).toBe(remainder);
    // Physical reconciliation: onHand == Σ(IN) − Σ(OUT) from operational rows
    // (OPENING via seed is on the summary, not the ledger; the ledger here holds
    // the DISPATCH_OUT 5 → net −5 against the seeded 10 → 5). RESERVE/RELEASE
    // rows contribute 0.
    const net = s.ledger.reduce((acc: number, r: any) => {
      if (r.direction === 'IN') return acc + Number(r.qty);
      if (r.direction === 'OUT') return acc - Number(r.qty);
      return acc;
    }, 10);
    expect(net).toBe(5);
  });

  it('RULES: a legitimate consume update (qtyConsumed + status) by Warehouse is ALLOWED', async () => {
    await seed(10);
    await reserveTxn(dbFor(ACC), { qty: 5, piId: 'PI-C', orderId: 'ORD-C', lineKey: P1, actorId: ACC.userId });
    const rsvId = reservationDocId(`SALES_RESERVE:proforma_invoice:PI-C:${P1}`);
    await updateDoc(doc(dbFor(WHU), 'stock_reservations', rsvId), {
      qtyConsumed: 5, status: 'consumed', updatedAt: new Date().toISOString(), updatedBy: WHU.userId,
      lastMovementAt: new Date().toISOString(), lastMovementLedgerId: 'LGR-x',
    });
    const s = await readState();
    expect(s.reservations[0]).toMatchObject({ qtyConsumed: 5, status: 'consumed' });
  });
});
