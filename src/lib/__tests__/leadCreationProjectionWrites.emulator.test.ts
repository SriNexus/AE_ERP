import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/**
 * leadCreationProjectionWrites.emulator.test.ts — the CROSS-ROLE authorization
 * matrix for internal BUSINESS-RECORD creation (Lead AND Customer), and the
 * two-tier architecture that keeps an optional identity write from ever
 * blocking one.
 *
 *   PRIMARY BUSINESS RECORD  (REQUIRED writes — must succeed or the op fails)
 *     leads/{id}                        canonical Lead
 *     entities/{id}                     Lead's CRM entity relation
 *     customers/{id}                    canonical Customer
 *     customer_phone_locks/{lockId}     Customer per-company phone uniqueness
 *
 *   MASTER-IDENTITY / CONTACT LINK  (OPTIONAL enrichment — best-effort)
 *     users/MUSR-{companyId}-{phone}    a phone-keyed CRM contact, NOT a login
 *
 * The `users` collection is governed by STAFF-LOGIN-account rules whose
 * CREATE/UPDATE arms are expression-budget-fragile:
 *   - a GroupAdmin actor is routed to a group-coherence CREATE arm that needs
 *     hasGroupId(request.resource.data) — a contact identity is DELIBERATELY
 *     group-less (userIdentity.createOrResolveUserByPhone), so a GroupAdmin's
 *     contact CREATE is denied.
 *   - a non-Admin actor's contact CREATE goes through the heavy
 *     isContactIdentityRole || isAdmin arm; the emulator's stricter 1000-expr
 *     ceiling denies it outright (the Admin arm short-circuits and passes).
 *   - a non-Admin cannot arbitrarily rewrite a PRE-EXISTING contact doc; the
 *     freshly-created contact is anyway seeded with roles[]/linkedModules[]
 *     (userIdentity.seededRoles) so attachUserRole() is an idempotent no-op and
 *     never issues an UPDATE on the create hot path.
 * Both Lead creation (entityProjection.attachUserId) and Customer creation
 * (useCustomers.createCustomerProjection) resolve the link through the ONE
 * shared best-effort primitive userIdentity.linkMasterIdentityBestEffort: a
 * denial is logged and the primary record is still created (unlinked; an Admin
 * backfill/edit populates userId/masterUserId later).
 *
 * These tests pin the REQUIRED writes as PASS for every authorized role in
 * scope, PASS cross-company only for GroupAdmin-in-group, DENIED for outsiders,
 * and document the users-collection denials that the best-effort handling
 * absorbs.
 */

const PROJECT = 'neozy-lead-projection-writes-test';
const GROUP = 'GROUP-LP';
const CO_A = 'CO-LP-A';           // home company of the actors below
const CO_SIB = 'CO-LP-SIB';       // sibling company in the same group (GroupAdmin cross-company)

const ROLES: Array<{ uid: string; id: string; role: string; email: string; company: string; extra?: Record<string, unknown> }> = [
  { uid: 'uid-lp-admin', id: 'MUSR-LP-ADMIN', role: 'Admin', email: 'admin@lp.test', company: CO_A },
  { uid: 'uid-lp-sales', id: 'MUSR-LP-SALES', role: 'Sales', email: 'sales@lp.test', company: CO_A },
  { uid: 'uid-lp-mgr', id: 'MUSR-LP-MGR', role: 'Manager', email: 'mgr@lp.test', company: CO_A },
  { uid: 'uid-lp-ga', id: 'MUSR-LP-GA', role: 'GroupAdmin', email: 'ga@lp.test', company: CO_A, extra: { groupId: GROUP } },
  { uid: 'uid-lp-outsider', id: 'MUSR-LP-OUT', role: 'Sales', email: 'out@other.test', company: 'CO-OUTSIDE' },
];

let env: RulesTestEnvironment;
const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'groups', GROUP), { id: GROUP, name: 'Group LP', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-OUTSIDE'), { id: 'GROUP-OUTSIDE', name: 'Other', status: 'Active' });
    await setDoc(doc(db, 'companies', CO_A), { id: CO_A, companyId: CO_A, name: 'Company LP A', groupId: GROUP });
    await setDoc(doc(db, 'companies', CO_SIB), { id: CO_SIB, companyId: CO_SIB, name: 'Company LP Sibling', groupId: GROUP });
    await setDoc(doc(db, 'companies', 'CO-OUTSIDE'), { id: 'CO-OUTSIDE', companyId: 'CO-OUTSIDE', name: 'Outsider Co', groupId: 'GROUP-OUTSIDE' });
    for (const r of ROLES) {
      await setDoc(doc(db, 'users', r.id), { id: r.id, companyId: r.company, role: r.role, email: r.email, status: 'Active', isSuperAdmin: false, isDeleted: false, ...(r.company === CO_A ? { groupId: GROUP } : {}), ...r.extra });
      await setDoc(doc(db, 'user_auth_maps', r.uid), { authUid: r.uid, userId: r.id, companyId: r.company, email: r.email, ...(r.company === CO_A ? { groupId: GROUP } : {}) });
    }
  });
});

const entityDoc = (companyId: string, groupId: string, actorId: string) => ({
  id: 'ENT-LP-1', companyId, groupId, primaryRole: 'lead', roles: ['lead'],
  displayName: 'Ramesh Iyer', createdBy: actorId, updatedBy: actorId, isDeleted: false,
});
const leadDoc = (companyId: string, groupId: string, actorId: string, assignedToId = '') => ({
  id: 'PLD-LP-1', companyId, groupId, name: 'Ramesh Iyer', phone: '9990001111',
  source: 'Website', status: 'New', assignedToId, assignedToName: assignedToId ? 'Assignee' : '',
  createdBy: actorId, updatedBy: actorId, isDeleted: false,
});
const contactDoc = (companyId: string, actorId: string) => ({
  id: `MUSR-${companyId}-9990001111`, userId: `MUSR-${companyId}-9990001111`, companyId, phone: '9990001111',
  name: 'Ramesh Iyer', email: '', role: 'Lead', roles: ['Lead'], linkedModules: ['leads'], status: 'Identity',
  createdBy: actorId, updatedBy: actorId, isDeleted: false,
});
// Customer canonical writes — the phone-lock + the customer doc. `masterUserId`
// is written ONLY when the best-effort link resolved (''  → the field is
// omitted, exactly like useCustomers.createCustomerProjectionInTransaction).
const customerLockDoc = (companyId: string, groupId: string) => ({
  id: `${companyId}_9990002222`, companyId, ...(groupId ? { groupId } : {}),
  phone: '9990002222', customerId: 'CUS-LP-1', isDeleted: false,
});
const customerDoc = (companyId: string, groupId: string, actorId: string, masterUserId = '') => ({
  id: 'CUS-LP-1', companyId, ...(groupId ? { groupId } : {}), name: 'Meera Nair', phone: '9990002222',
  type: 'B2B', ...(masterUserId ? { userId: masterUserId, masterUserId } : {}),
  createdBy: actorId, updatedBy: actorId, isDeleted: false,
});

// ── REQUIRED writes: PASS for every authorized role in its own company ────────
describe('REQUIRED Lead writes (entities + leads) — every authorized role, own company', () => {
  for (const r of ROLES.filter((x) => x.company === CO_A)) {
    it(`${r.role}: can create the entity relation and the canonical Lead`, async () => {
      const db = ctx(r.uid, r.email);
      await assertSucceeds(setDoc(doc(db, 'entities', 'ENT-LP-1'), entityDoc(CO_A, GROUP, r.id)));
      await assertSucceeds(setDoc(doc(db, 'leads', 'PLD-LP-1'), leadDoc(CO_A, GROUP, r.id, 'MUSR-LP-SALES')));
    });
  }
});

describe('REQUIRED Customer writes (phone-lock + customer) — every authorized role, own company', () => {
  for (const r of ROLES.filter((x) => x.company === CO_A)) {
    it(`${r.role}: can create the phone-lock and the canonical Customer (linked)`, async () => {
      const db = ctx(r.uid, r.email);
      await assertSucceeds(setDoc(doc(db, 'customer_phone_locks', `${CO_A}_9990002222`), customerLockDoc(CO_A, GROUP)));
      await assertSucceeds(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc(CO_A, GROUP, r.id, `MUSR-${CO_A}-9990002222`)));
    });
    it(`${r.role}: can still create the canonical Customer UNLINKED (best-effort identity skipped)`, async () => {
      const db = ctx(r.uid, r.email);
      await assertSucceeds(setDoc(doc(db, 'customer_phone_locks', `${CO_A}_9990002222`), customerLockDoc(CO_A, GROUP)));
      await assertSucceeds(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc(CO_A, GROUP, r.id)));
    });
  }
});

// ── GroupAdmin cross-company (same group) — required writes still PASS ────────
describe('GroupAdmin — a sibling company in the same group', () => {
  it('can create the entity relation and the canonical Lead in the sibling company', async () => {
    const db = ctx('uid-lp-ga', 'ga@lp.test');
    await assertSucceeds(setDoc(doc(db, 'entities', 'ENT-LP-1'), entityDoc(CO_SIB, GROUP, 'MUSR-LP-GA')));
    await assertSucceeds(setDoc(doc(db, 'leads', 'PLD-LP-1'), leadDoc(CO_SIB, GROUP, 'MUSR-LP-GA')));
  });
  it('can create the phone-lock and the canonical Customer in the sibling company', async () => {
    const db = ctx('uid-lp-ga', 'ga@lp.test');
    await assertSucceeds(setDoc(doc(db, 'customer_phone_locks', `${CO_SIB}_9990002222`), customerLockDoc(CO_SIB, GROUP)));
    await assertSucceeds(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc(CO_SIB, GROUP, 'MUSR-LP-GA')));
  });
});

// ── Unauthorized ────────────────────────────────────────────────────────────
describe('Unauthorized actors remain blocked', () => {
  it('a user from another company/tenant cannot create a Lead here', async () => {
    const db = ctx('uid-lp-outsider', 'out@other.test');
    await assertFails(setDoc(doc(db, 'leads', 'PLD-LP-1'), leadDoc(CO_A, GROUP, 'MUSR-LP-OUT')));
    await assertFails(setDoc(doc(db, 'entities', 'ENT-LP-1'), entityDoc(CO_A, GROUP, 'MUSR-LP-OUT')));
  });
  it('a user from another company/tenant cannot create a Customer (or its phone-lock) here', async () => {
    const db = ctx('uid-lp-outsider', 'out@other.test');
    await assertFails(setDoc(doc(db, 'customer_phone_locks', `${CO_A}_9990002222`), customerLockDoc(CO_A, GROUP)));
    await assertFails(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc(CO_A, GROUP, 'MUSR-LP-OUT')));
  });
  it('a GroupAdmin cannot reach into a company OUTSIDE their group', async () => {
    const db = ctx('uid-lp-ga', 'ga@lp.test');
    await assertFails(setDoc(doc(db, 'leads', 'PLD-LP-1'), leadDoc('CO-OUTSIDE', 'GROUP-OUTSIDE', 'MUSR-LP-GA')));
    await assertFails(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc('CO-OUTSIDE', 'GROUP-OUTSIDE', 'MUSR-LP-GA')));
  });
  it('a signed-out request cannot create a Lead or a Customer', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'leads', 'PLD-LP-1'), leadDoc(CO_A, GROUP, 'x')));
    await assertFails(setDoc(doc(db, 'customers', 'CUS-LP-1'), customerDoc(CO_A, GROUP, 'x')));
  });
});

// ── Why the master-identity link is BEST-EFFORT (users-collection denials) ────
//
// The `users` CREATE rule is the same one that protects STAFF LOGIN accounts —
// its non-GroupAdmin arm (isAdmin() || (signedIn() && isContactIdentityRole()))
// && sameCompany() && groupIdMatchesCompany() && managerScopeMatches() is
// documented in firestore.rules as expression-budget-marginal, and the
// emulator's stricter 1000-expression ceiling denies a NON-Admin actor's
// contact CREATE outright here (the Admin arm short-circuits cheaply and
// passes). That fragility — not just the GroupAdmin group-coherence arm — is
// precisely why linkMasterIdentityBestEffort swallows the failure and the
// primary business record is still written unlinked.
describe('users/MUSR contact write — the denials the best-effort primitive absorbs', () => {
  it('Admin CAN create the phone-keyed contact identity (cheap arm)', async () => {
    await assertSucceeds(setDoc(doc(ctx('uid-lp-admin', 'admin@lp.test'), 'users', `MUSR-${CO_A}-9990001111`), contactDoc(CO_A, 'MUSR-LP-ADMIN')));
  });
  it('GroupAdmin CANNOT create the group-less contact — routed to the group-coherence CREATE arm; link falls to best-effort skip', async () => {
    await assertFails(setDoc(doc(ctx('uid-lp-ga', 'ga@lp.test'), 'users', `MUSR-${CO_A}-9990001111`), contactDoc(CO_A, 'MUSR-LP-GA')));
  });
  it('a non-Admin cannot rewrite a PRE-EXISTING contact doc wholesale (id/companyId/role/status/createdBy are immutable)', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users', `MUSR-${CO_A}-9990001111`), { ...contactDoc(CO_A, 'MUSR-LP-ADMIN'), roles: ['Customer'] });
    });
    await assertFails(
      setDoc(doc(ctx('uid-lp-sales', 'sales@lp.test'), 'users', `MUSR-${CO_A}-9990001111`), { ...contactDoc(CO_A, 'MUSR-LP-SALES'), roles: ['Customer', 'Lead'] }, { merge: true }),
    );
  });
  it('no actor can forge a cross-company contact identity', async () => {
    await assertFails(setDoc(doc(ctx('uid-lp-admin', 'admin@lp.test'), 'users', `MUSR-CO-OUTSIDE-9990001111`), contactDoc('CO-OUTSIDE', 'MUSR-LP-ADMIN')));
  });
});

// ── customer_phone_locks — the uniqueness GET every Customer create makes ────
// The FIRST read in createCustomerProjectionInTransaction is a get() on a
// not-yet-created {companyId}_{phone} lock. Before the `resource == null`
// guard was added (mirroring settings/roles/companies), a null resource.data
// raised a "Null value error" and denied the whole transaction for EVERY role
// — the real reason Customer creation failed regardless of the users/MUSR
// write. An existing lock still enforces same-company / same-group isolation.
describe('customer_phone_locks — read of a NON-EXISTENT lock is allowed for every authorized role', () => {
  for (const r of ROLES.filter((x) => x.company === CO_A)) {
    it(`${r.role} can get a not-yet-created lock in their own company`, async () => {
      await assertSucceeds(getDoc(doc(ctx(r.uid, r.email), 'customer_phone_locks', `${CO_A}_9990009999`)));
    });
  }
  it('an outsider still cannot read an EXISTING lock in another company', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'customer_phone_locks', `${CO_A}_9990009999`), { id: `${CO_A}_9990009999`, companyId: CO_A, groupId: GROUP, phone: '9990009999', customerId: 'CUS-X', isDeleted: false });
    });
    await assertFails(getDoc(doc(ctx('uid-lp-outsider', 'out@other.test'), 'customer_phone_locks', `${CO_A}_9990009999`)));
  });
});

// ── Visibility (rules layer) — a created record is readable by its company ────
describe('Lead / Customer visibility (rules layer)', () => {
  it('a same-company Sales user can read a company Lead (assigned to anyone)', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'leads', 'PLD-LP-VIS'), { id: 'PLD-LP-VIS', companyId: CO_A, groupId: GROUP, name: 'Visible', assignedToId: 'MUSR-LP-MGR', createdBy: 'MUSR-LP-ADMIN', isDeleted: false });
    });
    await assertSucceeds(getDoc(doc(ctx('uid-lp-sales', 'sales@lp.test'), 'leads', 'PLD-LP-VIS')));
  });
  it('a same-company Sales user can read a company Customer', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'customers', 'CUS-LP-VIS'), { id: 'CUS-LP-VIS', companyId: CO_A, groupId: GROUP, name: 'Visible Cust', createdBy: 'MUSR-LP-ADMIN', isDeleted: false });
    });
    await assertSucceeds(getDoc(doc(ctx('uid-lp-sales', 'sales@lp.test'), 'customers', 'CUS-LP-VIS')));
  });
  it('a GroupAdmin can read a same-group Lead', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'leads', 'PLD-LP-VIS2'), { id: 'PLD-LP-VIS2', companyId: CO_SIB, groupId: GROUP, name: 'Sibling lead', createdBy: 'MUSR-LP-ADMIN', isDeleted: false });
    });
    await assertSucceeds(getDoc(doc(ctx('uid-lp-ga', 'ga@lp.test'), 'leads', 'PLD-LP-VIS2')));
  });
  it('a user from another group cannot read this group\'s Lead or Customer', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'leads', 'PLD-LP-VIS3'), { id: 'PLD-LP-VIS3', companyId: CO_A, groupId: GROUP, name: 'x', createdBy: 'MUSR-LP-ADMIN', isDeleted: false });
      await setDoc(doc(c.firestore(), 'customers', 'CUS-LP-VIS3'), { id: 'CUS-LP-VIS3', companyId: CO_A, groupId: GROUP, name: 'x', createdBy: 'MUSR-LP-ADMIN', isDeleted: false });
    });
    await assertFails(getDoc(doc(ctx('uid-lp-outsider', 'out@other.test'), 'leads', 'PLD-LP-VIS3')));
    await assertFails(getDoc(doc(ctx('uid-lp-outsider', 'out@other.test'), 'customers', 'CUS-LP-VIS3')));
  });
});
