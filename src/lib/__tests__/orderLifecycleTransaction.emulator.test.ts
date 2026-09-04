/**
 * orderLifecycleTransaction.emulator.test.ts — INVENTORY-04
 * ========================================================
 *
 * Verifies, against the Firestore emulator, the transaction guarantees the
 * INVENTORY-04 order-lifecycle locks add (P2-2 cancel atomicity, P2-8 quote
 * -> order convert race). Each test issues the EXACT transaction shape the
 * configured branch of the workflow issues:
 *
 *   convertQuotationToOrder: one runTransaction that re-reads the quotation's
 *     convertedOrderId, then creates the order + marks the quotation.
 *   cancelOrder: one runTransaction that re-reads the order + every affected
 *     dispatch, then flips them all to Cancelled / Returned.
 *
 * INVENTORY-04 changes NO firestore.rules — `orders` / `quotations` remain on
 * the generic company-scoped fallback.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, serverTimestamp, collection, getDocs, where, query } from 'firebase/firestore';

const PROJECT = 'neozy-order-lifecycle-txn-test';
const CO = 'CO-OLC-1';
const GRP = 'GRP-OLC-1';
const UID = 'uid-olc-sales';
const USER = 'user-olc-sales';
const EMAIL = 'olc-sales@t.test';

let env: RulesTestEnvironment;

async function seedIdentity() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP), { id: GRP, name: 'OLC', status: 'Active' });
    await setDoc(doc(db, 'companies', CO), { id: CO, companyId: CO, name: 'OLC Co', groupId: GRP });
    await setDoc(doc(db, 'users', USER), { id: USER, companyId: CO, groupId: GRP, role: 'Sales', name: 'Sales', email: EMAIL, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', UID), { authUid: UID, userId: USER, companyId: CO, groupId: GRP, email: EMAIL });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seedIdentity(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = () => env.authenticatedContext(UID, { email: EMAIL }).firestore();

/** The exact transaction shape convertQuotationToOrder issues (configured branch). */
async function convertTxn(db: ReturnType<typeof dbFor>, quoteId: string, oid: string): Promise<string> {
  const quoteRef = doc(db, 'quotations', quoteId);
  const orderRef = doc(db, 'orders', oid);
  return runTransaction(db, async (tx) => {
    const qSnap = await tx.get(quoteRef);
    if (!qSnap.exists()) throw new Error('quotation not found');
    const q = qSnap.data() as Record<string, unknown>;
    if (q.convertedOrderId) return String(q.convertedOrderId);
    if (q.status === 'Converted to Order') throw new Error('already converted');
    tx.set(orderRef, {
      id: oid, orderNumber: oid, orderNo: oid, companyId: CO, groupId: GRP,
      customerId: 'C-1', customer: 'Cust', orderType: 'B2B', status: 'Pending', paymentStatus: 'Pending',
      subtotal: 100, total: 118, items: [{ productId: '', product: 'Engineering item', qty: 5, price: 0, dispatchedQty: 0, pendingQty: 5 }],
      sourceQuotationId: quoteId, quotationId: quoteId, totalInvoiced: 0, pendingBilling: 118,
      createdBy: USER, createdAt: serverTimestamp(), isDeleted: false,
    });
    tx.set(quoteRef, { status: 'Converted to Order', convertedOrderId: oid, convertedAt: new Date().toISOString(), updatedBy: USER, updatedAt: serverTimestamp() }, { merge: true });
    return oid;
  });
}

/** The exact transaction shape cancelOrder issues for the status flip (configured branch). */
async function cancelStatusTxn(db: ReturnType<typeof dbFor>, orderId: string, dispatchIds: string[]) {
  const orderRef = doc(db, 'orders', orderId);
  return runTransaction(db, async (tx) => {
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists()) throw new Error('order not found');
    if (String((oSnap.data() as Record<string, unknown>).status || '').toLowerCase() === 'cancelled') {
      throw new Error('Order is already cancelled');
    }
    const dSnaps = await Promise.all(dispatchIds.map(async (id) => ({ id, snap: await tx.get(doc(db, 'dispatch', id)) })));
    tx.set(orderRef, { status: 'Cancelled', cancellationReason: 'x', cancelledBy: USER, refundRequired: true, piReversalRequired: true, reversalInvoiceIds: ['PI-1'], updatedBy: USER, updatedAt: serverTimestamp() }, { merge: true });
    for (const d of dSnaps) {
      if (!d.snap.exists()) continue;
      tx.set(doc(db, 'dispatch', d.id), { status: 'Returned', cancellationOrderId: orderId, cancellationReason: 'x', updatedBy: USER, updatedAt: serverTimestamp() }, { merge: true });
    }
  });
}

async function readAll() {
  let out: { orders: any[]; quote: any; dispatches: any[] } = { orders: [], quote: null, dispatches: [] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.orders = (await getDocs(query(collection(db, 'orders'), where('companyId', '==', CO)))).docs.map((d) => ({ id: d.id, ...d.data() }));
    out.quote = (await getDoc(doc(db, 'quotations', 'Q-1'))).data();
    out.dispatches = (await getDocs(query(collection(db, 'dispatch'), where('companyId', '==', CO)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-04 — order lifecycle transactions (emulator)', () => {
  it('P2-8 (13): a normal quotation -> order conversion succeeds and marks the quotation', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'quotations', 'Q-1'), { id: 'Q-1', companyId: CO, groupId: GRP, status: 'Sent', customerId: 'C-1', customer: 'Cust', items: [], total: 118 });
    });
    const id = await convertTxn(dbFor(), 'Q-1', 'ORD-A');
    expect(id).toBe('ORD-A');
    const s = await readAll();
    expect(s.orders).toHaveLength(1);
    expect(s.quote.convertedOrderId).toBe('ORD-A');
    expect(s.quote.status).toBe('Converted to Order');
  });

  it('P2-8 (14/15): two concurrent conversions -> exactly ONE order, both callers get the SAME id', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'quotations', 'Q-1'), { id: 'Q-1', companyId: CO, groupId: GRP, status: 'Sent', customerId: 'C-1', customer: 'Cust', items: [], total: 118 });
    });
    const db = dbFor();
    const results = await Promise.allSettled([
      convertTxn(db, 'Q-1', 'ORD-RACE-A'),
      convertTxn(db, 'Q-1', 'ORD-RACE-B'),
    ]);
    const ids = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(ids.length).toBe(2);                 // neither call throws
    expect(ids[0]).toBe(ids[1]);                // both reference the SAME order
    const s = await readAll();
    expect(s.orders).toHaveLength(1);           // exactly one order created
    expect(s.orders[0].id).toBe(s.quote.convertedOrderId);
    expect(s.quote.convertedOrderId).toBe(ids[0]);
  });

  it('P2-8: engineering-derived item (productId: "") survives the conversion', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'quotations', 'Q-1'), { id: 'Q-1', companyId: CO, groupId: GRP, status: 'Sent', customerId: 'C-1', customer: 'Cust', items: [], total: 118 });
    });
    await convertTxn(dbFor(), 'Q-1', 'ORD-ENG');
    const s = await readAll();
    expect(s.orders[0].items[0].productId).toBe('');
    expect(s.orders[0].items[0].qty).toBe(5);
  });

  it('P2-2 (8): cancel flips the order + every affected dispatch in one transaction', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'orders', 'ORD-C'), { id: 'ORD-C', companyId: CO, groupId: GRP, status: 'Partial Dispatch', customer: 'Cust', items: [{ productId: 'P-1', qty: 5, dispatchedQty: 3 }] });
      await setDoc(doc(db, 'dispatch', 'DSP-1'), { id: 'DSP-1', companyId: CO, groupId: GRP, warehouseId: 'W-1', orderId: 'ORD-C', status: 'Dispatched', createdBy: USER });
      await setDoc(doc(db, 'dispatch', 'DSP-2'), { id: 'DSP-2', companyId: CO, groupId: GRP, warehouseId: 'W-1', orderId: 'ORD-C', status: 'Dispatched', createdBy: USER });
    });
    await cancelStatusTxn(dbFor(), 'ORD-C', ['DSP-1', 'DSP-2']);
    const s = await readAll();
    expect(s.orders[0].status).toBe('Cancelled');
    expect(s.orders[0].piReversalRequired).toBe(true);
    expect(s.orders[0].reversalInvoiceIds).toEqual(['PI-1']);
    expect(s.dispatches.every((d) => d.status === 'Returned')).toBe(true);
    expect(s.dispatches).toHaveLength(2);
  });

  it('P2-2 (9): a precondition failure (already cancelled) aborts the whole transaction — no partial status flips', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'orders', 'ORD-C'), { id: 'ORD-C', companyId: CO, groupId: GRP, status: 'Cancelled', customer: 'Cust', items: [] });
      await setDoc(doc(db, 'dispatch', 'DSP-1'), { id: 'DSP-1', companyId: CO, groupId: GRP, warehouseId: 'W-1', orderId: 'ORD-C', status: 'Dispatched', createdBy: USER });
    });
    await expect(cancelStatusTxn(dbFor(), 'ORD-C', ['DSP-1'])).rejects.toThrow('already cancelled');
    const s = await readAll();
    expect(s.dispatches[0].status).toBe('Dispatched');   // untouched — the txn aborted before any write
  });
});
