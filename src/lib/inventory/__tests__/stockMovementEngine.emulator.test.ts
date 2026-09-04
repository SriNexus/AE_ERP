/**
 * stockMovementEngine.emulator.test.ts — INVENTORY-05a
 * ===================================================
 *
 * Proves, against the Firestore emulator, that the DORMANT movement engine's
 * write shape satisfies the CURRENT `firestore.rules` for `stock` /
 * `stock_ledger` UNCHANGED, and that the transaction is atomic + idempotent.
 * The test issues the EXACT transaction shape `applyStockMovement()` issues in
 * its configured branch (ledger-exists check → stock read → invariant guard →
 * stock write + ledger write, one runTransaction).
 *
 * INVENTORY-05a changes NO firestore.rules. If this test shows the engine's
 * writes are rejected by today's rules, that is a Phase-05a BLOCKER (Plan §759).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { buildIdempotencyKey, movementLedgerId } from '../idempotency';
import { MOVEMENT_DIRECTION } from '../types';
import type { MovementType } from '../types';

const PROJECT = 'neozy-stock-movement-engine-test';
const CO_A = 'CO-SME-A';
const CO_B = 'CO-SME-B';
const GRP_A = 'GRP-SME-A';
const GRP_B = 'GRP-SME-B';
const WH_A = 'WH-SME-A';
const WH_B = 'WH-SME-B';
const P1 = 'PRD-SME-1';

const WH_USER = { uid: 'uid-sme-wh', userId: 'user-sme-wh', email: 'sme-wh@t.test' };
const SALES_USER = { uid: 'uid-sme-sales', userId: 'user-sme-sales', email: 'sme-sales@t.test' };
const WH_B_USER = { uid: 'uid-sme-whB', userId: 'user-sme-whB', email: 'sme-whB@t.test' };

let env: RulesTestEnvironment;

async function seed(onHand?: number) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: CO_B, groupId: GRP_B, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });

    await setDoc(doc(db, 'users', WH_USER.userId), { id: WH_USER.userId, companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, role: 'Warehouse', name: 'WH', email: WH_USER.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', WH_USER.uid), { authUid: WH_USER.uid, userId: WH_USER.userId, companyId: CO_A, groupId: GRP_A, email: WH_USER.email });
    await setDoc(doc(db, 'users', SALES_USER.userId), { id: SALES_USER.userId, companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, role: 'Sales', name: 'Sales', email: SALES_USER.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', SALES_USER.uid), { authUid: SALES_USER.uid, userId: SALES_USER.userId, companyId: CO_A, groupId: GRP_A, email: SALES_USER.email });
    await setDoc(doc(db, 'users', WH_B_USER.userId), { id: WH_B_USER.userId, companyId: CO_B, groupId: GRP_B, warehouseId: WH_B, role: 'Warehouse', name: 'WHB', email: WH_B_USER.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', WH_B_USER.uid), { authUid: WH_B_USER.uid, userId: WH_B_USER.userId, companyId: CO_B, groupId: GRP_B, email: WH_B_USER.email });

    if (onHand !== undefined) {
      await setDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`), {
        id: `SUM-${CO_A}-${P1}-${WH_A}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A,
        onHandQty: onHand, availableQty: onHand, reservedQty: 0, unit: 'Nos', isDeleted: false,
      });
    }
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();
const EPSILON = 1e-6;

/** The exact configured-branch transaction applyStockMovement issues. */
async function movementTxn(
  db: ReturnType<typeof dbFor>,
  opts: { movementType: MovementType; productId?: string; warehouseId?: string; companyId?: string; groupId?: string; qty: number; unit?: string; sourceType: string; sourceId: string; lineKey?: string | number; actorId: string; reservationsEnabled?: boolean },
): Promise<{ applied: boolean; onHandAfter: number; reservedAfter: number; ledgerId: string }> {
  const productId = opts.productId ?? P1;
  const warehouseId = opts.warehouseId ?? WH_A;
  const companyId = opts.companyId ?? CO_A;
  const groupId = opts.groupId ?? GRP_A;
  const unit = opts.unit ?? 'Nos';
  const direction = opts.movementType === 'RECONCILE_ADJUST'
    ? (opts.qty >= 0 ? 'IN' : 'OUT')
    : MOVEMENT_DIRECTION[opts.movementType as Exclude<MovementType, 'RECONCILE_ADJUST'>];
  const absQty = Math.abs(opts.qty);
  const key = buildIdempotencyKey(opts.movementType, opts.sourceType, opts.sourceId, opts.lineKey);
  const ledgerId = movementLedgerId(key);
  const stockId = `SUM-${companyId}-${productId}-${warehouseId}`;

  return runTransaction(db, async (tx) => {
    const ledgerRef = doc(db, 'stock_ledger', ledgerId);
    const stockRef = doc(db, 'stock', stockId);
    const ledgerSnap = await tx.get(ledgerRef);
    if (ledgerSnap.exists()) {
      const r = ledgerSnap.data() as Record<string, any>;
      return { applied: false, onHandAfter: Number(r.onHandAfter) || 0, reservedAfter: Number(r.reservedAfter) || 0, ledgerId };
    }
    const stockSnap = await tx.get(stockRef);
    const existing = stockSnap.exists() ? stockSnap.data() as Record<string, any> : null;
    const onHandBefore = Number(existing?.onHandQty ?? existing?.availableQty) || 0;
    const reservedBefore = Number(existing?.reservedQty) || 0;
    let onHandAfter = onHandBefore;
    let reservedAfter = reservedBefore;
    if (direction === 'IN') onHandAfter = onHandBefore + absQty;
    else if (direction === 'OUT') onHandAfter = onHandBefore - absQty;
    else if (direction === 'RESERVE') reservedAfter = reservedBefore + absQty;
    else if (direction === 'RELEASE') reservedAfter = reservedBefore - absQty;
    if (onHandAfter < -EPSILON) throw new Error(`Insufficient stock: onHandQty -> ${onHandAfter}`);
    if (reservedAfter < -EPSILON) throw new Error(`Invalid release: reservedQty -> ${reservedAfter}`);
    if (opts.reservationsEnabled && reservedAfter > onHandAfter + EPSILON) throw new Error('Over-reservation');
    const availableAfter = opts.reservationsEnabled ? onHandAfter - reservedAfter : onHandAfter;

    const base = { ...(existing || {}) };
    delete (base as Record<string, unknown>).available;
    delete (base as Record<string, unknown>).reserved;
    tx.set(stockRef, {
      ...base, id: stockId, companyId, groupId, productId, warehouseId, unit,
      onHandQty: onHandAfter, reservedQty: reservedAfter, availableQty: availableAfter,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(), createdAt: existing?.createdAt ?? serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: ledgerId, companyId, groupId, productId, warehouseId, unit,
      movementType: opts.movementType, direction, qty: absQty,
      onHandBefore, onHandAfter, reservedBefore, reservedAfter,
      sourceType: opts.sourceType, sourceId: opts.sourceId, idempotencyKey: key,
      actorId: opts.actorId, transactionId: `TXN-${ledgerId}`, movementAt: serverTimestamp(),
      createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      type: direction === 'OUT' || direction === 'RELEASE' ? 'OUT' : 'IN',
      referenceType: opts.sourceType, referenceId: opts.sourceId, date: new Date().toISOString(), notes: '',
    });
    return { applied: true, onHandAfter, reservedAfter, ledgerId };
  });
}

async function readState() {
  let out: { summary: any; ledgerRows: any[] } = { summary: null, ledgerRows: [] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.summary = (await getDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`))).data();
    out.ledgerRows = (await getDocs(query(collection(db, 'stock_ledger'), where('companyId', '==', CO_A)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-05a — stock movement engine (emulator)', () => {
  it('1: a Warehouse-role IN movement passes the CURRENT firestore.rules — summary + ledger written atomically', async () => {
    await seed();
    const r = await movementTxn(dbFor(WH_USER), { movementType: 'PURCHASE_RECEIPT', qty: 10, sourceType: 'goods_receipt', sourceId: 'GRN-1', lineKey: 0, actorId: WH_USER.userId });
    expect(r).toMatchObject({ applied: true, onHandAfter: 10, reservedAfter: 0 });
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 10, availableQty: 10, reservedQty: 0, groupId: GRP_A });
    expect(s.ledgerRows).toHaveLength(1);
    expect(s.ledgerRows[0]).toMatchObject({ movementType: 'PURCHASE_RECEIPT', direction: 'IN', type: 'IN', idempotencyKey: 'PURCHASE_RECEIPT:goods_receipt:GRN-1:0' });
  });

  it('2: an OUT movement decrements on-hand; availableQty tracks onHandQty (reserved 0)', async () => {
    await seed(10);
    const r = await movementTxn(dbFor(WH_USER), { movementType: 'DISPATCH_OUT', qty: 4, sourceType: 'dispatch', sourceId: 'DSP-1', lineKey: P1, actorId: WH_USER.userId });
    expect(r.onHandAfter).toBe(6);
    const s = await readState();
    expect(s.summary).toMatchObject({ onHandQty: 6, availableQty: 6, reservedQty: 0 });
    expect(s.ledgerRows).toHaveLength(1);
  });

  it('3: the SAME movement twice is idempotent — one stock change, one ledger row', async () => {
    await seed();
    const first = await movementTxn(dbFor(WH_USER), { movementType: 'PURCHASE_RECEIPT', qty: 7, sourceType: 'goods_receipt', sourceId: 'GRN-D', lineKey: 1, actorId: WH_USER.userId });
    const second = await movementTxn(dbFor(WH_USER), { movementType: 'PURCHASE_RECEIPT', qty: 7, sourceType: 'goods_receipt', sourceId: 'GRN-D', lineKey: 1, actorId: WH_USER.userId });
    expect(first.applied).toBe(true);
    expect(second).toMatchObject({ applied: false, onHandAfter: 7 });
    const s = await readState();
    expect(s.summary.onHandQty).toBe(7);          // NOT 14
    expect(s.ledgerRows).toHaveLength(1);
  });

  it('4 (INV-1): an OUT below zero aborts the whole transaction — no partial write', async () => {
    await seed(3);
    await expect(movementTxn(dbFor(WH_USER), { movementType: 'DISPATCH_OUT', qty: 9, sourceType: 'dispatch', sourceId: 'DSP-X', actorId: WH_USER.userId }))
      .rejects.toThrow('Insufficient stock');
    const s = await readState();
    expect(s.summary.onHandQty).toBe(3);
    expect(s.ledgerRows).toHaveLength(0);
  });

  it('5: a cross-company movement is DENIED by the current rules', async () => {
    await seed(10);
    // A Company B warehouse actor tries to move Company A's stock (stamps CO_A).
    await expect(movementTxn(dbFor(WH_B_USER), { movementType: 'DISPATCH_OUT', qty: 1, sourceType: 'dispatch', sourceId: 'DSP-XC', actorId: WH_B_USER.userId }))
      .rejects.toBeTruthy();
    const s = await readState();
    expect(s.summary.onHandQty).toBe(10);
  });

  it('6 (P1-3): a Sales-role actor CANNOT run a movement that changes an existing summary (least privilege preserved)', async () => {
    await seed(10);
    await expect(movementTxn(dbFor(SALES_USER), { movementType: 'DISPATCH_OUT', qty: 1, sourceType: 'dispatch', sourceId: 'DSP-SL', actorId: SALES_USER.userId }))
      .rejects.toBeTruthy();
    const s = await readState();
    expect(s.summary.onHandQty).toBe(10);
  });

  it('7: forged cross-company warehouseId is rejected (warehouseBelongsToCompany)', async () => {
    await seed();
    await expect(movementTxn(dbFor(WH_USER), { movementType: 'PURCHASE_RECEIPT', qty: 5, warehouseId: WH_B, sourceType: 'goods_receipt', sourceId: 'GRN-F', lineKey: 0, actorId: WH_USER.userId }))
      .rejects.toBeTruthy();
  });

  it('8: the deterministic ledger row is immutable (rules `update, delete: if false`)', async () => {
    await seed();
    const r = await movementTxn(dbFor(WH_USER), { movementType: 'PURCHASE_RECEIPT', qty: 5, sourceType: 'goods_receipt', sourceId: 'GRN-IMM', lineKey: 0, actorId: WH_USER.userId });
    const db = dbFor(WH_USER);
    await assertFails(setDoc(doc(db, 'stock_ledger', r.ledgerId), { id: r.ledgerId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, qty: 999, transactionId: 'X', movementAt: serverTimestamp() }));
  });
});
