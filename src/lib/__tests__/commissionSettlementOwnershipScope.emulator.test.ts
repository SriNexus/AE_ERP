/**
 * commissionSettlementOwnershipScope.emulator.test.ts
 *
 * RBAC Master Implementation Plan — Phase 7 (AUTH-C3), commission_records / settlements.
 *
 * ROOT CAUSE: `commission_records` and `settlements` have dedicated
 * `firestore.rules` match blocks (added in the pre-RBAC Security Remediation
 * Phase 2), but their `read` rule was a coarse company/role boundary —
 * `sameCompany(data) && (actorIsSuperAdmin() || actorRoleMatches('Admin|Manager|Partner|Director'))`.
 * roleBootstrap.ts seeds Partner at `visibility:'self'` on the governing
 * `partners` module (every other role granted it — Admin/Manager/Director —
 * has no visibility key and normalizes to `'all'`, per plan §8). That
 * Partner self-scope was real client-side (`applyAccessFilters` /
 * `buildOwnershipVisibilityQueryPlan` on OWNERSHIP_FIELDS) but advisory only
 * at the rules layer: a same-company Partner could `getDoc()` ANOTHER
 * partner's commission / settlement row directly, bypassing the UI
 * (AUTH-C3, High severity).
 *
 * FIX: `commissionSettlementReadAllowed()` — a `let`-bound predicate that
 * narrows a Partner-role actor to rows whose `partnerId` matches their own
 * `channel_partners` doc (`users.channelPartnerId`). Every other role's read
 * (Admin / Manager / Director company-wide, SuperAdmin / Owner unconditional,
 * GroupAdmin group-wide) and create / update / delete for every role are
 * byte-for-byte unchanged. Partner-only — no team branch, because no role is
 * seeded `'team'` on the partners module ("do not invent narrower business
 * behavior").
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const PROJECT = 'neozy-commission-settlement-ownership-scope-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';
const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';

const MGR = 'MUSR-manager';
const DIRECTOR = 'MUSR-director';
const PARTNER_USER = 'MUSR-partner';
const PARTNER_DOC = 'CP-1';
const OTHER_PARTNER_DOC = 'CP-2';
const ADMIN = 'MUSR-admin';
const GROUP_ADMIN = 'MUSR-groupadmin';

function userDoc(id: string, role: string, companyId: string, extra: Record<string, unknown> = {}) {
  return { id, companyId, role, email: `${id}@neozy.test`, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string, email: string) {
  return { authUid: uid, userId, companyId, groupId, email };
}

let env: RulesTestEnvironment;

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: GROUP_B, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_B), { id: GROUP_B, name: 'Group B', status: 'Active' });

    await setDoc(doc(db, 'users', MGR), userDoc(MGR, 'Manager', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-manager'), mappingDoc('uid-manager', MGR, COMPANY_A, GROUP_A, `${MGR}@neozy.test`));

    await setDoc(doc(db, 'users', DIRECTOR), userDoc(DIRECTOR, 'Director', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-director'), mappingDoc('uid-director', DIRECTOR, COMPANY_A, GROUP_A, `${DIRECTOR}@neozy.test`));

    await setDoc(doc(db, 'channel_partners', PARTNER_DOC), { id: PARTNER_DOC, companyId: COMPANY_A, name: 'Partner One', userId: PARTNER_USER, status: 'Active' });
    await setDoc(doc(db, 'users', PARTNER_USER), userDoc(PARTNER_USER, 'Partner', COMPANY_A, { channelPartnerId: PARTNER_DOC }));
    await setDoc(doc(db, 'user_auth_maps', 'uid-partner'), mappingDoc('uid-partner', PARTNER_USER, COMPANY_A, GROUP_A, `${PARTNER_USER}@neozy.test`));

    await setDoc(doc(db, 'users', ADMIN), userDoc(ADMIN, 'Admin', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-admin'), mappingDoc('uid-admin', ADMIN, COMPANY_A, GROUP_A, `${ADMIN}@neozy.test`));

    await setDoc(doc(db, 'users', GROUP_ADMIN), userDoc(GROUP_ADMIN, 'GroupAdmin', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-groupadmin'), mappingDoc('uid-groupadmin', GROUP_ADMIN, COMPANY_A, GROUP_A, `${GROUP_ADMIN}@neozy.test`));

    // commission_records: own-partner, other-partner, no-partnerId, cross-company, group-target.
    await setDoc(doc(db, 'commission_records', 'CR-partner-own'), { id: 'CR-partner-own', companyId: COMPANY_A, partnerId: PARTNER_DOC, amount: 5000, status: 'pending', createdBy: MGR });
    await setDoc(doc(db, 'commission_records', 'CR-partner-other'), { id: 'CR-partner-other', companyId: COMPANY_A, partnerId: OTHER_PARTNER_DOC, amount: 7000, status: 'pending', createdBy: MGR });
    await setDoc(doc(db, 'commission_records', 'CR-no-partner'), { id: 'CR-no-partner', companyId: COMPANY_A, amount: 100, status: 'pending', createdBy: MGR });
    await setDoc(doc(db, 'commission_records', 'CR-cross-company'), { id: 'CR-cross-company', companyId: COMPANY_B, partnerId: PARTNER_DOC, amount: 9000, status: 'pending', createdBy: 'MUSR-b' });
    await setDoc(doc(db, 'commission_records', 'CR-groupadmin-target'), { id: 'CR-groupadmin-target', companyId: COMPANY_A, groupId: GROUP_A, partnerId: OTHER_PARTNER_DOC, amount: 4000, status: 'pending', createdBy: MGR });

    // settlements: identical shape.
    await setDoc(doc(db, 'settlements', 'ST-partner-own'), { id: 'ST-partner-own', companyId: COMPANY_A, partnerId: PARTNER_DOC, netAmount: 5000, status: 'paid', createdBy: ADMIN });
    await setDoc(doc(db, 'settlements', 'ST-partner-other'), { id: 'ST-partner-other', companyId: COMPANY_A, partnerId: OTHER_PARTNER_DOC, netAmount: 7000, status: 'paid', createdBy: ADMIN });
    await setDoc(doc(db, 'settlements', 'ST-cross-company'), { id: 'ST-cross-company', companyId: COMPANY_B, partnerId: PARTNER_DOC, netAmount: 9000, status: 'paid', createdBy: 'MUSR-b' });
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

describe('AUTH-C3 (commission_records) — Partner self-scope', () => {
  it('POSITIVE: Partner A can read a commission_record linked to their own channel_partners doc', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-partner-own')));
  });

  it('NEGATIVE (same-company out-of-scope): Partner A CANNOT direct-read Partner B\'s commission_record', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-partner-other')));
  });

  it('NEGATIVE: Partner cannot read a commission_record with no partnerId at all', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-no-partner')));
  });

  it('NEGATIVE (cross-company): Partner cannot read a Company B commission_record even one carrying their own partnerId', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-cross-company')));
  });

  it('QUERY SCOPE: an unconstrained same-company commission_records query is rejected (Firestore cannot prove partner-ownership for the worst-case matched doc)', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDocs(query(collection(db, 'commission_records'), where('companyId', '==', COMPANY_A))));
  });

  it('QUERY SCOPE: a query narrowed to the Partner\'s own partnerId succeeds (matches the client query-planning shape)', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    const snap = await assertSucceeds(getDocs(query(collection(db, 'commission_records'), where('companyId', '==', COMPANY_A), where('partnerId', '==', PARTNER_DOC))));
    expect(snap.docs.map((d) => d.id)).toEqual(['CR-partner-own']);
  });

  it('NO ESCALATION: Partner still cannot create or update a commission_record (create/update unchanged — Admin/Manager only)', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(setDoc(doc(db, 'commission_records', 'CR-partner-new'), { id: 'CR-partner-new', companyId: COMPANY_A, partnerId: PARTNER_DOC, amount: 1, status: 'pending', createdBy: PARTNER_USER }));
    await assertFails(updateDoc(doc(db, 'commission_records', 'CR-partner-own'), { amount: 999999 }));
  });
});

describe('AUTH-C3 (commission_records) — company-wide roles unchanged', () => {
  it('Admin reads ANY same-company commission_record regardless of partnerId (unchanged)', async () => {
    const db = ctx('uid-admin', `${ADMIN}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-partner-other')));
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-no-partner')));
  });

  it('Manager (seeded `all` on the partners module) reads ANY same-company commission_record (unchanged)', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-partner-other')));
  });

  it('Director (view-only, `all`) reads ANY same-company commission_record (unchanged)', async () => {
    const db = ctx('uid-director', `${DIRECTOR}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-partner-own')));
  });

  it('Admin cannot read a Company B commission_record (company isolation unaffected)', async () => {
    const db = ctx('uid-admin', `${ADMIN}@neozy.test`);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-cross-company')));
  });

  it('GroupAdmin reaches a same-group commission_record via groupAdminCanRead(), independent of the Partner predicate (unchanged)', async () => {
    const db = ctx('uid-groupadmin', `${GROUP_ADMIN}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-groupadmin-target')));
  });
});

describe('AUTH-C3 (settlements) — Partner self-scope', () => {
  it('POSITIVE: Partner can read a settlement linked to their own channel_partners doc', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'settlements', 'ST-partner-own')));
  });

  it('NEGATIVE (same-company out-of-scope): Partner A CANNOT direct-read Partner B\'s settlement', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'settlements', 'ST-partner-other')));
  });

  it('NEGATIVE (cross-company): Partner cannot read a Company B settlement', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'settlements', 'ST-cross-company')));
  });

  it('Admin reads ANY same-company settlement (unchanged)', async () => {
    const db = ctx('uid-admin', `${ADMIN}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'settlements', 'ST-partner-other')));
  });
});
