/**
 * settingsPersonalOwnershipBackfillFix.emulator.test.ts — real production
 * regression fix verification.
 *
 * TRIGGERED BY A LIVE, REPRODUCED REPORT: the real `admin@neozy.in`
 * (GroupAdmin) account hit `FirebaseError: Missing or insufficient
 * permissions` saving Settings -> Appearance. Reproduced directly against
 * the live production Firestore project (ae-erp-d933d) using that account's
 * own Firebase Auth ID token (read-only document GETs of the account's own
 * documents, no data mutated) — NOT assumed from source inspection alone.
 *
 * ROOT CAUSE (confirmed by direct field read of the live document): the
 * existing `settings/{userId}_settings_appearance` document had
 * `updatedBy: "system-backfill"` instead of the owning user's real id.
 *
 * `scripts/backfill-group-denorm.cjs` (Phase 1 Multi-Tenant groupId
 * denormalization) lists `settings` among ~40 generic tenant-scoped business
 * collections (leads, customers, orders, ...) it walks to stamp a missing
 * `groupId` field, and — like every other collection it touches — also
 * overwrites `updatedBy: 'system-backfill'` on every document it stamps.
 * That is harmless for ordinary business documents, but `settings`
 * documents are NOT all company-scoped: personal (user-scoped) sections
 * (appearance, notifications) are owned by a specific user, and
 * firestore.rules' `isOwnPersonalSettings()` used `data.updatedBy ==
 * currentUserId()` as part of its AUTHORIZATION decision. Once the backfill
 * script overwrote that field, `isOwnPersonalSettings(resource.data, ...)`
 * could never be true again for that user's own document — permanently
 * locking them out of saving their own personal settings, since the update
 * rule requires isOwnPersonalSettings() to hold for BOTH resource.data (the
 * existing doc) and request.resource.data (the new one).
 *
 * This bug is NOT specific to GroupAdmin — it affects any user whose
 * personal settings document was touched by that backfill script. It
 * surfaced first through the reported GroupAdmin account.
 *
 * THE FIX: firestore.rules' isOwnPersonalSettings() no longer checks
 * data.updatedBy. The remaining check — `documentId == currentUserId() +
 * '_settings_' + sectionId` — is already a complete, unforgeable ownership
 * proof (documentId is a Firestore path segment; currentUserId() is derived
 * server-side from request.auth.uid via the trusted user_auth_maps mapping)
 * making the updatedBy equality check redundant for a legitimate client, and
 * a real liability against any future system-initiated write.
 *
 * This file proves the REAL Firestore-emulator-level behavior (not
 * client-side canDo() mocking) for the exact corrupted-document shape found
 * in production.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'neozy-settings-personal-ownership-fix-test';

const COMPANY_A = 'CO-A';
const GROUP_A = 'GROUP-A';
const UID_GA = 'uid-ga-a';
const ID_GA = 'MUSR-GA-A'; // the Group Admin — mirrors the real reported account's role
const UID_SALES = 'uid-sales-a';
const ID_SALES = 'MUSR-SALES-A'; // an ordinary, non-admin actor — proves this is NOT a GroupAdmin-only fix

let env: RulesTestEnvironment;

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}
/** Mirrors the EXACT corrupted document shape found live in production. */
function corruptedAppearanceDoc(userId: string, companyId: string, groupId: string) {
  return {
    companyId,
    groupId,
    section: 'appearance',
    data: { themeMode: 'system', fontSize: 'small' },
    isDeleted: false,
    createdBy: userId,
    createdAt: '2026-08-09T16:55:31.573Z',
    updatedAt: '2026-08-18T16:37:09.693Z',
    updatedBy: 'system-backfill', // <- the exact corruption
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'group_members', `${GROUP_A}_${ID_GA}`), { id: `${GROUP_A}_${ID_GA}`, groupId: GROUP_A, userId: ID_GA, role: 'GroupAdmin', status: 'Active', grantedBy: 'system' });

    await setDoc(doc(db, 'users', ID_GA), userDoc(ID_GA, 'GroupAdmin', COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_GA), mappingDoc(UID_GA, ID_GA, COMPANY_A, GROUP_A, 'ga.a@neozy.test'));
    await setDoc(doc(db, 'users', ID_SALES), userDoc(ID_SALES, 'Sales', COMPANY_A, GROUP_A, 'sales.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_SALES), mappingDoc(UID_SALES, ID_SALES, COMPANY_A, GROUP_A, 'sales.a@neozy.test'));

    // The exact reported-production corruption, seeded for BOTH actors.
    await setDoc(doc(db, 'settings', `${ID_GA}_settings_appearance`), corruptedAppearanceDoc(ID_GA, COMPANY_A, GROUP_A));
    await setDoc(doc(db, 'settings', `${ID_SALES}_settings_appearance`), corruptedAppearanceDoc(ID_SALES, COMPANY_A, GROUP_A));
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

describe('The reported bug\'s real Firestore-level workflow: saving personal Appearance settings whose existing document was touched by backfill-group-denorm.cjs', () => {
  it('a Group Admin CAN save their own appearance settings even though the existing doc carries updatedBy: "system-backfill" (the exact live production shape)', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'settings', `${ID_GA}_settings_appearance`), {
      companyId: COMPANY_A,
      groupId: GROUP_A,
      section: 'appearance',
      data: { themeMode: 'dark', fontSize: 'medium' },
      updatedAt: new Date().toISOString(),
      updatedBy: ID_GA,
    }));
    const snap = await getDoc(doc(db, 'settings', `${ID_GA}_settings_appearance`));
    expect((snap.data() as any)?.data?.themeMode).toBe('dark');
  });

  it('an ordinary (non-admin, non-GroupAdmin) user CAN also save their own appearance settings under the same corrupted-doc condition — proves this is a general self-ownership fix, not a GroupAdmin-specific carve-out', async () => {
    const db = ctx(UID_SALES, 'sales.a@neozy.test');
    await assertSucceeds(updateDoc(doc(db, 'settings', `${ID_SALES}_settings_appearance`), {
      companyId: COMPANY_A,
      groupId: GROUP_A,
      section: 'appearance',
      data: { themeMode: 'light' },
      updatedAt: new Date().toISOString(),
      updatedBy: ID_SALES,
    }));
  });

  it('a DIFFERENT user still CANNOT write to someone else\'s personal settings document (ownership is still id-derived, not broadened)', async () => {
    const db = ctx(UID_SALES, 'sales.a@neozy.test');
    await assertFails(updateDoc(doc(db, 'settings', `${ID_GA}_settings_appearance`), {
      companyId: COMPANY_A,
      groupId: GROUP_A,
      section: 'appearance',
      data: { themeMode: 'dark' },
      updatedAt: new Date().toISOString(),
      updatedBy: ID_SALES,
    }));
  });

  it('creating a fresh personal settings document (no prior corruption) still works — the create path was never broken', async () => {
    const db = ctx(UID_GA, 'ga.a@neozy.test');
    await assertSucceeds(setDoc(doc(db, 'settings', `${ID_GA}_settings_notifications`), {
      companyId: COMPANY_A,
      section: 'notifications',
      data: { email: true },
      isDeleted: false,
      createdBy: ID_GA,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: ID_GA,
    }));
  });
});

describe('Source verification — the settings write rules no longer gate on the mutable updatedBy field', () => {
  it('firestore.rules\' settings create/update authorization no longer checks data.updatedBy == currentUserId()', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const fnStart = rules.indexOf('function settingsCreateAllowed(data)');
    const fnEnd = rules.indexOf('function settingsUpdateAllowed(oldData, newData)');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = rules.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain('updatedBy');
    expect(fnBody).toContain("documentId == ownerAwareUserId + '_settings_' + data.section");
  });
});
