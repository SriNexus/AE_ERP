/**
 * missingDocTransactionGet.emulator.test.ts — the production `batchGet 403` class
 * ================================================================================
 *
 * LIVE-PRODUCTION ROOT CAUSE (browser-proven 2026-09-06): adding a Product in the
 * deployed ERP failed with
 *   POST .../documents:batchGet 403 (Forbidden)
 * from `useInventory.ts:85` — `transaction.get(productRef)` inside
 * `createProductWithSkuLock()`. A Firestore transaction issues BatchGetDocuments
 * for its reads; on a first-time create BOTH reads target documents that do not
 * exist yet (`products/{newId}` pre-create id-collision read +
 * `product_sku_locks/{companyId}_{sku}` uniqueness read). The ruleset that was
 * deployed to production (byte-identical to commit 46e3aab, deployed 2026-09-02 —
 * three days BEFORE INVENTORY-09 landed) evaluated the generic fallback's
 * `allow read: ... canReadCompanyScoped()` which dereferences `resource.data` —
 * undefined for a missing doc → hard deny for EVERY role → the whole transaction
 * 403s. The current rules add the established `resource == null` guard (same
 * pattern as settings/stock/roles/customer_phone_locks) to the generic fallback,
 * the dedicated `product_sku_locks` block, and the `document_counters` get/list
 * split (the quotation/order/invoice numbering transaction get()s its
 * deterministic counter id before it exists — same failure class).
 *
 * These tests pin, against the CURRENT firestore.rules:
 *   - a missing product / SKU lock / counter document can be transaction-get()ed
 *     and getDoc()ed by any active signed-in actor (the production defect);
 *   - the full `createProductWithSkuLock` transaction succeeds for Admin, an
 *     ordinary role (Sales), and a GroupAdmin acting on a same-group SIBLING
 *     company — while a foreign-group GroupAdmin is DENIED;
 *   - a fresh document counter can be created (currentNumber == 1) and then
 *     incremented (n + 1) — the first quotation/order/invoice of a company;
 *   - the null-guard grants NOTHING once a document exists: an existing
 *     other-company product / lock / counter remains unreadable cross-group.
 *
 * Run via: npx firebase emulators:exec --only firestore --project <pid>
 *          "npx vitest run --config vitest.emulator.config.ts"
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { normalizeSku, productSkuLockId } from '../inventory/skuLock';

const PROJECT = 'neozy-missing-doc-get-test';
const CO_A = 'CO-MD-A';      // GroupAdmin home company (GRP-A, active)
const CO_SIB = 'CO-MD-SIB';  // sibling company, same group (GRP-A, active)
const CO_B = 'CO-MD-B';      // foreign group (GRP-B, active)
const GRP_A = 'GRP-MD-A';
const GRP_B = 'GRP-MD-B';

const ADMIN = { uid: 'uid-md-admin', userId: 'user-md-admin', email: 'md-admin@t.test' };
const SALES = { uid: 'uid-md-sales', userId: 'user-md-sales', email: 'md-sales@t.test' };
const GROUP_ADMIN = { uid: 'uid-md-ga', userId: 'user-md-ga', email: 'md-ga@t.test' };
const ADMIN_B = { uid: 'uid-md-adminB', userId: 'user-md-adminB', email: 'md-adminB@t.test' };

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GRP_A), { id: GRP_A, name: 'A', status: 'Active' });
    await setDoc(doc(db, 'groups', GRP_B), { id: GRP_B, name: 'B', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Co A', groupId: GRP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', CO_SIB), { id: CO_SIB, companyId: CO_SIB, name: 'Co Sibling', groupId: GRP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Co B', groupId: GRP_B, status: 'Active' });

    const mkUser = (u: typeof ADMIN, role: string, companyId: string, groupId: string) => Promise.all([
      setDoc(doc(db, 'users', u.userId), { id: u.userId, companyId, groupId, role, name: role, email: u.email, status: 'Active', isSuperAdmin: false, isDeleted: false }),
      setDoc(doc(db, 'user_auth_maps', u.uid), { authUid: u.uid, userId: u.userId, companyId, groupId, email: u.email }),
    ]);
    await mkUser(ADMIN, 'Admin', CO_A, GRP_A);
    await mkUser(SALES, 'Sales', CO_A, GRP_A);
    // GroupAdmin is scoped to GRP_A, home company CO_A — sibling access keys off
    // role + groupId, mirroring every other GroupAdmin emulator suite.
    await mkUser(GROUP_ADMIN, 'GroupAdmin', CO_A, GRP_A);
    await mkUser(ADMIN_B, 'GroupAdmin', CO_B, GRP_B); // foreign-group admin

    // Pre-existing documents for the "the guard grants nothing once a doc
    // exists" negatives — an ordinary CO_A product, its lock, and its counter.
    await setDoc(doc(db, 'products', 'PRD-EXISTING'), { id: 'PRD-EXISTING', name: 'Existing', companyId: CO_A, groupId: GRP_A, isDeleted: false });
    await setDoc(doc(db, 'product_sku_locks', productSkuLockId(CO_A, 'EXISTING')), { id: productSkuLockId(CO_A, 'EXISTING'), companyId: CO_A, groupId: GRP_A, sku: 'EXISTING', productId: 'PRD-EXISTING', isDeleted: false });
    // A counter as the §3.2 group-denormalization backfill leaves it: groupId +
    // updatedAt + `updatedBy: 'system-backfill'` stamped onto a pre-existing
    // doc. getNextDocumentNumber()'s set(merge:true) RETAINS updatedBy, so the
    // post-merge shape must still be accepted (Phase 8 live-verified defect —
    // the next order/quotation/invoice of every backfilled tenant was denied
    // for EVERY role until validCounterShape() allowed the audit field).
    await setDoc(doc(db, 'document_counters', `${CO_A}_quotation`), { id: `${CO_A}_quotation`, companyId: CO_A, groupId: GRP_A, docType: 'quotation', currentNumber: 7, prefix: 'QT-A', sequencePadding: 4, isDeleted: false, updatedBy: 'system-backfill' });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

const dbFor = (u: { uid: string; email: string }) => env.authenticatedContext(u.uid, { email: u.email }).firestore();

/** Mirrors `createProductWithSkuLock`'s configured branch (useInventory.ts:84). */
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

/** Mirrors `getNextDocumentNumber`'s transaction (documentNumbering.ts). */
async function counterTxn(
  db: ReturnType<typeof dbFor>,
  opts: { companyId: string; groupId: string; docType: 'quotation' | 'order' | 'invoice'; prefix: string },
) {
  const counterId = `${opts.companyId}_${opts.docType}`;
  const counterRef = doc(db, 'document_counters', counterId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const currentNumber = snap.exists() ? Number(snap.data().currentNumber) || 0 : 0;
    const nextNumber = currentNumber + 1;
    tx.set(counterRef, {
      id: counterId, companyId: opts.companyId, groupId: opts.groupId, docType: opts.docType,
      currentNumber: nextNumber, prefix: opts.prefix, sequencePadding: 4,
      createdAt: snap.exists() ? snap.data().createdAt || serverTimestamp() : serverTimestamp(),
      updatedAt: serverTimestamp(), isDeleted: false,
    }, { merge: true });
    return nextNumber;
  });
}

describe('A. missing-document transaction get() — the production batchGet 403 class', () => {
  it('getDoc on a MISSING product is ALLOWED and returns no data (the pre-create id-collision read)', async () => {
    await assertSucceeds(getDoc(doc(dbFor(ADMIN), 'products', 'PRD-BRAND-NEW')));
    const snap = await getDoc(doc(dbFor(SALES), 'products', 'PRD-BRAND-NEW'));
    expect(snap.exists()).toBe(false);
  });

  it('getDoc on a MISSING product_sku_lock is ALLOWED (the uniqueness pre-read)', async () => {
    await assertSucceeds(getDoc(doc(dbFor(SALES), 'product_sku_locks', productSkuLockId(CO_A, 'NEVER-USED'))));
  });

  it('getDoc on a MISSING document_counter is ALLOWED (the first quotation/order/invoice read)', async () => {
    await assertSucceeds(getDoc(doc(dbFor(ADMIN), 'document_counters', `${CO_A}_invoice`)));
  });
});

describe('B. createProductWithSkuLock transaction (configured branch, useInventory.ts:84)', () => {
  it('Admin creates a product in the HOME company — the exact reported production flow — ALLOW', async () => {
    await expect(createProductTxn(dbFor(ADMIN), { id: 'PRD-HOME', sku: 'MD-001', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId }))
      .resolves.toMatchObject({ applied: true });
  });

  it('an ordinary role (Sales) creates in the HOME company — ALLOW (the guard is role-generic)', async () => {
    await expect(createProductTxn(dbFor(SALES), { id: 'PRD-SALES', sku: 'MD-002', companyId: CO_A, groupId: GRP_A, actorId: SALES.userId }))
      .resolves.toMatchObject({ applied: true });
  });

  it('GroupAdmin creates a product in a same-group SIBLING company — ALLOW (groupAdminCanCreate)', async () => {
    await expect(createProductTxn(dbFor(GROUP_ADMIN), { id: 'PRD-SIB', sku: 'MD-003', companyId: CO_SIB, groupId: GRP_A, actorId: GROUP_ADMIN.userId }))
      .resolves.toMatchObject({ applied: true });
  });

  it('a foreign-group GroupAdmin creating into CO-A — DENY (tenant boundary intact)', async () => {
    await assertFails(createProductTxn(dbFor(ADMIN_B), { id: 'PRD-FGN', sku: 'MD-004', companyId: CO_A, groupId: GRP_A, actorId: ADMIN_B.userId }));
  });

  it('a same-company duplicate SKU is still blocked — the lock binds (app-level collision inside the txn)', async () => {
    await createProductTxn(dbFor(ADMIN), { id: 'PRD-1', sku: 'MD-DUP', companyId: CO_A, groupId: GRP_A, actorId: ADMIN.userId });
    await expect(createProductTxn(dbFor(SALES), { id: 'PRD-2', sku: 'MD-DUP', companyId: CO_A, groupId: GRP_A, actorId: SALES.userId }))
      .rejects.toThrow(/already used by another product/);
  });
});

describe('C. document_counters — first-create then increment (documentNumbering.ts)', () => {
  it('Admin: the FIRST order of a fresh counter state creates the counter (currentNumber 1) — ALLOW', async () => {
    await expect(counterTxn(dbFor(ADMIN), { companyId: CO_A, groupId: GRP_A, docType: 'order', prefix: 'ORD-A' })).resolves.toBe(1);
  });

  it('Admin: the SECOND order increments the EXISTING counter (n + 1) — ALLOW', async () => {
    await counterTxn(dbFor(ADMIN), { companyId: CO_A, groupId: GRP_A, docType: 'order', prefix: 'ORD-A' });
    await expect(counterTxn(dbFor(ADMIN), { companyId: CO_A, groupId: GRP_A, docType: 'order', prefix: 'ORD-A' })).resolves.toBe(2);
  });

  it('an ordinary role (Sales): first invoice counter — ALLOW', async () => {
    await expect(counterTxn(dbFor(SALES), { companyId: CO_A, groupId: GRP_A, docType: 'invoice', prefix: 'PI-A' })).resolves.toBe(1);
  });

  it('GroupAdmin: first order counter in a same-group SIBLING company — ALLOW', async () => {
    await expect(counterTxn(dbFor(GROUP_ADMIN), { companyId: CO_SIB, groupId: GRP_A, docType: 'invoice', prefix: 'PI-S' })).resolves.toBe(1);
  });

  it('a foreign-group GroupAdmin creating CO-A\u2019s counter — DENY', async () => {
    await assertFails(counterTxn(dbFor(ADMIN_B), { companyId: CO_A, groupId: GRP_A, docType: 'invoice', prefix: 'PI-A' }));
  });

  // Phase 8 live-verified regression: after scripts/backfill-group-denorm.cjs
  // stamps `updatedBy: 'system-backfill'` on a counter, getNextDocumentNumber's
  // set(merge:true) increment RETAINS that field. validCounterShape() must
  // still accept the post-merge shape — otherwise the NEXT numbered document
  // of every backfilled tenant is denied for every role (demo-tenant, 2026-09-07).
  it('Admin: increment a backfilled counter carrying updatedBy:system-backfill — ALLOW', async () => {
    await expect(counterTxn(dbFor(ADMIN), { companyId: CO_A, groupId: GRP_A, docType: 'quotation', prefix: 'QT-A' })).resolves.toBe(8);
  });

  it('GroupAdmin on the HOME company: increment a backfilled counter — ALLOW (the exact demo-tenant failure)', async () => {
    await expect(counterTxn(dbFor(GROUP_ADMIN), { companyId: CO_A, groupId: GRP_A, docType: 'quotation', prefix: 'QT-A' })).resolves.toBe(8);
  });

  it('an ordinary role (Sales): increment a backfilled counter — ALLOW', async () => {
    await expect(counterTxn(dbFor(SALES), { companyId: CO_A, groupId: GRP_A, docType: 'quotation', prefix: 'QT-A' })).resolves.toBe(8);
  });
});

describe('D. the resource == null guard grants nothing once a document EXISTS', () => {
  it('an existing other-company product is NOT readable cross-group — DENY', async () => {
    await assertFails(getDoc(doc(dbFor(ADMIN_B), 'products', 'PRD-EXISTING')));
  });

  it('an existing other-company SKU lock is NOT readable cross-group — DENY', async () => {
    await assertFails(getDoc(doc(dbFor(ADMIN_B), 'product_sku_locks', productSkuLockId(CO_A, 'EXISTING'))));
  });

  it('an existing other-company counter is NOT readable cross-group — DENY', async () => {
    await assertFails(getDoc(doc(dbFor(ADMIN_B), 'document_counters', `${CO_A}_quotation`)));
  });

  it('the owning Admin still reads their own existing product — ALLOW (sanity)', async () => {
    await assertSucceeds(getDoc(doc(dbFor(ADMIN), 'products', 'PRD-EXISTING')));
  });
});
