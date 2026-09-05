/**
 * banksRoleAliasParity.emulator.test.ts
 *
 * RBAC Master Implementation Plan — Phase 2 (AUTH-S1).
 *
 * ROOT CAUSE: firestore.rules' `banks` read rule tested
 * actorRoleMatches('Admin|Sales|Accounts|Director|Manager') — an exact,
 * alias-blind alternation. canDo() (src/lib/permissions.ts) already
 * resolves 'Sales Executive'/'BDM'/'BDE' -> Sales and 'TL' -> Manager via
 * EXACT_ROLE_COMPATIBILITY, so a user stored with one of those exact role
 * strings passed the client's own "can I view Banks" check yet was denied
 * by this rule — a "UI allows, rules reject" false DENY, not an intentional
 * restriction (banks:view is a genuine Sales/Manager grant per
 * roleBootstrap.ts).
 *
 * FIX: the alternation now also lists every currently-active alias of Sales
 * and Manager verbatim. This is a false-DENY closure — it grants nothing an
 * account literally named 'Sales'/'Manager' didn't already have; it only
 * extends that SAME existing grant to accounts stored under an alias name.
 *
 * GroupAdmin is not part of this fix (and this file does not test it) — it
 * is already routed through the isGroupAdmin() ternary on this exact rule,
 * never through this regex.
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT = 'neozy-banks-role-alias-parity-test';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';
const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';

const BANK_A = `${COMPANY_A}_BANK1`;
const BANK_B = `${COMPANY_B}_BANK1`;

function userDoc(id: string, role: string, companyId: string, groupId: string, email: string) {
  return { id, companyId, groupId, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false };
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
    await setDoc(doc(db, 'banks', BANK_A), { id: BANK_A, companyId: COMPANY_A, name: 'Bank One' });
    await setDoc(doc(db, 'banks', BANK_B), { id: BANK_B, companyId: COMPANY_B, name: 'Bank Two' });

    const roles: Array<[string, string]> = [
      ['uid-sales-exec', 'Sales Executive'],
      ['uid-bdm', 'BDM'],
      ['uid-bde', 'BDE'],
      ['uid-tl', 'TL'],
      ['uid-warehouse', 'Warehouse'], // negative control — must remain denied
      ['uid-hr', 'HR'], // negative control — must remain denied
    ];
    for (const [uid, role] of roles) {
      const userId = `MUSR-${uid}`;
      await setDoc(doc(db, 'users', userId), userDoc(userId, role, COMPANY_A, GROUP_A, `${uid}@neozy.test`));
      await setDoc(doc(db, 'user_auth_maps', uid), mappingDoc(uid, userId, COMPANY_A, GROUP_A, `${uid}@neozy.test`));
    }
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

describe('AUTH-S1 — banks read rule recognizes Sales/Manager aliases', () => {
  it('POSITIVE: Sales Executive can now read banks (previously a false DENY)', async () => {
    const db = ctx('uid-sales-exec', 'uid-sales-exec@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('POSITIVE: BDM can now read banks', async () => {
    const db = ctx('uid-bdm', 'uid-bdm@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('POSITIVE: BDE can now read banks', async () => {
    const db = ctx('uid-bde', 'uid-bde@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('POSITIVE: TL (Manager alias) can now read banks', async () => {
    const db = ctx('uid-tl', 'uid-tl@neozy.test');
    await assertSucceeds(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('NEGATIVE: roles with no banks grant remain denied — this is a false-DENY fix, not a broadening (Warehouse)', async () => {
    const db = ctx('uid-warehouse', 'uid-warehouse@neozy.test');
    await assertFails(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('NEGATIVE: roles with no banks grant remain denied (HR)', async () => {
    const db = ctx('uid-hr', 'uid-hr@neozy.test');
    await assertFails(getDoc(doc(db, 'banks', BANK_A)));
  });

  it('NEGATIVE: cross-company access remains blocked for an aliased role — tenant isolation is untouched by this alias fix', async () => {
    const db = ctx('uid-sales-exec', 'uid-sales-exec@neozy.test');
    await assertFails(getDoc(doc(db, 'banks', BANK_B)));
  });
});
