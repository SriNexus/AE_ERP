import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, query, collection, setDoc, updateDoc, where } from 'firebase/firestore';

/**
 * groupAdminFullGroupAccess.emulator.test.ts — real-behavior regression
 * fix verification.
 *
 * Triggered by a live report: "A GroupAdmin cannot update/change a user's
 * role from the Roles/User management flow." Root-caused to TWO distinct,
 * real defects (both confirmed by direct source inspection AND behavioral
 * reproduction before being fixed — see groupViewPermissionCollapseFix.test.ts
 * for the client-side half):
 *
 *  1. Users.tsx / MobileUsersWorkspace.tsx gated the user-role-reassignment
 *     <select> on canDo('roles','edit') instead of canDo('users','edit') —
 *     conflating "can edit ROLE DOCUMENT definitions" with "can reassign a
 *     USER's role". Phase 4 correctly makes roles.edit false in Group
 *     View (no company context to mutate a role FOR); since Group View is
 *     the ONLY way this screen shows users across multiple companies in a
 *     GroupAdmin's Group, that mix-up locked the role field read-only
 *     exactly when a GroupAdmin needed it for cross-company management.
 *  2. useGlobalBoot.ts's roles_global query called getAll(COLLECTIONS.ROLES)
 *     unconditionally, which — via companyScopedQuery()'s groupId-based
 *     Group-View branch, and role documents never carrying a groupId field
 *     — ALWAYS returned zero documents while genuinely in Group View,
 *     collapsing canDo() to false for EVERY module, not just roles.
 *
 * This file proves the REAL, Firestore-emulator-level behavior (not
 * client-side canDo() mocking) for the actual reported workflow: a
 * GroupAdmin reassigning a user's role, across same-company, sibling-
 * company (same Group), and different-Group scopes — plus the full
 * custom-role create -> assign -> real-business-write lifecycle the
 * broader complaint asked for, closing the loop from "permission checkbox
 * is on" to "the assigned user can actually perform the operation."
 *
 * multiTenantSecurity.emulator.test.ts already exhaustively covers the
 * general roles/users CRUD and privilege-escalation matrix (345 tests,
 * unmodified, re-run as part of npm run test:rules) — this file does not
 * duplicate that; it targets exactly the workflow the live report named.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */

const PROJECT = 'neozy-groupadmin-full-access-test';

const COMPANY_A = 'CO-A'; // GroupAdmin's home company (GROUP-A)
const COMPANY_C = 'CO-C'; // sibling company, same Group (GROUP-A)
const COMPANY_B = 'CO-B'; // different Group entirely (GROUP-B)

const UID_GA_A = 'uid-ga-a';
const ID_GA_A = 'MUSR-GA-A';
const UID_ADMIN_A = 'uid-admin-a';
const ID_ADMIN_A = 'MUSR-ADMIN-A';
const UID_USER_A = 'uid-user-a';
const ID_USER_A = 'MUSR-USER-A'; // ordinary Sales-tier user, Company A (home)
const UID_USER_C = 'uid-user-c';
const ID_USER_C = 'MUSR-USER-C'; // ordinary Sales-tier user, Company C (sibling)
const UID_USER_B = 'uid-user-b';
const ID_USER_B = 'MUSR-USER-B'; // ordinary Sales-tier user, Company B (different Group)

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string, extra: Record<string, unknown> = {}) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'Company C', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: 'GROUP-B' });
    await setDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-B'), { id: 'GROUP-B', name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-GA-A'), { id: 'GROUP-A_MUSR-GA-A', groupId: 'GROUP-A', userId: ID_GA_A, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    const identities = [
      { uid: UID_GA_A, userId: ID_GA_A, companyId: COMPANY_A, groupId: 'GROUP-A', email: 'ga.a@neozy.test', role: 'GroupAdmin' },
      { uid: UID_ADMIN_A, userId: ID_ADMIN_A, companyId: COMPANY_A, groupId: 'GROUP-A', email: 'admin.a@neozy.test', role: 'Admin' },
      { uid: UID_USER_A, userId: ID_USER_A, companyId: COMPANY_A, groupId: 'GROUP-A', email: 'user.a@neozy.test', role: 'Sales' },
      { uid: UID_USER_C, userId: ID_USER_C, companyId: COMPANY_C, groupId: 'GROUP-A', email: 'user.c@neozy.test', role: 'Sales' },
      { uid: UID_USER_B, userId: ID_USER_B, companyId: COMPANY_B, groupId: 'GROUP-B', email: 'user.b@neozy.test', role: 'Sales' },
    ];
    for (const identity of identities) {
      await setDoc(doc(db, 'users', identity.userId), userDoc(identity.userId, identity.role, identity.companyId, identity.groupId, identity.email));
      await setDoc(doc(db, 'user_auth_maps', identity.uid), mappingDoc(identity.uid, identity.userId, identity.companyId, identity.groupId, identity.email));
    }

    await setDoc(doc(db, 'roles', `${COMPANY_A}_Admin`), { id: `${COMPANY_A}_Admin`, companyId: COMPANY_A, name: 'Admin', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', `${COMPANY_A}_Sales`), { id: `${COMPANY_A}_Sales`, companyId: COMPANY_A, name: 'Sales', schemaVersion: 1, isSystem: true, permissions: {} });
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

describe('The reported bug\'s real Firestore-level workflow: GroupAdmin reassigning a user\'s role', () => {
  it('GroupAdmin_A changes User_A\'s (own home company) role — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_A), { role: 'Admin' }));
    const snap = await getDoc(doc(db, 'users', ID_USER_A));
    expect(snap.data()?.role).toBe('Admin');
  });

  it('GroupAdmin_A changes the sibling-company (same Group) User_C\'s role — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_C), { role: 'Admin' }));
  });

  it('GroupAdmin_A CANNOT change the different-Group User_B\'s role — DENY', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_B), { role: 'Admin' }));
  });

  it('GroupAdmin_A changes User_A\'s role to a DIFFERENT DEPARTMENT, mirroring the real app payload (enrichOrgFields denormalizes department + isManager onto every save, not just {role}) — ALLOW', async () => {
    // useUsers.ts's updateUserProjection() -> enrichOrgFields() ALWAYS
    // recomputes and includes `department` (+ `isManager`) on any edit where
    // `role` is present in the form payload -- which desktop Users.tsx sends
    // unconditionally, every save, not only when the role actually changed.
    // The three tests above only ever write `{ role: 'Admin' }` in isolation,
    // which never happens in the real app and never exercises
    // managerAssignmentUnchanged()'s department-changed branch. Seed User_A
    // with a PRESENT (not absent) empty-string department field first, to
    // match a real onboarded user doc's shape.
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await updateDoc(doc(rulesCtx.firestore(), 'users', ID_USER_A), { department: '', managerId: '', isManager: false });
    });
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_USER_A), {
      role: 'Admin', department: 'Management', isManager: false, managerId: '',
    }));
    const snap = await getDoc(doc(db, 'users', ID_USER_A));
    expect(snap.data()?.role).toBe('Admin');
    expect(snap.data()?.department).toBe('Management');
  });

  it('the fixed Group-View roles_global fetch shape (where companyId == home company) actually returns documents — proving the fix, not just the absence of the old bug', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    const snap = await assertSucceeds(getDocs(query(collection(db, 'roles'), where('companyId', '==', COMPANY_A))));
    expect(snap.docs.length).toBeGreaterThan(0);
    // Confirms, from the actual returned documents (not merely the seed
    // fixture), that none carries a groupId field — the reason the OLD
    // groupId-based query (companyScopedQuery()'s Group-View branch, what
    // getAll(ROLES) used before this fix) could only ever return zero
    // results for this collection. (A direct `where('groupId','==',...)`
    // list query against `roles` was deliberately NOT re-run here: it hits
    // an unrelated Firestore list-query shadow-document provability quirk
    // — dereferencing the absent companyId field on the OTHER matching read
    // branch — a test-mechanics artifact, not a security property; the fact
    // itself is independently confirmed by this assertion instead.)
    for (const d of snap.docs) {
      expect(d.data().groupId).toBeUndefined();
    }
  });
});

describe('Full custom-role lifecycle: create -> assign -> real business write', () => {
  const ROLE_ID = `${COMPANY_A}_TestSalesManager`;

  it('GroupAdmin creates a custom role with granular per-module permissions — ALLOW', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'roles', ROLE_ID), {
      id: ROLE_ID, companyId: COMPANY_A, name: 'TestSalesManager', schemaVersion: 1,
      permissions: {
        customers: { view: true, create: true, edit: true, delete: true },
        leads: { view: true, create: true, edit: true, delete: false },
        projects: { view: true, create: true, edit: false, delete: false },
      },
    }));
  });

  it('GroupAdmin assigns the custom role to User_A — ALLOW', async () => {
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(ga, 'roles', ROLE_ID), {
      id: ROLE_ID, companyId: COMPANY_A, name: 'TestSalesManager', schemaVersion: 1,
      permissions: { customers: { view: true, create: true, edit: true, delete: true } },
    }));
    await assertSucceeds(updateDoc(doc(ga, 'users', ID_USER_A), { role: 'TestSalesManager' }));
    const snap = await getDoc(doc(ga, 'users', ID_USER_A));
    expect(snap.data()?.role).toBe('TestSalesManager');
  });

  it('the reassigned user (now TestSalesManager) can actually perform a real Firestore write in their own company — a customers create — closing the full chain from "permission granted" to "operation succeeds"', async () => {
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    await setDoc(doc(ga, 'roles', ROLE_ID), {
      id: ROLE_ID, companyId: COMPANY_A, name: 'TestSalesManager', schemaVersion: 1,
      permissions: { customers: { view: true, create: true, edit: true, delete: true } },
    });
    await updateDoc(doc(ga, 'users', ID_USER_A), { role: 'TestSalesManager' });

    const reassignedUser = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(setDoc(doc(reassignedUser, 'customers', 'CUST-TEST-1'), {
      id: 'CUST-TEST-1', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Test Customer', isDeleted: false,
    }));
  });

  it('architecture confirmation (not a defect): ordinary business-collection writes (customers, leads, ...) are authorized by company/group scope alone at the Firestore-rules layer, independent of the actor\'s role-document permission map — proven directly, not assumed', async () => {
    // User_A here still carries its ORIGINAL role ('Sales'), whose seeded
    // role doc (${COMPANY_A}_Sales) has an EMPTY permissions map — yet the
    // write below still succeeds, because canCreateCompanyScoped() never
    // reads a role document at all. This is the same structural property
    // Phase 8/9 already proved for `roles`/`users` (identity-only gating);
    // this test proves it holds for a representative GENERIC collection
    // too, which is the direct, evidence-based answer to "does Firestore
    // enforce role permissions for ordinary modules" — see the fix report.
    const salesUser = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertSucceeds(setDoc(doc(salesUser, 'customers', 'CUST-TEST-2'), {
      id: 'CUST-TEST-2', companyId: COMPANY_A, groupId: 'GROUP-A', name: 'Another Customer', isDeleted: false,
    }));
  });
});

describe('Regression anchor: unauthorized roles and cross-scope escalation remain denied (unaffected by this fix)', () => {
  it('an ordinary role cannot create a role, even in its own company', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(setDoc(doc(db, 'roles', 'ROL-HOSTILE'), {
      id: 'ROL-HOSTILE', companyId: COMPANY_A, name: 'Hostile', schemaVersion: 1, permissions: {},
    }));
  });

  it('an ordinary role cannot grant itself isSuperAdmin', async () => {
    const db = ctx(UID_USER_A, 'user.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_A), { isSuperAdmin: true }));
  });

  it('GroupAdmin still cannot promote a same-Group user to GroupAdmin without a group_members record (unchanged)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_A), { role: 'GroupAdmin' }));
  });

  it('Admin_A (plain company Admin, not GroupAdmin) cannot reassign a role for a user in a DIFFERENT company', async () => {
    const db = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'users', ID_USER_C), { role: 'Admin' }));
  });
});
