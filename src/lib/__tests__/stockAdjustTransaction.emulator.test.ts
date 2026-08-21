/**
 * Regression coverage for the real Adjust-Stock write shape: an actual
 * two-document atomic transaction (stock_ledger create + stock update, run
 * through transaction.get()/transaction.set() exactly as
 * useSaveStockEntry()/stockIn() issue it) — not the single-document setDoc()
 * every prior stock rules test used.
 *
 * This distinction matters: a single-document write and this real
 * transaction shape are NOT equivalent from firestore.rules' perspective.
 * The real transaction evaluates rules for both documents together (and,
 * per the generic wildcard fallback's own documented non-short-circuiting
 * behavior, redundantly re-evaluates group/company scoping for both), which
 * costs enough cumulative expression-evaluation budget that it once
 * exceeded Firestore's hard "maximum of 1000 expressions" cap for BOTH a
 * plain Admin and a Group Admin actor — a pre-existing bug no prior test
 * caught. Uses the exact real-world data shape (companyId/groupId/
 * warehouseId/role) captured from admin@neozy.in / Ashish Enterprises.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

const PROJECT = 'neozy-stock-adjust-transaction-test';
let env: RulesTestEnvironment;

const COMPANY_ID = 'CO-1783978330465-3EV9';
const GROUP_ID = 'group-csgpl';
const WAREHOUSE_ID = 'WH-1787126688481-X8K5';
const PRODUCT_ID = 'PRD-1787136692687-IR7G';
const STOCK_ID = `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WAREHOUSE_ID}`;
const UID_GA = 'uid-real-ga';
const USER_ID_GA = 'MUSR-default-0234824979';

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_ID), { id: COMPANY_ID, companyId: COMPANY_ID, name: 'Ashish Enterprises', groupId: GROUP_ID });
    await setDoc(doc(db, 'groups', GROUP_ID), { id: GROUP_ID, name: 'AE Group', status: 'Active' });
    await setDoc(doc(db, 'warehouses', WAREHOUSE_ID), { id: WAREHOUSE_ID, companyId: COMPANY_ID, groupId: GROUP_ID, name: 'Ashish Enterprises', status: 'Active' });
    await setDoc(doc(db, 'users', USER_ID_GA), {
      id: USER_ID_GA, companyId: COMPANY_ID, groupId: GROUP_ID, role: 'GroupAdmin', name: 'Admin', email: 'admin@neozy.in', status: 'Active', isSuperAdmin: false, isDeleted: false,
    });
    await setDoc(doc(db, 'user_auth_maps', UID_GA), {
      authUid: UID_GA, userId: USER_ID_GA, companyId: COMPANY_ID, groupId: GROUP_ID, email: 'admin@neozy.in',
    });
    // Pre-existing stock summary (mirrors the real, already-created doc).
    await setDoc(doc(db, 'stock', STOCK_ID), {
      id: STOCK_ID, productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
      availableQty: 1, reservedQty: 0, unit: 'PCS', companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_GA, isDeleted: false,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env.cleanup();
});

const ctx = () => env.authenticatedContext(UID_GA, { email: 'admin@neozy.in' }).firestore();

const UID_PLAIN_ADMIN = 'uid-plain-admin';
const USER_ID_PLAIN_ADMIN = 'plain-admin-user';
async function seedPlainAdmin() {
  await env.withSecurityRulesDisabled(async (unrestricted) => {
    const db = unrestricted.firestore();
    await setDoc(doc(db, 'users', USER_ID_PLAIN_ADMIN), {
      id: USER_ID_PLAIN_ADMIN, companyId: COMPANY_ID, groupId: GROUP_ID, role: 'Admin', name: 'Plain Admin', email: 'plainadmin@neozy.test', status: 'Active', isSuperAdmin: false, isDeleted: false,
    });
    await setDoc(doc(db, 'user_auth_maps', UID_PLAIN_ADMIN), {
      authUid: UID_PLAIN_ADMIN, userId: USER_ID_PLAIN_ADMIN, companyId: COMPANY_ID, groupId: GROUP_ID, email: 'plainadmin@neozy.test',
    });
  });
}
const ctxPlainAdmin = () => env.authenticatedContext(UID_PLAIN_ADMIN, { email: 'plainadmin@neozy.test' }).firestore();

describe('Group Admin & Admin stock quantity update — real transaction shape', () => {
  it('ISOLATED: plain single-document update of availableQty only (no transaction, no ledger doc)', async () => {
    const db = ctx();
    await assertSucceeds(setDoc(doc(db, 'stock', STOCK_ID), {
      id: STOCK_ID, productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
      availableQty: 0, reservedQty: 0, unit: 'PCS', companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_GA, isDeleted: false,
    }));
  });

  it('ISOLATED: plain single-document create of a NEW stock_ledger entry (no transaction, no stock doc)', async () => {
    const db = ctx();
    await assertSucceeds(setDoc(doc(db, 'stock_ledger', 'STK-REGR-1'), {
      id: 'STK-REGR-1', productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
      type: 'OUT', qty: 1, unit: 'PCS', reference: '', notes: '', date: '2026-08-21',
      createdBy: USER_ID_GA, beforeQty: 1, afterQty: 0, transactionId: 'TXN-REGR-1',
      companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_GA, isDeleted: false,
      movementAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('COMBINED: the exact real runTransaction shape (ledger create + stock update together)', async () => {
    const db = ctx();
    let caught: unknown;
    try {
      await runTransaction(db, async (transaction) => {
        const stockRef = doc(db, 'stock', STOCK_ID);
        const ledgerRef = doc(db, 'stock_ledger', 'STK-REGR-2');
        const stockSnap = await transaction.get(stockRef);
        expect(stockSnap.exists()).toBe(true);

        transaction.set(ledgerRef, {
          id: 'STK-REGR-2', productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
          type: 'OUT', qty: 1, unit: 'PCS', reference: '', notes: '', date: '2026-08-21',
          createdBy: USER_ID_GA, beforeQty: 1, afterQty: 0, transactionId: 'TXN-REGR-2',
          companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_GA, isDeleted: false,
          movementAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(stockRef, {
          id: STOCK_ID, productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
          availableQty: 0, reservedQty: 0, unit: 'PCS', companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_GA, isDeleted: false,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (e) {
      caught = e;
    }
    if (caught) console.log('COMBINED transaction error:', String((caught as Error)?.message || caught));
    expect(caught).toBeUndefined();
  });

  it('BASELINE: plain Company Admin (not Group Admin) doing the SAME two-document transaction', async () => {
    await seedPlainAdmin();
    const db = ctxPlainAdmin();
    let caught: unknown;
    try {
      await runTransaction(db, async (transaction) => {
        const stockRef = doc(db, 'stock', STOCK_ID);
        const ledgerRef = doc(db, 'stock_ledger', 'STK-REGR-3');
        const stockSnap = await transaction.get(stockRef);
        expect(stockSnap.exists()).toBe(true);

        transaction.set(ledgerRef, {
          id: 'STK-REGR-3', productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
          type: 'OUT', qty: 1, unit: 'PCS', reference: '', notes: '', date: '2026-08-21',
          createdBy: USER_ID_PLAIN_ADMIN, beforeQty: 1, afterQty: 0, transactionId: 'TXN-REGR-3',
          companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_PLAIN_ADMIN, isDeleted: false,
          movementAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        transaction.set(stockRef, {
          id: STOCK_ID, productId: PRODUCT_ID, product: 'Adani 545 Bi-Facial DCR', warehouseId: WAREHOUSE_ID, warehouse: 'Ashish Enterprises',
          availableQty: 0, reservedQty: 0, unit: 'PCS', companyId: COMPANY_ID, groupId: GROUP_ID, updatedBy: USER_ID_PLAIN_ADMIN, isDeleted: false,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (e) {
      caught = e;
    }
    if (caught) console.log('BASELINE (plain Admin) transaction error:', String((caught as Error)?.message || caught));
    expect(caught).toBeUndefined();
  });
});
