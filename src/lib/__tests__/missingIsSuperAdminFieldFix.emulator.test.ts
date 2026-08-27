/**
 * missingIsSuperAdminFieldFix.emulator.test.ts — real production regression
 * fix verification.
 *
 * TRIGGERED BY chasing the real, reported Roles/Operations permission-save
 * failure past the AD-1 fix (rolesSystemRolePermissionEditFix.emulator.test.ts):
 * even after that fix was deployed, a fresh, live re-test against the real
 * production account (a real Firebase Auth sign-in + a real Firestore write,
 * via the actual Firebase JS client SDK — not source inspection, not the
 * emulator alone) still failed with "Missing or insufficient permissions" on
 * a TRIVIAL, non-identity field (description-only) update to the SAME real
 * role document AD-1's fix was supposed to unblock.
 *
 * ROOT CAUSE: the real GroupAdmin account's users/{id} document has NO
 * isSuperAdmin field at all (confirmed by a direct field dump of the live
 * document — not isSuperAdmin:false, genuinely absent, a legacy/migration
 * artifact: its updatedBy history shows 'system-repair' / 'identity-
 * verification-2026-08-19' / 'identity-correction-2026-08-19' markers from
 * several past repair scripts). firestore.rules' isSuperAdmin() read
 * currentUser().isSuperAdmin == true UNGUARDED — unlike every other optional
 * field in this file (hasGroupId/hasCompanyId/roleNotSystemProtected all
 * guard with keys().hasAny() first). Reproduced directly: seeding an
 * emulator user document that OMITS isSuperAdmin entirely (matching the real
 * document exactly, instead of the isSuperAdmin:false every prior test in
 * this suite used) turned a passing roles/{id} update into
 * "PERMISSION_DENIED: Unable to evaluate the expression as the maximum of
 * 1000 expressions to evaluate has been reached" for BOTH branches of the
 * OR (isAdmin() branch AND, per the emulator's own documented non-short-
 * circuiting across the wildcard fallback, cost bleeds into the whole
 * request) — denying an update that has nothing to do with system-role
 * protection at all.
 *
 * This is NOT specific to the roles collection or to Group Admin: isAdmin()/
 * isSuperAdmin() are called from dozens of places throughout firestore.rules,
 * and usersUpdateAllowed() (the users/{userId} update rule) had the exact
 * same unguarded pattern on both the actor's own flag and the target user's
 * flag. Any account whose profile predates isSuperAdmin being unconditionally
 * stamped could hit this on ANY collection's write.
 *
 * THE FIX: isSuperAdmin() and usersUpdateAllowed() now guard every
 * isSuperAdmin field access with keys().hasAny(['isSuperAdmin']) first,
 * treating absence as false (via the new isSuperAdminFlag() helper) instead
 * of erroring/exploding the expression budget.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'neozy-missing-issuperadmin-field-fix-test';
const COMPANY = 'CO-A';
const GROUP = 'GROUP-A';
const UID_GA = 'uid-ga-a';
const ID_GA = 'MUSR-GA-A';
const UID_TARGET = 'uid-target-a';
const ID_TARGET = 'MUSR-TARGET-A';
const ROLE_ID = `${COMPANY}_Operations`;

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY), { id: COMPANY, companyId: COMPANY, name: 'Company A', groupId: GROUP, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP), { id: GROUP, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'group_members', `${GROUP}_${ID_GA}`), { id: `${GROUP}_${ID_GA}`, groupId: GROUP, userId: ID_GA, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    // Deliberately OMITS isSuperAdmin entirely — matches the real production
    // document exactly (not isSuperAdmin:false, which every OTHER test in
    // this suite uses and which never exercised this bug).
    await setDoc(doc(db, 'users', ID_GA), { id: ID_GA, companyId: COMPANY, groupId: GROUP, role: 'GroupAdmin', email: 'ga.a@neozy.test', status: 'Active', isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', UID_GA), { authUid: UID_GA, userId: ID_GA, companyId: COMPANY, groupId: GROUP, email: 'ga.a@neozy.test' });

    // A second user, ALSO missing isSuperAdmin, as the target of a users/{id}
    // update — proves usersUpdateAllowed()'s guard fix too.
    await setDoc(doc(db, 'users', ID_TARGET), { id: ID_TARGET, companyId: COMPANY, groupId: GROUP, role: 'Sales', email: 'target.a@neozy.test', status: 'Active', isDeleted: false });
    await setDoc(doc(db, 'user_auth_maps', UID_TARGET), { authUid: UID_TARGET, userId: ID_TARGET, companyId: COMPANY, groupId: GROUP, email: 'target.a@neozy.test' });

    await setDoc(doc(db, 'roles', ROLE_ID), {
      id: ROLE_ID, companyId: COMPANY, name: 'Operations', schemaVersion: 1, isSystem: true,
      department: 'Operations', description: 'Operations role.',
      permissions: { projects: { view: false, create: false, edit: false, delete: false, visibility: 'all' } },
    });
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

describe('An actor whose users/{id} document has NO isSuperAdmin field at all (real production shape) is not denied by that absence', () => {
  it('GroupAdmin with no isSuperAdmin field can still edit a system role\'s permissions — the exact reproduced production failure', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'roles', ROLE_ID), { description: 'diagnostic-probe' }));
    await assertSucceeds(updateDoc(doc(db, 'roles', ROLE_ID), {
      permissions: { projects: { view: true, create: false, edit: false, delete: false, visibility: 'team' } },
    }));
    const snap = await getDoc(doc(db, 'roles', ROLE_ID));
    expect((snap.data() as any)?.permissions?.projects?.view).toBe(true);
  });

  it('GroupAdmin with no isSuperAdmin field can still reassign a target user\'s role (target also missing the field)', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'users', ID_TARGET), { role: 'Admin' }));
  });
});

describe('Source verification — every isSuperAdmin field access in firestore.rules is guarded', () => {
  it('no unguarded `.isSuperAdmin ==` comparison remains anywhere in the file', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const lines = rules.split('\n');
    const offenders: string[] = [];
    // The guard may live on the SAME line or on one of the 1-2 preceding
    // lines (this file wraps long guarded expressions across lines) — check
    // a small preceding window, not just the exact line.
    lines.forEach((line, i) => {
      if (!line.includes('.isSuperAdmin ==')) return;
      if (line.trim().startsWith('//')) return;
      const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
      if (window.includes("keys().hasAny(['isSuperAdmin'])")) return;
      if (window.includes('isSuperAdminFlag')) return;
      // managerScopeMatches() guards via the differently-named hasOrgField()
      // helper instead — an equally valid, pre-existing guard pattern.
      if (window.includes("hasOrgField(") && window.includes("'isSuperAdmin'")) return;
      offenders.push(`${i + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it('isSuperAdmin() and isSuperAdminFlag() both exist and guard the field access via the cheaper map.get(key, default) accessor', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain("hasUserProfile() && currentUser().get('isSuperAdmin', false) == true");
    expect(rules).toContain("function isSuperAdminFlag(data)");
    expect(rules).toContain("data.get('isSuperAdmin', false) == true");
  });
});
