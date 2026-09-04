/**
 * stockTransferTransaction.emulator.test.ts — INVENTORY-08 (L1–L7, INV-11, rules)
 * ============================================================================
 *
 * Proves, against the Firestore emulator + the CURRENT firestore.rules:
 *
 *   L1  ship  → source onHandQty −= qty; TRANSFER_OUT row; status in_transit.
 *   L2  receive → dest onHandQty += qty; TRANSFER_IN row; status received.
 *   L3  INV-11: Σ(TRANSFER_OUT + TRANSFER_IN) per transfer == 0.
 *   L4  ship / receive idempotency (deterministic ledger id).
 *   L5  cancel an in-transit transfer → compensating TRANSFER_IN back to source.
 *   CONCURRENCY: two ships of the same transfer → one effect; two transfers
 *               racing the last units → Firestore serialises, no negative stock.
 *   PARTIAL: ship 10, receive 8 → source −10, dest +8, 2-unit loss visible.
 *   RULES: cross-company transfer impossible; non-inventory role denied;
 *          warehouse-restricted actor can only ship FROM their own warehouse;
 *          the stock_ledger row is immutable; the transfer identity is immutable.
 *
 * The transaction helpers replicate `applyBatchConfigured` + the transfer-doc
 * participant (INVENTORY-08 §5/§9).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { buildIdempotencyKey, movementLedgerId } from '../inventory/idempotency';

const PROJECT = 'neozy-stock-transfer-test';
const CO_A = 'CO-TRF-A';
const CO_B = 'CO-TRF-B';
const GRP_A = 'GRP-TRF-A';
const GRP_B = 'GRP-TRF-B';
const WH_A = 'WH-TRF-A';
const WH_B = 'WH-TRF-B';
const WH_C = 'WH-TRF-C';   // second CO_A warehouse
const WH_FOREIGN = 'WH-TRF-FOREIGN'; // CO_B
const P1 = 'PRD-TRF-1';
const EPS = 1e-6;

const WHU = { uid: 'uid-trf-wh', userId: 'user-trf-wh', email: 'trf-wh@t.test' };        // Warehouse @ WH_A
const WHU_C = { uid: 'uid-trf-whc', userId: 'user-trf-whc', email: 'trf-whc@t.test' };    // Warehouse @ WH_C
const WHU_DEST = { uid: 'uid-trf-whd', userId: 'user-trf-whd', email: 'trf-whd@t.test' }; // Warehouse @ WH_B
// A company-wide inventory operator (warehouse-any + in the stock physical-write
// role list) — the role that can run BOTH legs of a transfer.
const ADMIN = { uid: 'uid-trf-admin', userId: 'user-trf-admin', email: 'trf-admin@t.test' };
const SALES = { uid: 'uid-trf-sales', userId: 'user-trf-sales', email: 'trf-sales@t.test' };
const WHU_B = { uid: 'uid-trf-whb', userId: 'user-trf-whb', email: 'trf-whb@t.test' };     // CO_B Warehouse

let env: RulesTestEnvironment;

async function seed(onHandA: number, onHandC = 0) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });
    await setDoc(doc(db, 'warehouses', WH_A), { id: WH_A, companyId: CO_A, groupId: GRP_A, name: 'WH A', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_B), { id: WH_B, companyId: CO_A, groupId: GRP_A, name: 'WH B', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_C), { id: WH_C, companyId: CO_A, groupId: GRP_A, name: 'WH C', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WH_FOREIGN), { id: WH_FOREIGN, companyId: CO_B, groupId: GRP_B, name: 'Foreign', status: 'Active' });
    await setDoc(doc(db, 'products', P1), { id: P1, companyId: CO_A, name: 'Panel', isDeleted: false });

    const mkUser = (u: typeof WHU, role: string, companyId: string, groupId: string, warehouseId?: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...(warehouseId ? { warehouseId } : {}) }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(WHU, 'Warehouse', CO_A, GRP_A, WH_A);
    await mkUser(WHU_C, 'Warehouse', CO_A, GRP_A, WH_C);
    await mkUser(WHU_DEST, 'Warehouse', CO_A, GRP_A, WH_B);
    await mkUser(ADMIN, 'Admin', CO_A, GRP_A);
    await mkUser(SALES, 'Sales', CO_A, GRP_A);
    await mkUser(WHU_B, 'Warehouse', CO_B, GRP_B, WH_FOREIGN);

    if (onHandA > 0) {
      await setDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`), { id: `SUM-${CO_A}-${P1}-${WH_A}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, onHandQty: onHandA, availableQty: onHandA, reservedQty: 0, unit: 'PCS', isDeleted: false });
    }
    if (onHandC > 0) {
      await setDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_C}`), { id: `SUM-${CO_A}-${P1}-${WH_C}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_C, onHandQty: onHandC, availableQty: onHandC, reservedQty: 0, unit: 'PCS', isDeleted: false });
    }
  });
}

async function seedTransfer(id: string, fromWh: string, toWh: string, qty: number, status = 'draft', createdBy = WHU.userId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const item: Record<string, unknown> = { productId: P1, qty, unit: 'PCS' };
    if (status !== 'draft') item.shippedQty = qty;
    await setDoc(doc(ctx.firestore(), 'stock_transfers', id), {
      id, companyId: CO_A, groupId: GRP_A, fromWarehouseId: fromWh, toWarehouseId: toWh,
      warehouseIds: [fromWh, toWh], items: [item],
      status, createdBy, createdAt: new Date().toISOString(), isDeleted: false,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

/** applyBatchConfigured for ONE transfer movement + the transfer-doc participant. */
async function moveTxn(
  db: ReturnType<typeof dbFor>,
  opts: {
    transferId: string; movementType: 'TRANSFER_OUT' | 'TRANSFER_IN'; sourceType: 'transfer' | 'transfer_cancel';
    warehouseId: string; qty: number; actorId: string;
    requiredStatus: string; targetStatus: string; patch: Record<string, unknown>;
  },
) {
  const key = buildIdempotencyKey(opts.movementType, opts.sourceType, opts.transferId, P1);
  const ledgerId = movementLedgerId(key);
  const stockId = `SUM-${CO_A}-${P1}-${opts.warehouseId}`;
  const dir = opts.movementType === 'TRANSFER_OUT' ? 'OUT' : 'IN';

  return runTransaction(db, async (tx) => {
    const ledgerRef = doc(db, 'stock_ledger', ledgerId);
    const stockRef = doc(db, 'stock', stockId);
    const trfRef = doc(db, 'stock_transfers', opts.transferId);
    const ledgerSnap = await tx.get(ledgerRef);
    const stockSnap = await tx.get(stockRef);
    const trfSnap = await tx.get(trfRef);

    if (!trfSnap.exists()) throw new Error('transfer not found');
    const trfStatus = String(trfSnap.data().status || '');
    if (trfStatus === opts.targetStatus) return { applied: false, skipped: true, onHandAfter: null as number | null };
    if (trfStatus !== opts.requiredStatus) throw new Error(`transfer is '${trfStatus}', expected '${opts.requiredStatus}'`);

    if (ledgerSnap.exists()) {
      // movement already applied; participant.commit would NOT run — recover doc
      tx.set(trfRef, opts.patch, { merge: true });
      return { applied: false, skipped: false, onHandAfter: Number(stockSnap.data()?.onHandQty) || 0 };
    }

    const existing = stockSnap.exists() ? stockSnap.data() as any : null;
    const onHand = Number(existing?.onHandQty ?? existing?.availableQty) || 0;
    const reserved = Number(existing?.reservedQty) || 0;
    const onHandAfter = dir === 'OUT' ? onHand - opts.qty : onHand + opts.qty;
    if (onHandAfter < -EPS) throw new Error(`Insufficient stock: onHandQty -> ${onHandAfter}`);
    if (reserved > onHandAfter + EPS) throw new Error('Over-reservation');

    tx.set(stockRef, {
      ...(existing || {}), id: stockId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: opts.warehouseId, unit: 'PCS',
      onHandQty: onHandAfter, reservedQty: reserved, availableQty: onHandAfter - reserved,
      updatedBy: opts.actorId, updatedAt: serverTimestamp(), createdAt: existing?.createdAt ?? serverTimestamp(), isDeleted: false,
    });
    tx.set(ledgerRef, {
      id: ledgerId, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: opts.warehouseId, unit: 'PCS',
      movementType: opts.movementType, direction: dir, qty: opts.qty,
      onHandBefore: onHand, onHandAfter, reservedBefore: reserved, reservedAfter: reserved,
      sourceType: opts.sourceType, sourceId: opts.transferId, idempotencyKey: key, transferId: opts.transferId,
      actorId: opts.actorId, transactionId: `TXN-${ledgerId}`, movementAt: serverTimestamp(),
      createdAt: serverTimestamp(), createdBy: opts.actorId, isDeleted: false,
      type: dir, referenceType: 'StockTransfer', referenceId: opts.transferId, date: new Date().toISOString(), notes: '',
    });
    tx.set(trfRef, opts.patch, { merge: true });
    return { applied: true, skipped: false, onHandAfter };
  });
}

const nowIso = () => new Date().toISOString();
const shipPatch = (actorId: string) => ({ status: 'in_transit', shippedBy: actorId, shippedAt: nowIso(), updatedBy: actorId });
const recvPatch = (actorId: string, receivedQty: number, qty: number) => ({
  status: 'received', receivedBy: actorId, receivedAt: nowIso(),
  items: [{ productId: P1, qty, unit: 'PCS', shippedQty: qty, receivedQty }],
  hasShortfall: qty - receivedQty > EPS, shortfallQty: Math.max(0, qty - receivedQty), updatedBy: actorId,
});
const cancelPatch = (actorId: string) => ({ status: 'cancelled', cancelledBy: actorId, cancelledAt: nowIso(), updatedBy: actorId });

async function readState(transferId: string) {
  let out: any = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    out.a = (await getDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_A}`))).data();
    out.b = (await getDoc(doc(db, 'stock', `SUM-${CO_A}-${P1}-${WH_B}`))).data();
    out.transfer = (await getDoc(doc(db, 'stock_transfers', transferId))).data();
    out.ledger = (await getDocs(query(collection(db, 'stock_ledger'), where('transferId', '==', transferId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

const ship = (db: ReturnType<typeof dbFor>, transferId: string, qty: number, actorId: string) =>
  moveTxn(db, { transferId, movementType: 'TRANSFER_OUT', sourceType: 'transfer', warehouseId: WH_A, qty, actorId, requiredStatus: 'draft', targetStatus: 'in_transit', patch: shipPatch(actorId) });
const receive = (db: ReturnType<typeof dbFor>, transferId: string, qty: number, received: number, actorId: string) =>
  moveTxn(db, { transferId, movementType: 'TRANSFER_IN', sourceType: 'transfer', warehouseId: WH_B, qty: received, actorId, requiredStatus: 'in_transit', targetStatus: 'received', patch: recvPatch(actorId, received, qty) });

describe('INVENTORY-08 — warehouse transfer transaction (emulator)', () => {
  it('L1/L2/L3: ship (source WH staff) → receive (dest WH staff); paired TRANSFER_OUT/IN share transferId and sum to 0 (INV-11)', async () => {
    await seed(10);
    await seedTransfer('TRF-1', WH_A, WH_B, 5);
    const s1 = await ship(dbFor(WHU), 'TRF-1', 5, WHU.userId);
    expect(s1).toMatchObject({ applied: true, onHandAfter: 5 });
    let st = await readState('TRF-1');
    expect(st.a).toMatchObject({ onHandQty: 5, availableQty: 5 });
    expect(st.b).toBeUndefined();
    expect(st.transfer.status).toBe('in_transit');
    expect(st.ledger).toHaveLength(1);
    expect(st.ledger[0]).toMatchObject({ movementType: 'TRANSFER_OUT', direction: 'OUT', qty: 5, transferId: 'TRF-1' });

    // the destination warehouse's own staff receive it
    await receive(dbFor(WHU_DEST), 'TRF-1', 5, 5, WHU_DEST.userId);
    st = await readState('TRF-1');
    expect(st.a).toMatchObject({ onHandQty: 5 });
    expect(st.b).toMatchObject({ onHandQty: 5, availableQty: 5 });
    expect(st.transfer.status).toBe('received');
    expect(st.ledger).toHaveLength(2);
    const net = st.ledger.reduce((n: number, r: any) => n + (r.direction === 'IN' ? r.qty : -r.qty), 0);
    expect(net).toBe(0);
    expect(st.ledger.every((r: any) => r.transferId === 'TRF-1')).toBe(true);
  });

  it('L4: double ship + double receive are idempotent (deterministic ledger id)', async () => {
    await seed(10);
    await seedTransfer('TRF-2', WH_A, WH_B, 4);
    await ship(dbFor(ADMIN), 'TRF-2', 4, ADMIN.userId);
    const s2 = await ship(dbFor(ADMIN), 'TRF-2', 4, ADMIN.userId);
    expect(s2.skipped).toBe(true);
    await receive(dbFor(ADMIN), 'TRF-2', 4, 4, ADMIN.userId);
    const r2 = await receive(dbFor(ADMIN), 'TRF-2', 4, 4, ADMIN.userId);
    expect(r2.skipped).toBe(true);
    const st = await readState('TRF-2');
    expect(st.a.onHandQty).toBe(6);
    expect(st.b.onHandQty).toBe(4);
    expect(st.ledger).toHaveLength(2);
  });

  it('CONCURRENCY: two ships of the same transfer → source reduced exactly once', async () => {
    await seed(10);
    await seedTransfer('TRF-3', WH_A, WH_B, 6);
    const results = await Promise.allSettled([
      ship(dbFor(WHU), 'TRF-3', 6, WHU.userId),
      ship(dbFor(WHU), 'TRF-3', 6, WHU.userId),
    ]);
    const applied = results.filter((r) => r.status === 'fulfilled' && r.value.applied).length;
    expect(applied).toBe(1);
    const st = await readState('TRF-3');
    expect(st.a.onHandQty).toBe(4);
    expect(st.ledger.filter((r: any) => r.direction === 'OUT')).toHaveLength(1);
  });

  it('CONCURRENCY: two transfers racing the last units → Firestore serialises, no negative stock', async () => {
    await seed(5);
    await seedTransfer('TRF-4a', WH_A, WH_B, 3);
    await seedTransfer('TRF-4b', WH_A, WH_C, 3);
    const results = await Promise.allSettled([
      ship(dbFor(WHU), 'TRF-4a', 3, WHU.userId),
      ship(dbFor(WHU), 'TRF-4b', 3, WHU.userId),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.applied).length;
    expect(ok).toBe(1); // the second aborts on INV-1
    const st = await readState('TRF-4a');
    expect(st.a.onHandQty).toBe(2);
    expect(st.a.onHandQty).toBeGreaterThanOrEqual(0);
  });

  it('L5: cancel an in-transit transfer → compensating TRANSFER_IN back to the source', async () => {
    await seed(10);
    await seedTransfer('TRF-5', WH_A, WH_B, 6, 'in_transit');
    // simulate the ship movement already applied
    await ship(dbFor(WHU), 'TRF-5', 6, WHU.userId).catch(() => {});
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stock', `SUM-${CO_A}-${P1}-${WH_A}`), { id: `SUM-${CO_A}-${P1}-${WH_A}`, companyId: CO_A, groupId: GRP_A, productId: P1, warehouseId: WH_A, onHandQty: 4, availableQty: 4, reservedQty: 0, unit: 'PCS', isDeleted: false });
    });
    await moveTxn(dbFor(WHU), {
      transferId: 'TRF-5', movementType: 'TRANSFER_IN', sourceType: 'transfer_cancel', warehouseId: WH_A, qty: 6, actorId: WHU.userId,
      requiredStatus: 'in_transit', targetStatus: 'cancelled', patch: cancelPatch(WHU.userId),
    });
    const st = await readState('TRF-5');
    expect(st.a.onHandQty).toBe(10);
    expect(st.transfer.status).toBe('cancelled');
    expect(st.ledger.some((r: any) => r.sourceType === 'transfer_cancel' && r.direction === 'IN')).toBe(true);
  });

  it('PARTIAL: ship 10, receive 8 → source −10, dest +8, 2-unit loss visible on the doc', async () => {
    await seed(10);
    await seedTransfer('TRF-6', WH_A, WH_B, 10);
    await ship(dbFor(ADMIN), 'TRF-6', 10, ADMIN.userId);
    await receive(dbFor(ADMIN), 'TRF-6', 10, 8, ADMIN.userId);
    const st = await readState('TRF-6');
    expect(st.a.onHandQty).toBe(0);
    expect(st.b.onHandQty).toBe(8);
    expect(st.transfer).toMatchObject({ status: 'received', hasShortfall: true, shortfallQty: 2 });
    const net = st.ledger.reduce((n: number, r: any) => n + (r.direction === 'IN' ? r.qty : -r.qty), 0);
    expect(net).toBe(-2); // identified, explained discrepancy — not silently erased
  });

  it('RULES: a company-wide operator (Admin) may ship AND receive both legs of a transfer', async () => {
    await seed(10);
    await seedTransfer('TRF-7', WH_A, WH_B, 5, 'draft', ADMIN.userId);
    const shipRes = await ship(dbFor(ADMIN), 'TRF-7', 5, ADMIN.userId);
    expect(shipRes.applied).toBe(true);
    const recvRes = await receive(dbFor(ADMIN), 'TRF-7', 5, 5, ADMIN.userId);
    expect(recvRes.applied).toBe(true);
  });

  it('RULES: a Sales-role actor is DENIED the ship (the stock physical-write role guard)', async () => {
    await seed(10);
    await seedTransfer('TRF-8', WH_A, WH_B, 5, 'draft', ADMIN.userId);
    await expect(ship(dbFor(SALES), 'TRF-8', 5, SALES.userId)).rejects.toThrow();
    const st = await readState('TRF-8');
    expect(st.a.onHandQty).toBe(10);
    expect(st.transfer.status).toBe('draft');
  });

  it('RULES: a warehouse-restricted actor cannot ship a transfer that does not leave their own warehouse', async () => {
    await seed(10, 5);
    await seedTransfer('TRF-9', WH_C, WH_B, 3, 'draft', WHU_C.userId);
    // WHU is scoped to WH_A; this transfer is WH_C → WH_B
    await expect(
      moveTxn(dbFor(WHU), { transferId: 'TRF-9', movementType: 'TRANSFER_OUT', sourceType: 'transfer', warehouseId: WH_C, qty: 3, actorId: WHU.userId, requiredStatus: 'draft', targetStatus: 'in_transit', patch: shipPatch(WHU.userId) }),
    ).rejects.toThrow();
  });

  it('RULES: a cross-company actor cannot create a transfer that touches this company\'s warehouse', async () => {
    await seed(10);
    await assertFails(setDoc(doc(dbFor(WHU_B), 'stock_transfers', 'TRF-X'), {
      id: 'TRF-X', companyId: CO_B, groupId: GRP_B, fromWarehouseId: WH_FOREIGN, toWarehouseId: WH_A,
      warehouseIds: [WH_FOREIGN, WH_A], items: [{ productId: P1, qty: 1, unit: 'PCS' }], status: 'draft',
      createdBy: WHU_B.userId, createdAt: new Date().toISOString(), isDeleted: false,
    }));
  });

  it('RULES: a company-A actor cannot create a transfer whose destination is company B\'s warehouse', async () => {
    await seed(10);
    await assertFails(setDoc(doc(dbFor(WHU), 'stock_transfers', 'TRF-Y'), {
      id: 'TRF-Y', companyId: CO_A, groupId: GRP_A, fromWarehouseId: WH_A, toWarehouseId: WH_FOREIGN,
      warehouseIds: [WH_A, WH_FOREIGN], items: [{ productId: P1, qty: 1, unit: 'PCS' }], status: 'draft',
      createdBy: WHU.userId, createdAt: new Date().toISOString(), isDeleted: false,
    }));
  });

  it('RULES: cross-company read denied; the transfer identity is immutable; delete denied; its ledger row is immutable', async () => {
    await seed(10);
    await seedTransfer('TRF-Z', WH_A, WH_B, 4, 'draft', ADMIN.userId);
    await ship(dbFor(WHU), 'TRF-Z', 4, WHU.userId);
    // cross-company read
    await assertFails(getDoc(doc(dbFor(WHU_B), 'stock_transfers', 'TRF-Z')));
    // identity immutable
    await assertFails(updateDoc(doc(dbFor(WHU), 'stock_transfers', 'TRF-Z'), { toWarehouseId: WH_C }));
    // delete denied
    await assertFails(deleteDoc(doc(dbFor(WHU), 'stock_transfers', 'TRF-Z')));
    // ledger immutable
    const ledgerId = movementLedgerId(buildIdempotencyKey('TRANSFER_OUT', 'transfer', 'TRF-Z', P1));
    await assertFails(updateDoc(doc(dbFor(WHU), 'stock_ledger', ledgerId), { qty: 1 }));
  });

  it('RULES: a suspended group cannot ship a transfer', async () => {
    await seed(10);
    await seedTransfer('TRF-S', WH_A, WH_B, 4, 'draft', ADMIN.userId);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Suspended' });
    });
    await expect(ship(dbFor(WHU), 'TRF-S', 4, WHU.userId)).rejects.toThrow();
  });
});
