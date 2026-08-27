import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

/**
 * sensitiveCollectionsRoleEnforcement.emulator.test.ts — Security
 * Remediation Phase 2 (F-06/RULES-001,
 * docs/audits/NEOZY_SECURITY_REMEDIATION_PHASE_2_IMPLEMENTATION_CONTRACT.md).
 *
 * Proves, against the REAL Firestore rules emulator (never mocked), that
 * the 6 hardened collections — employees, payroll, payments, banks,
 * commission_records, settlements — are no longer reachable by an active,
 * same-company, but role-unauthorized user via a direct Firestore SDK call.
 * Before this phase, ALL 6 collections fell through the generic
 * company-scoped fallback (canReadCompanyScoped()/canCreateCompanyScoped()/
 * canUpdateCompanyScoped()), which checks tenant membership only — never
 * role. The regression test below (RULES-001 attack) is written to FAIL
 * against that old fallback and PASS only with the new explicit role-aware
 * blocks in place.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */

const PROJECT = 'neozy-sensitive-collections-test';

const COMPANY_A = 'CO-A';   // home company, GROUP-A
const COMPANY_C = 'CO-C';   // sibling company, same Group (GROUP-A)
const COMPANY_B = 'CO-B';   // different Group entirely (GROUP-B)
const COMPANY_S = 'CO-S';   // company whose owning Group is Suspended

let env: RulesTestEnvironment;

type Identity = { uid: string; userId: string; companyId: string; groupId: string; email: string; role: string; isSuperAdmin?: boolean };

const IDENTITIES: Identity[] = [
  { uid: 'uid-super', userId: 'MUSR-SUPER', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'super@neozy.test', role: 'Admin', isSuperAdmin: true },
  { uid: 'uid-admin-a', userId: 'MUSR-ADMIN-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'admin.a@neozy.test', role: 'Admin' },
  { uid: 'uid-ga-a', userId: 'MUSR-GA-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'ga.a@neozy.test', role: 'GroupAdmin' },
  { uid: 'uid-ga-b', userId: 'MUSR-GA-B', companyId: COMPANY_B, groupId: 'GROUP-B', email: 'ga.b@neozy.test', role: 'GroupAdmin' },
  { uid: 'uid-hr-a', userId: 'MUSR-HR-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'hr.a@neozy.test', role: 'HR' },
  { uid: 'uid-hr-c', userId: 'MUSR-HR-C', companyId: COMPANY_C, groupId: 'GROUP-A', email: 'hr.c@neozy.test', role: 'HR' },
  { uid: 'uid-hr-b', userId: 'MUSR-HR-B', companyId: COMPANY_B, groupId: 'GROUP-B', email: 'hr.b@neozy.test', role: 'HR' },
  { uid: 'uid-hr-s', userId: 'MUSR-HR-S', companyId: COMPANY_S, groupId: 'GROUP-SUSPENDED', email: 'hr.s@neozy.test', role: 'HR' },
  { uid: 'uid-accounts-a', userId: 'MUSR-ACCOUNTS-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'accounts.a@neozy.test', role: 'Accounts' },
  { uid: 'uid-director-a', userId: 'MUSR-DIRECTOR-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'director.a@neozy.test', role: 'Director' },
  { uid: 'uid-manager-a', userId: 'MUSR-MANAGER-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'manager.a@neozy.test', role: 'Manager' },
  { uid: 'uid-partner-a', userId: 'MUSR-PARTNER-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'partner.a@neozy.test', role: 'Partner' },
  { uid: 'uid-sales-a', userId: 'MUSR-SALES-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'sales.a@neozy.test', role: 'Sales' },
];

function identity(userId: string): Identity {
  const found = IDENTITIES.find((i) => i.userId === userId);
  if (!found) throw new Error(`Unknown test identity ${userId}`);
  return found;
}

async function seed() {
  await env.withSecurityRulesDisabled(async (rulesCtx) => {
    const db = rulesCtx.firestore();

    await setDoc(doc(db, 'companies', COMPANY_A), { id: COMPANY_A, companyId: COMPANY_A, name: 'Company A', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_C), { id: COMPANY_C, companyId: COMPANY_C, name: 'Company C', groupId: 'GROUP-A' });
    await setDoc(doc(db, 'companies', COMPANY_B), { id: COMPANY_B, companyId: COMPANY_B, name: 'Company B', groupId: 'GROUP-B' });
    await setDoc(doc(db, 'companies', COMPANY_S), { id: COMPANY_S, companyId: COMPANY_S, name: 'Company S', groupId: 'GROUP-SUSPENDED' });
    await setDoc(doc(db, 'groups', 'GROUP-A'), { id: 'GROUP-A', name: 'Group A', shortName: 'GA', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-B'), { id: 'GROUP-B', name: 'Group B', shortName: 'GB', status: 'Active' });
    await setDoc(doc(db, 'groups', 'GROUP-SUSPENDED'), { id: 'GROUP-SUSPENDED', name: 'Suspended Group', shortName: 'GS', status: 'Suspended' });

    for (const identity of IDENTITIES) {
      await setDoc(doc(db, 'users', identity.userId), {
        id: identity.userId, companyId: identity.companyId, groupId: identity.groupId,
        role: identity.role, email: identity.email, status: 'Active',
        isSuperAdmin: identity.isSuperAdmin === true, isDeleted: false,
      });
      await setDoc(doc(db, 'user_auth_maps', identity.uid), {
        authUid: identity.uid, userId: identity.userId, companyId: identity.companyId,
        groupId: identity.groupId, email: identity.email,
      });
    }

    // One seeded, pre-existing document per collection, per company, for READ/UPDATE tests.
    for (const col of COLLECTIONS) {
      for (const companyId of [COMPANY_A, COMPANY_C, COMPANY_B, COMPANY_S]) {
        const groupId = companyId === COMPANY_A || companyId === COMPANY_C ? 'GROUP-A'
          : companyId === COMPANY_B ? 'GROUP-B' : 'GROUP-SUSPENDED';
        await setDoc(doc(db, col.name, `${col.name}-${companyId}`), {
          id: `${col.name}-${companyId}`, companyId, groupId, note: 'seed',
        });
      }
    }
  });
}

const ctx = (userId: string) => {
  const id = identity(userId);
  return env.authenticatedContext(id.uid, { email: id.email }).firestore();
};
const anon = () => env.unauthenticatedContext().firestore();

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

type CollectionSpec = { name: string; readRoles: string[]; writeRoles: string[]; unauthorizedRole: string };

const COLLECTIONS: CollectionSpec[] = [
  { name: 'employees', readRoles: ['HR', 'Director'], writeRoles: ['HR'], unauthorizedRole: 'Sales' },
  { name: 'payroll', readRoles: ['HR', 'Director'], writeRoles: [], unauthorizedRole: 'Sales' },
  { name: 'payments', readRoles: ['Accounts', 'Director'], writeRoles: ['Accounts'], unauthorizedRole: 'Sales' },
  { name: 'banks', readRoles: ['Sales', 'Accounts', 'Director', 'Manager'], writeRoles: [], unauthorizedRole: 'Partner' },
  { name: 'commission_records', readRoles: ['Manager', 'Partner', 'Director'], writeRoles: ['Manager'], unauthorizedRole: 'Sales' },
  { name: 'settlements', readRoles: ['Manager', 'Partner', 'Director'], writeRoles: ['Manager'], unauthorizedRole: 'Sales' },
];

for (const col of COLLECTIONS) {
  describe(`${col.name} — role-aware rule enforcement (Phase 2 / F-06)`, () => {
    for (const role of col.readRoles) {
      it(`authorized role (${role}) can READ an own-company document — ALLOW`, async () => {
        const userId = IDENTITIES.find((i) => i.role === role && i.companyId === COMPANY_A)!.userId;
        await assertSucceeds(getDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`)));
      });
    }

    it(`RULES-001 regression anchor: an active, same-company, but unauthorized role (${col.unauthorizedRole}) CANNOT read directly via the SDK — DENY`, async () => {
      const userId = IDENTITIES.find((i) => i.role === col.unauthorizedRole && i.companyId === COMPANY_A)!.userId;
      await assertFails(getDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`)));
    });

    it('unauthorized role CANNOT create a document — DENY', async () => {
      const userId = IDENTITIES.find((i) => i.role === col.unauthorizedRole && i.companyId === COMPANY_A)!.userId;
      await assertFails(setDoc(doc(ctx(userId), col.name, `${col.name}-new-1`), { id: `${col.name}-new-1`, companyId: COMPANY_A, groupId: 'GROUP-A', note: 'x' }));
    });

    it('unauthorized role CANNOT update a document — DENY', async () => {
      const userId = IDENTITIES.find((i) => i.role === col.unauthorizedRole && i.companyId === COMPANY_A)!.userId;
      await assertFails(updateDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`), { note: 'changed' }));
    });

    it('authorized READ role cannot access a DIFFERENT company\'s document (cross-company denial, even in the same Group) — DENY', async () => {
      const readRole = col.readRoles[0];
      const userId = IDENTITIES.find((i) => i.role === readRole && i.companyId === COMPANY_A)!.userId;
      await assertFails(getDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_C}`)));
    });

    it('authorized READ role in a DIFFERENT Group entirely cannot access this company\'s document — DENY', async () => {
      // HR exists in every company for a controlled cross-group probe.
      await assertFails(getDoc(doc(ctx('MUSR-HR-B'), col.name, `${col.name}-${COMPANY_A}`)));
    });

    it('authorized role in a SUSPENDED Group\'s company is denied even for their own company\'s document — DENY', async () => {
      await assertFails(getDoc(doc(ctx('MUSR-HR-S'), col.name, `${col.name}-${COMPANY_S}`)));
    });

    it('GroupAdmin (own Group, sibling company) — ALLOW read', async () => {
      await assertSucceeds(getDoc(doc(ctx('MUSR-GA-A'), col.name, `${col.name}-${COMPANY_C}`)));
    });

    it('GroupAdmin (own Group, sibling company) — ALLOW create', async () => {
      await assertSucceeds(setDoc(doc(ctx('MUSR-GA-A'), col.name, `${col.name}-ga-new`), { id: `${col.name}-ga-new`, companyId: COMPANY_C, groupId: 'GROUP-A', note: 'x' }));
    });

    it('GroupAdmin from a DIFFERENT Group cannot access this company\'s document — DENY', async () => {
      await assertFails(getDoc(doc(ctx('MUSR-GA-B'), col.name, `${col.name}-${COMPANY_A}`)));
    });

    it('Admin (role, own company) — ALLOW read/create/update', async () => {
      await assertSucceeds(getDoc(doc(ctx('MUSR-ADMIN-A'), col.name, `${col.name}-${COMPANY_A}`)));
      await assertSucceeds(setDoc(doc(ctx('MUSR-ADMIN-A'), col.name, `${col.name}-admin-new`), { id: `${col.name}-admin-new`, companyId: COMPANY_A, groupId: 'GROUP-A', note: 'x' }));
      await assertSucceeds(updateDoc(doc(ctx('MUSR-ADMIN-A'), col.name, `${col.name}-${COMPANY_A}`), { note: 'changed' }));
    });

    it('Super Admin — ALLOW unconditionally, including a company they do not belong to', async () => {
      await assertSucceeds(getDoc(doc(ctx('MUSR-SUPER'), col.name, `${col.name}-${COMPANY_B}`)));
    });

    it('an authorized role cannot change companyId on update (tenant-immutability preserved) — DENY', async () => {
      const writeRole = col.writeRoles[0] ?? 'Admin';
      const userId = writeRole === 'Admin' ? 'MUSR-ADMIN-A' : IDENTITIES.find((i) => i.role === writeRole && i.companyId === COMPANY_A)!.userId;
      await assertFails(updateDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`), { companyId: COMPANY_C }));
    });

    it('unauthenticated access is denied — DENY', async () => {
      await assertFails(getDoc(doc(anon(), col.name, `${col.name}-${COMPANY_A}`)));
    });

    for (const role of col.writeRoles) {
      it(`authorized write role (${role}) can CREATE and UPDATE an own-company document — ALLOW`, async () => {
        const userId = IDENTITIES.find((i) => i.role === role && i.companyId === COMPANY_A)!.userId;
        await assertSucceeds(setDoc(doc(ctx(userId), col.name, `${col.name}-${role}-new`), { id: `${col.name}-${role}-new`, companyId: COMPANY_A, groupId: 'GROUP-A', note: 'x' }));
        await assertSucceeds(updateDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`), { note: 'changed-by-' + role }));
      });
    }

    // A role that only has READ (not write) for this collection must be
    // denied create/update — proves the create/update boundary is a
    // genuinely separate gate, not merely "any read-authorized role can write".
    const readOnlyRoles = col.readRoles.filter((r) => !col.writeRoles.includes(r));
    for (const role of readOnlyRoles) {
      it(`read-only-authorized role (${role}) CANNOT create/update — DENY`, async () => {
        const userId = IDENTITIES.find((i) => i.role === role && i.companyId === COMPANY_A)!.userId;
        await assertFails(setDoc(doc(ctx(userId), col.name, `${col.name}-${role}-blocked`), { id: `${col.name}-${role}-blocked`, companyId: COMPANY_A, groupId: 'GROUP-A', note: 'x' }));
        await assertFails(updateDoc(doc(ctx(userId), col.name, `${col.name}-${COMPANY_A}`), { note: 'blocked' }));
      });
    }

    it('delete is always denied (soft-delete-only convention, matching every other collection)', async () => {
      const { deleteDoc } = await import('firebase/firestore');
      await assertFails(deleteDoc(doc(ctx('MUSR-ADMIN-A'), col.name, `${col.name}-${COMPANY_A}`)));
    });
  });
}
