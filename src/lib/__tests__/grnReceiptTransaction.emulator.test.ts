/**
 * grnReceiptTransaction.emulator.test.ts — INVENTORY-03
 * ====================================================
 *
 * Verifies, against the Firestore emulator, the transaction / concurrency /
 * authorization behavior of the INVENTORY-03 Goods Receipt fix
 * (P1-1 / P1-2 / P1-5 / P1-3 / INV-13). The test issues the EXACT single
 * transaction shape goodsReceiptWorkflow.createGoodsReceipt() issues in the
 * configured branch — PO read + deterministic GRN-doc read + per-line
 * (deterministic ledger read + summary read), then per-line summary + ledger
 * writes + PO increment + GRN doc write, all inside ONE runTransaction — and
 * asserts:
 *
 *   J6  full receipt   -> stock +ordered, one IN ledger row, PO 'Received'
 *   J7  partial x2      -> receivedQty increments, PO PartiallyReceived->Received
 *   J8  over-receipt    -> rejected inside the txn, NOTHING written (INV-13)
 *   J9  double-submit   -> deterministic GRN id => 2nd is a no-op, one stock IN
 *   J10 concurrent      -> Σ received <= ordered always; 4+6 -> exactly 10
 *   J11 Procurement role -> CAN receive into an EXISTING summary (P1-3 fixed)
 *   J12 atomicity        -> a rejected / losing receipt leaves no partial state
 *   E3  Sales / Accounts -> DENIED (least privilege preserved)
 *   C7  forged cross-company warehouseId -> DENIED
 *   N1  cross-company receipt -> DENIED
 *   N5  goods_receipts / stock_ledger update -> DENIED (immutable)
 *   PartiallyReceived -> PartiallyReceived PO update -> ALLOWED by rules
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';

const PROJECT = 'neozy-grn-receipt-txn-test';
const CO_A = 'CO-GRN-A';
const CO_B = 'CO-GRN-B';
const GRP_A = 'GRP-GRN-A';
const GRP_B = 'GRP-GRN-B';
const WH_A = 'WH-GRN-A';
const WH_B = 'WH-GRN-B';
const P1 = 'PRD-GRN-1';
const P2 = 'PRD-GRN-2';
const PO_ID = 'PO-GRN-1';

const U = (role: string) => ({ uid: `uid-grn-${role}`, userId: `user-grn-${role}`, email: `grn-${role}@t.test`, role });
const PROC = U('proc');
const WHU = U('wh');
const SALES = U('sales');
const ACC = U('acc');
const PROC_B = { uid: 'uid-grn-procB', userId: 'user-grn-procB', email: 'grn-procB@t.test', role: 'proc' };

let env: RulesTestEnvironment;

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
type Line = { lineIndex: number; productId: string; product: string; qty: number; previouslyReceivedQty: number; unit: string };
const grnDocId = (poId: string, lines: Line[]) =>
  `GRN-${encodeURIComponent(poId)}-${djb2(`${poId}#${lines.map((l) => `L${l.lineIndex}:B${l.previouslyReceivedQty}:Q${l.qty}`).sort().join('|')}`)}`;
// INVENTORY-05b: the movement-engine idempotency key + deterministic (injective)
// ledger doc id. `grnId` already encodes each line's (before, qty), so two
// submissions from the same PO snapshot produce the same key.
const grnMovementKey = (grnId: string, lineIndex: number) => `PURCHASE_RECEIPT:goods_receipt:${grnId}:${lineIndex}`;
const grnLedgerId = (grnId: string, lineIndex: number) => `STKMV-${encodeURIComponent(grnMovementKey(grnId, lineIndex))}`;

async function seed(opts: { poItems: Array<{ productId: string; qty: number; receivedQty: number }>; poStatus?: string; existingSummaries?: Array<{ productId: string; warehouseId: string; companyId: string; groupId: string; availableQty: number }> }) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: CO_B, groupId: GRP_B, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });
    await setDoc(doc(db, 'products', P2), { id: P2, companyId: CO_A, name: 'Inverter', isDeleted: false });

    for (const u of [PROC, WHU, SALES, ACC]) {
      await setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, role: u.role === 'proc' ? 'Procurement' : u.role === 'wh' ? 'Warehouse' : u.role === 'sales' ? 'Sales' : 'Accounts', name: u.role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
      await setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId: CO_A, groupId: GRP_A, email: u.email });
    }
    await setDoc(doc(db, 'users', PROC_B.userId), { id: PROC_B.userId, companyId: CO_B, groupId: GRP_B, warehouseId: WH_B, role: 'Procurement', name: 'procB', email: PROC_B.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', PROC_B.uid), { authUid: PROC_B.uid, userId: PROC_B.userId, companyId: CO_B, groupId: GRP_B, email: PROC_B.email });

    await setDoc(doc(db, 'purchase_orders', PO_ID), {
      id: PO_ID, purchaseOrderId: PO_ID, companyId: CO_A, groupId: GRP_A, vendorId: 'VEN-1', vendorName: 'Vendor',
      status: opts.poStatus || 'Sent', statusHistory: [],
      items: opts.poItems.map((it) => ({ productId: it.productId, product: it.productId === P1 ? 'Panel' : 'Inverter', qty: it.qty, unit: 'Nos', price: 10, tax: 0, discount: 0, taxableValue: 10, taxAmount: 0, total: 10, receivedQty: it.receivedQty })),
    });
    for (const s of opts.existingSummaries || []) {
      await setDoc(doc(db, 'stock', `SUM-${s.companyId}-${s.productId}-${s.warehouseId}`), {
        id: `SUM-${s.companyId}-${s.productId}-${s.warehouseId}`, companyId: s.companyId, groupId: s.groupId,
        productId: s.productId, warehouseId: s.warehouseId, availableQty: s.availableQty, reservedQty: 0, unit: 'Nos', isDeleted: false,
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

/**
 * INVENTORY-05b: mirrors goodsReceiptWorkflow.createGoodsReceipt after the
 * movement-engine migration —
 *   reconcile-scan (goods_receipts + stock_ledger by purchaseOrderId) -> ONE
 *   atomic runTransaction: engine reads every line's stock_ledger + stock,
 *   the `purchase_orders` PARTICIPANT reads the PO, validates INV-13, then the
 *   engine writes stock + stock_ledger and the participant writes the PO
 *   receivedQty/status — all committed together (Plan §4.1 / §8) -> GRN doc via
 *   setDoc. NO firestore.rules change from INVENTORY-03.
 */
async function grnReceiptTxn(
  db: ReturnType<typeof dbFor>,
  opts: { lines: Line[]; warehouseId?: string; companyId?: string; groupId?: string; actorId: string },
): Promise<{ alreadyReceived: boolean; grnId: string; applied: number; status?: string }> {
  const warehouseId = opts.warehouseId ?? WH_A;
  const companyId = opts.companyId ?? CO_A;
  const groupId = opts.groupId ?? GRP_A;
  const grnId = grnDocId(PO_ID, opts.lines);

  // RECONCILE — rebuild any GRN doc whose atomic stock+PO transaction committed
  // but whose doc write failed (J12), from the orphan ledger rows (which now
  // carry grnLineIndex / grnPreviouslyReceivedQty directly — INVENTORY-05b).
  const priorDocs = await getDocs(query(collection(db, 'goods_receipts'), where('companyId', '==', companyId), where('purchaseOrderId', '==', PO_ID)));
  const docIds = new Set(priorDocs.docs.map((d) => d.id));
  const priorLedgers = await getDocs(query(collection(db, 'stock_ledger'), where('companyId', '==', companyId), where('purchaseOrderId', '==', PO_ID)));
  const orphanGrnIds = new Set(priorLedgers.docs.map((d) => String((d.data() as Record<string, any>).referenceId || '')).filter((id) => id && !docIds.has(id)));
  for (const orphanId of orphanGrnIds) {
    const rows = priorLedgers.docs.filter((d) => (d.data() as Record<string, any>).referenceId === orphanId).map((d) => d.data() as Record<string, any>);
    await setDoc(doc(db, 'goods_receipts', orphanId), {
      id: orphanId, goodsReceiptId: orphanId, companyId, groupId, purchaseOrderId: PO_ID, vendorId: 'VEN-1', vendorName: 'Vendor',
      warehouseId, warehouseName: 'WH', receivedDate: '2026-07-10', receivedBy: opts.actorId, notes: '',
      receivedItems: rows.map((r) => ({ lineIndex: Number(r.grnLineIndex) || 0, productId: r.productId, product: r.product, qty: r.qty, unit: r.unit, orderedQty: 0, previouslyReceivedQty: Number(r.grnPreviouslyReceivedQty) || 0 })),
      stockEntries: [], stockApplied: rows.map((r) => r.id),
    });
    docIds.add(orphanId);
  }

  // DEDUPE — an already-recorded identical receipt (same deterministic id) is a no-op (J9).
  if (docIds.has(grnId)) {
    const snap = await getDoc(doc(db, 'goods_receipts', grnId));
    return { alreadyReceived: true, grnId, applied: 0, status: String((snap.data() as Record<string, any> | undefined)?.status || '') };
  }

  const poRef = doc(db, 'purchase_orders', PO_ID);
  const grnRef = doc(db, 'goods_receipts', grnId);

  // ATOMIC — engine (stock + stock_ledger) + PO participant, ONE runTransaction.
  const t = await runTransaction(db, async (tx) => {
    // READ PHASE — engine ledger+stock reads, then participant PO read.
    const reads: Array<{ l: Line; stockRef: ReturnType<typeof doc>; ledgerRef: ReturnType<typeof doc>; ledgerExists: boolean; stock: Record<string, any> | null; stockId: string }> = [];
    for (const l of opts.lines) {
      const stockId = `SUM-${companyId}-${l.productId}-${warehouseId}`;
      const ledgerRef = doc(db, 'stock_ledger', grnLedgerId(grnId, l.lineIndex));
      const ledgerSnap = await tx.get(ledgerRef);
      const stockRef = doc(db, 'stock', stockId);
      const stockSnap = await tx.get(stockRef);
      reads.push({ l, stockRef, ledgerRef, ledgerExists: ledgerSnap.exists(), stock: stockSnap.exists() ? stockSnap.data() as Record<string, any> : null, stockId });
    }
    const poSnap = await tx.get(poRef);                         // participant.read
    if (!poSnap.exists()) throw new Error('po not found');
    const po = poSnap.data() as Record<string, any>;

    // PLAN
    const applyByLine = new Map<number, number>();
    let anything = false;
    for (const r of reads) {
      if (r.ledgerExists) { applyByLine.set(r.l.lineIndex, 0); continue; }
      applyByLine.set(r.l.lineIndex, r.l.qty);
      anything = true;
    }

    // participant.validate — receivable + INV-13 over-receipt against the fresh PO
    if (!['Sent', 'PartiallyReceived'].includes(String(po.status))) throw new Error('not receivable');
    for (const [idx, add] of applyByLine) {
      if (add <= 0) continue;
      const item = (po.items || [])[idx] || {};
      if ((Number(item.receivedQty) || 0) + add > (Number(item.qty) || 0) + 1e-6) throw new Error(`over-receipt line ${idx}`);
    }
    if (!anything) return { alreadyReceived: true, status: String(po.status), applied: 0 };

    // WRITE PHASE — engine owns stock + stock_ledger
    let applied = 0;
    for (const r of reads) {
      const add = applyByLine.get(r.l.lineIndex) || 0;
      if (r.ledgerExists || add <= 0) continue;
      const existing = r.stock || {};
      const base = { ...existing }; delete (base as Record<string, unknown>).available; delete (base as Record<string, unknown>).reserved;
      const before = Number(existing.onHandQty ?? existing.availableQty ?? existing.available) || 0;
      const after = before + add;
      tx.set(r.stockRef, { ...base, id: r.stockId, companyId, groupId, productId: r.l.productId, warehouseId, unit: r.l.unit, onHandQty: after, reservedQty: 0, availableQty: after, updatedBy: opts.actorId, updatedAt: serverTimestamp(), createdAt: existing.createdAt ?? serverTimestamp(), isDeleted: false });
      tx.set(r.ledgerRef, {
        id: r.ledgerRef.id, companyId, groupId, productId: r.l.productId, product: r.l.product, warehouseId, warehouse: 'WH', stockId: r.stockId, unit: r.l.unit,
        movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: add, onHandBefore: before, onHandAfter: after, reservedBefore: 0, reservedAfter: 0,
        sourceType: 'goods_receipt', sourceId: grnId, idempotencyKey: grnMovementKey(grnId, r.l.lineIndex),
        actorId: opts.actorId, transactionId: `TXN-${r.ledgerRef.id}`, movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
        type: 'IN', referenceType: 'GoodsReceipt', referenceId: grnId, purchaseOrderId: PO_ID, beforeQty: before, afterQty: after,
        grnLineIndex: r.l.lineIndex, grnPreviouslyReceivedQty: r.l.previouslyReceivedQty, date: new Date().toISOString(), notes: 'x',
      });
      applied += add;
    }

    // participant.commit — the engine's guarded writer forwards this to the SAME txn
    const newItems = (po.items || []).map((it: Record<string, any>, idx: number) => {
      const rec = (Number(it.receivedQty) || 0) + (applyByLine.get(idx) || 0);
      return { ...it, receivedQty: rec, remainingQty: Math.max(0, (Number(it.qty) || 0) - rec) };
    });
    const newStatus = newItems.every((it: Record<string, any>) => (it.remainingQty || 0) <= 1e-6) ? 'Received' : 'PartiallyReceived';
    tx.set(poRef, { items: newItems, status: newStatus, statusHistory: [...(po.statusHistory || []), { status: newStatus, changedAt: new Date().toISOString(), changedBy: opts.actorId }], updatedBy: opts.actorId }, { merge: true });
    return { alreadyReceived: false, status: newStatus, applied };
  });

  // GRN doc — deterministic id, written after the atomic transaction.
  if (!t.alreadyReceived) {
    await setDoc(grnRef, {
      id: grnId, goodsReceiptId: grnId, companyId, groupId, purchaseOrderId: PO_ID, vendorId: 'VEN-1', vendorName: 'Vendor',
      warehouseId, warehouseName: 'WH', receivedDate: '2026-07-10', receivedBy: opts.actorId, notes: '',
      receivedItems: opts.lines.map((l) => ({ lineIndex: l.lineIndex, productId: l.productId, product: l.product, qty: l.qty, unit: l.unit, orderedQty: 0, previouslyReceivedQty: l.previouslyReceivedQty })),
      stockEntries: opts.lines.map((l) => ({ productId: l.productId, stockId: `SUM-${companyId}-${l.productId}-${warehouseId}`, ledgerId: grnLedgerId(grnId, l.lineIndex), transactionId: '' })),
      stockApplied: opts.lines.map((l) => grnLedgerId(grnId, l.lineIndex)),
    });
  }
  return { alreadyReceived: t.alreadyReceived, grnId, applied: t.applied, status: t.status };
}

async function readState() {
  let out: { po: any; summaries: Record<string, number>; inLedgerRows: any[]; grnDocs: any[] } = { po: null, summaries: {}, inLedgerRows: [], grnDocs: [] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.po = (await getDoc(doc(db, 'purchase_orders', PO_ID))).data();
    const stock = await getDocs(query(collection(db, 'stock'), where('companyId', '==', CO_A)));
    for (const d of stock.docs) out.summaries[d.id] = Number((d.data() as any).availableQty);
    const led = await getDocs(query(collection(db, 'stock_ledger'), where('referenceType', '==', 'GoodsReceipt')));
    out.inLedgerRows = led.docs.map((d) => ({ id: d.id, ...d.data() }));
    const grns = await getDocs(query(collection(db, 'goods_receipts'), where('purchaseOrderId', '==', PO_ID)));
    out.grnDocs = grns.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

const line = (lineIndex: number, productId: string, qty: number, before: number): Line => ({ lineIndex, productId, product: productId === P1 ? 'Panel' : 'Inverter', qty, previouslyReceivedQty: before, unit: 'Nos' });

describe('INVENTORY-03 — Goods Receipt transaction (emulator)', () => {
  it('J6: Procurement full receipt — stock +10, one IN ledger row, PO Received', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const r = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 10, 0)], actorId: PROC.userId });
    expect(r).toMatchObject({ alreadyReceived: false, applied: 10, status: 'Received' });
    const s = await readState();
    expect(s.po.status).toBe('Received');
    expect(s.po.items[0].receivedQty).toBe(10);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(10);
    expect(s.inLedgerRows).toHaveLength(1);
    expect(s.grnDocs).toHaveLength(1);
  });

  it('J7: partial then second partial — receivedQty increments, PartiallyReceived -> Received', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const r1 = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId });
    expect(r1.status).toBe('PartiallyReceived');
    let s = await readState();
    expect(s.po.items[0].receivedQty).toBe(4);
    const r2 = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 6, 4)], actorId: PROC.userId });
    expect(r2.status).toBe('Received');
    s = await readState();
    expect(s.po.items[0].receivedQty).toBe(10);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(10);
    expect(s.inLedgerRows).toHaveLength(2);
  });

  it('PartiallyReceived -> PartiallyReceived: a further partial receipt on a multi-line PO is allowed by rules', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }, { productId: P2, qty: 10, receivedQty: 0 }] });
    await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId }); // -> PartiallyReceived
    const r2 = await grnReceiptTxn(dbFor(PROC), { lines: [line(1, P2, 3, 0)], actorId: PROC.userId }); // still PartiallyReceived
    expect(r2.status).toBe('PartiallyReceived');
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBe(4);
    expect(s.po.items[1].receivedQty).toBe(3);
    expect(s.po.status).toBe('PartiallyReceived');
  });

  it('J8 / INV-13: sequential over-receipt is rejected inside the txn — nothing written', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 8 }] });
    await expect(grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 3, 8)], actorId: PROC.userId })).rejects.toThrow('over-receipt');
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBe(8);
    expect(s.inLedgerRows).toHaveLength(0);
    expect(Object.keys(s.summaries)).toHaveLength(0);
    expect(s.grnDocs).toHaveLength(0);
  });

  it('J9 (P1-1): double-submitting the SAME receipt is a no-op — one stock IN, one GRN doc', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId });
    // client never saw the PO update -> submits the identical receipt again
    const r2 = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId });
    expect(r2.alreadyReceived).toBe(true);
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBe(4);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(4);
    expect(s.inLedgerRows).toHaveLength(1);
    expect(s.grnDocs).toHaveLength(1);
  });

  it('J10: two concurrent 6+6 receipts against ordered 10 — Σ received <= 10, one applies', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const db = dbFor(PROC);
    await Promise.allSettled([
      grnReceiptTxn(db, { lines: [line(0, P1, 6, 0)], actorId: PROC.userId }),
      grnReceiptTxn(db, { lines: [line(0, P1, 6, 0)], actorId: PROC.userId }),
    ]);
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBeLessThanOrEqual(10);
    expect(s.po.items[0].receivedQty).toBe(6);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(6);
    expect(s.inLedgerRows).toHaveLength(1);
  });

  it('J10: concurrent 4+6 against ordered 10 — final receivedQty exactly 10', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const db = dbFor(PROC);
    await Promise.allSettled([
      grnReceiptTxn(db, { lines: [line(0, P1, 4, 0)], actorId: PROC.userId }),
      grnReceiptTxn(db, { lines: [line(0, P1, 6, 0)], actorId: PROC.userId }),
    ]);
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBe(10);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(10);
    expect(s.po.status).toBe('Received');
    expect(s.inLedgerRows).toHaveLength(2);
  });

  it('J10: concurrent 7+6 against ordered 10 — never over-receipt, one is rejected', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const db = dbFor(PROC);
    const results = await Promise.allSettled([
      grnReceiptTxn(db, { lines: [line(0, P1, 7, 0)], actorId: PROC.userId }),
      grnReceiptTxn(db, { lines: [line(0, P1, 6, 0)], actorId: PROC.userId }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(1);
    const s = await readState();
    expect(s.po.items[0].receivedQty).toBeLessThanOrEqual(10);
    const totalIn = s.inLedgerRows.reduce((sum, l) => sum + Number((l as any).qty), 0);
    expect(totalIn).toBe(s.po.items[0].receivedQty); // stock reflects exactly what the PO accepted
  });

  it('J11 (P1-3): Procurement CAN receive into an EXISTING stock summary', async () => {
    await seed({
      poItems: [{ productId: P1, qty: 10, receivedQty: 0 }],
      existingSummaries: [{ productId: P1, warehouseId: WH_A, companyId: CO_A, groupId: GRP_A, availableQty: 25 }],
    });
    const r = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 10, 0)], actorId: PROC.userId });
    expect(r.applied).toBe(10);
    const s = await readState();
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(35);
  });

  it('E3: a Sales-role actor CANNOT complete the receipt (least privilege)', async () => {
    await seed({
      poItems: [{ productId: P1, qty: 10, receivedQty: 0 }],
      existingSummaries: [{ productId: P1, warehouseId: WH_A, companyId: CO_A, groupId: GRP_A, availableQty: 5 }],
    });
    await expect(grnReceiptTxn(dbFor(SALES), { lines: [line(0, P1, 3, 0)], actorId: SALES.userId })).rejects.toBeTruthy();
    const s = await readState();
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(5);
    expect(s.inLedgerRows).toHaveLength(0);
  });

  it('E3: an Accounts-role actor CANNOT complete the receipt into an existing summary', async () => {
    await seed({
      poItems: [{ productId: P1, qty: 10, receivedQty: 0 }],
      existingSummaries: [{ productId: P1, warehouseId: WH_A, companyId: CO_A, groupId: GRP_A, availableQty: 5 }],
    });
    await expect(grnReceiptTxn(dbFor(ACC), { lines: [line(0, P1, 3, 0)], actorId: ACC.userId })).rejects.toBeTruthy();
  });

  it('N1: a Company B actor cannot receive against a Company A PO', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    await expect(grnReceiptTxn(dbFor(PROC_B), { lines: [line(0, P1, 5, 0)], actorId: PROC_B.userId, companyId: CO_B, groupId: GRP_B })).rejects.toBeTruthy();
  });

  it('C7: a forged cross-company warehouseId is rejected', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    // Procurement (Co A) tries to receive into WH_B (Co B) but stamps companyId CO_A.
    await expect(grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 5, 0)], actorId: PROC.userId, warehouseId: WH_B })).rejects.toBeTruthy();
  });

  it('N5: the GRN doc and its IN ledger rows are immutable', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const r = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 10, 0)], actorId: PROC.userId });
    const db = dbFor(PROC);
    await assertFails(updateDoc(doc(db, 'goods_receipts', r.grnId), { notes: 'tampered' }));
    await assertFails(deleteDoc(doc(db, 'goods_receipts', r.grnId)));
    const ledgerId = grnLedgerId(r.grnId, 0);
    await assertFails(updateDoc(doc(db, 'stock_ledger', ledgerId), { qty: 999 }));
    await assertFails(deleteDoc(doc(db, 'stock_ledger', ledgerId)));
  });

  it('J12: a receipt whose GRN-doc write failed is reconciled from the ledger on retry — no double stock', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }] });
    const r = await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId });
    // simulate the post-transaction GRN-doc write having failed
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'goods_receipts', r.grnId)); });
    let s = await readState();
    expect(s.grnDocs).toHaveLength(0);
    expect(s.po.items[0].receivedQty).toBe(4);          // stock + PO stayed consistent (atomic)
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(4);
    // retry the identical receipt -> reconciled from the ledger, no second stock IN
    await grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 4, 0)], actorId: PROC.userId });
    s = await readState();
    expect(s.grnDocs).toHaveLength(1);
    expect(s.summaries[`SUM-${CO_A}-${P1}-${WH_A}`]).toBe(4);   // NOT 8
    expect(s.inLedgerRows).toHaveLength(1);
  });

  it('rejects a receipt against a non-receivable (Draft) PO', async () => {
    await seed({ poItems: [{ productId: P1, qty: 10, receivedQty: 0 }], poStatus: 'Draft' });
    await expect(grnReceiptTxn(dbFor(PROC), { lines: [line(0, P1, 5, 0)], actorId: PROC.userId })).rejects.toThrow('not receivable');
  });
});
