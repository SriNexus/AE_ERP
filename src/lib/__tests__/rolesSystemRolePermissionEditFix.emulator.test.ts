/**
 * rolesSystemRolePermissionEditFix.emulator.test.ts — real production
 * regression fix verification.
 *
 * TRIGGERED BY A LIVE, REPRODUCED REPORT: using a real Playwright/Chromium
 * browser session against the real local dev server (which, per .env.local,
 * points at the real production Firebase project) logged in as the real
 * admin@neozy.in (GroupAdmin) account, opening Roles -> Edit Role ->
 * "Operations" -> toggling a permission -> Save produced the toast
 * "Missing or insufficient permissions.", and the change did not persist
 * across a reload — reproduced exactly as reported, not assumed from source.
 *
 * ROOT CAUSE: firestore.rules' roles/{roleId} update rule required
 * roleNotSystemProtected() to hold for BOTH resource.data and
 * request.resource.data, with no bypass for GroupAdmin and no bypass for an
 * ordinary Company Admin either (only `isSuperAdmin()` bypassed it, on the
 * Admin branch only). "Operations" — like every seeded role in
 * roleBootstrap.ts's SYSTEM_ROLE_NAMES — carries isSystem:true, so this
 * blocked EVERY field of the update, including the permission matrix, for
 * every actor except Super Admin/Owner. This is not GroupAdmin-specific: the
 * exact same block applies to any ordinary company Admin editing any system
 * role. The governing decision (AD-1,
 * docs/implementation/NEOZY_ROLES_PERMISSIONS_RBAC_IMPLEMENTATION.md) is
 * scoped to "cannot create/promote system roles" — this fix narrows
 * enforcement to match that scope: a system role's identity (name, the
 * isSystem flag) stays immutable for non-Super-Admin actors, but its
 * permission grants/description/department/isManager become editable.
 *
 * This file proves the REAL Firestore-emulator-level behavior (not
 * client-side canDo() mocking), using the real "Operations" role's real
 * company/group scope.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'neozy-roles-system-role-edit-fix-test';

const COMPANY_A = 'CO-A'; // Group Admin's home company
const COMPANY_C = 'CO-C'; // sibling company, same Group
const COMPANY_B = 'CO-B'; // different Group entirely
const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';

const UID_GA = 'uid-ga-a';
const ID_GA = 'MUSR-GA-A';
const UID_ADMIN = 'uid-admin-a';
const ID_ADMIN = 'MUSR-ADMIN-A';
const UID_SALES = 'uid-sales-a';
const ID_SALES = 'MUSR-SALES-A';
const UID_OWNER = 'uid-owner';

const OPERATIONS_ROLE_ID = `${COMPANY_A}_Operations`;
const OPERATIONS_SIBLING_ID = `${COMPANY_C}_Operations`;
const OPERATIONS_OTHER_GROUP_ID = `${COMPANY_B}_Operations`;

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}
/** Mirrors the real seeded "Operations" system role shape (roleBootstrap.ts). */
function operationsRoleDoc(id: string, companyId: string) {
  return {
    id, companyId, name: 'Operations', schemaVersion: 1, isSystem: true,
    department: 'Operations', description: 'Operations role.',
    permissions: { projects: { view: false, create: false, edit: false, delete: false, visibility: 'self' } },
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'Company C', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: GROUP_B, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_B), { id: GROUP_B, name: 'Group B', status: 'Active' });
    await setDoc(doc(db, 'group_members', `${GROUP_A}_${ID_GA}`), { id: `${GROUP_A}_${ID_GA}`, groupId: GROUP_A, userId: ID_GA, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    await setDoc(doc(db, 'users', ID_GA), userDoc(ID_GA, 'GroupAdmin', COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GA), mappingDoc(UID_GA, ID_GA, COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_ADMIN), userDoc(ID_ADMIN, 'Admin', COMPANY_A, GROUP_A, 'admin.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_ADMIN), mappingDoc(UID_ADMIN, ID_ADMIN, COMPANY_A, GROUP_A, 'admin.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_SALES), userDoc(ID_SALES, 'Sales', COMPANY_A, GROUP_A, 'sales.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_SALES), mappingDoc(UID_SALES, ID_SALES, COMPANY_A, GROUP_A, 'sales.a@neozy.test'));
    const ownerId = 'MUSR-OWNER';
    await setDoc(doc(db, 'users', ownerId), { ...userDoc(ownerId, 'Admin', COMPANY_A, GROUP_A, 'shreeniwas.tripathi0@gmail.com'), isSuperAdmin: true });
    await setDoc(doc(db, 'user_auth_maps', UID_OWNER), mappingDoc(UID_OWNER, ownerId, COMPANY_A, GROUP_A, 'shreeniwas.tripathi0@gmail.com'));

    await setDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), operationsRoleDoc(OPERATIONS_ROLE_ID, COMPANY_A));
    await setDoc(doc(db, 'roles', OPERATIONS_SIBLING_ID), operationsRoleDoc(OPERATIONS_SIBLING_ID, COMPANY_C));
    await setDoc(doc(db, 'roles', OPERATIONS_OTHER_GROUP_ID), operationsRoleDoc(OPERATIONS_OTHER_GROUP_ID, COMPANY_B));
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

describe('The reported bug\'s real Firestore-level workflow: editing the "Operations" system role\'s permission matrix', () => {
  it('GroupAdmin CAN now toggle a permission on their own company\'s "Operations" system role — the exact reported, reproduced failure', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), {
      permissions: { projects: { view: true, create: false, edit: false, delete: false, visibility: 'all' } },
    }));
    const snap = await getDoc(doc(db, 'roles', OPERATIONS_ROLE_ID));
    expect((snap.data() as any)?.permissions?.projects?.view).toBe(true);
    expect((snap.data() as any)?.permissions?.projects?.visibility).toBe('all');
  });

  it('GroupAdmin CAN edit the same system role on a SIBLING company in their Group', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', OPERATIONS_SIBLING_ID), {
      permissions: { projects: { view: true, create: false, edit: false, delete: false, visibility: 'team' } },
    }));
  });

  it('an ordinary Company Admin CAN also edit a system role\'s permissions — proves this is a general fix, not GroupAdmin-only', async () => {
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), {
      permissions: { projects: { view: false, create: true, edit: false, delete: false, visibility: 'self' } },
    }));
  });

  it('GroupAdmin CANNOT edit a system role belonging to a DIFFERENT Group — cross-Group isolation preserved', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_OTHER_GROUP_ID), {
      permissions: { projects: { view: true, create: false, edit: false, delete: false, visibility: 'all' } },
    }));
  });

  it('an ordinary non-admin role (Sales) still CANNOT edit any role document, system or custom', async () => {
    const db = ctx(UID_SALES, 'sales.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), {
      permissions: { projects: { view: true, create: false, edit: false, delete: false, visibility: 'all' } },
    }));
  });
});

describe('System-role identity remains protected — this is a narrowing, not a removal, of AD-1', () => {
  it('GroupAdmin CANNOT rename a system role', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), { name: 'Operations Renamed' }));
  });

  it('GroupAdmin CANNOT demote a system role to isSystem:false', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), { isSystem: false }));
  });

  it('an ordinary Company Admin also CANNOT rename or demote a system role', async () => {
    const db = ctx(UID_ADMIN, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), { name: 'Hijacked' }));
    await assertFails(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), { isSystem: false }));
  });

  it('Super Admin / Owner retains full, unrestricted control (can rename/demote a system role) — unchanged bypass', async () => {
    const db = ctx(UID_OWNER, 'shreeniwas.tripathi0@gmail.com');
    await assertSucceeds(updateDoc(doc(db, 'roles', OPERATIONS_ROLE_ID), { name: 'Operations Renamed By Owner' }));
  });

  it('creating a NEW role with isSystem:true (promotion) remains Super-Admin-only — AD-1\'s create-side scope is untouched', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(setDoc(doc(db, 'roles', 'ROL-forged-system'), {
      id: 'ROL-forged-system', companyId: COMPANY_A, name: 'Forged System Role', schemaVersion: 1,
      isSystem: true, permissions: {},
    }));
  });

  it('a custom (non-system) role is completely unaffected — full edit, including rename, remains allowed for GroupAdmin', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    const customId = `${COMPANY_A}_TestCustomRole`;
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'roles', customId), {
        id: customId, companyId: COMPANY_A, name: 'TestCustomRole', schemaVersion: 1, permissions: {},
      });
    });
    await assertSucceeds(updateDoc(doc(db, 'roles', customId), { name: 'TestCustomRole Renamed', permissions: { leads: { view: true, visibility: 'all' } } }));
  });
});

describe('Source verification — the narrowed system-role protection', () => {
  it('firestore.rules defines roleSystemIdentityUnchanged() and the roles update rule uses it instead of the old whole-document block', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain('function roleSystemIdentityUnchanged(oldData, newData)');
    expect(rules).toContain('roleSystemIdentityUnchanged(resource.data, request.resource.data)');
    expect(rules).not.toContain('(roleNotSystemProtected(resource.data) && roleNotSystemProtected(request.resource.data))');
    // The create rule's stricter, unmodified protection (cannot create/promote
    // a system role) must remain exactly as-is.
    expect(rules).toContain('roleNotSystemProtected(request.resource.data)');
  });
});
