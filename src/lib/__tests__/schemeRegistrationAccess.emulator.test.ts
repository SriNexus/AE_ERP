/**
 * schemeRegistrationAccess.emulator.test.ts
 *
 * Production fix (2026-09-10) — "missing or insufficient permissions" when an
 * authorized administrator (Group Admin) files a Registration from the B2C
 * Project workflow, even though the SAME actor can create the parent Lead,
 * Customer and Project.
 *
 * ROOT CAUSE: the old `scheme_registrations` create/update rules routed EVERY
 * Group Admin through `isGroupAdmin() && sameGroup(...)` — which needs a
 * `groupId` field stamped on the write AND `data.groupId == actorGroupId()`
 * (from `user_auth_maps.groupId`). Neither is guaranteed (`resolveWriteGroupId()`
 * → '' when `companyGroupIds` isn't populated; the auth-map groupId can be
 * stale for the life of a tab). The `leads` / `customers` / `projects` create
 * rules do NOT have this problem: they use `canCreateCompanyScoped() ||
 * groupAdminCanCreate(...)`, and `canCreateCompanyScoped()` passes a home-
 * company Group Admin on the plain `sameCompany()` companyId match.
 *
 * FIX: `scheme_registrations` create/update/delete were re-based onto the
 * working leads / employees rule shape:
 *   - tenancy: `partnerCreateEligible() && (canCreateCompanyScoped() ||
 *     groupAdminCanCreate())` for create (leads pattern); a lazy
 *     `isGroupAdmin() ? (groupAdminCan* || canXCompanyScoped) : (canX && …)`
 *     discriminator (employees/payroll pattern) so exactly one arm evaluates;
 *   - role gate: LEAN `actorRoleMatches('Admin|Manager|TL|Partner')` (auth-map
 *     read, resolves Management -> Admin via roleStringMatches — BD-5);
 *   - NO per-record ownership predicate at the rules layer (same as leads):
 *     a Partner's "file only for a project I own" is enforced in
 *     `createSchemeRegistration` (the sole write path).
 * The bespoke `actorHomeCompanyMatches()` helper AND the ownership get()s are
 * removed. This leaner shape also brought the WHOLE block (Admin included)
 * back inside the emulator's 1000-expression budget — every test below runs.
 *
 * Run via: npm run test:rules
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';

const PROJECT = 'neozy-scheme-registration-access-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';           // same group as A, sibling
const COMPANY_X = 'CO-X';           // different group
const GROUP_A = 'GROUP-A';
const GROUP_X = 'GROUP-X';

const ADMIN_A = { user: 'MUSR-admin-a', uid: 'uid-admin-a' };
const MGMT_A = { user: 'MUSR-mgmt-a', uid: 'uid-mgmt-a' };
const GA_A = { user: 'MUSR-ga-a', uid: 'uid-ga-a' };       // Group Admin of GROUP_A
const MANAGER_A = { user: 'MUSR-mgr-a', uid: 'uid-mgr-a' };
const SALES_A = { user: 'MUSR-sales-a', uid: 'uid-sales-a' };
const ADMIN_X = { user: 'MUSR-admin-x', uid: 'uid-admin-x' };   // other group
const PARTNER_A = { user: 'MUSR-p-a', uid: 'uid-p-a', cp: 'CP-A' };          // active
const PARTNER_SUSP = { user: 'MUSR-p-susp', uid: 'uid-p-susp', cp: 'CP-SUSP' }; // suspended

function userDoc(id: string, companyId: string, groupId: string, role: string, extra: Record<string, unknown> = {}) {
  return { id, companyId, groupId, role, email: `${id}@neozy.test`, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}
function mappingDoc(uid: string, userId: string, companyId: string, groupId: string) {
  return { authUid: uid, userId, companyId, groupId, email: `${userId}@neozy.test` };
}
function projectDoc(id: string, companyId: string, groupId: string, partnerId = '') {
  return { id, projectId: id, companyId, groupId, customerId: 'CUST-1', partnerId, currentStage: 'SchemeRegistration', createdBy: 'x', updatedBy: 'x', isDeleted: false };
}
// Registration create payload. `partnerId` empty = internal (non-partner) B2C.
function regPayload(id: string, projectId: string, companyId: string, opts: { groupId?: string; partnerId?: string } = {}) {
  const base: Record<string, unknown> = {
    id, registrationId: id, projectId, companyId,
    partnerId: opts.partnerId ?? '', status: 'Draft', vendorName: 'Company EPC',
    createdBy: 'x', updatedBy: 'x', isDeleted: false,
  };
  if (opts.groupId) base.groupId = opts.groupId;
  return base;
}

let env: RulesTestEnvironment;
const ctx = (uid: string, user: string) => env.authenticatedContext(uid, { email: `${user}@neozy.test` }).firestore();

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_X), { id: GROUP_X, name: 'Group X', status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'companies', COMPANY_X), { id: COMPANY_X, companyId: COMPANY_X, name: 'Company X', groupId: GROUP_X, status: 'Active' });

    for (const [a, companyId, groupId, role] of [
      [ADMIN_A, COMPANY_A, GROUP_A, 'Admin'],
      [MGMT_A, COMPANY_A, GROUP_A, 'Management'],
      [GA_A, COMPANY_A, GROUP_A, 'GroupAdmin'],
      [MANAGER_A, COMPANY_A, GROUP_A, 'Manager'],
      [SALES_A, COMPANY_A, GROUP_A, 'Sales'],
      [ADMIN_X, COMPANY_X, GROUP_X, 'Admin'],
    ] as const) {
      await setDoc(doc(db, 'users', a.user), userDoc(a.user, companyId, groupId, role));
      await setDoc(doc(db, 'user_auth_maps', a.uid), mappingDoc(a.uid, a.user, companyId, groupId));
    }
    for (const [p, status] of [[PARTNER_A, 'active'], [PARTNER_SUSP, 'suspended']] as const) {
      await setDoc(doc(db, 'users', p.user), userDoc(p.user, COMPANY_A, GROUP_A, 'Partner', { channelPartnerId: p.cp }));
      await setDoc(doc(db, 'user_auth_maps', p.uid), mappingDoc(p.uid, p.user, COMPANY_A, GROUP_A));
      await setDoc(doc(db, 'channel_partners', p.cp), { id: p.cp, companyId: COMPANY_A, groupId: GROUP_A, userId: p.user, status, kycStatus: 'verified', isDeleted: false });
    }

    await setDoc(doc(db, 'projects', 'PRJ-A'), projectDoc('PRJ-A', COMPANY_A, GROUP_A));                     // internal
    await setDoc(doc(db, 'projects', 'PRJ-B'), projectDoc('PRJ-B', COMPANY_B, GROUP_A));                     // sibling company
    await setDoc(doc(db, 'projects', 'PRJ-P'), projectDoc('PRJ-P', COMPANY_A, GROUP_A, PARTNER_A.cp));       // partner-owned

    // Existing registrations for the update/delete tests.
    await setDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST'), regPayload('SREG-A-EXIST', 'PRJ-A', COMPANY_A, { groupId: GROUP_A }));
    await setDoc(doc(db, 'scheme_registrations', 'SREG-A-NOGID'), regPayload('SREG-A-NOGID', 'PRJ-A', COMPANY_A)); // resolveWriteGroupId()→'' shape
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

describe('scheme_registrations READ — must stay in the emulator expression budget', () => {
  // The "one active registration per project" check in createSchemeRegistration
  // does getAll(scheme_registrations) — a LIST that companyScopedQuery() narrows
  // to `where('companyId','==', <home>)` for a Group Admin. The old non-lazy
  // schemeRegCanRead blew the 1000-expression cap on that LIST for a Group
  // Admin (the ACTUAL blocker of Registration creation, found by the
  // real-browser E2E).
  const scopedList = (db: ReturnType<typeof ctx>, companyId: string) =>
    getDocs(query(collection(db, 'scheme_registrations'), where('companyId', '==', companyId)));

  it('Group Admin can LIST scheme_registrations in their company (no budget error)', async () => {
    await assertSucceeds(scopedList(ctx(GA_A.uid, GA_A.user), COMPANY_A));
  });
  it('Group Admin can GET a scheme_registration with no groupId', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(getDoc(doc(db, 'scheme_registrations', 'SREG-A-NOGID')));
  });
  it('Admin can LIST + GET', async () => {
    const db = ctx(ADMIN_A.uid, ADMIN_A.user);
    await assertSucceeds(scopedList(db, COMPANY_A));
    await assertSucceeds(getDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('an out-of-group Admin CANNOT LIST Company A scheme_registrations', async () => {
    await assertFails(scopedList(ctx(ADMIN_X.uid, ADMIN_X.user), COMPANY_A));
  });
  it('Management can GET', async () => {
    const db = ctx(MGMT_A.uid, MGMT_A.user);
    await assertSucceeds(getDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('Manager can GET a company registration', async () => {
    const db = ctx(MANAGER_A.uid, MANAGER_A.user);
    await assertSucceeds(getDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('an out-of-group Admin CANNOT GET a Company A registration', async () => {
    const db = ctx(ADMIN_X.uid, ADMIN_X.user);
    await assertFails(getDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('Sales CANNOT GET a scheme_registration', async () => {
    const db = ctx(SALES_A.uid, SALES_A.user);
    await assertFails(getDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
});

describe('scheme_registrations CREATE — authorized administrator (the Lead pattern)', () => {
  it('Admin can file a Registration', async () => {
    const db = ctx(ADMIN_A.uid, ADMIN_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-ADMIN'), regPayload('SREG-ADMIN', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('Management (Admin alias — BD-5) can file a Registration', async () => {
    const db = ctx(MGMT_A.uid, MGMT_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-MGMT'), regPayload('SREG-MGMT', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('Group Admin can file a Registration in their HOME company WITHOUT a groupId on the write (the exact leads/projects path)', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-GA-NOGID'), regPayload('SREG-GA-NOGID', 'PRJ-A', COMPANY_A)));
  });
  it('Group Admin can file a Registration in their HOME company WITH a groupId on the write', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-GA-GID'), regPayload('SREG-GA-GID', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('Group Admin can file a Registration in a SAME-GROUP sibling company (groupAdminCanCreate path)', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-GA-SIB'), regPayload('SREG-GA-SIB', 'PRJ-B', COMPANY_B, { groupId: GROUP_A })));
  });
  it('Manager can file a Registration for an internal (non-partner) project in their company', async () => {
    const db = ctx(MANAGER_A.uid, MANAGER_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-MGR'), regPayload('SREG-MGR', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('an ACTIVE Partner can file a Registration (tenant + role scoped; project ownership is workflow-enforced, exactly like leads)', async () => {
    const db = ctx(PARTNER_A.uid, PARTNER_A.user);
    await assertSucceeds(setDoc(doc(db, 'scheme_registrations', 'SREG-P'), regPayload('SREG-P', 'PRJ-P', COMPANY_A, { groupId: GROUP_A, partnerId: PARTNER_A.cp })));
  });
});

describe('scheme_registrations CREATE — security boundary intact', () => {
  it('Sales (no scheme_registration grant) CANNOT file a Registration', async () => {
    const db = ctx(SALES_A.uid, SALES_A.user);
    await assertFails(setDoc(doc(db, 'scheme_registrations', 'SREG-SALES'), regPayload('SREG-SALES', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('an Admin of ANOTHER group CANNOT file a Registration in Company A', async () => {
    const db = ctx(ADMIN_X.uid, ADMIN_X.user);
    await assertFails(setDoc(doc(db, 'scheme_registrations', 'SREG-XGRP'), regPayload('SREG-XGRP', 'PRJ-A', COMPANY_A, { groupId: GROUP_A })));
  });
  it('a Group Admin CANNOT file a Registration in an out-of-group company (forged groupId)', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertFails(setDoc(doc(db, 'scheme_registrations', 'SREG-GA-XGRP'), regPayload('SREG-GA-XGRP', 'PRJ-A', COMPANY_X, { groupId: GROUP_A })));
  });
  it('a SUSPENDED Partner CANNOT file a Registration (BD-3 — via partnerCreateEligible(), same as leads)', async () => {
    const db = ctx(PARTNER_SUSP.uid, PARTNER_SUSP.user);
    await assertFails(setDoc(doc(db, 'scheme_registrations', 'SREG-PSUSP'), regPayload('SREG-PSUSP', 'PRJ-P', COMPANY_A, { groupId: GROUP_A, partnerId: PARTNER_SUSP.cp })));
  });
});

describe('scheme_registrations UPDATE — authorized administrator (the Lead pattern)', () => {
  it('Group Admin can advance a Registration status in their home company (no groupId on the record)', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-NOGID'), { status: 'Submitted', updatedBy: 'y' }));
  });
  it('Admin can advance a Registration status in their home company', async () => {
    const db = ctx(ADMIN_A.uid, ADMIN_A.user);
    await assertSucceeds(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST'), { status: 'Submitted', updatedBy: 'y' }));
  });
  it('Management can advance a Registration status in their home company', async () => {
    const db = ctx(MGMT_A.uid, MGMT_A.user);
    await assertSucceeds(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST'), { status: 'Submitted', updatedBy: 'y' }));
  });
  it('Manager can advance an internal (non-partner) Registration status', async () => {
    const db = ctx(MANAGER_A.uid, MANAGER_A.user);
    await assertSucceeds(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST'), { status: 'Submitted', updatedBy: 'y' }));
  });
  it('an out-of-group Admin CANNOT update a Company A Registration', async () => {
    const db = ctx(ADMIN_X.uid, ADMIN_X.user);
    await assertFails(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST'), { status: 'Submitted', updatedBy: 'y' }));
  });

  // Round 7 (2026-09-11): reproduces the EXACT real production shape behind a
  // second, deeper bug found while investigating a Storage
  // `storage/unauthorized` report — attachRegistrationDocument (linking an
  // uploaded document to a Registration's requiredDocuments) failed with
  // "Missing or insufficient permissions" for a REAL internal (non-partner)
  // registration whose `partnerId` field is genuinely ABSENT (not '' —
  // confirmed live via Admin SDK read of SREG-260911-8VOF). The seed
  // helper above (regPayload) always sets partnerId to at least '', so
  // every other UPDATE test in this file exercises a defined-but-empty
  // field, not a MISSING one — the gap that let the original
  // schemeRegIdentityUnchanged() bug (`request.resource.data.partnerId ==
  // resource.data.partnerId`, throwing "Property partnerId is undefined on
  // object" when the key is truly absent) pass 461+ prior assertions
  // without ever being exercised. Seeded here with the key omitted entirely
  // to match production.
  it('Group Admin can attach a document (requiredDocuments/documents patch, NO status change) on a registration with NO partnerId field at all (production shape)', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    const noPartnerIdPayload: Record<string, unknown> = {
      id: 'SREG-A-NOPARTNERKEY', registrationId: 'SREG-A-NOPARTNERKEY', projectId: 'PRJ-A', companyId: COMPANY_A,
      status: 'Draft', vendorName: 'Company EPC', createdBy: 'x', updatedBy: 'x', isDeleted: false,
      // partnerId deliberately OMITTED — real internal-registration shape.
    };
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(doc(rulesCtx.firestore(), 'scheme_registrations', 'SREG-A-NOPARTNERKEY'), noPartnerIdPayload);
    });
    await assertSucceeds(updateDoc(doc(db, 'scheme_registrations', 'SREG-A-NOPARTNERKEY'), {
      requiredDocuments: [{ category: 'customer_identity', documentId: 'DOC-1' }],
      documents: [{ category: 'customer_identity', documentId: 'DOC-1' }],
      updatedBy: 'y',
    }));
  });
});

describe('scheme_registrations DELETE — audited hard-delete', () => {
  it('Admin can hard-delete in their company', async () => {
    const db = ctx(ADMIN_A.uid, ADMIN_A.user);
    await assertSucceeds(deleteDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('Group Admin can hard-delete in their home company', async () => {
    const db = ctx(GA_A.uid, GA_A.user);
    await assertSucceeds(deleteDoc(doc(db, 'scheme_registrations', 'SREG-A-NOGID')));
  });
  it('Manager CANNOT hard-delete', async () => {
    const db = ctx(MANAGER_A.uid, MANAGER_A.user);
    await assertFails(deleteDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
  it('an out-of-group Admin CANNOT hard-delete a Company A Registration', async () => {
    const db = ctx(ADMIN_X.uid, ADMIN_X.user);
    await assertFails(deleteDoc(doc(db, 'scheme_registrations', 'SREG-A-EXIST')));
  });
});
