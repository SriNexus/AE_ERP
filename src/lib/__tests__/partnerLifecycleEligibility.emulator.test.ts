/**
 * partnerLifecycleEligibility.emulator.test.ts
 *
 * RBAC Master Implementation Plan §15 BD-3 + BD-5 — OWNER-APPROVED 2026-09-09.
 *
 * BD-3 — Channel Partner lifecycle → the `firestore.rules` `partnerCreateEligible()`
 * gate on `leads` / `customers` / `projects` / `scheme_registrations` CREATE:
 *   - status 'active'                → CAN create (verified, KYC-pending and
 *                                      KYC-rejected are all 'active' — KYC is
 *                                      ADVISORY and never read by the rule)
 *   - status 'suspended'             → CANNOT create new records, but CAN still
 *                                      read + update existing/in-flight work
 *   - status 'inactive' / 'pending_approval' → CANNOT create
 *   - non-Partner actors             → unaffected (Admin / Sales / GroupAdmin)
 *
 * BD-5 — `Management` role is an alias of `Admin` for authorization, on the
 * rules plane exactly as on the client (permissions.ts) and the API
 * (api/_lib/permissions.ts): a `Management` actor is treated as `Admin` by
 * `isAdmin()` / `roleMatches()` / `actorRoleMatches()` and the direct
 * `== 'Admin'` sites — and NEVER widened past Admin (not GroupAdmin, not
 * SuperAdmin, no unrelated role gains it).
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT = 'neozy-partner-lifecycle-eligibility-test';

const COMPANY_A = 'CO-A';
const GROUP_A = 'GROUP-A';

// Partner accounts, one per lifecycle state under test.
const P_ACTIVE = { user: 'MUSR-p-active', cp: 'CP-ACTIVE', uid: 'uid-p-active' };
const P_KYC_PENDING = { user: 'MUSR-p-kycpend', cp: 'CP-KYCPEND', uid: 'uid-p-kycpend' };
const P_KYC_REJECTED = { user: 'MUSR-p-kycrej', cp: 'CP-KYCREJ', uid: 'uid-p-kycrej' };
const P_SUSPENDED = { user: 'MUSR-p-susp', cp: 'CP-SUSP', uid: 'uid-p-susp' };
const P_INACTIVE = { user: 'MUSR-p-inact', cp: 'CP-INACT', uid: 'uid-p-inact' };

const SALES = { user: 'MUSR-sales', uid: 'uid-sales' };
const ADMIN = { user: 'MUSR-admin', uid: 'uid-admin' };
const MANAGEMENT = { user: 'MUSR-mgmt', uid: 'uid-mgmt' };
const GROUP_ADMIN = { user: 'MUSR-ga', uid: 'uid-ga' };

function userDoc(id: string, role: string, extra: Record<string, unknown> = {}) {
  return { id, companyId: COMPANY_A, groupId: GROUP_A, role, email: `${id}@neozy.test`, status: 'Active', isSuperAdmin: false, isDeleted: false, ...extra };
}
function mappingDoc(uid: string, userId: string) {
  return { authUid: uid, userId, companyId: COMPANY_A, groupId: GROUP_A, email: `${userId}@neozy.test` };
}
function cpDoc(id: string, userId: string, status: string, kycStatus: string) {
  return { id, companyId: COMPANY_A, groupId: GROUP_A, name: `Partner ${id}`, userId, status, kycStatus, isDeleted: false };
}

// A CREATE payload shaped so the ONLY thing under test is partnerCreateEligible().
function leadPayload(id: string, cpId: string) {
  return { id, companyId: COMPANY_A, groupId: GROUP_A, name: 'New Lead', phone: '9990001111', source: 'Channel Partner', status: 'New', partnerId: cpId, createdBy: 'x', updatedBy: 'x', isDeleted: false };
}
function customerPayload(id: string, cpId: string) {
  return { id, companyId: COMPANY_A, groupId: GROUP_A, name: 'New Customer', phone: '9990002222', type: 'B2C', partnerId: cpId, createdBy: 'x', updatedBy: 'x', isDeleted: false };
}
function projectPayload(id: string, cpId: string) {
  return { id, projectId: id, companyId: COMPANY_A, groupId: GROUP_A, name: 'New Project', partnerId: cpId, createdBy: 'x', updatedBy: 'x', isDeleted: false };
}
// scheme_registrations writes are not emulator-testable (see the NOTE below);
// no schemeRegPayload here.

let env: RulesTestEnvironment;
const ctx = (uid: string, user: string) => env.authenticatedContext(uid, { email: `${user}@neozy.test` }).firestore();

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();
    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: GROUP_A, status: 'Active' });
    await setDoc(doc(db, 'groups', GROUP_A), { id: GROUP_A, name: 'Group A', status: 'Active' });

    // Partners
    for (const [p, status, kyc] of [
      [P_ACTIVE, 'active', 'verified'],
      [P_KYC_PENDING, 'active', 'not_started'],
      [P_KYC_REJECTED, 'active', 'rejected'],
      [P_SUSPENDED, 'suspended', 'verified'],
      [P_INACTIVE, 'inactive', 'verified'],
    ] as const) {
      await setDoc(doc(db, 'channel_partners', p.cp), cpDoc(p.cp, p.user, status, kyc));
      await setDoc(doc(db, 'users', p.user), userDoc(p.user, 'Partner', { channelPartnerId: p.cp }));
      await setDoc(doc(db, 'user_auth_maps', p.uid), mappingDoc(p.uid, p.user));
    }

    // Non-partner actors
    await setDoc(doc(db, 'users', SALES.user), userDoc(SALES.user, 'Sales'));
    await setDoc(doc(db, 'user_auth_maps', SALES.uid), mappingDoc(SALES.uid, SALES.user));
    await setDoc(doc(db, 'users', ADMIN.user), userDoc(ADMIN.user, 'Admin'));
    await setDoc(doc(db, 'user_auth_maps', ADMIN.uid), mappingDoc(ADMIN.uid, ADMIN.user));
    await setDoc(doc(db, 'users', MANAGEMENT.user), userDoc(MANAGEMENT.user, 'Management'));
    await setDoc(doc(db, 'user_auth_maps', MANAGEMENT.uid), mappingDoc(MANAGEMENT.uid, MANAGEMENT.user));
    await setDoc(doc(db, 'users', GROUP_ADMIN.user), userDoc(GROUP_ADMIN.user, 'GroupAdmin'));
    await setDoc(doc(db, 'user_auth_maps', GROUP_ADMIN.uid), mappingDoc(GROUP_ADMIN.uid, GROUP_ADMIN.user));

    // An existing lead owned by the suspended partner (they may still edit it).
    await setDoc(doc(db, 'leads', 'LEAD-SUSP-EXISTING'), { id: 'LEAD-SUSP-EXISTING', companyId: COMPANY_A, groupId: GROUP_A, name: 'Pre-suspension Lead', partnerId: P_SUSPENDED.cp, createdBy: P_SUSPENDED.user, assignedToId: P_SUSPENDED.user, isDeleted: false });

    // A same-company commission_record for the BD-5 Management-read test.
    await setDoc(doc(db, 'commission_records', 'CR-1'), { id: 'CR-1', companyId: COMPANY_A, groupId: GROUP_A, partnerId: P_ACTIVE.cp, amount: 1000, status: 'pending', isDeleted: false });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
afterAll(async () => { await env.cleanup(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('BD-3 — active partner CAN create (KYC is advisory)', () => {
  it('verified + active partner can create a lead', async () => {
    const db = ctx(P_ACTIVE.uid, P_ACTIVE.user);
    await assertSucceeds(setDoc(doc(db, 'leads', 'LEAD-NEW-1'), leadPayload('LEAD-NEW-1', P_ACTIVE.cp)));
  });
  it('verified + active partner can create a customer', async () => {
    const db = ctx(P_ACTIVE.uid, P_ACTIVE.user);
    await assertSucceeds(setDoc(doc(db, 'customers', 'CUST-NEW-1'), customerPayload('CUST-NEW-1', P_ACTIVE.cp)));
  });
  it('verified + active partner can create a project', async () => {
    const db = ctx(P_ACTIVE.uid, P_ACTIVE.user);
    await assertSucceeds(setDoc(doc(db, 'projects', 'PRJ-NEW-1'), projectPayload('PRJ-NEW-1', P_ACTIVE.cp)));
  });
  // NOTE — `scheme_registrations` write coverage now lives in its own suite,
  // `schemeRegistrationAccess.emulator.test.ts` (added 2026-09-10 with the
  // production fix that re-based this block onto the working leads/employees
  // rule shape — `partnerCreateEligible() && (canCreateCompanyScoped() ||
  // groupAdminCanCreate())` + a LEAN `actorRoleMatches()` role gate, no
  // per-record ownership get()). That leaner shape brought the whole block —
  // Admin, Management, Group Admin, Manager AND Partner create/update/delete —
  // back inside the emulator's 1000-expression budget (it previously could not
  // evaluate ANY scheme_registrations write). BD-3 for scheme is now enforced
  // (a) at the rules layer by `partnerCreateEligible()` at the top of the
  // create rule — identical to leads/customers/projects — and (b) in the
  // createSchemeRegistration workflow. Its own suite asserts the suspended-
  // partner denial directly. The pre-2026-09-10 create/update rules were
  // ALSO restructured to the file's ternary-discriminator shape (behaviour-
  // identical, lower prod expression cost) as part of this change.

  it('KYC not_started partner can still create a lead (KYC advisory)', async () => {
    const db = ctx(P_KYC_PENDING.uid, P_KYC_PENDING.user);
    await assertSucceeds(setDoc(doc(db, 'leads', 'LEAD-KYCPEND-1'), leadPayload('LEAD-KYCPEND-1', P_KYC_PENDING.cp)));
  });
  it('KYC not_started partner can still create a customer', async () => {
    const db = ctx(P_KYC_PENDING.uid, P_KYC_PENDING.user);
    await assertSucceeds(setDoc(doc(db, 'customers', 'CUST-KYCPEND-1'), customerPayload('CUST-KYCPEND-1', P_KYC_PENDING.cp)));
  });
  it('KYC rejected partner can still create a lead (KYC advisory, not a blocker)', async () => {
    const db = ctx(P_KYC_REJECTED.uid, P_KYC_REJECTED.user);
    await assertSucceeds(setDoc(doc(db, 'leads', 'LEAD-KYCREJ-1'), leadPayload('LEAD-KYCREJ-1', P_KYC_REJECTED.cp)));
  });
  it('KYC rejected partner can still create a project', async () => {
    const db = ctx(P_KYC_REJECTED.uid, P_KYC_REJECTED.user);
    await assertSucceeds(setDoc(doc(db, 'projects', 'PRJ-KYCREJ-1'), projectPayload('PRJ-KYCREJ-1', P_KYC_REJECTED.cp)));
  });
});

describe('BD-3 — suspended partner CANNOT create new records', () => {
  it('suspended partner CANNOT create a lead', async () => {
    const db = ctx(P_SUSPENDED.uid, P_SUSPENDED.user);
    await assertFails(setDoc(doc(db, 'leads', 'LEAD-SUSP-1'), leadPayload('LEAD-SUSP-1', P_SUSPENDED.cp)));
  });
  it('suspended partner CANNOT create a customer', async () => {
    const db = ctx(P_SUSPENDED.uid, P_SUSPENDED.user);
    await assertFails(setDoc(doc(db, 'customers', 'CUST-SUSP-1'), customerPayload('CUST-SUSP-1', P_SUSPENDED.cp)));
  });
  it('suspended partner CANNOT create a project', async () => {
    const db = ctx(P_SUSPENDED.uid, P_SUSPENDED.user);
    await assertFails(setDoc(doc(db, 'projects', 'PRJ-SUSP-1'), projectPayload('PRJ-SUSP-1', P_SUSPENDED.cp)));
  });
  // scheme_registrations suspended-partner denial is asserted directly in
  // schemeRegistrationAccess.emulator.test.ts ("a SUSPENDED Partner CANNOT
  // file a Registration — BD-3 via partnerCreateEligible()").
});

describe('BD-3 — suspended partner keeps existing/in-flight work', () => {
  it('suspended partner CAN still read their pre-suspension lead', async () => {
    const db = ctx(P_SUSPENDED.uid, P_SUSPENDED.user);
    await assertSucceeds(getDoc(doc(db, 'leads', 'LEAD-SUSP-EXISTING')));
  });
  it('suspended partner CAN still update their pre-suspension lead (close-out work)', async () => {
    const db = ctx(P_SUSPENDED.uid, P_SUSPENDED.user);
    await assertSucceeds(updateDoc(doc(db, 'leads', 'LEAD-SUSP-EXISTING'), { notes: 'closing out', updatedBy: P_SUSPENDED.user }));
  });
});

describe('BD-3 — inactive / pending partner cannot create', () => {
  it('inactive (terminated) partner CANNOT create a lead', async () => {
    const db = ctx(P_INACTIVE.uid, P_INACTIVE.user);
    await assertFails(setDoc(doc(db, 'leads', 'LEAD-INACT-1'), leadPayload('LEAD-INACT-1', P_INACTIVE.cp)));
  });
  it('inactive (terminated) partner CANNOT create a customer', async () => {
    const db = ctx(P_INACTIVE.uid, P_INACTIVE.user);
    await assertFails(setDoc(doc(db, 'customers', 'CUST-INACT-1'), customerPayload('CUST-INACT-1', P_INACTIVE.cp)));
  });
});

describe('BD-3 — non-Partner actors are unaffected', () => {
  it('Sales can create a lead (no partner status gate for non-partners)', async () => {
    const db = ctx(SALES.uid, SALES.user);
    await assertSucceeds(setDoc(doc(db, 'leads', 'LEAD-SALES-1'), { id: 'LEAD-SALES-1', companyId: COMPANY_A, groupId: GROUP_A, name: 'Sales Lead', phone: '9990003333', source: 'Website', status: 'New', createdBy: SALES.user, updatedBy: SALES.user, isDeleted: false }));
  });
  it('Admin can create a customer', async () => {
    const db = ctx(ADMIN.uid, ADMIN.user);
    await assertSucceeds(setDoc(doc(db, 'customers', 'CUST-ADMIN-1'), { id: 'CUST-ADMIN-1', companyId: COMPANY_A, groupId: GROUP_A, name: 'Admin Customer', phone: '9990004444', type: 'B2C', createdBy: ADMIN.user, updatedBy: ADMIN.user, isDeleted: false }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BD-5 — Management is an Admin alias at the rules layer', () => {
  it('Management can read a same-company commission_record exactly as Admin can', async () => {
    const db = ctx(MANAGEMENT.uid, MANAGEMENT.user);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-1')));
  });
  it('Admin can read that same commission_record (control)', async () => {
    const db = ctx(ADMIN.uid, ADMIN.user);
    await assertSucceeds(getDoc(doc(db, 'commission_records', 'CR-1')));
  });
  it('Sales CANNOT read that commission_record (control — proves it is a real role gate, not company-wide)', async () => {
    const db = ctx(SALES.uid, SALES.user);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-1')));
  });
  it('Management can create a commission_rule (isAdmin()-gated write) exactly as Admin can', async () => {
    const db = ctx(MANAGEMENT.uid, MANAGEMENT.user);
    await assertSucceeds(setDoc(doc(db, 'commission_rules', 'RULE-MGMT-1'), { id: 'RULE-MGMT-1', companyId: COMPANY_A, groupId: GROUP_A, name: 'Std', type: 'percentage', value: 5, isActive: true, isDeleted: false }));
  });
  it('Sales CANNOT create a commission_rule (control)', async () => {
    const db = ctx(SALES.uid, SALES.user);
    await assertFails(setDoc(doc(db, 'commission_rules', 'RULE-SALES-1'), { id: 'RULE-SALES-1', companyId: COMPANY_A, groupId: GROUP_A, name: 'Std', type: 'percentage', value: 5, isActive: true, isDeleted: false }));
  });
  it('Management is NOT widened to GroupAdmin — it cannot reach a cross-company document', async () => {
    // A Management actor in COMPANY_A trying to read a doc in another company
    // must be denied: Management resolves to Admin (company-scoped), never
    // GroupAdmin (group-scoped).
    await env.withSecurityRulesDisabled(async (rc) => {
      const db = rc.firestore();
      await setDoc(doc(db, 'companies', 'CO-OTHER'), { id: 'CO-OTHER', companyId: 'CO-OTHER', name: 'Other', groupId: 'GROUP-OTHER', status: 'Active' });
      await setDoc(doc(db, 'groups', 'GROUP-OTHER'), { id: 'GROUP-OTHER', name: 'Other Group', status: 'Active' });
      await setDoc(doc(db, 'commission_records', 'CR-OTHER'), { id: 'CR-OTHER', companyId: 'CO-OTHER', groupId: 'GROUP-OTHER', partnerId: 'CP-X', amount: 1, status: 'pending', isDeleted: false });
    });
    const db = ctx(MANAGEMENT.uid, MANAGEMENT.user);
    await assertFails(getDoc(doc(db, 'commission_records', 'CR-OTHER')));
  });
});
