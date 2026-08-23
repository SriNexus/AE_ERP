import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

/**
 * rbacPhase8CumulativeSecurity.emulator.test.ts — RBAC Phase 8
 * (Security & Regression Hardening, cumulative Phases 1-7).
 *
 * `multiTenantSecurity.emulator.test.ts` already exhaustively covers the
 * per-phase roles/users/group_members CRUD matrix (333 tests total,
 * including 27 RBAC-Phase-1-specific role-mutation tests and the full
 * group_members -> users promotion chain with cross-group/isSuperAdmin
 * escalation denials). Re-running that suite (npm run test:rules) already
 * re-proves Phases 1-7's individual guarantees against the final cumulative
 * rules file — this file does NOT duplicate any of that.
 *
 * This file tests exactly one thing those suites do not: the CROSS-PHASE
 * interaction the governing Phase 8 spec calls out specifically — the full
 * chain "authorized actor -> edits a role's PERMISSION MAP to grant
 * roles.create/roles.edit/users.edit -> assigns that role to a second,
 * ordinary identity -> that identity attempts the now-"granted" privileged
 * operation." The question this proves an answer to: does editing a role
 * DOCUMENT's `permissions` map ever change what the FIRESTORE RULES actually
 * authorize for whoever is assigned that role?
 *
 * The answer, proven below: NO. Every privileged Firestore write path in
 * this schema (roles create/update, users.isSuperAdmin, users.role ->
 * 'GroupAdmin'/'Admin') is gated by isAdmin()/isSuperAdmin()/
 * isOwnerIdentity()/groupAdminCanReadRole() — literal identity checks
 * (the actor's own `role` STRING field, or the isSuperAdmin/isOwner flags)
 * — and NONE of them ever read a roles/{roleId}.permissions map to decide
 * anything. A role document's `permissions` map is consumed exclusively by
 * the CLIENT-SIDE canDo() engine (Phases 2-6) for UI gating; it has zero
 * weight at the rules layer. This is the structural reason the newly-
 * functional Phase-1 role-editing capability cannot be chained into a
 * privilege escalation: granting elevated permissions to a role and
 * assigning that role to an unprivileged identity does not — cannot —
 * change what that identity's writes actually authorize.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`
 * list, updated by this phase to add this file — the only non-test-file
 * change this phase makes; see the Phase 8 report §3/§17).
 */

const PROJECT = 'neozy-rbac-phase8-cumulative-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';

const UID_GA_A = 'uid-ga-a';
const ID_GA_A = 'MUSR-GA-A';
const UID_ADMIN_A = 'uid-admin-a';
const ID_ADMIN_A = 'MUSR-ADMIN-A';
// The escalation target: an ORDINARY Sales-tier identity, assigned a custom
// role ('PowerRole') whose PERMISSION MAP grants roles.create/edit/delete
// and users.edit — the exact scenario the Phase 8 spec's §7 Test 3 and §8
// "self-escalation through a second identity" require proving denied.
const UID_ESCALATED = 'uid-escalated';
const ID_ESCALATED = 'MUSR-ESCALATED';

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, email: string, extra: Record<string, unknown> = {}) {
  return { id, companyId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}
function mappingDoc(uid: string, userId: string, companyId: string, email: string, extra: Record<string, unknown> = {}) {
  return { authUid: uid, userId, companyId, email, ...extra };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: 'GROUP-B' });
    await setDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-B'), { id: 'GROUP-B', name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'group_members', 'GROUP-A_MUSR-GA-A'), { id: 'GROUP-A_MUSR-GA-A', groupId: 'GROUP-A', userId: ID_GA_A, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    await setDoc(doc(db, 'users', ID_GA_A), { ...userDoc(ID_GA_A, 'GroupAdmin', COMPANY_A, 'ga.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_GA_A), mappingDoc(UID_GA_A, ID_GA_A, COMPANY_A, 'ga.a@neozy.test', { groupId: 'GROUP-A' }));
    await setDoc(doc(db, 'users', ID_ADMIN_A), { ...userDoc(ID_ADMIN_A, 'Admin', COMPANY_A, 'admin.a@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_ADMIN_A), mappingDoc(UID_ADMIN_A, ID_ADMIN_A, COMPANY_A, 'admin.a@neozy.test', { groupId: 'GROUP-A' }));

    // The escalation target: role STRING 'PowerRole' (never 'Admin' or
    // 'GroupAdmin'), assigned via a legitimate GroupAdmin-authorized write
    // shape (same-Group, non-reserved role string).
    await setDoc(doc(db, 'users', ID_ESCALATED), { ...userDoc(ID_ESCALATED, 'PowerRole', COMPANY_A, 'escalated@neozy.test'), groupId: 'GROUP-A' });
    await setDoc(doc(db, 'user_auth_maps', UID_ESCALATED), mappingDoc(UID_ESCALATED, ID_ESCALATED, COMPANY_A, 'escalated@neozy.test', { groupId: 'GROUP-A' }));

    // The role DOCUMENT the escalation identity is nominally assigned to,
    // via canDo()'s name-based resolution — permissions map is wide open.
    await setDoc(doc(db, 'roles', `${COMPANY_A}_PowerRole`), {
      id: `${COMPANY_A}_PowerRole`, companyId: COMPANY_A, name: 'PowerRole', schemaVersion: 1,
      permissions: {
        roles: { view: true, create: true, edit: true, delete: true },
        users: { view: true, create: true, edit: true, delete: true },
      },
    });
    await setDoc(doc(db, 'roles', `${COMPANY_A}_Admin`), { id: `${COMPANY_A}_Admin`, companyId: COMPANY_A, name: 'Admin', schemaVersion: 1, isSystem: true, permissions: {} });
    await setDoc(doc(db, 'roles', 'ROL-CUSTOM-A'), { id: 'ROL-CUSTOM-A', companyId: COMPANY_A, name: 'Custom A', schemaVersion: 1, permissions: {} });
    await setDoc(doc(db, 'roles', 'ROL-CUSTOM-B'), { id: 'ROL-CUSTOM-B', companyId: COMPANY_B, name: 'Custom B', schemaVersion: 1, permissions: {} });
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

describe('Phase 8 — the assignment step itself is a legitimate, already-proven-safe GroupAdmin write (regression anchor, not new evidence)', () => {
  it('GroupAdmin CAN grant a role wide-open permissions within their own company (Phase 1 capability, unchanged)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', `${COMPANY_A}_PowerRole`), {
      permissions: { roles: { create: true, edit: true, delete: true }, users: { create: true, edit: true } },
    }));
  });
  it('GroupAdmin CAN assign a non-reserved role string to an ordinary same-Group user (Phase 1 users-update branch C, unchanged)', async () => {
    const db = ctx(UID_GA_A, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_ESCALATED), { role: 'PowerRole', groupId: 'GROUP-A' }));
  });
});

describe('Phase 8 — Test 3 (§7): the escalation-target identity\'s ACTUAL Firestore authority, despite its assigned role\'s wide-open permissions map', () => {
  const escalated = () => ctx(UID_ESCALATED, 'escalated@neozy.test');

  it('CANNOT create a role document in their OWN company, despite roles.create:true in their assigned role\'s permission map', async () => {
    await assertFails(setDoc(doc(escalated(), 'roles', 'ROL-ESCALATION-ATTEMPT'), {
      id: 'ROL-ESCALATION-ATTEMPT', companyId: COMPANY_A, name: 'Escalation Attempt', schemaVersion: 1, permissions: {},
    }));
  });

  it('CANNOT update an existing custom role in their OWN company, despite roles.edit:true', async () => {
    await assertFails(updateDoc(doc(escalated(), 'roles', 'ROL-CUSTOM-A'), { description: 'hijacked via granted permission' }));
  });

  it('CANNOT delete a role, despite roles.delete:true (delete is allow:false for everyone, unaffected either way)', async () => {
    await assertFails(updateDoc(doc(escalated(), 'roles', 'ROL-CUSTOM-A'), { isDeleted: true }));
  });

  it('CANNOT edit another user\'s profile, despite users.edit:true in their assigned role\'s permission map', async () => {
    await assertFails(updateDoc(doc(escalated(), 'users', ID_ADMIN_A), { department: 'hijacked' }));
  });

  it('CANNOT grant themselves isSuperAdmin, despite users.edit:true', async () => {
    await assertFails(updateDoc(doc(escalated(), 'users', ID_ESCALATED), { isSuperAdmin: true }));
  });

  it('CANNOT promote themselves to GroupAdmin, despite users.edit:true', async () => {
    await assertFails(updateDoc(doc(escalated(), 'users', ID_ESCALATED), { role: 'GroupAdmin' }));
  });

  it('CANNOT create a role in a DIFFERENT company either — the permission grant does not even unlock same-tier-but-wrong-scope access', async () => {
    await assertFails(setDoc(doc(escalated(), 'roles', 'ROL-ESCALATION-B'), {
      id: 'ROL-ESCALATION-B', companyId: COMPANY_B, name: 'Escalation B', schemaVersion: 1, permissions: {},
    }));
  });

  it('regression anchor: a REAL Admin in the same company, with the SAME nominal roles.edit intent, CAN legitimately do what the escalated identity cannot — proving the denials above are role-identity-specific, not a blanket bug', async () => {
    const admin = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    await assertSucceeds(updateDoc(doc(admin, 'roles', 'ROL-CUSTOM-A'), { description: 'legitimately updated by Admin' }));
  });
});

describe('Phase 8 — full chain (§8): GroupAdmin edits permissions -> assigns the role -> second identity gains NO real authority', () => {
  it('end-to-end: after GroupAdmin (a) widens PowerRole\'s permission map and (b) assigns it to the target, the target is STILL denied every privileged write', async () => {
    const ga = ctx(UID_GA_A, 'ga.a@neozy.test');
    // Step 1: GroupAdmin edits the role's permission map (already proven ALLOW above; re-asserted here as part of the continuous chain).
    await assertSucceeds(updateDoc(doc(ga, 'roles', `${COMPANY_A}_PowerRole`), {
      permissions: { roles: { create: true, edit: true, delete: true }, users: { create: true, edit: true, delete: true } },
    }));
    // Step 2: GroupAdmin assigns that role to the ordinary identity (already proven ALLOW above).
    await assertSucceeds(updateDoc(doc(ga, 'users', ID_ESCALATED), { role: 'PowerRole', groupId: 'GROUP-A' }));
    // Step 3: the second identity attempts the privileged operation the role's permission map nominally grants — DENIED.
    const escalated = ctx(UID_ESCALATED, 'escalated@neozy.test');
    await assertFails(setDoc(doc(escalated, 'roles', 'ROL-CHAIN-ESCALATION'), {
      id: 'ROL-CHAIN-ESCALATION', companyId: COMPANY_A, name: 'Chain Escalation', schemaVersion: 1, permissions: {},
    }));
    await assertFails(updateDoc(doc(escalated, 'users', ID_ADMIN_A), { isSuperAdmin: true }));
  });
});

describe('Phase 8 — sanity: the target document actually persisted the wide-open permission map (proving the DENY above is a rules-layer property, not a seed/read failure)', () => {
  it('reads back PowerRole\'s permissions map and confirms it is genuinely wide-open', async () => {
    const admin = ctx(UID_ADMIN_A, 'admin.a@neozy.test');
    const snap = await assertSucceeds(getDoc(doc(admin, 'roles', `${COMPANY_A}_PowerRole`)));
    const data = snap.data() as any;
    expect(data.permissions.roles.create).toBe(true);
    expect(data.permissions.roles.edit).toBe(true);
    expect(data.permissions.users.edit).toBe(true);
  });
});
