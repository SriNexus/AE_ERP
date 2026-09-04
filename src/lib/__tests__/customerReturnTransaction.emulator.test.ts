/**
 * customerReturnTransaction.emulator.test.ts — INVENTORY-10 (§10e, rules)
 * ============================================================================
 *
 * Proves, against the Firestore emulator + the CURRENT firestore.rules:
 *
 *   R1  resellable return → onHand increases; ONE SALES_RETURN_IN ledger row;
 *       customer_returns doc committed in the SAME transaction.
 *   R2  damaged return → SALES_RETURN_IN then DAMAGE_OUT, net onHand unchanged,
 *       BOTH ledger rows share the return's sourceId.
 *   R3  retrying the SAME returnId is a benign no-op (idempotent) — no double
 *       restock, no duplicate ledger rows, no duplicate customer_returns doc.
 *   CONCURRENCY: two concurrent creates of the SAME returnId → exactly one
 *                applies; final onHand reflects a single restock.
 *   RULES: cross-company read denied; an unauthorized role (Sales-less /
 *          random role outside the pattern) denied create; a warehouse-
 *          restricted actor can only return into their own warehouse;
 *          the return doc is immutable (update/delete denied); its ledger
 *          rows are immutable.
 *
 * The transaction helper replicates `applyBatchConfigured` +
 * `customerReturnWorkflow.ts`'s `returnParticipant` (INVENTORY-10 §10e).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { buildIdempotencyKey, movementLedgerId } from '../inventory/idempotency';

const PROJECT = 'neozy-customer-return-test';
const CO_A = 'CO-RET-A';
const CO_B = 'CO-RET-B';
const GRP_A = 'GRP-RET-A';
const GRP_B = 'GRP-RET-B';
const WH_A = 'WH-RET-A';
const WH_FOREIGN = 'WH-RET-FOREIGN'; // CO_B
const P1 = 'PRD-RET-1';
const ORDER = 'ORD-RET-1';
const DISPATCH = 'DSP-RET-1';
const EPS = 1e-6;

const WHU = { uid: 'uid-ret-wh', userId: 'user-ret-wh', email: 'ret-wh@t.test' };          // Warehouse @ WH_A
const ADMIN = { uid: 'uid-ret-admin', userId: 'user-ret-admin', email: 'ret-admin@t.test' };
const ENGINEER = { uid: 'uid-ret-eng', userId: 'user-ret-eng', email: 'ret-eng@t.test' };   // NOT in the allowed-role pattern
const WHU_B = { uid: 'uid-ret-whb', userId: 'user-ret-whb', email: 'ret-whb@t.test' };      // CO_B Warehouse
const WHU_OTHER_WH = { uid: 'uid-ret-oth', userId: 'user-ret-oth', email: 'ret-oth@t.test' }; // Warehouse @ a different CO_A warehouse

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', 'WH-RET-C'), { id: 'WH-RET-C', companyId: CO_A, groupId: GRP_A, name: 'WH C', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_FOREIGN), { id: WH_FOREIGN, companyId: CO_B, groupId: GRP_B, name: 'Foreign', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });
    await setDoc(doc(db, 'orders', ORDER), { id: ORDER, companyId: CO_A, isDeleted: false });
    await setDoc(doc(db, 'dispatch', DISPATCH), {
      id: DISPATCH, companyId: CO_A, groupId: GRP_A, orderId: ORDER, warehouseId: WH_A,
      items: [{ productId: P1, verifiedQty: 20, unit: 'PCS' }], isDeleted: false,
    });

    const mkUser = (u: typeof WHU, role: string, companyId: string, groupId: string, warehouseId?: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...(warehouseId ? { warehouseId } : {}) }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(WHU, 'Warehouse', CO_A, GRP_A, WH_A);
    await mkUser(ADMIN, 'Admin', CO_A, GRP_A);
    await mkUser(ENGINEER, 'Engineer', CO_A, GRP_A);
    await mkUser(WHU_B, 'Warehouse', CO_B, GRP_B, WH_FOREIGN);
    await mkUser(WHU_OTHER_WH, 'Warehouse', CO_A, GRP_A, 'WH-RET-C');

    await setDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`), {
      id: `SUM-${CO_A}-${P1}-${WH_A}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A,
      onHandQty: 50, availableQty: 50, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

interface ReturnLeg { productId: string; qty: number; unit: string; damaged?: boolean; damageReasonCode?: string; }

/**
 * Replicates the movement-engine transaction + `returnParticipant` for a
 * single customer return: reads the return doc + every leg's ledger/stock
 * rows, then — atomically — writes the return doc + the applicable stock
 * summary/ledger rows. A pre-existing return doc is a benign idempotent
 * no-op (mirrors `returnParticipant.validate`).
 */
async function createReturnTxn(
  db: ReturnType<typeof dbFor>,
  opts: { returnId: string; warehouseId: string; actorId: string; legs: ReturnLeg[] },
) {
  const { returnId, warehouseId, actorId, legs } = opts;
  const retRef = doc(db, 'customer_returns', returnId);

  return runTransaction(db, async (tx) => {
    const retSnap = await tx.get(retRef);
    if (retSnap.exists()) return { applied: false, skipped: true };

    type Movement = { movementType: 'SALES_RETURN_IN' | 'DAMAGE_OUT'; sourceType: string; qty: number; productId: string; unit: string; reasonCode?: string };
    const movements: Movement[] = [];
    for (const leg of legs) {
      movements.push({ movementType: 'SALES_RETURN_IN', sourceType: 'customer_return', qty: leg.qty, productId: leg.productId, unit: leg.unit });
      if (leg.damaged) {
        movements.push({ movementType: 'DAMAGE_OUT', sourceType: 'customer_return_damage', qty: leg.qty, productId: leg.productId, unit: leg.unit, reasonCode: leg.damageReasonCode });
      }
    }

    const stockId = `SUM-${CO_A}-${P1}-${warehouseId}`;
    const stockRef = doc(db, 'stock', stockId);
    const stockSnap = await tx.get(stockRef);
    let onHand = Number(stockSnap.data()?.onHandQty ?? stockSnap.data()?.availableQty) || 0;
    const reserved = Number(stockSnap.data()?.reservedQty) || 0;

    const ledgerWrites: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    for (const m of movements) {
      const key = buildIdempotencyKey(m.movementType, m.sourceType, returnId, m.productId);
      const ledgerId = movementLedgerId(key);
      const ledgerRef = doc(db, 'stock_ledger', ledgerId);
      const ledgerSnap = await tx.get(ledgerRef);
      if (ledgerSnap.exists()) continue; // this leg already applied (shouldn't happen when the doc itself is new)
      const dir = m.movementType === 'SALES_RETURN_IN' ? 'IN' : 'OUT';
      const onHandBefore = onHand;
      const onHandAfter = dir === 'IN' ? onHand + m.qty : onHand - m.qty;
      if (onHandAfter < -EPS) throw new Error(`Insufficient stock: onHandQty -> ${onHandAfter}`);
      onHand = onHandAfter;
      ledgerWrites.push({
        ref: ledgerRef,
        data: {
          id: ledgerId, companyId: CO_A, groupId: GRP_A, productId: m.productId, warehouseId, unit: m.unit,
          movementType: m.movementType, direction: dir, qty: m.qty,
          onHandBefore, onHandAfter, reservedBefore: reserved, reservedAfter: reserved,
          sourceType: m.sourceType, sourceId: returnId, idempotencyKey: key,
          ...(m.reasonCode ? { reasonCode: m.reasonCode } : {}),
          actorId, transactionId: `TXN-${ledgerId}`, movementAt: serverTimestamp(),
          createdAt: serverTimestamp(), createdBy: actorId, isDeleted: false,
          type: dir, referenceType: m.movementType === 'SALES_RETURN_IN' ? 'CustomerReturn' : 'CustomerReturnDamage',
          referenceId: returnId, date: new Date().toISOString(), notes: '',
        },
      });
    }

    tx.set(stockRef, {
      ...(stockSnap.data() || {}), id: stockId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId,
      unit: 'PCS', onHandQty: onHand, reservedQty: reserved, availableQty: onHand - reserved,
      updatedBy: actorId, updatedAt: serverTimestamp(),
      createdAt: stockSnap.data()?.createdAt ?? serverTimestamp(), isDeleted: false,
    });
    for (const w of ledgerWrites) tx.set(w.ref, w.data);
    tx.set(retRef, {
      id: returnId, companyId: CO_A, groupId: GRP_A, orderId: ORDER, dispatchId: DISPATCH, warehouseId,
      items: legs.map((l) => ({ productId: l.productId, qty: l.qty, unit: l.unit, condition: l.damaged ? 'damaged' : 'resellable', ...(l.damageReasonCode ? { damageReasonCode: l.damageReasonCode } : {}) })),
      status: 'processed', createdBy: actorId, createdAt: new Date().toISOString(), isDeleted: false,
    });

    return { applied: true, skipped: false, onHandAfter: onHand };
  });
}

async function readState(returnId: string) {
  let out: any = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.stock = (await getDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`))).data();
    out.ret = (await getDoc(doc(db, 'customer_returns', returnId))).data();
    out.ledger = (await getDocs(query(collection(db, 'stock_ledger'), where('referenceId', '==', returnId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-10 (§10e) — customer return / RMA transaction (emulator)', () => {
  it('R1: a resellable return restocks onHand and commits ONE SALES_RETURN_IN ledger row atomically with the return doc', async () => {
    const r = await createReturnTxn(dbFor(WHU), { returnId: 'RET-1', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 5, unit: 'PCS' }] });
    expect(r).toMatchObject({ applied: true, onHandAfter: 55 });
    const st = await readState('RET-1');
    expect(st.stock.onHandQty).toBe(55);
    expect(st.ret).toMatchObject({ status: 'processed', orderId: ORDER, dispatchId: DISPATCH });
    expect(st.ledger).toHaveLength(1);
    expect(st.ledger[0]).toMatchObject({ movementType: 'SALES_RETURN_IN', direction: 'IN', qty: 5 });
  });

  it('R2: a damaged return restocks then writes off — net onHand unchanged, BOTH ledger rows recorded', async () => {
    const r = await createReturnTxn(dbFor(WHU), { returnId: 'RET-2', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 4, unit: 'PCS', damaged: true, damageReasonCode: 'damaged' }] });
    expect(r).toMatchObject({ applied: true, onHandAfter: 50 });
    const st = await readState('RET-2');
    expect(st.stock.onHandQty).toBe(50);
    expect(st.ledger.map((l: any) => l.movementType).sort()).toEqual(['DAMAGE_OUT', 'SALES_RETURN_IN']);
    expect(st.ledger.every((l: any) => l.sourceId === 'RET-2')).toBe(true);
  });

  it('R3: retrying the SAME returnId is a benign idempotent no-op', async () => {
    await createReturnTxn(dbFor(WHU), { returnId: 'RET-3', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 6, unit: 'PCS' }] });
    const r2 = await createReturnTxn(dbFor(WHU), { returnId: 'RET-3', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 6, unit: 'PCS' }] });
    expect(r2.skipped).toBe(true);
    const st = await readState('RET-3');
    expect(st.stock.onHandQty).toBe(56); // not 62 — no double restock
    expect(st.ledger).toHaveLength(1);
  });

  it('CONCURRENCY: two concurrent creates of the SAME returnId → exactly one applies', async () => {
    const results = await Promise.allSettled([
      createReturnTxn(dbFor(WHU), { returnId: 'RET-4', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 3, unit: 'PCS' }] }),
      createReturnTxn(dbFor(WHU), { returnId: 'RET-4', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 3, unit: 'PCS' }] }),
    ]);
    const applied = results.filter((r) => r.status === 'fulfilled' && (r.value as any).applied).length;
    expect(applied).toBe(1);
    const st = await readState('RET-4');
    expect(st.stock.onHandQty).toBe(53);
    expect(st.ledger).toHaveLength(1);
  });

  it('RULES: cross-company read of a customer_returns doc is denied', async () => {
    await createReturnTxn(dbFor(WHU), { returnId: 'RET-5', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 1, unit: 'PCS' }] });
    await assertFails(getDoc(doc(dbFor(WHU_B), 'customer_returns', 'RET-5')));
  });

  it('RULES: a role outside the allowed pattern (e.g. Engineer) is denied direct create', async () => {
    await assertFails(setDoc(doc(dbFor(ENGINEER), 'customer_returns', 'RET-6'), {
      id: 'RET-6', companyId: CO_A, groupId: GRP_A, orderId: ORDER, dispatchId: DISPATCH, warehouseId: WH_A,
      items: [{ productId: P1, qty: 1, unit: 'PCS', condition: 'resellable' }], status: 'processed',
      createdBy: ENGINEER.userId, createdAt: new Date().toISOString(), isDeleted: false,
    }));
  });

  it('RULES: a warehouse-restricted actor cannot create a return for a DIFFERENT warehouse', async () => {
    await assertFails(setDoc(doc(dbFor(WHU_OTHER_WH), 'customer_returns', 'RET-7'), {
      id: 'RET-7', companyId: CO_A, groupId: GRP_A, orderId: ORDER, dispatchId: DISPATCH, warehouseId: WH_A,
      items: [{ productId: P1, qty: 1, unit: 'PCS', condition: 'resellable' }], status: 'processed',
      createdBy: WHU_OTHER_WH.userId, createdAt: new Date().toISOString(), isDeleted: false,
    }));
  });

  it('RULES: a cross-company actor cannot create a return referencing this company\'s warehouse', async () => {
    await assertFails(setDoc(doc(dbFor(WHU_B), 'customer_returns', 'RET-8'), {
      id: 'RET-8', companyId: CO_B, groupId: GRP_B, orderId: ORDER, dispatchId: DISPATCH, warehouseId: WH_A,
      items: [{ productId: P1, qty: 1, unit: 'PCS', condition: 'resellable' }], status: 'processed',
      createdBy: WHU_B.userId, createdAt: new Date().toISOString(), isDeleted: false,
    }));
  });

  it('RULES: the return doc is immutable (update + delete denied); its ledger row is immutable', async () => {
    await createReturnTxn(dbFor(WHU), { returnId: 'RET-9', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 2, unit: 'PCS' }] });
    await assertFails(updateDoc(doc(dbFor(WHU), 'customer_returns', 'RET-9'), { notes: 'edited' }));
    await assertFails(deleteDoc(doc(dbFor(WHU), 'customer_returns', 'RET-9')));
    const ledgerId = movementLedgerId(buildIdempotencyKey('SALES_RETURN_IN', 'customer_return', 'RET-9', P1));
    await assertFails(updateDoc(doc(dbFor(WHU), 'stock_ledger', ledgerId), { qty: 999 }));
  });

  it('RULES: a suspended group cannot create a customer return', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Suspended' });
    });
    await expect(createReturnTxn(dbFor(WHU), { returnId: 'RET-10', warehouseId: WH_A, actorId: WHU.userId, legs: [{ productId: P1, qty: 1, unit: 'PCS' }] }))
      .rejects.toThrow();
  });

  it('RULES: an Admin (company-wide, not warehouse-restricted) may create a return for any of the company\'s warehouses', async () => {
    const r = await createReturnTxn(dbFor(ADMIN), { returnId: 'RET-11', warehouseId: WH_A, actorId: ADMIN.userId, legs: [{ productId: P1, qty: 2, unit: 'PCS' }] });
    expect(r.applied).toBe(true);
  });
});
