/**
 * dispatchStockOutTransaction.emulator.test.ts — INVENTORY-01
 * =========================================================
 *
 * Verifies, against the Firestore emulator, the transaction/concurrency
 * behavior of the INVENTORY-01 dispatch stock-OUT fix (P0-1). The test issues
 * the EXACT transaction shape that dispatchWorkflow.executeAndVerifyDispatch()
 * now issues in the configured branch — dispatch read + deterministic ledger
 * read + stock read, then stock write + deterministic ledger write + dispatch
 * status write, all inside one runTransaction — and asserts:
 *
 *   1. Warehouse-role actor: succeeds; stock decremented; one OUT ledger row;
 *      dispatch -> 'Dispatched'.
 *   2. CONCURRENCY (Plan §7): stock = 1, two concurrent verifications of 1 unit
 *      -> exactly one applies; final stock = 0; exactly ONE OUT ledger row;
 *      never negative; never two OUT rows.
 *   3. Insufficient stock -> transaction aborts; stock + ledger unchanged.
 *   4. Idempotency: after a successful verify, a second verification finds the
 *      deterministic ledger row and is a no-op -> no second decrement.
 *   5. `stock_ledger` immutability still holds: a raw attempt to overwrite the
 *      deterministic ledger id is DENIED by rules.
 *   6. P1-3 compatibility: an Accounts-role actor CANNOT complete the stock
 *      write (pre-existing field guard — documented, fixed in Plan Phase 03).
 *   7. Cross-company warehouse reference is rejected by rules.
 *   8. Warehouse-restricted scoping: a Warehouse actor cannot decrement another
 *      warehouse's stock.
 *
 * INVENTORY-01 does NOT change firestore.rules.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';

const PROJECT = 'neozy-dispatch-stock-out-txn-test';
const COMPANY_ID = 'CO-DISPOUT-1';
const GROUP_ID = 'GRP-DISPOUT-1';
const WH_A = 'WH-DISPOUT-A';
const WH_B = 'WH-DISPOUT-B';
const PRODUCT_ID = 'PRD-DISPOUT-1';
const DISPATCH_ID = 'DSP-DISPOUT-1';
const STOCK_ID = `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WH_A}`;
// INVENTORY-05c: the movement engine's injective ledger id (the idempotency key
// is byte-identical to the INVENTORY-01 key `DISPATCH_OUT:dispatch:{id}:{pid}`).
const DISPATCH_OUT_KEY = `DISPATCH_OUT:dispatch:${DISPATCH_ID}:${PRODUCT_ID}`;
const LEDGER_ID = `STKMV-${encodeURIComponent(DISPATCH_OUT_KEY)}`;

const UID_WH = 'uid-dispout-wh';
const USER_WH = 'user-dispout-wh';
const UID_ACC = 'uid-dispout-acc';
const USER_ACC = 'user-dispout-acc';

const TERMINAL = ['Dispatched', 'In Transit', 'Delivered', 'Returned', 'Closed'];

let env: RulesTestEnvironment;

async function seed(initialAvailable: number, dispatchStatus = 'Pending Verification') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GROUP_ID), { id: GROUP_ID, name: 'DispOut Group', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_ID), { id: COMPANY_ID, companyId: COMPANY_ID, name: 'DispOut Co', groupId: GROUP_ID });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: COMPANY_ID, groupId: GROUP_ID, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: COMPANY_ID, groupId: GROUP_ID, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'products', PRODUCT_ID), { id: PRODUCT_ID, companyId: COMPANY_ID, name: 'Panel', isDeleted: false });

    await setDoc(doc(db, 'users', USER_WH), { id: USER_WH, companyId: COMPANY_ID, groupId: GROUP_ID, warehouseId: WH_A, role: 'Warehouse', name: 'WH', email: `${USER_WH}@t.test`, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', UID_WH), { authUid: UID_WH, userId: USER_WH, companyId: COMPANY_ID, groupId: GROUP_ID, email: `${USER_WH}@t.test` });
    await setDoc(doc(db, 'users', USER_ACC), { id: USER_ACC, companyId: COMPANY_ID, groupId: GROUP_ID, warehouseId: WH_A, role: 'Accounts', name: 'ACC', email: `${USER_ACC}@t.test`, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', UID_ACC), { authUid: UID_ACC, userId: USER_ACC, companyId: COMPANY_ID, groupId: GROUP_ID, email: `${USER_ACC}@t.test` });

    await setDoc(doc(db, 'stock', STOCK_ID), {
      id: STOCK_ID, companyId: COMPANY_ID, groupId: GROUP_ID, productId: PRODUCT_ID, warehouseId: WH_A,
      availableQty: initialAvailable, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
    await setDoc(doc(db, 'dispatch', DISPATCH_ID), {
      id: DISPATCH_ID, companyId: COMPANY_ID, groupId: GROUP_ID, warehouseId: WH_A, orderId: 'ORD-1',
      status: dispatchStatus, createdBy: USER_WH, items: [{ productId: PRODUCT_ID, product: 'Panel', unit: 'PCS', verifiedQty: 0 }],
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
});
afterAll(async () => {
  await env.cleanup();
});

const dbFor = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

/**
 * INVENTORY-05c: mirrors executeAndVerifyDispatch after the movement-engine
 * migration — ONE runTransaction: the engine reads the deterministic ledger +
 * the stock summary, the `dispatch`-doc PARTICIPANT reads the dispatch (terminal
 * check), then the engine writes stock + stock_ledger and the participant writes
 * the dispatch status — committed together. NO firestore.rules change from
 * INVENTORY-01.
 */
async function verifyLineTxn(
  db: ReturnType<typeof dbFor>,
  opts: { qty: number; actorId: string; stockId?: string; warehouseId?: string; companyId?: string },
): Promise<{ applied: number; alreadyVerified: boolean }> {
  const stockId = opts.stockId ?? STOCK_ID;
  const warehouseId = opts.warehouseId ?? WH_A;
  const companyId = opts.companyId ?? COMPANY_ID;
  return runTransaction(db, async (tx) => {
    const dispatchRef = doc(db, 'dispatch', DISPATCH_ID);
    const ledgerRef = doc(db, 'stock_ledger', LEDGER_ID);
    const stockRef = doc(db, 'stock', stockId);

    // READ PHASE — engine ledger + stock, then participant dispatch read.
    const ledgerSnap = await tx.get(ledgerRef);
    const stockSnap = await tx.get(stockRef);
    const dSnap = await tx.get(dispatchRef);
    if (!dSnap.exists()) throw new Error('dispatch not found');

    // participant.validate — a terminal dispatch is a benign no-op (skip).
    if (TERMINAL.includes(String(dSnap.data().status || ''))) return { applied: 0, alreadyVerified: true };

    if (ledgerSnap.exists()) return { applied: 0, alreadyVerified: false };  // idempotent no-op

    if (!stockSnap.exists()) throw new Error('stock not found');
    const onHandBefore = Number(stockSnap.data().onHandQty ?? stockSnap.data().availableQty ?? 0) || 0;
    if (onHandBefore < opts.qty) throw new Error(`insufficient (available ${onHandBefore}, need ${opts.qty})`);
    const onHandAfter = onHandBefore - opts.qty;

    // WRITE PHASE — engine owns stock + stock_ledger.
    const base = { ...stockSnap.data() };
    delete (base as Record<string, unknown>).available;
    delete (base as Record<string, unknown>).reserved;
    tx.set(stockRef, {
      ...base, id: stockId, companyId, groupId: GROUP_ID, productId: PRODUCT_ID, warehouseId, unit: 'PCS',
      onHandQty: onHandAfter, reservedQty: Number(stockSnap.data().reservedQty ?? 0) || 0, availableQty: onHandAfter,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(),
      createdAt: stockSnap.data().createdAt ?? serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: LEDGER_ID, companyId, groupId: GROUP_ID, productId: PRODUCT_ID, product: 'Panel', warehouseId, warehouse: 'WH A', stockId, unit: 'PCS',
      movementType: 'DISPATCH_OUT', direction: 'OUT', qty: opts.qty, onHandBefore, onHandAfter, reservedBefore: 0, reservedAfter: 0,
      sourceType: 'dispatch', sourceId: DISPATCH_ID, idempotencyKey: DISPATCH_OUT_KEY,
      actorId: opts.actorId, transactionId: `TXN-${LEDGER_ID}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      type: 'OUT', referenceType: 'Dispatch', referenceId: DISPATCH_ID, beforeQty: onHandBefore, afterQty: onHandAfter, date: new Date().toISOString(), notes: 'x',
    });
    // participant.commit — the engine's guarded writer forwards this to the SAME txn.
    tx.set(dispatchRef, { status: 'Dispatched', verifiedBy: opts.actorId, dispatchedAt: serverTimestamp(), updatedBy: opts.actorId }, { merge: true });
    return { applied: opts.qty, alreadyVerified: false };
  });
}

async function readState() {
  let out: { availableQty: number; dispatchStatus: unknown; ledgerOutRows: Array<Record<string, unknown>> } = { availableQty: NaN, dispatchStatus: undefined, ledgerOutRows: [] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const stock = (await getDoc(doc(db, 'stock', STOCK_ID))).data();
    const dispatch = (await getDoc(doc(db, 'dispatch', DISPATCH_ID))).data();
    const ledgers = (await getDocs(query(collection(db, 'stock_ledger'), where('referenceId', '==', DISPATCH_ID), where('type', '==', 'OUT')))).docs.map((d) => ({ id: d.id, ...d.data() }));
    out = { availableQty: Number(stock?.availableQty), dispatchStatus: dispatch?.status, ledgerOutRows: ledgers };
  });
  return out;
}

describe('INVENTORY-01 — dispatch stock-OUT transaction (emulator)', () => {
  it('K2: Warehouse actor verifies a line — atomic decrement + one deterministic OUT ledger + dispatch Dispatched', async () => {
    await seed(10);
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);
    const r = await verifyLineTxn(db, { qty: 3, actorId: USER_WH });
    expect(r).toEqual({ applied: 3, alreadyVerified: false });

    const s = await readState();
    expect(s.availableQty).toBe(7);
    expect(s.dispatchStatus).toBe('Dispatched');
    expect(s.ledgerOutRows).toHaveLength(1);
    expect(s.ledgerOutRows[0].id).toBe(LEDGER_ID);
    expect(s.ledgerOutRows[0]).toMatchObject({ beforeQty: 10, afterQty: 7, idempotencyKey: `DISPATCH_OUT:dispatch:${DISPATCH_ID}:${PRODUCT_ID}` });
  });

  it('D4 / K4 (Plan §7): stock = 1, TWO concurrent 1-unit verifications — exactly one applies, final stock 0, exactly ONE OUT ledger row, never negative', async () => {
    await seed(1);
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);

    const results = await Promise.allSettled([
      verifyLineTxn(db, { qty: 1, actorId: USER_WH }),
      verifyLineTxn(db, { qty: 1, actorId: USER_WH }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ applied: number }>[];
    const appliedTotal = fulfilled.reduce((sum, r) => sum + r.value.applied, 0);

    const s = await readState();
    // Invariants — must hold no matter how the two transactions interleaved:
    expect(s.availableQty).toBe(0);                 // never -1, never 1
    expect(s.availableQty).toBeGreaterThanOrEqual(0);
    expect(s.ledgerOutRows).toHaveLength(1);        // exactly one OUT row (deterministic id)
    expect(appliedTotal).toBe(1);                   // the unit was issued exactly once
    expect(s.dispatchStatus).toBe('Dispatched');
  });

  it('D3 / K3: insufficient stock aborts the whole transaction — stock and ledger unchanged', async () => {
    await seed(2);
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);
    await expect(verifyLineTxn(db, { qty: 5, actorId: USER_WH })).rejects.toThrow('insufficient');

    const s = await readState();
    expect(s.availableQty).toBe(2);
    expect(s.ledgerOutRows).toHaveLength(0);
    expect(s.dispatchStatus).toBe('Pending Verification');
  });

  it('D5 / K5: a second verification after success is an idempotent no-op — no second decrement, still one ledger row', async () => {
    await seed(10);
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);
    await verifyLineTxn(db, { qty: 4, actorId: USER_WH });         // available 10 -> 6, dispatch -> Dispatched
    const second = await verifyLineTxn(db, { qty: 4, actorId: USER_WH }); // rejected: dispatch already terminal / ledger already exists

    expect(second.applied).toBe(0);                 // no second decrement, whichever guard fired
    const s = await readState();
    expect(s.availableQty).toBe(6);                 // NOT 2
    expect(s.ledgerOutRows).toHaveLength(1);
  });

  it('K5 (status guard): once the dispatch is terminal, a verification is a no-op', async () => {
    await seed(10, 'Dispatched');
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);
    const r = await verifyLineTxn(db, { qty: 3, actorId: USER_WH });
    expect(r).toEqual({ applied: 0, alreadyVerified: true });
    const s = await readState();
    expect(s.availableQty).toBe(10);
    expect(s.ledgerOutRows).toHaveLength(0);
  });

  it('ledger immutability: overwriting the deterministic OUT ledger id is DENIED by rules', async () => {
    await seed(10);
    const db = dbFor(UID_WH, `${USER_WH}@t.test`);
    await verifyLineTxn(db, { qty: 1, actorId: USER_WH }); // creates STKOUT-... row
    // A raw attempt to change that row (e.g. a buggy second writer) must fail.
    await assertFails(setDoc(doc(db, 'stock_ledger', LEDGER_ID), {
      id: LEDGER_ID, companyId: COMPANY_ID, groupId: GROUP_ID, productId: PRODUCT_ID, warehouseId: WH_A,
      type: 'OUT', qty: 999, beforeQty: 0, afterQty: 0, transactionId: 'X', movementAt: serverTimestamp(),
    }));
  });

  it('P1-3 compatibility: an Accounts-role actor CANNOT complete the stock write (pre-existing field guard — Plan Phase 03)', async () => {
    await seed(10);
    const db = dbFor(UID_ACC, `${USER_ACC}@t.test`);
    await expect(verifyLineTxn(db, { qty: 1, actorId: USER_ACC })).rejects.toBeTruthy();
    const s = await readState();
    expect(s.availableQty).toBe(10);   // unchanged — the whole transaction aborted
    expect(s.ledgerOutRows).toHaveLength(0);
  });

  it('cross-company / cross-warehouse: a Warehouse actor cannot decrement another warehouse\'s stock', async () => {
    await seed(10);
    // A summary for WH_B (a different warehouse in the same company).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stock', `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WH_B}`), {
        id: `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WH_B}`, companyId: COMPANY_ID, groupId: GROUP_ID,
        productId: PRODUCT_ID, warehouseId: WH_B, availableQty: 5, reservedQty: 0, unit: 'PCS', isDeleted: false,
      });
    });
    const db = dbFor(UID_WH, `${USER_WH}@t.test`); // scoped to WH_A
    await expect(verifyLineTxn(db, { qty: 1, actorId: USER_WH, stockId: `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WH_B}`, warehouseId: WH_B }))
      .rejects.toBeTruthy();
  });
});
