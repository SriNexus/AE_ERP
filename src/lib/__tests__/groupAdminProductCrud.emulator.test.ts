import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, collection, setDoc, updateDoc, where, runTransaction } from 'firebase/firestore';
import { productSkuLockId, normalizeSku } from '../inventory/skuLock';

/**
 * groupAdminProductCrud.emulator.test.ts — RBAC Master Implementation Plan,
 * Phase 8 (SuperAdmin / GroupAdmin Hardening) — RUNTIME CLOSURE.
 *
 * The live acceptance criterion Phase 8 kept failing: "the actual GroupAdmin
 * account cannot create a Product from the desktop ERP." Every prior pass
 * proved helper return values; none proved the FIRESTORE RULES accept the
 * exact write the desktop Product flow issues.
 *
 * This file closes that gap. It exercises the REAL firestore.rules file
 * against the EXACT document shapes the desktop path produces —
 *
 *   ProductsWorkspace "Add Product" -> useSaveProduct.mutationFn
 *     -> resolveWriteCompanyId()  (the FOCUSED company; after commit 1371030
 *        a GroupAdmin's fresh session is their HOME company)
 *     -> resolveWriteGroupId(companyId)  (that company's owning group, or ''
 *        during the boot race / for legacy data)
 *     -> createProductWithSkuLock(id, payload, { companyId, groupId, actorId })
 *          transaction.set(products/{id},          { ...payload, id, companyId,
 *                                                    groupId?, createdBy,
 *                                                    updatedBy, isDeleted:false })
 *          transaction.set(product_sku_locks/{cid_sku}, { id, companyId, groupId?,
 *                                                    sku, productId, isDeleted:false })
 *
 * — plus the list query companyScopedQuery() builds (home -> where('companyId',
 * '==', home); sibling / 'group' -> where('groupId','==', actorGroupId)) and
 * the edit / soft-delete writes.
 *
 * What THIS proves: the rules ACCEPT / DENY the GroupAdmin Product flow
 * correctly at every scope boundary, with and without a groupId on the write,
 * with and without a backfilled identity groupId.
 * What the UNIT suite (phase8GroupAdminTenantContext.test.ts, 70 tests)
 * proves: the client builds exactly these shapes.
 * What NEITHER proves: a literal browser DOM render.
 *
 * Run via: npm run test:rules (registered in vitest.emulator.config.ts).
 */

const PROJECT = 'neozy-groupadmin-product-crud-test';

const CO_A = 'CO-A';            // GroupAdmin_A home company        (GROUP-A, active)
const CO_C = 'CO-C';            // sibling company, same group      (GROUP-A, active)
const CO_B = 'CO-B';            // company in a DIFFERENT group     (GROUP-B, active)
const CO_NOLINK = 'CO-NOLINK';  // company with NO groupId at all
const CO_SUSP = 'CO-SUSP';      // company whose group is SUSPENDED (GROUP-S)

const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';
const GROUP_S = 'GROUP-S';

const UID_GA_A = 'uid-ga-a';         const ID_GA_A = 'MUSR-GA-A';           // GroupAdmin, home CO-A, groupId GROUP-A
const UID_GA_NOGROUP = 'uid-ga-ng';  const ID_GA_NOGROUP = 'MUSR-GA-NG';    // GroupAdmin, home CO-A, identity groupId '' (un-backfilled)
const UID_GA_NOLINK = 'uid-ga-nl';   const ID_GA_NOLINK = 'MUSR-GA-NL';     // GroupAdmin, home CO-NOLINK (company not group-linked)
const UID_GA_SUSP = 'uid-ga-su';     const ID_GA_SUSP = 'MUSR-GA-SU';       // GroupAdmin, home CO-SUSP (group suspended)
const UID_ADMIN_A = 'uid-admin-a';   const ID_ADMIN_A = 'MUSR-ADMIN-A';     // plain Admin, home CO-A
const UID_ADMIN_NL = 'uid-admin-nl'; const ID_ADMIN_NL = 'MUSR-ADMIN-NL';   // plain Admin, home CO-NOLINK
const UID_SALES_A = 'uid-sales-a';   const ID_SALES_A = 'MUSR-SALES-A';     // plain Sales, home CO-A (empty role permissions map)

let env: RulesTestEnvironment;

const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

/** The exact product doc shape createProductWithSkuLock() writes. */
function productDoc(id: string, companyId: string, groupId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, name: `Product ${id}`, sku: '', price: 0, companyId,
    ...(groupId ? { groupId } : {}),
    createdBy: 'actor', updatedBy: 'actor', isDeleted: false, ...extra,
  };
}
/** The exact product_sku_locks doc shape createProductWithSkuLock() writes. */
function lockDoc(companyId: string, sku: string, productId: string, groupId: string | null) {
  const normalizedSku = normalizeSku(sku);
  return {
    id: productSkuLockId(companyId, normalizedSku), companyId,
    ...(groupId ? { groupId } : {}),
    sku: normalizedSku, productId, updatedBy: 'actor', isDeleted: false,
  };
}

/** Mirrors createProductWithSkuLock()'s configured branch: product doc + SKU lock in ONE transaction. */
async function createProductLikeDesktop(
  db: ReturnType<typeof ctx>,
  id: string, companyId: string, groupId: string | null, sku: string,
) {
  const normalizedSku = normalizeSku(sku);
  return runTransaction(db, async (tx) => {
    // The P1-7 id-collision guard read (a get of the not-yet-created doc).
    await tx.get(doc(db, 'products', id));
    if (normalizedSku) await tx.get(doc(db, 'product_sku_locks', productSkuLockId(companyId, normalizedSku)));
    tx.set(doc(db, 'products', id), productDoc(id, companyId, groupId, sku ? { sku: normalizedSku } : {}));
    if (normalizedSku) {
      tx.set(doc(db, 'product_sku_locks', productSkuLockId(companyId, normalizedSku)), lockDoc(companyId, sku, id, groupId));
    }
  });
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Company A', groupId: GROUP_A });
    await setDoc(doc(db, 'companies', CO_C), { id: CO_C, companyId: CO_C, name: 'Company C', groupId: GROUP_A });
    await setDoc(doc(db, 'companies', CO_B), { id: CO_B, companyId: CO_B, name: 'Company B', groupId: GROUP_B });
    await setDoc(doc(db, 'companies', CO_NOLINK), { id: CO_NOLINK, companyId: CO_NOLINK, name: 'Company NoLink' });
    await setDoc(doc(db, 'companies', CO_SUSP), { id: CO_SUSP, companyId: CO_SUSP, name: 'Company Suspended', groupId: GROUP_S });

    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_B), { id: GROUP_B, name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_S), { id: GROUP_S, name: 'Group S', shortName: 'GS', status: 'Suspended' });

    const identities: Array<[string, string, string, string, string, string]> = [
      // uid, userId, role, companyId, groupId, email
      [UID_GA_A, ID_GA_A, 'GroupAdmin', CO_A, GROUP_A, 'ga.a@neozy.test'],
      [UID_GA_NOGROUP, ID_GA_NOGROUP, 'GroupAdmin', CO_A, '', 'ga.ng@neozy.test'],
      [UID_GA_NOLINK, ID_GA_NOLINK, 'GroupAdmin', CO_NOLINK, '', 'ga.nl@neozy.test'],
      [UID_GA_SUSP, ID_GA_SUSP, 'GroupAdmin', CO_SUSP, GROUP_S, 'ga.su@neozy.test'],
      [UID_ADMIN_A, ID_ADMIN_A, 'Admin', CO_A, GROUP_A, 'admin.a@neozy.test'],
      [UID_ADMIN_NL, ID_ADMIN_NL, 'Admin', CO_NOLINK, '', 'admin.nl@neozy.test'],
      [UID_SALES_A, ID_SALES_A, 'Sales', CO_A, GROUP_A, 'sales.a@neozy.test'],
    ];
    for (const [uid, userId, role, companyId, groupId, email] of identities) {
      await setDoc(doc(db, 'users', userId), {
        id: userId, companyId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false,
        ...(groupId ? { groupId } : {}),
      });
      await setDoc(doc(db, 'user_auth_maps', uid), {
        authUid: uid, userId, companyId, email, ...(groupId ? { groupId } : {}),
      });
    }

    // Empty permissions maps — proves canCreateCompanyScoped()/canReadCompanyScoped()
    // never consult the role document.
    await setDoc(doc(db, 'roles', `${CO_A}_Admin`), { id: `${CO_A}_Admin`, companyId: CO_A, name: 'Admin', isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', `${CO_A}_Sales`), { id: `${CO_A}_Sales`, companyId: CO_A, name: 'Sales', isSystem: true, permissions: {} });

    // Pre-existing products for read / edit / delete tests.
    await setDoc(doc(db, 'products', 'PRD-A-EXISTING'), productDoc('PRD-A-EXISTING', CO_A, GROUP_A));
    await setDoc(doc(db, 'products', 'PRD-C-EXISTING'), productDoc('PRD-C-EXISTING', CO_C, GROUP_A));
    await setDoc(doc(db, 'products', 'PRD-B-EXISTING'), productDoc('PRD-B-EXISTING', CO_B, GROUP_B));
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

describe('A. GroupAdmin — HOME company Product CREATE (the reported failure)', () => {
  it('creates a product in their home company with the authoritative groupId — the exact desktop transaction — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-NEW-1', CO_A, GROUP_A, 'SKU-1'));
    expect((await getDoc(doc(db, 'products', 'PRD-NEW-1'))).data()?.companyId).toBe(CO_A);
  });

  it('creates a product in their home company with NO groupId on the write (boot race / legacy data: resolveWriteGroupId returned "") — ALLOW (canCreateCompanyScoped does not require groupId)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-NEW-2', CO_A, null, 'SKU-2'));
  });

  it('a GroupAdmin whose OWN identity groupId is not backfilled (user_auth_maps.groupId absent) still creates in their home company — ALLOW (home create keys on user_auth_maps.companyId, never actorGroupId)', async () => {
    const db = ctx(UID_GA_NOGROUP, 'ga.ng@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-NEW-3', CO_A, null, 'SKU-3'));
  });

  it('a blank-SKU product (no lock doc written) — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-NEW-4', CO_A, GROUP_A, ''));
  });
});

describe('B. GroupAdmin — HOME company Product READ / LIST', () => {
  it('lists home-company products with where("companyId","==",home) — the shape companyScopedQuery builds for a GroupAdmin focused on home — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    const snap = await assertSucceeds(getDocs(query(collection(db, 'products'), where('companyId', '==', CO_A))));
    expect(snap.docs.length).toBeGreaterThan(0);
  });

  it('reads a single home-company product doc — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'products', 'PRD-A-EXISTING')));
  });
});

describe('C. GroupAdmin — HOME company Product EDIT / soft-DELETE', () => {
  it('updates a home-company product — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'products', 'PRD-A-EXISTING'), { name: 'Renamed', updatedBy: 'ga' }));
  });

  it('soft-deletes a home-company product (isDeleted:true) — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'products', 'PRD-A-EXISTING'), { isDeleted: true, updatedBy: 'ga' }));
  });
});

describe('D. GroupAdmin — IN-GROUP SIBLING company (administrative scope)', () => {
  it('creates a product in a sibling company of the same group, stamped with the group — ALLOW (groupAdminCanCreate)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-C-NEW', CO_C, GROUP_A, 'SKU-C1'));
  });

  it('lists the group\'s products with where("groupId","==",actorGroup) — the shape companyScopedQuery builds for a sibling / group view — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(getDocs(query(collection(db, 'products'), where('groupId', '==', GROUP_A))));
  });

  it('updates a sibling-company product — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'products', 'PRD-C-EXISTING'), { name: 'Sibling renamed', updatedBy: 'ga' }));
  });
});

describe('E. GroupAdmin — CROSS-GROUP boundary is absolute', () => {
  it('cannot create a product in a company that belongs to a different group — DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-B-NEW', CO_B, GROUP_B, 'SKU-B1'));
  });

  it('cannot create in a different-group company by FORGING the groupId to its own — DENY (groupIdMatchesCompany: the company\'s real group wins)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-B-FORGE', CO_B, GROUP_A, 'SKU-B2'));
  });

  it('cannot read a different-group product — DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDoc(doc(db, 'products', 'PRD-B-EXISTING')));
  });

  it('cannot list a different-group company\'s products — DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(getDocs(query(collection(db, 'products'), where('companyId', '==', CO_B))));
  });

  it('cannot update a different-group product — DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'products', 'PRD-B-EXISTING'), { name: 'hijack' }));
  });
});

describe('F. The data precondition — NOT a GroupAdmin code bug', () => {
  it('a GroupAdmin whose HOME company has no groupId link cannot create — DENY (companyGroupIsActive: company carries no groupId)', async () => {
    const db = ctx(UID_GA_NOLINK, 'ga.nl@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-NL-1', CO_NOLINK, null, 'SKU-NL'));
  });

  it('a PLAIN ADMIN homed at the SAME unlinked company ALSO cannot create — proving the failure is a company-data precondition affecting EVERY role, not a GroupAdmin-specific defect', async () => {
    const db = ctx(UID_ADMIN_NL, 'admin.nl@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-NL-2', CO_NOLINK, null, 'SKU-NL2'));
  });

  it('a GroupAdmin whose home company\'s group is SUSPENDED cannot create — DENY (groupIsActive)', async () => {
    const db = ctx(UID_GA_SUSP, 'ga.su@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-SU-1', CO_SUSP, GROUP_S, 'SKU-SU'));
  });
});

describe('G. Non-GroupAdmin roles — unchanged (company-scoped, role-map independent)', () => {
  it('a plain Sales user with an EMPTY role permissions map still creates a product in their own company — ALLOW (canCreateCompanyScoped never reads the role doc)', async () => {
    const db = ctx(UID_SALES_A, 'sales.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-S-1', CO_A, GROUP_A, 'SKU-S1'));
  });

  it('a plain Sales user CANNOT create a product in an in-group sibling company — DENY (only a GroupAdmin crosses company lines)', async () => {
    const db = ctx(UID_SALES_A, 'sales.a@neozy.test');
    await assertFails(createProductLikeDesktop(db, 'PRD-S-2', CO_C, GROUP_A, 'SKU-S2'));
  });

  it('a plain Admin creates in their own company — ALLOW; in a sibling — DENY', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(createProductLikeDesktop(db, 'PRD-AD-1', CO_A, GROUP_A, 'SKU-AD1'));
    await assertFails(createProductLikeDesktop(db, 'PRD-AD-2', CO_C, GROUP_A, 'SKU-AD2'));
  });

  it('a plain Sales user cannot read a sibling-company product — DENY', async () => {
    const db = ctx(UID_SALES_A, 'sales.a@neozy.test');
    await assertFails(getDoc(doc(db, 'products', 'PRD-C-EXISTING')));
  });
});
