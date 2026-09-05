/**
 * rolesReservedSystemNameProtection.emulator.test.ts
 *
 * RBAC Master Implementation Plan — Phase 2 (AUTH-C6 / S-4).
 *
 * ROOT CAUSE: `roleNotSystemProtected(data)` checked ONLY the client-supplied
 * `isSystem` boolean on the request — never the `name` field. An Admin or
 * GroupAdmin (the only actors who can create/rename a role document at all)
 * could therefore create a second, fully "custom" role (isSystem omitted or
 * false) literally NAMED "Admin", "Sales", or any other seeded system role
 * name, in the same company — the Roles.tsx UI's own client-side duplicate-
 * name check (a real but client-only safeguard) is the only thing that
 * previously stopped this through the normal form; a direct write bypassed
 * it entirely.
 *
 * FIX: `roleNotSystemProtected` now ALSO treats a reserved system role name
 * (the static SYSTEM_ROLE_NAMES list, mirrored from src/lib/roleBootstrap.ts)
 * as protected, regardless of the isSystem flag's value. This is additive
 * protection, not a narrowing of anything that worked before — it only
 * changes the outcome for the exact collision case that was previously (and
 * incorrectly) allowed.
 *
 * This file proves the real Firestore-emulator-level behavior, reusing the
 * exact fixture pattern established in rolesSystemRolePermissionEditFix.
 * emulator.test.ts (that file's own regression suite is re-run unmodified
 * alongside this one to prove the AD-1 system-role-edit fix is untouched).
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'neozy-roles-reserved-name-test';

const COMPANY_A = 'CO-A';
const GROUP_A = 'GROUP-A';

const UID_ADMIN = 'uid-admin-a';
const ID_ADMIN = 'MUSR-ADMIN-A';
const UID_GA = 'uid-ga-a';
const ID_GA = 'MUSR-GA-A';
const UID_OWNER = 'uid-owner';
const ID_OWNER = 'MUSR-OWNER';

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'group_members', `${GROUP_A}_${ID_GA}`), { id: `${GROUP_A}_${ID_GA}`, groupId: GROUP_A, userId: ID_GA, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    await setDoc(doc(db, 'users', ID_ADMIN), userDoc(ID_ADMIN, 'Admin', COMPANY_A, GROUP_A, 'admin.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_ADMIN), mappingDoc(UID_ADMIN, ID_ADMIN, COMPANY_A, GROUP_A, 'admin.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_GA), userDoc(ID_GA, 'GroupAdmin', COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GA), mappingDoc(UID_GA, ID_GA, COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_OWNER), { ...userDoc(ID_OWNER, 'Admin', COMPANY_A, GROUP_A, 'shreeniwas.tripathi0@gmail.com'), isSuperAdmin: true });
    await setDoc(doc(db, 'user_auth_maps', UID_OWNER), mappingDoc(UID_OWNER, ID_OWNER, COMPANY_A, GROUP_A, 'shreeniwas.tripathi0@gmail.com'));
  });
}

const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

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

describe('AUTH-C6 — an Admin/GroupAdmin cannot create a custom role colliding with a reserved system role name', () => {
  it('Admin CANNOT create a role named "Admin" without isSystem:true', async () => {
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertFails(setDoc(doc(db, 'roles', `${COMPANY_A}_FakeAdmin`), {
      id: `${COMPANY_A}_FakeAdmin`, companyId: COMPANY_A, name: 'Admin', schemaVersion: 1, permissions: {},
    }));
  });

  it('Admin CANNOT create a role named "Sales" (a different reserved name, proving this is not Admin-specific)', async () => {
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertFails(setDoc(doc(db, 'roles', `${COMPANY_A}_FakeSales`), {
      id: `${COMPANY_A}_FakeSales`, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, permissions: {},
    }));
  });

  it('GroupAdmin CANNOT create a role named "Manager" either — same protection applies to the GroupAdmin branch', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'roles', `${COMPANY_A}_FakeManager`), {
      id: `${COMPANY_A}_FakeManager`, companyId: COMPANY_A, name: 'Manager', schemaVersion: 1, permissions: {},
    }));
  });

  it('Super Admin / Owner CAN still create a role with a reserved name (the legitimate seed/self-heal path is unaffected)', async () => {
    const db = ctx(UID_OWNER, 'shreeniwas.tripathi0@gmail.com');
    await assertSucceeds(setDoc(doc(db, 'roles', `${COMPANY_A}_Sales`), {
      id: `${COMPANY_A}_Sales`, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, isSystem: true, permissions: {},
    }));
  });

  it('a genuinely custom, non-reserved role name is completely unaffected — Admin can still create ordinary custom roles', async () => {
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'roles', `${COMPANY_A}_RegionalLead`), {
      id: `${COMPANY_A}_RegionalLead`, companyId: COMPANY_A, name: 'Regional Lead', schemaVersion: 1, permissions: {},
    }));
  });
});

describe('AUTH-C6 — an Admin/GroupAdmin cannot RENAME a custom role into a reserved system role name', () => {
  async function seedCustomRole(id: string, name: string) {
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'roles', id), {
        id, companyId: COMPANY_A, name, schemaVersion: 1, permissions: {},
      });
    });
  }

  it('Admin CANNOT rename a custom role to "Admin"', async () => {
    const customId = `${COMPANY_A}_Custom1`;
    await seedCustomRole(customId, 'Custom One');
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', customId), { name: 'Admin' }));
  });

  it('GroupAdmin CANNOT rename a custom role to "Director"', async () => {
    const customId = `${COMPANY_A}_Custom2`;
    await seedCustomRole(customId, 'Custom Two');
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', customId), { name: 'Director' }));
  });

  it('renaming a custom role to another genuinely custom name still works', async () => {
    const customId = `${COMPANY_A}_Custom3`;
    await seedCustomRole(customId, 'Custom Three');
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', customId), { name: 'Custom Three Renamed' }));
  });
});

describe('AUTH-C6 — regression: legitimate system role management is untouched (AD-1 preserved)', () => {
  it('Admin can still edit a genuine system role\'s permissions without touching name/isSystem', async () => {
    const roleId = `${COMPANY_A}_Sales`;
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'roles', roleId), {
        id: roleId, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, isSystem: true,
        permissions: { leads: { view: true, create: false, edit: false, delete: false, visibility: 'all' } },
      });
    });
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', roleId), {
      permissions: { leads: { view: true, create: true, edit: false, delete: false, visibility: 'all' } },
    }));
  });

  it('Admin still cannot rename or demote an existing genuine system role — unaffected by this fix', async () => {
    const roleId = `${COMPANY_A}_Sales`;
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'roles', roleId), {
        id: roleId, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, isSystem: true, permissions: {},
      });
    });
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', roleId), { name: 'Sales Renamed' }));
    await assertFails(updateDoc(doc(db, 'roles', roleId), { isSystem: false }));
  });
});
