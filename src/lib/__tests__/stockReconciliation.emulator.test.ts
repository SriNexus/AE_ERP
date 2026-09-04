/**
 * stockReconciliation.emulator.test.ts — INVENTORY-06 (F4 / F5)
 * ============================================================
 *
 * Proves, against the Firestore emulator, that:
 *
 *   F4  the reconciliation report is READ-ONLY — reconcile reads `stock` +
 *       `stock_ledger` and writes NOTHING.
 *   F5  the `RECONCILE_ADJUST` correction path is human-approved + audit-logged
 *       + idempotent per (reconciliationRunId x summaryId), and:
 *         - an unauthorized role (Sales) is DENIED the `stock` update
 *         - the correction ledger row is immutable (`update` / `delete` denied)
 *         - a cross-company correction is DENIED
 *
 * The correction transaction mirrors the movement engine's configured-branch
 * shape (ledger-exists idempotency check -> stock read -> stock write + ledger
 * write, one runTransaction). NO firestore.rules change from INVENTORY-05.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { buildIdempotencyKey, movementLedgerId } from '../inventory/idempotency';
import { ledgerRowOnHandDelta, computeReconciliation } from '../../engines/StockReconciliationEngine';

const PROJECT = 'neozy-stock-reconciliation-test';
const CO_A = 'CO-RECON-A';
const CO_B = 'CO-RECON-B';
const GRP_A = 'GRP-RECON-A';
const GRP_B = 'GRP-RECON-B';
const WH_A = 'WH-RECON-A';
const WH_B = 'WH-RECON-B';
const P1 = 'PRD-RECON-1';
const SUM_A = `SUM-${CO_A}-${P1}-${WH_A}`;

const ADMIN = { uid: 'uid-recon-admin', userId: 'user-recon-admin', email: 'recon-admin@t.test' };
const SALES = { uid: 'uid-recon-sales', userId: 'user-recon-sales', email: 'recon-sales@t.test' };
const ADMIN_B = { uid: 'uid-recon-adminB', userId: 'user-recon-adminB', email: 'recon-adminB@t.test' };

let env: RulesTestEnvironment;

/** Seed a summary whose stored on-hand DRIFTS from its ledger (pre-engine style). */
async function seed(storedOnHand: number, ledgerRows: Array<{ movementType: string; direction: string; qty: number }>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: CO_B, groupId: GRP_B, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });

    await setDoc(doc(db, 'users', ADMIN.userId), { id: ADMIN.userId, companyId: CO_A, groupId: GRP_A, role: 'Admin', name: 'Admin', email: ADMIN.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', ADMIN.uid), { authUid: ADMIN.uid, userId: ADMIN.userId, companyId: CO_A, groupId: GRP_A, email: ADMIN.email });
    await setDoc(doc(db, 'users', SALES.userId), { id: SALES.userId, companyId: CO_A, groupId: GRP_A, warehouseId: WH_A, role: 'Sales', name: 'Sales', email: SALES.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', SALES.uid), { authUid: SALES.uid, userId: SALES.userId, companyId: CO_A, groupId: GRP_A, email: SALES.email });
    await setDoc(doc(db, 'users', ADMIN_B.userId), { id: ADMIN_B.userId, companyId: CO_B, groupId: GRP_B, role: 'Admin', name: 'AdminB', email: ADMIN_B.email, status: 'Active', isSuperAdmin: false, isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', ADMIN_B.uid), { authUid: ADMIN_B.uid, userId: ADMIN_B.userId, companyId: CO_B, groupId: GRP_B, email: ADMIN_B.email });

    await setDoc(doc(db, 'stock', SUM_A), {
      id: SUM_A, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A,
      onHandQty: storedOnHand, availableQty: storedOnHand, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
    let n = 0;
    for (const row of ledgerRows) {
      n += 1;
      await setDoc(doc(db, 'stock_ledger', `LGR-RECON-${n}`), {
        id: `LGR-RECON-${n}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, unit: 'PCS',
        movementType: row.movementType, direction: row.direction, qty: row.qty,
        type: row.direction === 'OUT' ? 'OUT' : 'IN',
        transactionId: `TXN-LGR-${n}`, movementAt: serverTimestamp(), date: `2026-08-0${n}T00:00:00.000Z`,
        createdBy: ADMIN.userId, isDeleted: false,
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

/** READ-ONLY reconciliation of one summary — mirrors reconcileSummary(). */
async function reconcileRO(db: ReturnType<typeof dbFor>) {
  const summarySnap = await getDoc(doc(db, 'stock', SUM_A));
  const summary = summarySnap.data() as Record<string, any>;
  const ledgerSnap = await getDocs(query(collection(db, 'stock_ledger'),
    where('companyId', '==', CO_A), where('productId', '==', P1), where('warehouseId', '==', WH_A)));
  const rows = ledgerSnap.docs.map((d) => d.data() as Record<string, any>);
  return computeReconciliation({
    summaryId: SUM_A, companyId: CO_A, productId: P1, warehouseId: WH_A, unit: 'PCS',
    storedOnHand: Number(summary?.onHandQty ?? summary?.availableQty) || 0,
    ledgerRows: rows,
  });
}

async function snapshotAll() {
  let out: { stock: any; ledger: Array<{ id: string; data: any }> } = { stock: null, ledger: [] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.stock = (await getDoc(doc(db, 'stock', SUM_A))).data();
    out.ledger = (await getDocs(query(collection(db, 'stock_ledger'), where('companyId', '==', CO_A)))).docs.map((d) => ({ id: d.id, data: d.data() }));
  });
  return out;
}

/**
 * Mirrors the movement engine's configured branch for ONE RECONCILE_ADJUST
 * movement + the reconciliation audit fields.
 */
async function correctionTxn(
  db: ReturnType<typeof dbFor>,
  opts: { correctionQty: number; reasonCode: string; reconciliationRunId: string; actorId: string; companyId?: string; groupId?: string },
): Promise<{ applied: boolean }> {
  const companyId = opts.companyId ?? CO_A;
  const groupId = opts.groupId ?? GRP_A;
  const key = buildIdempotencyKey('RECONCILE_ADJUST', 'reconciliation', opts.reconciliationRunId, SUM_A);
  const ledgerId = movementLedgerId(key);
  const direction = opts.correctionQty >= 0 ? 'IN' : 'OUT';
  const absQty = Math.abs(opts.correctionQty);

  return runTransaction(db, async (tx) => {
    const ledgerRef = doc(db, 'stock_ledger', ledgerId);
    const stockRef = doc(db, 'stock', SUM_A);
    const ledgerSnap = await tx.get(ledgerRef);
    if (ledgerSnap.exists()) return { applied: false };
    const stockSnap = await tx.get(stockRef);
    const existing = stockSnap.exists() ? stockSnap.data() as Record<string, any> : null;
    const onHandBefore = Number(existing?.onHandQty ?? existing?.availableQty) || 0;
    const onHandAfter = direction === 'IN' ? onHandBefore + absQty : onHandBefore - absQty;
    if (onHandAfter < 0) throw new Error('Insufficient stock');

    const base = { ...(existing || {}) };
    delete (base as Record<string, unknown>).available;
    delete (base as Record<string, unknown>).reserved;
    tx.set(stockRef, {
      ...base, id: SUM_A, companyId, groupId, productId: P1, warehouseId: WH_A, unit: 'PCS',
      onHandQty: onHandAfter, reservedQty: 0, availableQty: onHandAfter,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(), createdAt: existing?.createdAt ?? serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: ledgerId, companyId, groupId, productId: P1, warehouseId: WH_A, stockId: SUM_A, unit: 'PCS',
      movementType: 'RECONCILE_ADJUST', direction, qty: absQty,
      onHandBefore, onHandAfter, reservedBefore: 0, reservedAfter: 0,
      sourceType: 'reconciliation', sourceId: opts.reconciliationRunId, idempotencyKey: key,
      reasonCode: opts.reasonCode, actorId: opts.actorId, transactionId: `TXN-${ledgerId}`,
      movementAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      auditReconciliation: true, reconciliationRunId: opts.reconciliationRunId, approvedBy: opts.actorId,
      type: direction === 'OUT' ? 'OUT' : 'IN', referenceType: 'StockReconciliation', referenceId: opts.reconciliationRunId,
      beforeQty: onHandBefore, afterQty: onHandAfter, date: new Date().toISOString(),
    });
    return { applied: true };
  });
}

describe('INVENTORY-06 — reconciliation (emulator)', () => {
  it('F4: reconciling the report performs ZERO writes', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    const before = await snapshotAll();

    const recon = await reconcileRO(dbFor(ADMIN));
    expect(recon).toMatchObject({ stored: 10, computed: 13, delta: 3, reconciled: false });

    const after = await snapshotAll();
    expect(after.stock).toEqual(before.stock);
    expect(after.ledger).toHaveLength(before.ledger.length);
  });

  it('F5: an authorized (Admin) RECONCILE_ADJUST correction is applied + audited + reconciles the summary', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    const r = await correctionTxn(dbFor(ADMIN), { correctionQty: 3, reasonCode: 'physical count 13', reconciliationRunId: 'RUN-1', actorId: ADMIN.userId });
    expect(r.applied).toBe(true);

    const s = await snapshotAll();
    expect(s.stock).toMatchObject({ onHandQty: 13 });
    const row = s.ledger.find((l) => l.data.movementType === 'RECONCILE_ADJUST')!;
    expect(row.data).toMatchObject({
      direction: 'IN', qty: 3, reasonCode: 'physical count 13',
      auditReconciliation: true, reconciliationRunId: 'RUN-1', approvedBy: ADMIN.userId,
    });
    // post-correction: RECONCILE_ADJUST excluded from computed -> reconciled
    const post = await reconcileRO(dbFor(ADMIN));
    expect(post).toMatchObject({ stored: 13, computed: 13, reconcileAdjustTotal: 3, delta: 0, reconciled: true });
    expect(ledgerRowOnHandDelta(row.data).isReconcile).toBe(true);
  });

  it('F5: idempotent per (runId x summary) — a retry with the same runId is a no-op', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 15 }]);
    await correctionTxn(dbFor(ADMIN), { correctionQty: 5, reasonCode: 'x', reconciliationRunId: 'RUN-2', actorId: ADMIN.userId });
    const second = await correctionTxn(dbFor(ADMIN), { correctionQty: 5, reasonCode: 'x', reconciliationRunId: 'RUN-2', actorId: ADMIN.userId });
    expect(second.applied).toBe(false);
    const s = await snapshotAll();
    expect(s.stock).toMatchObject({ onHandQty: 15 });                 // NOT 20
    expect(s.ledger.filter((l) => l.data.movementType === 'RECONCILE_ADJUST')).toHaveLength(1);
  });

  it('F5: a Sales-role actor CANNOT apply a correction (stock field-guard) — nothing written', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    await expect(correctionTxn(dbFor(SALES), { correctionQty: 3, reasonCode: 'x', reconciliationRunId: 'RUN-3', actorId: SALES.userId }))
      .rejects.toBeTruthy();
    const s = await snapshotAll();
    expect(s.stock).toMatchObject({ onHandQty: 10 });
    expect(s.ledger.filter((l) => l.data.movementType === 'RECONCILE_ADJUST')).toHaveLength(0);
  });

  it('F5: a cross-company correction is DENIED', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    await expect(correctionTxn(dbFor(ADMIN_B), { correctionQty: 3, reasonCode: 'x', reconciliationRunId: 'RUN-4', actorId: ADMIN_B.userId, companyId: CO_A, groupId: GRP_A }))
      .rejects.toBeTruthy();
  });

  it('F5: the RECONCILE_ADJUST ledger row is immutable (update / delete denied)', async () => {
    await seed(10, [{ movementType: 'PURCHASE_RECEIPT', direction: 'IN', qty: 13 }]);
    await correctionTxn(dbFor(ADMIN), { correctionQty: 3, reasonCode: 'x', reconciliationRunId: 'RUN-5', actorId: ADMIN.userId });
    const key = buildIdempotencyKey('RECONCILE_ADJUST', 'reconciliation', 'RUN-5', SUM_A);
    const ledgerId = movementLedgerId(key);
    const db = dbFor(ADMIN);
    await assertFails(updateDoc(doc(db, 'stock_ledger', ledgerId), { qty: 999 }));
    await assertFails(deleteDoc(doc(db, 'stock_ledger', ledgerId)));
  });
});
