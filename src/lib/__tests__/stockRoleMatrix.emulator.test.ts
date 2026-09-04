/**
 * stockRoleMatrix.emulator.test.ts — INVENTORY-00 (Baseline & Safety Lock)
 * =======================================================================
 *
 * Reproduces the ACTUAL current firestore.rules authorization behavior for
 * stock writes, per role. This is the Phase-00 deliverable that resolves the
 * audit finding **P1-3** (previously PLAUSIBLE / NOT CONFIRMED).
 *
 * 8 roles  ×  3 stock write operations:
 *   OP-1  create a NEW `stock` summary (SUM-… doc that does not exist yet)
 *   OP-2  update `availableQty` on an EXISTING `stock` summary
 *   OP-3  create a `stock_ledger` row
 *
 * Roles: Warehouse, Operations, Procurement, Accounts, Sales, Manager, Admin,
 * GroupAdmin — all in the SAME company / group / warehouse.
 *
 * INVENTORY-00 RULE: this test does NOT change firestore.rules. It records
 * what the deployed rules permit and deny TODAY. The `expected` column below
 * is the Phase-00 characterization; if the emulator disagrees, the STATE file
 * is corrected to match the emulator, not the other way around.
 *
 * Current (INVENTORY-03 firestore.rules):
 *   - OP-1 (create summary):  warehouseActorCanCreate() is NOT role-gated
 *                             -> ALL 8 roles SUCCEED.
 *   - OP-2 (update availableQty): the field guard is
 *                             actorRoleMatches('.*Warehouse.*|.*Operations.*|.*Procurement.*|Admin|GroupAdmin')
 *                             -> Warehouse/Operations/Procurement/Admin/GroupAdmin SUCCEED;
 *                                Accounts/Sales/Manager are DENIED (least privilege).
 *                             ^ P1-3 was CONFIRMED in INVENTORY-00 (Procurement DENY)
 *                                and RESOLVED in INVENTORY-03 (Procurement ALLOW).
 *   - OP-3 (create stock_ledger): warehouseActorCanCreate() + field presence
 *                             checks, NOT role-gated -> ALL 8 roles SUCCEED.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT = 'neozy-stock-role-matrix-test';
const COMPANY_ID = 'CO-ROLEMATRIX-1';
const GROUP_ID = 'GRP-ROLEMATRIX-1';
const WAREHOUSE_ID = 'WH-ROLEMATRIX-1';
const PRODUCT_ID = 'PRD-ROLEMATRIX-1';
const EXISTING_STOCK_ID = `SUM-${COMPANY_ID}-${PRODUCT_ID}-${WAREHOUSE_ID}`;

let env: RulesTestEnvironment;

interface RoleCase {
  role: string;
  uid: string;
  userId: string;
  /** expected outcome per operation: true = write allowed, false = denied */
  expected: { createSummary: boolean; updateAvailableQty: boolean; createLedger: boolean };
}

const ROLE_CASES: RoleCase[] = [
  { role: 'Warehouse',  uid: 'uid-wh',   userId: 'user-wh',   expected: { createSummary: true, updateAvailableQty: true,  createLedger: true } },
  { role: 'Operations', uid: 'uid-ops',  userId: 'user-ops',  expected: { createSummary: true, updateAvailableQty: true,  createLedger: true } },
  // INVENTORY-03 (P1-3 resolution): Procurement is now in the `stock`
  // write-role list so a Procurement-role Goods Receipt can post stock IN into
  // an EXISTING summary. Was `false` in the INVENTORY-00 baseline.
  { role: 'Procurement', uid: 'uid-proc', userId: 'user-proc', expected: { createSummary: true, updateAvailableQty: true, createLedger: true } },
  { role: 'Accounts',   uid: 'uid-acc',  userId: 'user-acc',  expected: { createSummary: true, updateAvailableQty: false, createLedger: true } },
  { role: 'Sales',      uid: 'uid-sales', userId: 'user-sales', expected: { createSummary: true, updateAvailableQty: false, createLedger: true } },
  { role: 'Manager',    uid: 'uid-mgr',  userId: 'user-mgr',  expected: { createSummary: true, updateAvailableQty: false, createLedger: true } },
  { role: 'Admin',      uid: 'uid-admin', userId: 'user-admin', expected: { createSummary: true, updateAvailableQty: true,  createLedger: true } },
  { role: 'GroupAdmin', uid: 'uid-ga',   userId: 'user-ga',   expected: { createSummary: true, updateAvailableQty: true,  createLedger: true } },
];

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GROUP_ID), { id: GROUP_ID, name: 'Role Matrix Group', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_ID), { id: COMPANY_ID, companyId: COMPANY_ID, name: 'Role Matrix Co', groupId: GROUP_ID });
    await setDoc(doc(db, 'warehouses', WAREHOUSE_ID), { id: WAREHOUSE_ID, companyId: COMPANY_ID, groupId: GROUP_ID, name: 'RM Warehouse', status: 'Active' });

    for (const rc of ROLE_CASES) {
      await setDoc(doc(db, 'users', rc.userId), {
        id: rc.userId, companyId: COMPANY_ID, groupId: GROUP_ID, warehouseId: WAREHOUSE_ID,
        role: rc.role, name: rc.role, email: `${rc.userId}@rm.test`, status: 'Active', isSuperAdmin: false, isDeleted: false,
      });
      await setDoc(doc(db, 'user_auth_maps', rc.uid), {
        authUid: rc.uid, userId: rc.userId, companyId: COMPANY_ID, groupId: GROUP_ID, email: `${rc.userId}@rm.test`,
      });
    }

    // Pre-existing stock summary for OP-2.
    await setDoc(doc(db, 'stock', EXISTING_STOCK_ID), {
      id: EXISTING_STOCK_ID, companyId: COMPANY_ID, groupId: GROUP_ID, productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID,
      availableQty: 100, reservedQty: 0, unit: 'PCS', isDeleted: false,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env.cleanup();
});

const dbFor = (rc: RoleCase) => env.authenticatedContext(rc.uid, { email: `${rc.userId}@rm.test` }).firestore();

function newSummaryDoc(dbId: string) {
  return {
    id: dbId, companyId: COMPANY_ID, groupId: GROUP_ID, productId: `${PRODUCT_ID}-NEW`, warehouseId: WAREHOUSE_ID,
    availableQty: 5, reservedQty: 0, unit: 'PCS', isDeleted: false, updatedAt: serverTimestamp(),
  };
}
function ledgerDoc(dbId: string) {
  return {
    id: dbId, companyId: COMPANY_ID, groupId: GROUP_ID, productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID,
    type: 'IN', qty: 3, unit: 'PCS', beforeQty: 100, afterQty: 103,
    transactionId: `TXN-${dbId}`, movementAt: serverTimestamp(), sourceType: 'adjustment', sourceId: '',
    createdBy: 'seed', isDeleted: false, createdAt: serverTimestamp(),
  };
}

// Collected results, printed at the end for the STATE file.
const observed: Record<string, { createSummary: boolean; updateAvailableQty: boolean; createLedger: boolean }> = {};

describe('INVENTORY-00 — stock write role matrix (firestore.rules, current behavior)', () => {
  describe('OP-1: create a NEW stock summary', () => {
    for (const rc of ROLE_CASES) {
      it(`${rc.role} -> expected ${rc.expected.createSummary ? 'ALLOW' : 'DENY'}`, async () => {
        const db = dbFor(rc);
        const dbId = `SUM-${COMPANY_ID}-${PRODUCT_ID}-NEW-${WAREHOUSE_ID}-${rc.role}`;
        const op = setDoc(doc(db, 'stock', dbId), newSummaryDoc(dbId));
        observed[rc.role] = observed[rc.role] || ({} as any);
        try {
          if (rc.expected.createSummary) await assertSucceeds(op);
          else await assertFails(op);
          observed[rc.role].createSummary = rc.expected.createSummary;
        } catch (e) {
          observed[rc.role].createSummary = !rc.expected.createSummary;
          throw e;
        }
      });
    }
  });

  describe('OP-2: update availableQty on an EXISTING stock summary (P1-3)', () => {
    for (const rc of ROLE_CASES) {
      it(`${rc.role} -> expected ${rc.expected.updateAvailableQty ? 'ALLOW' : 'DENY'}`, async () => {
        const db = dbFor(rc);
        const op = updateDoc(doc(db, 'stock', EXISTING_STOCK_ID), { availableQty: 90, updatedAt: serverTimestamp() });
        observed[rc.role] = observed[rc.role] || ({} as any);
        try {
          if (rc.expected.updateAvailableQty) await assertSucceeds(op);
          else await assertFails(op);
          observed[rc.role].updateAvailableQty = rc.expected.updateAvailableQty;
        } catch (e) {
          observed[rc.role].updateAvailableQty = !rc.expected.updateAvailableQty;
          throw e;
        }
      });
    }
  });

  describe('OP-3: create a stock_ledger row', () => {
    for (const rc of ROLE_CASES) {
      it(`${rc.role} -> expected ${rc.expected.createLedger ? 'ALLOW' : 'DENY'}`, async () => {
        const db = dbFor(rc);
        const dbId = `STK-RM-${rc.role}`;
        const op = setDoc(doc(db, 'stock_ledger', dbId), ledgerDoc(dbId));
        observed[rc.role] = observed[rc.role] || ({} as any);
        try {
          if (rc.expected.createLedger) await assertSucceeds(op);
          else await assertFails(op);
          observed[rc.role].createLedger = rc.expected.createLedger;
        } catch (e) {
          observed[rc.role].createLedger = !rc.expected.createLedger;
          throw e;
        }
      });
    }
  });

  it('prints the observed matrix (for INVENTORY_IMPLEMENTATION_STATE.md)', () => {
    // eslint-disable-next-line no-console
    console.log('\n[INVENTORY-00 stock role matrix — observed]\n' + JSON.stringify(observed, null, 2));
    // INVENTORY-03: Procurement can now update an existing summary (P1-3 fixed);
    // Sales / Accounts / Manager stay DENIED (least privilege preserved).
    expect(ROLE_CASES.find((r) => r.role === 'Procurement')?.expected.updateAvailableQty).toBe(true);
    expect(ROLE_CASES.find((r) => r.role === 'Accounts')?.expected.updateAvailableQty).toBe(false);
    expect(ROLE_CASES.find((r) => r.role === 'Sales')?.expected.updateAvailableQty).toBe(false);
    expect(ROLE_CASES.find((r) => r.role === 'Manager')?.expected.updateAvailableQty).toBe(false);
  });
});
