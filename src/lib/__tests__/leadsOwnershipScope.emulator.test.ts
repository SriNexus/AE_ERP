/**
 * leadsOwnershipScope.emulator.test.ts
 *
 * RBAC Master Implementation Plan — Phase 7 (AUTH-C1), collection 2 of 8.
 *
 * Same shape as customersOwnershipScope.emulator.test.ts: `leads` had no
 * dedicated `firestore.rules` match block — every request fell through to
 * the generic company-scoped fallback (`canReadCompanyScoped()`), which
 * grants read to ANY same-company active user regardless of seeded
 * `visibility`. roleBootstrap.ts already seeds Manager/TL at
 * `visibility:'team'` and Partner at `visibility:'self'` on this exact
 * module (BD-2/pre-existing, both RESOLVED) — that scope was real
 * client-side (`applyAccessFilters`/`buildOwnershipVisibilityQueryPlan`)
 * but advisory only at the rules layer.
 *
 * Also pins AUTH-C1a (known, unchanged by this commit): a CSV-imported lead
 * persists with `assignedToId: ''`. The new rule does not special-case
 * this — it mirrors `ownershipVisibility.ts`'s `OWNERSHIP_FIELDS` exactly,
 * so a still-unassigned lead created by someone outside a Manager's team is
 * exactly as invisible to that Manager under this rule as it already is
 * under the current, live, query-scoped client behavior — this closes the
 * "advisory only" gap, it does not change what is actually visible today.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

const PROJECT = 'neozy-leads-ownership-scope-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';
const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';

const MGR = 'MUSR-manager';
const REPORT = 'MUSR-report'; // Sales rep managed by MGR
const OUTSIDER = 'MUSR-outsider'; // Sales rep NOT managed by MGR, same company
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

    await setDoc(doc(db, 'users', REPORT), userDoc(REPORT, 'Sales', COMPANY_A, { managerId: MGR }));
    await setDoc(doc(db, 'user_auth_maps', 'uid-report'), mappingDoc('uid-report', REPORT, COMPANY_A, GROUP_A, `${REPORT}@neozy.test`));

    await setDoc(doc(db, 'users', OUTSIDER), userDoc(OUTSIDER, 'Sales', COMPANY_A, { managerId: 'MUSR-someone-else' }));
    await setDoc(doc(db, 'user_auth_maps', 'uid-outsider'), mappingDoc('uid-outsider', OUTSIDER, COMPANY_A, GROUP_A, `${OUTSIDER}@neozy.test`));

    await setDoc(doc(db, 'channel_partners', PARTNER_DOC), { id: PARTNER_DOC, companyId: COMPANY_A, name: 'Partner One', userId: PARTNER_USER, status: 'Active' });
    await setDoc(doc(db, 'users', PARTNER_USER), userDoc(PARTNER_USER, 'Partner', COMPANY_A, { channelPartnerId: PARTNER_DOC }));
    await setDoc(doc(db, 'user_auth_maps', 'uid-partner'), mappingDoc('uid-partner', PARTNER_USER, COMPANY_A, GROUP_A, `${PARTNER_USER}@neozy.test`));

    await setDoc(doc(db, 'users', ADMIN), userDoc(ADMIN, 'Admin', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-admin'), mappingDoc('uid-admin', ADMIN, COMPANY_A, GROUP_A, `${ADMIN}@neozy.test`));

    await setDoc(doc(db, 'users', GROUP_ADMIN), userDoc(GROUP_ADMIN, 'GroupAdmin', COMPANY_A));
    await setDoc(doc(db, 'user_auth_maps', 'uid-groupadmin'), mappingDoc('uid-groupadmin', GROUP_ADMIN, COMPANY_A, GROUP_A, `${GROUP_ADMIN}@neozy.test`));

    // Lead records.
    await setDoc(doc(db, 'leads', 'LEAD-own'), { id: 'LEAD-own', companyId: COMPANY_A, createdBy: MGR, assignedToId: MGR, name: 'Manager Own Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-team'), { id: 'LEAD-team', companyId: COMPANY_A, createdBy: REPORT, assignedToId: REPORT, name: 'Team Member Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-outsider'), { id: 'LEAD-outsider', companyId: COMPANY_A, createdBy: OUTSIDER, assignedToId: OUTSIDER, name: 'Outsider Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-partner-own'), { id: 'LEAD-partner-own', companyId: COMPANY_A, createdBy: REPORT, assignedToId: REPORT, partnerId: PARTNER_DOC, name: 'Partner-Linked Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-partner-other'), { id: 'LEAD-partner-other', companyId: COMPANY_A, createdBy: REPORT, assignedToId: REPORT, partnerId: OTHER_PARTNER_DOC, name: 'Other Partner Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-cross-company'), { id: 'LEAD-cross-company', companyId: COMPANY_B, createdBy: 'MUSR-someone-in-b', name: 'Cross Company Lead' });
    await setDoc(doc(db, 'leads', 'LEAD-groupadmin-target'), { id: 'LEAD-groupadmin-target', companyId: COMPANY_A, groupId: GROUP_A, createdBy: OUTSIDER, name: 'GroupAdmin Reach Lead' });
    // AUTH-C1a: a CSV-imported lead, unassigned, created by someone outside
    // the Manager's team (e.g. an Admin ran the import) — already invisible
    // to Manager/Partner today via the client's own query-scoped ownership
    // filter; this rule must produce the identical outcome, not a new one.
    await setDoc(doc(db, 'leads', 'LEAD-csv-unassigned'), { id: 'LEAD-csv-unassigned', companyId: COMPANY_A, createdBy: ADMIN, assignedToId: '', source: 'CSV Import', name: 'CSV Imported, Unassigned' });
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

describe('AUTH-C1 (leads) — Manager/TL team-scope', () => {
  it('POSITIVE: Manager can read their own lead record', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-own')));
  });

  it('POSITIVE: Manager can read a direct report\'s (team member\'s) lead record', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-team')));
  });

  it('NEGATIVE (same-company out-of-scope denial): Manager CANNOT read a same-company lead owned by a non-team-member — direct document-ID access is denied, not just hidden by the UI', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-outsider')));
  });

  it('NEGATIVE (cross-company denial): Manager cannot read a Company B lead', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-cross-company')));
  });

  it('AUTH-C1a: Manager cannot read a still-unassigned CSV-imported lead created outside their team — identical to today\'s live client-side query scoping, not a new restriction', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-csv-unassigned')));
  });

  it('QUERY SCOPE: an unconstrained same-company query is rejected outright (Firestore cannot prove team-membership for the worst-case matched document)', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    await assertFails(getDocs(query(collection(db, 'leads'), where('companyId', '==', COMPANY_A))));
  });

  it('QUERY SCOPE: a query narrowed to the Manager\'s own assignedToId succeeds (matches the client\'s own query-planning shape)', async () => {
    const db = ctx('uid-manager', `${MGR}@neozy.test`);
    const snap = await assertSucceeds(getDocs(query(collection(db, 'leads'), where('companyId', '==', COMPANY_A), where('assignedToId', '==', MGR))));
    expect(snap.docs.map((d) => d.id)).toEqual(['LEAD-own']);
  });
});

describe('AUTH-C1 (leads) — Partner self-scope', () => {
  it('POSITIVE: Partner can read a lead linked to their own channel_partners doc', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-partner-own')));
  });

  it('NEGATIVE (same-company out-of-scope denial): Partner cannot read a lead linked to a DIFFERENT partner', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-partner-other')));
  });

  it('NEGATIVE: Partner cannot read an ordinary same-company lead with no partnerId at all', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-team')));
  });

  it('NEGATIVE (cross-company denial): Partner cannot read a Company B lead', async () => {
    const db = ctx('uid-partner', `${PARTNER_USER}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-cross-company')));
  });
});

describe('AUTH-C1 (leads) — Admin/GroupAdmin/unscoped-role regression (must remain unchanged)', () => {
  it('Admin reads ANY same-company lead regardless of ownership (unchanged)', async () => {
    const db = ctx('uid-admin', `${ADMIN}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-outsider')));
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-csv-unassigned')));
  });

  it('Admin cannot read a Company B lead (company isolation unaffected)', async () => {
    const db = ctx('uid-admin', `${ADMIN}@neozy.test`);
    await assertFails(getDoc(doc(db, 'leads', 'LEAD-cross-company')));
  });

  it('GroupAdmin reaches a same-group lead via groupAdminCanRead(), independent of the new ownership predicate (unchanged)', async () => {
    const db = ctx('uid-groupadmin', `${GROUP_ADMIN}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-groupadmin-target')));
  });

  it('an unrelated same-company Sales rep (not the record owner, not a Manager/Partner) reads ANY same-company lead — Sales is seeded `all` (BD-1, RESOLVED), unaffected by this change', async () => {
    const db = ctx('uid-outsider', `${OUTSIDER}@neozy.test`);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-team')));
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-own')));
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-csv-unassigned')));
  });
});
