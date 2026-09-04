/**
 * productSkuLock.emulator.test.ts — INVENTORY-09 (§7–§9, §19, §20)
 * ===================================================================
 *
 * Proves, against the Firestore emulator + the CURRENT firestore.rules, that
 * the `product_sku_locks` uniqueness lock is:
 *
 *   - company-scoped (§19): Company A, SKU "ABC-001", two concurrent creates
 *     (Product A vs Product B) -> exactly ONE succeeds, exactly ONE lock doc,
 *     exactly ONE owning product. The SAME SKU in Company B then succeeds.
 *   - rules-enforced (§20): same-company duplicate DENIED at the rules layer
 *     (not just app logic); cross-company same-SKU ALLOWED; an active lock's
 *     ownership cannot be reassigned by a different product; the lock cannot
 *     be deleted; a legitimate SKU-swap (release + reclaim) is ALLOWED;
 *     GroupAdmin behaves consistently; a suspended group is denied.
 *
 * The transaction helper replicates `createProductWithSkuLock`'s configured
 * branch (product doc + SKU lock, ONE runTransaction).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { normalizeSku, productSkuLockId } from '../inventory/skuLock';

const PROJECT = 'neozy-sku-lock-test';
const CO_A = 'CO-SKU-A';
const CO_B = 'CO-SKU-B';
const GRP_A = 'GRP-SKU-A';
const GRP_B = 'GRP-SKU-B';

const ADMIN = { uid: 'uid-sku-admin', userId: 'user-sku-admin', email: 'sku-admin@t.test' };
const SALES = { uid: 'uid-sku-sales', userId: 'user-sku-sales', email: 'sku-sales@t.test' };
const ADMIN_B = { uid: 'uid-sku-adminB', userId: 'user-sku-adminB', email: 'sku-adminB@t.test' };
const GROUP_ADMIN = { uid: 'uid-sku-ga', userId: 'user-sku-ga', email: 'sku-ga@t.test' };

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B });

    const mkUser = (u: typeof ADMIN, role: string, companyId: string, groupId: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(ADMIN, 'Admin', CO_A, GRP_A);
    await mkUser(SALES, 'Sales', CO_A, GRP_A);
    await mkUser(ADMIN_B, 'Admin', CO_B, GRP_B);
    // GroupAdmin is scoped to GRP_A but not tied to a single company doc — the
    // group-admin rules paths key off role + groupId, mirroring every other
    // GroupAdmin emulator test in this repo (companyId still required for the
    // user doc's own identity resolution; reads/writes into CO_A prove the
    // cross-company-within-group grant).
    await mkUser(GROUP_ADMIN, 'GroupAdmin', CO_A, GRP_A);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

/** Mirrors `createProductWithSkuLock`'s configured branch: product doc + SKU lock, ONE txn. */
async function createProductTxn(
  db: ReturnType<typeof dbFor>,
  opts: { id: string; sku: string; companyId: string; groupId: string; actorId: string },
) {
  const normalized = normalizeSku(opts.sku);
  const productRef = doc(db, 'products', opts.id);
  const lockRef = normalized ? doc(db, 'product_sku_locks', productSkuLockId(opts.companyId, normalized)) : null;

  return runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (productSnap.exists()) throw new Error('Product id collision');
    if (lockRef) {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists() && lockSnap.data().isDeleted !== true && lockSnap.data().productId !== opts.id) {
        throw new Error(`SKU "${opts.sku}" is already used by another product in this company`);
      }
    }
    tx.set(productRef, {
      id: opts.id, name: opts.id, sku: opts.sku, companyId: opts.companyId, groupId: opts.groupId,
      price: 100, unit: 'PCS', status: 'Active', isDeleted: false,
      createdBy: opts.actorId, updatedBy: opts.actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    if (lockRef) {
      tx.set(lockRef, {
        id: lockRef.id, companyId: opts.companyId, groupId: opts.groupId, sku: normalized, productId: opts.id,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: opts.actorId, isDeleted: false,
      });
    }
    return { applied: true };
  });
}

async function readLocks(companyId: string) {
  let out: any[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const snap = await getDocs(query(collection(ctx.firestore(), 'product_sku_locks'), where('companyId', '==', companyId)));
    out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

describe('INVENTORY-09 — SKU lock concurrency (§19, company-scoped)', () => {
  it('two concurrent creates of the SAME (company, SKU): exactly 1 succeeds, exactly 1 lock, 1 owner; the same SKU in a DIFFERENT company then succeeds', async () => {
    const results = await Promise.allSettled([
      createProductTxn(dbFor(ADMIN), { id: 'PRD-A', sku: 'ABC-001', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId }),
      createProductTxn(dbFor(ADMIN), { id: 'PRD-B', sku: 'ABC-001', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId }),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const locksA = await readLocks(CO_A);
    expect(locksA).toHaveLength(1);
    const winnerId = locksA[0].productId;
    expect(['PRD-A', 'PRD-B']).toContain(winnerId);

    // the SAME sku in Company B is a completely independent namespace
    await expect(createProductTxn(dbFor(ADMIN_B), { id: 'PRD-C', sku: 'ABC-001', companyId: CO_B, groupId: GRP_B, actorId: ADMIN_B.userId }))
      .resolves.toMatchObject({ applied: true });
    const locksB = await readLocks(CO_B);
    expect(locksB).toHaveLength(1);
    expect(locksB[0].productId).toBe('PRD-C');
  });
});

describe('INVENTORY-09 — SKU lock rules (§20)', () => {
  it('a same-company duplicate SKU is DENIED at the rules layer', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-1', sku: 'DUP-1', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    const lockId = productSkuLockId(CO_A, 'DUP-1');
    // The deterministic lock id IS the uniqueness constraint: a second product
    // claiming the same SKU resolves to the SAME doc, which already exists and
    // is owned by PRD-1 — an update reassigning it to a different productId
    // while still active is denied.
    await assertFails(updateDoc(doc(dbFor(SALES), 'product_sku_locks', lockId), { productId: 'PRD-2' }));
  });

  it('cross-company same SKU is ALLOWED (different lock doc id entirely)', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-3', sku: 'SHARED', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    await expect(createProductTxn(dbFor(ADMIN_B), { id: 'PRD-4', sku: 'SHARED', companyId: CO_B, groupId: GRP_B, actorId: ADMIN_B.userId }))
      .resolves.toMatchObject({ applied: true });
  });

  it('an active lock\'s ownership cannot be reassigned by a different product (malicious steal denied)', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-5', sku: 'MINE', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    const lockId = productSkuLockId(CO_A, 'MINE');
    await assertFails(updateDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId), { productId: 'PRD-INTRUDER' }));
  });

  it('a legitimate SKU swap (release old, claim new) is ALLOWED — the released lock can later be reclaimed by a different product', async () => {
    const lockId = productSkuLockId(CO_A, 'RELEASE-ME');
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-6', sku: 'RELEASE-ME', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    // release (same owner, isDeleted flip — allowed)
    await updateDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId), { isDeleted: true });
    let snap = await getDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId));
    expect(snap.data()?.isDeleted).toBe(true);
    // reclaim by a DIFFERENT product — allowed because the existing lock is released
    await updateDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId), { productId: 'PRD-7', isDeleted: false });
    snap = await getDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId));
    expect(snap.data()).toMatchObject({ productId: 'PRD-7', isDeleted: false });
  });

  it('the lock can never be deleted', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-8', sku: 'NODELETE', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    const lockId = productSkuLockId(CO_A, 'NODELETE');
    await assertFails(deleteDoc(doc(dbFor(ADMIN), 'product_sku_locks', lockId)));
  });

  it('an unauthorized cross-company actor cannot read or write another company\'s lock', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-9', sku: 'PRIVATE', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    const lockId = productSkuLockId(CO_A, 'PRIVATE');
    await assertFails(getDoc(doc(dbFor(ADMIN_B), 'product_sku_locks', lockId)));
    await assertFails(updateDoc(doc(dbFor(ADMIN_B), 'product_sku_locks', lockId), { productId: 'PRD-STEAL' }));
  });

  it('GroupAdmin behaves consistently — can create/read a lock in a company within their group', async () => {
    await expect(createProductTxn(dbFor(GROUP_ADMIN), { id: 'PRD-10', sku: 'GRP-OK', companyId: CO_A, groupId: GRP_A, actorId: GROUP_ADMIN.userId }))
      .resolves.toMatchObject({ applied: true });
  });

  it('a suspended group is denied', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Suspended' });
    });
    await expect(createProductTxn(dbFor(ADMIN), { id: 'PRD-11', sku: 'SUSPENDED', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId }))
      .rejects.toThrow();
  });
});
