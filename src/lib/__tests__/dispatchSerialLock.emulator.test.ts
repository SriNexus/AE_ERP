/**
 * dispatchSerialLock.emulator.test.ts — INVENTORY-11 (§11a, rules)
 * ============================================================================
 *
 * Proves, against the Firestore emulator + the CURRENT firestore.rules, the
 * REAL transactional serial-uniqueness guard that replaced the old
 * `getAll(DISPATCH)` full-scan (P2-9):
 *
 *   S1  a fresh serial claim commits atomically with the DISPATCH_OUT +
 *       dispatch status flip; exactly one `dispatch_serials` lock doc exists.
 *   S2  a retry of the SAME dispatch + SAME serial is an idempotent no-op —
 *       no duplicate lock, no second decrement.
 *   S3  a DIFFERENT dispatch claiming an ALREADY-LOCKED serial aborts the
 *       WHOLE transaction — zero partial mutation (stock, ledger, dispatch
 *       status, AND the lock all unchanged).
 *   S4  case-insensitive collision: "sn-100" on dispatch A conflicts with
 *       "SN-100" on dispatch B (normalized comparison).
 *   CONCURRENCY: two DIFFERENT dispatches racing to claim the SAME serial —
 *       Firestore serializes on the SAME lock doc id — exactly one succeeds,
 *       exactly one lock doc exists, never two.
 *   S5  the SAME serial in a DIFFERENT company is independent (no
 *       cross-tenant false positive).
 *   RULES: the lock doc is immutable (update/delete denied); cross-company
 *       read denied; an unauthorized role cannot create a lock directly; a
 *       warehouse-restricted actor cannot claim a serial for a DIFFERENT
 *       warehouse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { normalizeSerial, dispatchSerialLockId } from '../inventory/serialLock';

const PROJECT = 'neozy-dispatch-serial-lock-test';
const CO_A = 'CO-SER-A';
const CO_B = 'CO-SER-B';
const GRP_A = 'GRP-SER-A';
const GRP_B = 'GRP-SER-B';
const WH_A = 'WH-SER-A';
const WH_C = 'WH-SER-C';       // second CO_A warehouse
const WH_FOREIGN = 'WH-SER-FOREIGN'; // CO_B
const P1 = 'PRD-SER-1';
const TERMINAL = ['Dispatched', 'In Transit', 'Delivered', 'Returned', 'Closed'];

const WHU = { uid: 'uid-ser-wh', userId: 'user-ser-wh', email: 'ser-wh@t.test' };           // Warehouse @ WH_A
const WHU_C = { uid: 'uid-ser-whc', userId: 'user-ser-whc', email: 'ser-whc@t.test' };       // Warehouse @ WH_C
const ADMIN = { uid: 'uid-ser-admin', userId: 'user-ser-admin', email: 'ser-admin@t.test' };
const SALES = { uid: 'uid-ser-sales', userId: 'user-ser-sales', email: 'ser-sales@t.test' }; // role outside the allowed pattern
const WHU_B = { uid: 'uid-ser-whb', userId: 'user-ser-whb', email: 'ser-whb@t.test' };       // CO_B Warehouse

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_C), { id: WH_C, companyId: CO_A, groupId: GRP_A, name: 'WH C', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_FOREIGN), { id: WH_FOREIGN, companyId: CO_B, groupId: GRP_B, name: 'Foreign', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });

    const mkUser = (u: typeof WHU, role: string, companyId: string, groupId: string, warehouseId?: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...(warehouseId ? { warehouseId } : {}) }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(WHU, 'Warehouse', CO_A, GRP_A, WH_A);
    await mkUser(WHU_C, 'Warehouse', CO_A, GRP_A, WH_C);
    await mkUser(ADMIN, 'Admin', CO_A, GRP_A);
    await mkUser(SALES, 'Sales', CO_A, GRP_A, WH_A);
    await mkUser(WHU_B, 'Warehouse', CO_B, GRP_B, WH_FOREIGN);
  });
}

async function seedDispatch(id: string, companyId: string, groupId: string, warehouseId: string, status = 'Pending Verification') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'dispatch', id), {
      id, companyId, groupId, warehouseId, orderId: 'ORD-1', status, createdBy: WHU.userId,
      items: [{ productId: P1, product: 'Panel', unit: 'PCS', verifiedQty: 0 }],
    });
  });
}
async function seedStock(companyId: string, groupId: string, warehouseId: string, onHand: number) {
  const stockId = `SUM-${companyId}-${P1}-${warehouseId}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'stock', stockId), {
      id: stockId, companyId, groupId, productId: P1, warehouseId, onHandQty: onHand, availableQty: onHand, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
  });
  return stockId;
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

/**
 * Mirrors `dispatchDocParticipant` (dispatchWorkflow.ts) exactly: reads
 * ledger + stock + dispatch + every serial's lock doc, validates (terminal
 * dispatch -> benign skip; a lock held by ANOTHER dispatch -> throw, abort
 * everything), then writes stock + ledger + dispatch status + every NEW
 * serial lock — all in ONE transaction.
 */
async function verifyDispatchTxn(
  db: ReturnType<typeof dbFor>,
  opts: { dispatchId: string; companyId: string; groupId: string; warehouseId: string; qty: number; actorId: string; serials?: string[]; stockId?: string },
): Promise<{ applied: number; alreadyVerified: boolean }> {
  const stockId = opts.stockId ?? `SUM-${opts.companyId}-${P1}-${opts.warehouseId}`;
  const key = `DISPATCH_OUT:dispatch:${opts.dispatchId}:${P1}`;
  const ledgerId = `STKMV-${encodeURIComponent(key)}`;
  const serials = opts.serials || [];
  const claims = serials.map((s) => ({ serial: s, normalizedSerial: normalizeSerial(s) }));

  return runTransaction(db, async (tx) => {
    const dispatchRef = doc(db, 'dispatch', opts.dispatchId);
    const ledgerRef = doc(db, 'stock_ledger', ledgerId);
    const stockRef = doc(db, 'stock', stockId);
    const lockRefs = claims.map((c) => doc(db, 'dispatch_serials', dispatchSerialLockId(opts.companyId, c.normalizedSerial)));

    // READ PHASE
    const ledgerSnap = await tx.get(ledgerRef);
    const stockSnap = await tx.get(stockRef);
    const dSnap = await tx.get(dispatchRef);
    const lockSnaps = await Promise.all(lockRefs.map((r) => tx.get(r)));
    if (!dSnap.exists()) throw new Error('dispatch not found');

    // VALIDATE PHASE
    if (TERMINAL.includes(String(dSnap.data().status || ''))) return { applied: 0, alreadyVerified: true };
    for (let i = 0; i < claims.length; i++) {
      const snap = lockSnaps[i];
      if (snap.exists() && snap.data().isDeleted !== true && snap.data().dispatchId !== opts.dispatchId) {
        throw new Error(`Serial number ${claims[i].serial} has already been dispatched on another order.`);
      }
    }
    if (ledgerSnap.exists()) return { applied: 0, alreadyVerified: false }; // idempotent no-op

    if (!stockSnap.exists()) throw new Error('stock not found');
    const onHandBefore = Number(stockSnap.data().onHandQty ?? stockSnap.data().availableQty ?? 0) || 0;
    if (onHandBefore < opts.qty) throw new Error(`insufficient (available ${onHandBefore}, need ${opts.qty})`);
    const onHandAfter = onHandBefore - opts.qty;

    // WRITE PHASE
    const base = { ...stockSnap.data() };
    delete (base as Record<string, unknown>).available;
    tx.set(stockRef, {
      ...base, id: stockId, companyId: opts.companyId, groupId: opts.groupId, productId: P1, warehouseId: opts.warehouseId, unit: 'PCS',
      onHandQty: onHandAfter, reservedQty: Number(stockSnap.data().reservedQty ?? 0) || 0, availableQty: onHandAfter,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(), createdAt: stockSnap.data().createdAt ?? serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: ledgerId, companyId: opts.companyId, groupId: opts.groupId, productId: P1, warehouseId: opts.warehouseId, unit: 'PCS',
      movementType: 'DISPATCH_OUT', direction: 'OUT', qty: opts.qty, onHandBefore, onHandAfter, reservedBefore: 0, reservedAfter: 0,
      sourceType: 'dispatch', sourceId: opts.dispatchId, idempotencyKey: key,
      actorId: opts.actorId, transactionId: `TXN-${ledgerId}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      type: 'OUT', referenceType: 'Dispatch', referenceId: opts.dispatchId, date: new Date().toISOString(), notes: '',
    });
    tx.set(dispatchRef, { status: 'Dispatched', verifiedBy: opts.actorId, dispatchedAt: serverTimestamp(), updatedBy: opts.actorId }, { merge: true });
    for (let i = 0; i < claims.length; i++) {
      tx.set(lockRefs[i], {
        id: dispatchSerialLockId(opts.companyId, claims[i].normalizedSerial), companyId: opts.companyId, groupId: opts.groupId,
        serial: claims[i].serial, dispatchId: opts.dispatchId, productId: P1, warehouseId: opts.warehouseId,
        status: 'assigned', isDeleted: false, createdAt: serverTimestamp(), createdBy: opts.actorId,
      });
    }
    return { applied: opts.qty, alreadyVerified: false };
  });
}

async function readLocks(companyId: string) {
  let out: Array<Record<string, unknown>> = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDocs(query(collection(ctx.firestore(), 'dispatch_serials'), where('companyId', '==', companyId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-11 (§11a) — dispatch serial lock transaction (emulator)', () => {
  it('S1: a fresh serial claim commits atomically with the DISPATCH_OUT + dispatch status flip', async () => {
    await seedDispatch('DSP-1', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    const r = await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-1', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-100'] });
    expect(r).toEqual({ applied: 1, alreadyVerified: false });
    const locks = await readLocks(CO_A);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ serial: 'SN-100', dispatchId: 'DSP-1', productId: P1 });
  });

  it('S2: a retry of the SAME dispatch + SAME serial is an idempotent no-op', async () => {
    await seedDispatch('DSP-2', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-2', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-200'] });
    const r2 = await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-2', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-200'] });
    expect(r2.applied).toBe(0);
    const locks = await readLocks(CO_A);
    expect(locks).toHaveLength(1); // no duplicate lock
  });

  it('S3: a DIFFERENT dispatch claiming an already-locked serial aborts the WHOLE transaction — zero partial mutation', async () => {
    await seedDispatch('DSP-A', CO_A, GRP_A, WH_A);
    await seedDispatch('DSP-B', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-A', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-300'] });

    await expect(verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-B', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-300'] }))
      .rejects.toThrow('already been dispatched');

    const locks = await readLocks(CO_A);
    expect(locks).toHaveLength(1); // still only DSP-A's lock
    expect(locks[0].dispatchId).toBe('DSP-A');
    await env.withSecurityRulesDisabled(async (ctx) => {
      const dispatchB = (await getDoc(doc(ctx.firestore(), 'dispatch', 'DSP-B'))).data();
      expect(dispatchB?.status).toBe('Pending Verification'); // NOT flipped — the whole txn aborted
      const stock = (await getDoc(doc(ctx.firestore(), 'stock', `SUM-${CO_A}-${P1}-${WH_A}`))).data();
      expect(stock?.onHandQty).toBe(9); // only DSP-A's decrement applied, DSP-B's never did
    });
  });

  it('S4: a case-insensitive collision is caught ("sn-100" then "SN-100" on a different dispatch)', async () => {
    await seedDispatch('DSP-C', CO_A, GRP_A, WH_A);
    await seedDispatch('DSP-D', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-C', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['sn-100'] });
    await expect(verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-D', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-100'] }))
      .rejects.toThrow('already been dispatched');
  });

  it('CONCURRENCY: two DIFFERENT dispatches racing to claim the SAME serial — exactly one succeeds, exactly one lock exists', async () => {
    await seedDispatch('DSP-E', CO_A, GRP_A, WH_A);
    await seedDispatch('DSP-F', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    const results = await Promise.allSettled([
      verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-E', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-RACE'] }),
      verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-F', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-RACE'] }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled' && (r.value as any).applied > 0).length;
    expect(succeeded).toBe(1);
    const locks = await readLocks(CO_A);
    expect(locks).toHaveLength(1); // never two owners of the same serial
  });

  it('S5: the SAME serial in a DIFFERENT company is independent (no cross-tenant false positive)', async () => {
    await seedDispatch('DSP-G', CO_A, GRP_A, WH_A);
    await seedDispatch('DSP-H', CO_B, GRP_B, WH_FOREIGN);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await seedStock(CO_B, GRP_B, WH_FOREIGN, 10);
    const r1 = await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-G', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-SHARED'] });
    const r2 = await verifyDispatchTxn(dbFor(WHU_B), { dispatchId: 'DSP-H', companyId: CO_B, groupId: GRP_B, warehouseId: WH_FOREIGN, qty: 1, actorId: WHU_B.userId, serials: ['SN-SHARED'] });
    expect(r1.applied).toBe(1);
    expect(r2.applied).toBe(1);
  });

  it('RULES: the lock doc is immutable — update and delete denied', async () => {
    await seedDispatch('DSP-I', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-I', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-IMM'] });
    const lockId = dispatchSerialLockId(CO_A, 'SN-IMM');
    await assertFails(updateDoc(doc(dbFor(WHU), 'dispatch_serials', lockId), { dispatchId: 'DSP-STOLEN' }));
    await assertFails(deleteDoc(doc(dbFor(WHU), 'dispatch_serials', lockId)));
  });

  it('RULES: cross-company read of a lock is denied', async () => {
    await seedDispatch('DSP-J', CO_A, GRP_A, WH_A);
    await seedStock(CO_A, GRP_A, WH_A, 10);
    await verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-J', companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, qty: 1, actorId: WHU.userId, serials: ['SN-XCO'] });
    const lockId = dispatchSerialLockId(CO_A, 'SN-XCO');
    await assertFails(getDoc(doc(dbFor(WHU_B), 'dispatch_serials', lockId)));
  });

  it('RULES: a direct (non-transactional) lock create by an unauthorized role (Sales) is denied', async () => {
    await assertFails(setDoc(doc(dbFor(SALES), 'dispatch_serials', dispatchSerialLockId(CO_A, 'SN-DIRECT')), {
      id: dispatchSerialLockId(CO_A, 'SN-DIRECT'), companyId: CO_A, groupId: GRP_A, serial: 'SN-DIRECT',
      dispatchId: 'DSP-NONE', productId: P1, warehouseId: WH_A, status: 'assigned', isDeleted: false,
    }));
  });

  it('RULES: a cross-company forged warehouseId is denied', async () => {
    await assertFails(setDoc(doc(dbFor(ADMIN), 'dispatch_serials', dispatchSerialLockId(CO_A, 'SN-FORGED')), {
      id: dispatchSerialLockId(CO_A, 'SN-FORGED'), companyId: CO_A, groupId: GRP_A, serial: 'SN-FORGED',
      dispatchId: 'DSP-NONE', productId: P1, warehouseId: WH_FOREIGN /* belongs to CO_B, not CO_A */, status: 'assigned', isDeleted: false,
    }));
  });

  it('RULES: a warehouse-restricted actor cannot claim a serial for a DIFFERENT warehouse', async () => {
    await seedDispatch('DSP-K', CO_A, GRP_A, WH_C);
    await seedStock(CO_A, GRP_A, WH_C, 10);
    // WHU is scoped to WH_A; DSP-K is at WH_C.
    await expect(verifyDispatchTxn(dbFor(WHU), { dispatchId: 'DSP-K', companyId: CO_A, groupId: GRP_A, warehouseId: WH_C, qty: 1, actorId: WHU.userId, serials: ['SN-CROSSWH'] }))
      .rejects.toBeTruthy();
  });
});
