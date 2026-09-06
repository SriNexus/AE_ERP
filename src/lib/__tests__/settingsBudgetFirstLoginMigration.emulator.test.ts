/**
 * Phase 8 follow-up (F-13 class) — settings rules expression-budget regression
 * suite. Live-reproduced browser defect: useTheme()'s first-login appearance
 * auto-migration write (createDocWithId shape — merge setDoc, serverTimestamp,
 * authoritative groupId auto-stamp) was denied on a FRESH login because the
 * client can dispatch before its group identity is hydrated; the previous
 * settingsCreateAllowed()/settingsUpdateAllowed() implementations precomputed
 * companyGroupIsActive()-bearing terms via eager `let`s for every evaluation,
 * and the resulting evaluation exhausted Firestore's 1000-expression budget
 * before any branch could grant. The rules now inline those terms lazily per
 * branch (predicates unchanged) — these tests pin that budget behavior and
 * the security surface around it.
 *
 * Covered:
 *   A    GroupAdmin first-login personal-settings migration WITHOUT groupId → ALLOW
 *   A-w  the same write WITH the authoritative groupId stamped → ALLOW
 *   B    GroupAdmin company-scoped section WITH groupId → ALLOW (branch parity)
 *   B-neg company-scoped section WITHOUT groupId → DENY (pre-existing semantics)
 *   C    the exact settingsPersonalOwnershipBackfillFix scenario → ALLOW
 *   D    a foreign-group GroupAdmin targeting Group A's company → DENY
 *   E    an ordinary (non-privileged) user's own personal-settings create → ALLOW
 *
 * Run via: npx firebase emulators:exec --only firestore --project <pid>
 *          "npx vitest run --config vitest.emulator.config.ts"
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT = 'neozy-settings-budget-regression-test';

const COMPANY_A = 'CO-A';
const GROUP_A = 'GROUP-A';
const COMPANY_B = 'CO-B'; // foreign group
const GROUP_B = 'GROUP-B';
const UID_GA = 'uid-ga-a';
const ID_GA = 'MUSR-GA-A';
const UID_SALES = 'uid-s-a';
const ID_SALES = 'MUSR-S-A';
const UID_GB = 'uid-ga-b';
const ID_GB = 'MUSR-GA-B';

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: GROUP_B, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_B), { id: GROUP_B, name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'group_members', `${GROUP_A}_${ID_GA}`), { id: `${GROUP_A}_${ID_GA}`, groupId: GROUP_A, userId: ID_GA, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });
    await setDoc(doc(db, 'group_members', `${GROUP_B}_${ID_GB}`), { id: `${GROUP_B}_${ID_GB}`, groupId: GROUP_B, userId: ID_GB, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });
    await setDoc(doc(db, 'users', ID_GA), userDoc(ID_GA, 'GroupAdmin', COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GA), mappingDoc(UID_GA, ID_GA, COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_SALES), userDoc(ID_SALES, 'Sales', COMPANY_A, GROUP_A, 's.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_SALES), mappingDoc(UID_SALES, ID_SALES, COMPANY_A, GROUP_A, 's.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_GB), userDoc(ID_GB, 'GroupAdmin', COMPANY_B, GROUP_B, 'ga.b@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GB), mappingDoc(UID_GB, ID_GB, COMPANY_B, GROUP_B, 'ga.b@neozy.test'));
  });
}

const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

/** The EXACT createDocWithId() wire shape (theme/useTheme auto-migration). */
const appPayload = (companyId: string, section: string, withGroupId: boolean, groupId?: string, actorId: string = ID_GA) => ({
  companyId,
  section,
  data: { themeMode: 'dark', fontSize: 'medium', navigationStyle: 'sidebar' },
  updatedAt: serverTimestamp(),
  updatedBy: actorId,
  createdBy: actorId,
  createdAt: serverTimestamp(),
  isDeleted: false,
  ...(withGroupId && groupId ? { groupId } : {}),
});

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

describe('Settings rules expression budget (F-13 class): the first-login personal-settings migration write must never be budget-denied', () => {
  it('Case A: GroupAdmin first-login appearance migration WITHOUT groupId (pre-hydration) → ALLOW', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(
      doc(db, 'settings', `${ID_GA}_settings_appearance`),
      appPayload(COMPANY_A, 'appearance', false),
      { merge: true },
    ));
  });

  it('Case A-with: the same GroupAdmin write WITH the authoritative groupId → ALLOW', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(
      doc(db, 'settings', `${ID_GA}_settings_appearance`),
      appPayload(COMPANY_A, 'appearance', true, GROUP_A),
      { merge: true },
    ));
  });

  it('Case B: GroupAdmin company-scoped section WITH groupId → ALLOW (branch parity with pre-restructure rules)', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(
      doc(db, 'settings', `${COMPANY_A}_settings_general`),
      appPayload(COMPANY_A, 'general', true, GROUP_A),
      { merge: true },
    ));
  });

  it('Case B-neg: company-scoped section WITHOUT groupId → DENY (pre-existing role semantics, preserved exactly)', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertFails(setDoc(
      doc(db, 'settings', `${COMPANY_A}_settings_general`),
      appPayload(COMPANY_A, 'general', false),
      { merge: true },
    ));
  });

  it('Case C: the settingsPersonalOwnershipBackfillFix scenario still passes — GroupAdmin updates own corrupted appearance doc', async () => {
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'settings', `${ID_GA}_settings_appearance`), {
        companyId: COMPANY_A, groupId: GROUP_A, section: 'appearance', data: { themeMode: 'system' },
        isDeleted: false, createdBy: ID_GA, createdAt: '2026-08-09T16:55:31.573Z', updatedAt: '2026-08-18T16:37:09.693Z', updatedBy: 'system-backfill',
      });
    });
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'settings', `${ID_GA}_settings_appearance`), {
      companyId: COMPANY_A, groupId: GROUP_A, section: 'appearance',
      data: { themeMode: 'dark' }, updatedAt: new Date().toISOString(), updatedBy: ID_GA,
    }));
  });

  it('Case D: a foreign-group GroupAdmin CANNOT create settings targeting Group A / Company A', async () => {
    const db = ctx(UID_GB, 'ga.b@neozy.test');
    await assertFails(setDoc(
      doc(db, 'settings', `${ID_GB}_settings_appearance`),
      appPayload(COMPANY_A, 'appearance', true, GROUP_A),
      { merge: true },
    ));
  });

  it('Case E: an ordinary (non-privileged) user CAN create their own personal appearance doc (no groupId)', async () => {
    const db = ctx(UID_SALES, 's.a@neozy.test');
    await assertSucceeds(setDoc(
      doc(db, 'settings', `${ID_SALES}_settings_appearance`),
      appPayload(COMPANY_A, 'appearance', false, undefined, ID_SALES),
      { merge: true },
    ));
  });
});
