import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

/**
 * multiTenantStorageSecurity.emulator.test.ts — PERMANENT Storage Rules
 * regression suite for Phase 8 (Master Plan §9.5 / §18 "Storage Rules
 * extensions (§9.5) tested with an equivalent Storage-side isolation test").
 *
 * §9.5 was specified in the architecture but never assigned to any Phase
 * 0-7 roadmap entry — audited and found genuinely unimplemented (zero
 * groupId/GroupAdmin logic anywhere in storage.rules) before this suite
 * closed it. Mirrors multiTenantSecurity.emulator.test.ts's actor/seed
 * conventions but exercises storage.rules against BOTH the Firestore and
 * Storage emulators simultaneously (storage.rules' checks are firestore.get()
 * cross-service lookups, so both must run together).
 *
 * Run via: npm run test:rules (extended to include the Storage emulator).
 */

// Must match the `--project` flag `npm run test:rules:storage` launches the
// emulators with — the Storage Emulator binds to exactly one project for its
// whole process lifetime, so Storage Rules' cross-service firestore.get()
// calls only ever resolve documents under THIS project (see
// vitest.emulator.storage.config.ts for the full explanation).
const PROJECT = 'neozy-multitenant-storage-test';

const COMPANY_A = 'CO-A'; // home company of GA_A, GROUP-A
const COMPANY_C = 'CO-C'; // second company in GROUP-A (sibling of CO-A)
const COMPANY_B = 'CO-B'; // GROUP-B — a different Group entirely
const COMPANY_SUS = 'CO-SUS'; // in GROUP-SUS (suspended)

const UID_GA_A = 'uid-ga-a';
const ID_GA_A = 'MUSR-GA-A';
const UID_GA_SUS = 'uid-ga-sus';
const ID_GA_SUS = 'MUSR-GA-SUS';
const UID_ADMIN_A = 'uid-admin-a';
const ID_ADMIN_A = 'MUSR-ADMIN-A';
const UID_USER_C = 'uid-user-c';
const ID_USER_C = 'MUSR-USER-C';

let env: RulesTestEnvironment;

const userDoc = (id: string, role: string, companyId: string, email: string, extra: Record<string, unknown> = {}) => ({
  id, role, companyId, email, status: 'Active', isDeleted: false, ...extra,
});
const mappingDoc = (authUid: string, userId: string, companyId: string, email: string, groupId?: string) => ({
  authUid, userId, companyId, email, ...(groupId ? { groupId } : {}),
});

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-B'), { id: 'GROUP-B', name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-SUS'), { id: 'GROUP-SUS', name: 'Group Suspended', shortName: 'GS', status: 'Suspended' });

    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, name: 'Company A', groupId: 'GROUP-A', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, name: 'Company C', groupId: 'GROUP-A', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, name: 'Company B', groupId: 'GROUP-B', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_SUS), { id: COMPANY_SUS, name: 'Company Suspended-Group', groupId: 'GROUP-SUS', status: 'Active' });

    // GroupAdmin of GROUP-A, home company CO-A — the actor every "sibling
    // company" test exercises against CO-C.
    await setDoc(doc(db, 'users', ID_GA_A), userDoc(ID_GA_A, 'GroupAdmin', COMPANY_A, 'ga.a@neozy.test', { groupId: 'GROUP-A' }));
    await setDoc(doc(db, 'user_auth_maps', UID_GA_A), mappingDoc(UID_GA_A, ID_GA_A, COMPANY_A, 'ga.a@neozy.test', 'GROUP-A'));

    // GroupAdmin whose OWN Group is suspended — home company CO-SUS.
    await setDoc(doc(db, 'users', ID_GA_SUS), userDoc(ID_GA_SUS, 'GroupAdmin', COMPANY_SUS, 'ga.sus@neozy.test', { groupId: 'GROUP-SUS' }));
    await setDoc(doc(db, 'user_auth_maps', UID_GA_SUS), mappingDoc(UID_GA_SUS, ID_GA_SUS, COMPANY_SUS, 'ga.sus@neozy.test', 'GROUP-SUS'));

    // Ordinary (non-GroupAdmin) Admin of CO-A — regression control: must NOT
    // gain cross-company Storage access merely by being an Admin.
    await setDoc(doc(db, 'users', ID_ADMIN_A), userDoc(ID_ADMIN_A, 'Admin', COMPANY_A, 'admin.a@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_ADMIN_A), mappingDoc(UID_ADMIN_A, ID_ADMIN_A, COMPANY_A, 'admin.a@neozy.test'));

    // Ordinary user of CO-C — proves same-company access is unaffected.
    await setDoc(doc(db, 'users', ID_USER_C), userDoc(ID_USER_C, 'Sales', COMPANY_C, 'user.c@neozy.test'));
    await setDoc(doc(db, 'user_auth_maps', UID_USER_C), mappingDoc(UID_USER_C, ID_USER_C, COMPANY_C, 'user.c@neozy.test'));

    // A case document under CO-C, staff-managed (no partnerId) — exercises
    // the scoped-document path (canReadScopedDocuments/canWriteScopedDocuments).
    await setDoc(doc(db, 'cases', 'CASE-C1'), { id: 'CASE-C1', companyId: COMPANY_C });
  });
}

const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});
afterAll(async () => {
  await env.cleanup();
});

const bytes = new Uint8Array([1, 2, 3]);

describe('Phase 8 (Master Plan §9.5) — Storage Rules GroupAdmin extension', () => {
  it('GroupAdmin of GROUP-A can read/write a general company path under a SIBLING Company in the same active Group', async () => {
    const storage = ctx(UID_GA_A, 'ga.a@neozy.test').storage();
    const path = `companies/${COMPANY_C}/products/logo.png`;
    await assertSucceeds(uploadBytes(ref(storage, path), bytes));
    await assertSucceeds(getBytes(ref(storage, path)));
  });

  it('GroupAdmin of GROUP-A is DENIED on a Company in a DIFFERENT Group (GROUP-B)', async () => {
    const storage = ctx(UID_GA_A, 'ga.a@neozy.test').storage();
    const path = `companies/${COMPANY_B}/products/logo.png`;
    await assertFails(uploadBytes(ref(storage, path), bytes));
  });

  it('a GroupAdmin whose own Group is SUSPENDED is denied even on their home Company\'s sibling (parity with Firestore §9.6)', async () => {
    // Seed a second company in GROUP-SUS to prove this is a suspension
    // check, not merely "home company only".
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'companies', 'CO-SUS-2'), { id: 'CO-SUS-2', name: 'Sibling in suspended group', groupId: 'GROUP-SUS', status: 'Active' });
    });
    const storage = ctx(UID_GA_SUS, 'ga.sus@neozy.test').storage();
    const path = `companies/CO-SUS-2/products/logo.png`;
    await assertFails(uploadBytes(ref(storage, path), bytes));
  });

  it('an ordinary (non-GroupAdmin) Admin of Company A is still DENIED on sibling Company C — regression: plain Admin gains nothing from §9.5', async () => {
    const storage = ctx(UID_ADMIN_A, 'admin.a@neozy.test').storage();
    const path = `companies/${COMPANY_C}/products/logo.png`;
    await assertFails(uploadBytes(ref(storage, path), bytes));
  });

  it('regression: same-company access is unchanged for an ordinary user (not a GroupAdmin path)', async () => {
    const storage = ctx(UID_USER_C, 'user.c@neozy.test').storage();
    const path = `companies/${COMPANY_C}/products/logo.png`;
    await assertSucceeds(uploadBytes(ref(storage, path), bytes));
    await assertSucceeds(getBytes(ref(storage, path)));
    await assertSucceeds(deleteObject(ref(storage, path)));
  });

  it('GroupAdmin extension also applies to the scoped case-document path (canReadScopedDocuments/canWriteScopedDocuments)', async () => {
    const storage = ctx(UID_GA_A, 'ga.a@neozy.test').storage();
    const path = `companies/${COMPANY_C}/cases/CASE-C1/documents/reg.pdf`;
    await assertSucceeds(uploadBytes(ref(storage, path), bytes));
    await assertSucceeds(getBytes(ref(storage, path)));
  });

  it('a signed-out identity is denied everywhere, GroupAdmin extension included', async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(storage, `companies/${COMPANY_C}/products/logo.png`), bytes));
  });
});
