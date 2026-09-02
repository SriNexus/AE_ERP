import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

/**
 * leadCreationProjectionWrites.emulator.test.ts — forensic reproduction of the
 * "Missing and insufficient permissions + orphan users record + Lead missing"
 * bug when a NON-Admin (Sales Executive / Manager / any role with leads:create
 * but no users-module grant) creates a Lead that carries a phone number.
 *
 * Internal Lead-create path: features/leads/hooks/useLeads.ts useSaveLead
 * → createLeadProjection → lib/entityProjection.ts createProjectionWithUserId,
 * which performs this NON-ATOMIC write sequence:
 *
 *   W1  users/MUSR-{companyId}-{phone}  CREATE  (contact identity, role:'Lead')
 *          — lib/userIdentity.ts resolveOrCreateMasterUserInTransaction
 *   W2  users/MUSR-{companyId}-{phone}  UPDATE  (roles[] + linkedModules[])
 *          — lib/userIdentity.ts attachUserRole  ← the denied write
 *   W3  entities/{entityId}             CREATE
 *   W4  leads/{leadId}                  CREATE
 *
 * firestore.rules has a contact-identity CREATE exception (isContactIdentityRole)
 * so W1 is allowed for any signed-in same-company user — but there is NO
 * matching UPDATE exception, so W2 is denied for every non-Admin/non-GroupAdmin
 * actor. W1 has already committed and is never compensated by
 * createProjectionWithUserId (its try/catch only rolls back the entities doc,
 * and only when W4 throws) → orphan users doc + thrown permission error + no
 * entities/leads write → the Lead never appears.
 */

const PROJECT = 'neozy-lead-projection-writes-test';
const CO = 'CO-LP';
const GROUP = 'GROUP-LP';

const UID_ADMIN = 'uid-lp-admin';
const ID_ADMIN = 'MUSR-LP-ADMIN';
const UID_SALES = 'uid-lp-sales';
const ID_SALES = 'MUSR-LP-SALES';

const PHONE = '9990001111';
const MUSR_LEAD = `MUSR-${CO}-${PHONE}`;

let env: RulesTestEnvironment;
const ctx = (uid: string, email: string) => env.authenticatedContext(uid, { email }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => { await env.cleanup(); });

const seededMasterUser = {
  id: MUSR_LEAD, userId: MUSR_LEAD, companyId: CO, phone: PHONE, name: 'Ramesh Iyer',
  email: '', role: 'Lead', roles: ['Lead'], linkedModules: ['leads'], status: 'Identity',
  createdBy: ID_ADMIN, updatedBy: ID_ADMIN, isSuperAdmin: false, isDeleted: false,
};

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'groups', GROUP), { id: GROUP, name: 'Group LP', status: 'Active' });
    await setDoc(doc(db, 'companies', CO), { id: CO, companyId: CO, name: 'Company LP', groupId: GROUP });
    for (const [uid, id, role, email] of [
      [UID_ADMIN, ID_ADMIN, 'Admin', 'admin@lp.test'],
      [UID_SALES, ID_SALES, 'Sales', 'sales@lp.test'],
    ] as const) {
      await setDoc(doc(db, 'users', id), { id, companyId: CO, groupId: GROUP, role, email, status: 'Active', isSuperAdmin: false, isDeleted: false });
      await setDoc(doc(db, 'user_auth_maps', uid), { authUid: uid, userId: id, companyId: CO, groupId: GROUP, email });
    }
    // A contact-identity MUSR doc that already exists (as if W1 committed).
    await setDoc(doc(db, 'users', MUSR_LEAD), seededMasterUser);
  });
});

// The write attachUserRole() performs (roles + linkedModules array merge).
const w2AttachRole = (actorId: string) => ({ roles: ['Lead', 'Lead'], linkedModules: ['leads'], updatedBy: actorId });
const w3Entity = (actorId: string) => ({
  id: 'ENT-LP-1', companyId: CO, groupId: GROUP, primaryRole: 'lead', roles: ['lead'],
  displayName: 'Ramesh Iyer', createdBy: actorId, updatedBy: actorId, isDeleted: false,
});
const w4Lead = (actorId: string, assignedToId: string) => ({
  id: 'PLD-LP-1', companyId: CO, groupId: GROUP, name: 'Ramesh Iyer', phone: PHONE,
  source: 'Website', status: 'New', assignedToId, assignedToName: 'Sales LP',
  userId: MUSR_LEAD, entityId: 'ENT-LP-1', createdBy: actorId, updatedBy: actorId, isDeleted: false,
});

describe('W2 — attachUserRole() UPDATE on a contact-identity users doc', () => {
  it('Admin CAN update it (baseline)', async () => {
    const db = ctx(UID_ADMIN, 'admin@lp.test');
    await assertSucceeds(updateDoc(doc(db, 'users', MUSR_LEAD), w2AttachRole(ID_ADMIN)));
  });

  it('Sales Executive CAN update it (contact-identity role-attach exception — the fix)', async () => {
    const db = ctx(UID_SALES, 'sales@lp.test');
    await assertSucceeds(updateDoc(doc(db, 'users', MUSR_LEAD), w2AttachRole(ID_SALES)));
  });

  it('the contact-identity update exception cannot escalate a contact doc to a staff role', async () => {
    const db = ctx(UID_SALES, 'sales@lp.test');
    await assertFails(updateDoc(doc(db, 'users', MUSR_LEAD), { role: 'Admin', updatedBy: ID_SALES }));
  });

  it('the contact-identity update exception cannot grant isSuperAdmin', async () => {
    const db = ctx(UID_SALES, 'sales@lp.test');
    await assertFails(updateDoc(doc(db, 'users', MUSR_LEAD), { isSuperAdmin: true, roles: ['Lead'], updatedBy: ID_SALES }));
  });

  it('the contact-identity update exception cannot flip a contact identity to an active login (status)', async () => {
    const db = ctx(UID_SALES, 'sales@lp.test');
    await assertFails(updateDoc(doc(db, 'users', MUSR_LEAD), { status: 'Active', roles: ['Lead'], updatedBy: ID_SALES }));
  });

  it('a user from another company CANNOT touch this contact identity (tenant isolation preserved)', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'groups', 'GROUP-OTHER'), { id: 'GROUP-OTHER', name: 'Other', status: 'Active' });
      await setDoc(doc(db, 'companies', 'CO-OTHER'), { id: 'CO-OTHER', companyId: 'CO-OTHER', name: 'Other Co', groupId: 'GROUP-OTHER' });
      await setDoc(doc(db, 'users', 'MUSR-OTHER-SALES'), { id: 'MUSR-OTHER-SALES', companyId: 'CO-OTHER', groupId: 'GROUP-OTHER', role: 'Sales', email: 'x@other.test', status: 'Active', isSuperAdmin: false, isDeleted: false });
      await setDoc(doc(db, 'user_auth_maps', 'uid-other-sales'), { authUid: 'uid-other-sales', userId: 'MUSR-OTHER-SALES', companyId: 'CO-OTHER', groupId: 'GROUP-OTHER', email: 'x@other.test' });
    });
    const db = ctx('uid-other-sales', 'x@other.test');
    await assertFails(updateDoc(doc(db, 'users', MUSR_LEAD), w2AttachRole('MUSR-OTHER-SALES')));
  });
});

describe('W3 / W4 — entities + leads writes are NOT the blocker for a Sales Executive', () => {
  it('Sales Executive CAN create the entities doc', async () => {
    await assertSucceeds(setDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'entities', 'ENT-LP-1'), w3Entity(ID_SALES)));
  });
  it('Sales Executive CAN create the leads doc (assigned to any same-company user)', async () => {
    await assertSucceeds(setDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'leads', 'PLD-LP-1'), w4Lead(ID_SALES, ID_ADMIN)));
  });
});

describe('Lead visibility (rules layer) — a created Lead is readable by its company + assignee', () => {
  it('Sales Executive can read a same-company Lead assigned to them', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'leads', 'PLD-LP-VIS'), { id: 'PLD-LP-VIS', companyId: CO, groupId: GROUP, name: 'Visible', assignedToId: ID_SALES, createdBy: ID_ADMIN, isDeleted: false });
    });
    await assertSucceeds(getDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'leads', 'PLD-LP-VIS')));
  });
});

// RC-B: lib/workflow.ts logActivity() writes an audit_logs entry on EVERY
// Lead/Customer/Order/... mutation, by EVERY role. It was Admin/GroupAdmin-only
// to create, so a non-Admin actor's own action log was denied ("Missing or
// insufficient permissions", swallowed) and the audit trail for anything a
// Sales/Manager/Partner did was silently lost. The self-authored append-only
// branch fixes that without opening the log.
describe('RC-B — audit_logs: a non-Admin may append their OWN activity entry', () => {
  const entry = (actorId: string, overrides: Record<string, unknown> = {}) => ({
    id: 'AUD-LP-1', companyId: CO, groupId: GROUP, module: 'Leads', action: 'Lead Created',
    entityId: 'PLD-LP-1', userId: actorId, userName: 'Sales LP', createdAt: 'now', ...overrides,
  });

  it('Sales Executive CAN create a self-authored audit entry (the fix)', async () => {
    await assertSucceeds(setDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'audit_logs', 'AUD-LP-1'), entry(ID_SALES)));
  });

  it('Admin CAN still create an audit entry (baseline, unchanged)', async () => {
    await assertSucceeds(setDoc(doc(ctx(UID_ADMIN, 'admin@lp.test'), 'audit_logs', 'AUD-LP-2'), entry(ID_ADMIN, { id: 'AUD-LP-2' })));
  });

  it('Sales Executive CANNOT forge an audit entry attributed to someone else', async () => {
    await assertFails(setDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'audit_logs', 'AUD-LP-3'), entry(ID_ADMIN, { id: 'AUD-LP-3' })));
  });

  it('Sales Executive CANNOT create an audit entry for another company (tenant isolation)', async () => {
    await assertFails(setDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'audit_logs', 'AUD-LP-4'), entry(ID_SALES, { id: 'AUD-LP-4', companyId: 'CO-OTHER', groupId: 'GROUP-OTHER' })));
  });

  it('Sales Executive CANNOT read the audit log (write-own-only, never browse)', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'audit_logs', 'AUD-SEED'), entry(ID_ADMIN, { id: 'AUD-SEED' }));
    });
    await assertFails(getDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'audit_logs', 'AUD-SEED')));
  });

  it('an audit entry is append-only — nobody can update or delete it', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'audit_logs', 'AUD-IMMUT'), entry(ID_SALES, { id: 'AUD-IMMUT' }));
    });
    await assertFails(updateDoc(doc(ctx(UID_ADMIN, 'admin@lp.test'), 'audit_logs', 'AUD-IMMUT'), { action: 'tampered' }));
    await assertFails(updateDoc(doc(ctx(UID_SALES, 'sales@lp.test'), 'audit_logs', 'AUD-IMMUT'), { action: 'tampered' }));
  });
});
