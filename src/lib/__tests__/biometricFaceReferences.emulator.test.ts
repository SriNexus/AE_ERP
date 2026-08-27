import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';

/**
 * biometricFaceReferences.emulator.test.ts — Face Attendance + DeepFace
 * Master Plan, Phase 3 (docs/implementation/FACE_ATTENDANCE_DEEPFACE_MASTER_PLAN.md
 * §9's data model, §5's threat model, §11's authorization model).
 *
 * Proves, against the REAL Firestore rules emulator (never mocked), that
 * the new `biometric_face_references` collection's rules are fail-closed:
 * self-enrollment is scoped to the caller's own identity; Admin/HR/
 * GroupAdmin can act on behalf of an employee only within their own
 * company/Group; no client-supplied identity/tenant field can be forged;
 * immutable anchor fields can never be re-pointed by any actor, including
 * Owner/Super Admin; revocation is never self-service; and the collection
 * cannot fall through to the generic company-scoped fallback (which would
 * otherwise grant ANY same-company active user broader access than this
 * collection's own dedicated block allows).
 *
 * Written and run in Phase 3 per explicit instruction (this supersedes this
 * document's own original Phase 3 text, which had deferred emulator tests
 * to Phase 10 — see the Phase 3 completion record for the explicit,
 * deliberate reason this was superseded).
 *
 * Run via: npm run test:rules (see vitest.emulator.config.ts's `include`).
 */

const PROJECT = 'neozy-biometric-face-references-test';

const COMPANY_A = 'CO-A'; // home company, GROUP-A
const COMPANY_C = 'CO-C'; // sibling company, same Group (GROUP-A)
const COMPANY_B = 'CO-B'; // different Group entirely (GROUP-B)
const COMPANY_S = 'CO-S'; // company whose owning Group is Suspended

let env: RulesTestEnvironment;

type Identity = {
  uid: string;
  userId: string;
  companyId: string;
  groupId: string;
  email: string;
  role: string;
  isSuperAdmin?: boolean;
  status?: string;
};

const IDENTITIES: Identity[] = [
  { uid: 'uid-super', userId: 'MUSR-SUPER', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'super@neozy.test', role: 'Admin', isSuperAdmin: true },
  { uid: 'uid-admin-a', userId: 'MUSR-ADMIN-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'admin.a@neozy.test', role: 'Admin' },
  { uid: 'uid-hr-a', userId: 'MUSR-HR-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'hr.a@neozy.test', role: 'HR' },
  { uid: 'uid-hr-c', userId: 'MUSR-HR-C', companyId: COMPANY_C, groupId: 'GROUP-A', email: 'hr.c@neozy.test', role: 'HR' },
  { uid: 'uid-hr-b', userId: 'MUSR-HR-B', companyId: COMPANY_B, groupId: 'GROUP-B', email: 'hr.b@neozy.test', role: 'HR' },
  { uid: 'uid-hr-s', userId: 'MUSR-HR-S', companyId: COMPANY_S, groupId: 'GROUP-SUSPENDED', email: 'hr.s@neozy.test', role: 'HR' },
  { uid: 'uid-director-a', userId: 'MUSR-DIRECTOR-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'director.a@neozy.test', role: 'Director' },
  { uid: 'uid-ga-a', userId: 'MUSR-GA-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'ga.a@neozy.test', role: 'GroupAdmin' },
  { uid: 'uid-ga-b', userId: 'MUSR-GA-B', companyId: COMPANY_B, groupId: 'GROUP-B', email: 'ga.b@neozy.test', role: 'GroupAdmin' },
  { uid: 'uid-self-a', userId: 'MUSR-SELF-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'self.a@neozy.test', role: 'Sales' },
  { uid: 'uid-victim-a', userId: 'MUSR-VICTIM-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'victim.a@neozy.test', role: 'Sales' },
  { uid: 'uid-self-c', userId: 'MUSR-SELF-C', companyId: COMPANY_C, groupId: 'GROUP-A', email: 'self.c@neozy.test', role: 'Sales' },
  { uid: 'uid-inactive-a', userId: 'MUSR-INACTIVE-A', companyId: COMPANY_A, groupId: 'GROUP-A', email: 'inactive.a@neozy.test', role: 'Sales', status: 'Inactive' },
];

function identity(userId: string): Identity {
  const found = IDENTITIES.find((i) => i.userId === userId);
  if (!found) throw new Error(`Unknown test identity ${userId}`);
  return found;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'MUSR-SELF-A',
    userId: 'MUSR-SELF-A',
    companyId: COMPANY_A,
    groupId: 'GROUP-A',
    embedding: [0.1, 0.2, 0.3, 0.4],
    embeddingModel: 'mock-model',
    embeddingModelVersion: 'mock-v1',
    detectorBackend: 'mock-detector',
    detectorVersion: 'mock-v1',
    schemaVersion: 1,
    status: 'active',
    enrolledAt: new Date().toISOString(),
    enrolledBy: 'MUSR-SELF-A',
    reEnrollmentCount: 0,
    history: [],
    createdBy: 'MUSR-SELF-A',
    updatedBy: 'MUSR-SELF-A',
  };
  return { ...base, ...overrides };
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

    for (const id of IDENTITIES) {
      await setDoc(doc(db, 'users', id.userId), {
        id: id.userId, companyId: id.companyId, groupId: id.groupId,
        role: id.role, email: id.email, status: id.status ?? 'Active',
        isSuperAdmin: id.isSuperAdmin === true, isDeleted: false,
      });
      await setDoc(doc(db, 'user_auth_maps', id.uid), {
        authUid: id.uid, userId: id.userId, companyId: id.companyId,
        groupId: id.groupId, email: id.email,
      });
    }

    // Pre-existing references for READ/UPDATE/DELETE tests.
    await setDoc(doc(db, 'biometric_face_references', 'MUSR-SELF-A'), validPayload());
    await setDoc(
      doc(db, 'biometric_face_references', 'MUSR-VICTIM-A'),
      validPayload({ id: 'MUSR-VICTIM-A', userId: 'MUSR-VICTIM-A', enrolledBy: 'MUSR-VICTIM-A', createdBy: 'MUSR-VICTIM-A', updatedBy: 'MUSR-VICTIM-A' }),
    );
    await setDoc(
      doc(db, 'biometric_face_references', 'MUSR-SELF-C'),
      validPayload({ id: 'MUSR-SELF-C', userId: 'MUSR-SELF-C', companyId: COMPANY_C, enrolledBy: 'MUSR-SELF-C', createdBy: 'MUSR-SELF-C', updatedBy: 'MUSR-SELF-C' }),
    );
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

describe('biometric_face_references — CREATE (self-enrollment)', () => {
  it('self-enrollment with own identity — ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-self'), validPayload({ id: 'new-self' })),
    );
  });

  it('forged employeeId/userId: an employee enrolling a reference under ANOTHER employee\'s userId — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-forged'),
        validPayload({ id: 'new-forged', userId: 'MUSR-VICTIM-A', enrolledBy: 'MUSR-VICTIM-A' }),
      ),
    );
  });

  it('forged companyId: self-enrollment claiming a different company — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-forged-co'),
        validPayload({ id: 'new-forged-co', companyId: COMPANY_C }),
      ),
    );
  });

  it('forged groupId: a groupId that does not match the real owning company\'s group — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-forged-group'),
        validPayload({ id: 'new-forged-group', groupId: 'GROUP-B' }),
      ),
    );
  });

  it('createdBy/updatedBy/enrolledBy forgery: claiming a different acting identity than the real caller — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-forged-audit'),
        validPayload({ id: 'new-forged-audit', createdBy: 'MUSR-VICTIM-A' }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'new-forged-audit-2'),
        validPayload({ id: 'new-forged-audit-2', updatedBy: 'MUSR-VICTIM-A' }),
      ),
    );
  });

  it('malformed document (missing/invalid required fields) — DENY', async () => {
    const { embedding: _drop, ...missingEmbedding } = validPayload({ id: 'malformed-1' });
    await assertFails(setDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'malformed-1'), missingEmbedding));

    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'malformed-2'),
        validPayload({ id: 'malformed-2', status: 'not-a-real-status' }),
      ),
    );

    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'malformed-3'),
        validPayload({ id: 'malformed-3', embedding: [] }),
      ),
    );
  });

  it('unauthenticated access is denied — DENY', async () => {
    await assertFails(setDoc(doc(anon(), 'biometric_face_references', 'anon-1'), validPayload({ id: 'anon-1' })));
  });

  it('an inactive/suspended user cannot self-enroll — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-INACTIVE-A'), 'biometric_face_references', 'MUSR-INACTIVE-A'),
        validPayload({ id: 'MUSR-INACTIVE-A', userId: 'MUSR-INACTIVE-A', enrolledBy: 'MUSR-INACTIVE-A', createdBy: 'MUSR-INACTIVE-A', updatedBy: 'MUSR-INACTIVE-A' }),
      ),
    );
  });
});

describe('biometric_face_references — CREATE (Admin/HR/GroupAdmin on behalf)', () => {
  it('Admin (own company) enrolling another employee — ALLOW', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'admin-enrolled'),
        validPayload({ id: 'admin-enrolled', userId: 'admin-enrolled', enrolledBy: 'MUSR-ADMIN-A', createdBy: 'MUSR-ADMIN-A', updatedBy: 'MUSR-ADMIN-A' }),
      ),
    );
  });

  it('HR (own company) enrolling another employee — ALLOW', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('MUSR-HR-A'), 'biometric_face_references', 'hr-enrolled'),
        validPayload({ id: 'hr-enrolled', userId: 'hr-enrolled', enrolledBy: 'MUSR-HR-A', createdBy: 'MUSR-HR-A', updatedBy: 'MUSR-HR-A' }),
      ),
    );
  });

  it('GroupAdmin enrolling an employee in a SIBLING company within their own Group — ALLOW', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('MUSR-GA-A'), 'biometric_face_references', 'ga-enrolled'),
        validPayload({ id: 'ga-enrolled', userId: 'ga-enrolled', companyId: COMPANY_C, enrolledBy: 'MUSR-GA-A', createdBy: 'MUSR-GA-A', updatedBy: 'MUSR-GA-A' }),
      ),
    );
  });

  it('cross-company write denial: Admin of Company A cannot enroll a reference for Company C', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'cross-co'),
        validPayload({ id: 'cross-co', userId: 'cross-co', companyId: COMPANY_C, enrolledBy: 'MUSR-ADMIN-A', createdBy: 'MUSR-ADMIN-A', updatedBy: 'MUSR-ADMIN-A' }),
      ),
    );
  });

  it('cross-group denial: GroupAdmin of Group B cannot enroll a reference for a Group A company', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-GA-B'), 'biometric_face_references', 'cross-group'),
        validPayload({ id: 'cross-group', userId: 'cross-group', companyId: COMPANY_A, groupId: 'GROUP-A', enrolledBy: 'MUSR-GA-B', createdBy: 'MUSR-GA-B', updatedBy: 'MUSR-GA-B' }),
      ),
    );
  });

  it('HR in a company whose Group is Suspended cannot enroll anyone — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-HR-S'), 'biometric_face_references', 'suspended-enroll'),
        validPayload({ id: 'suspended-enroll', userId: 'suspended-enroll', companyId: COMPANY_S, groupId: 'GROUP-SUSPENDED', enrolledBy: 'MUSR-HR-S', createdBy: 'MUSR-HR-S', updatedBy: 'MUSR-HR-S' }),
      ),
    );
  });

  it('unauthorized role (Sales) enrolling ANOTHER employee (not self) — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'sales-enrolls-other'),
        validPayload({ id: 'sales-enrolls-other', userId: 'MUSR-VICTIM-A', enrolledBy: 'MUSR-SELF-A', createdBy: 'MUSR-SELF-A', updatedBy: 'MUSR-SELF-A' }),
      ),
    );
  });

  it('Director (view-only role, not granted any biometric write) cannot enroll anyone — DENY', async () => {
    await assertFails(
      setDoc(
        doc(ctx('MUSR-DIRECTOR-A'), 'biometric_face_references', 'director-enroll'),
        validPayload({ id: 'director-enroll', userId: 'director-enroll', enrolledBy: 'MUSR-DIRECTOR-A', createdBy: 'MUSR-DIRECTOR-A', updatedBy: 'MUSR-DIRECTOR-A' }),
      ),
    );
  });
});

describe('biometric_face_references — READ', () => {
  it('self can read own reference — ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A')));
  });

  it('Admin (own company) can read another employee\'s reference — ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A')));
  });

  it('HR (own company) can read another employee\'s reference — ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx('MUSR-HR-A'), 'biometric_face_references', 'MUSR-VICTIM-A')));
  });

  it('GroupAdmin can read a sibling company\'s reference within their own Group — ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx('MUSR-GA-A'), 'biometric_face_references', 'MUSR-SELF-C')));
  });

  it('Super Admin can read across companies unconditionally — ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ctx('MUSR-SUPER'), 'biometric_face_references', 'MUSR-SELF-C')));
  });

  it('an employee CANNOT read another employee\'s reference (self-scope only, not company-scope) — DENY', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-VICTIM-A')));
  });

  it('Director is NOT granted biometric read access, unlike employees\' own broader read list — DENY', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-DIRECTOR-A'), 'biometric_face_references', 'MUSR-VICTIM-A')));
  });

  it('cross-company read denial: HR of Company A cannot read Company C\'s reference (same Group, but HR is company-scoped, not group-scoped)', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-HR-A'), 'biometric_face_references', 'MUSR-SELF-C')));
  });

  it('cross-group denial: HR of a different Group entirely cannot read this company\'s reference', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-HR-B'), 'biometric_face_references', 'MUSR-SELF-A')));
  });

  it('GroupAdmin from a DIFFERENT Group cannot read this company\'s reference — DENY', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-GA-B'), 'biometric_face_references', 'MUSR-SELF-A')));
  });

  it('an authorized role in a SUSPENDED Group\'s company is denied even for their own company — DENY', async () => {
    await assertFails(getDoc(doc(ctx('MUSR-HR-S'), 'biometric_face_references', 'MUSR-SELF-A')));
  });

  it('unauthenticated read is denied — DENY', async () => {
    await assertFails(getDoc(doc(anon(), 'biometric_face_references', 'MUSR-SELF-A')));
  });

  it('an inactive/suspended actor cannot read any reference, including their own — DENY', async () => {
    // Seed an inactive user's own reference to isolate "inactive" from "not self".
    await env.withSecurityRulesDisabled(async (rulesCtx) => {
      await setDoc(
        doc(rulesCtx.firestore(), 'biometric_face_references', 'MUSR-INACTIVE-A'),
        validPayload({ id: 'MUSR-INACTIVE-A', userId: 'MUSR-INACTIVE-A', enrolledBy: 'MUSR-INACTIVE-A', createdBy: 'MUSR-INACTIVE-A', updatedBy: 'MUSR-INACTIVE-A' }),
      );
    });
    await assertFails(getDoc(doc(ctx('MUSR-INACTIVE-A'), 'biometric_face_references', 'MUSR-INACTIVE-A')));
  });

  it('generic-fallback regression anchor: an active, same-company, but role-unauthorized actor cannot read via the SDK — proves biometric_face_references does not fall through to the company-scoped generic fallback', async () => {
    // Sales (MUSR-SELF-A) reading a DIFFERENT employee's reference in their
    // OWN company — canReadCompanyScoped() alone (the generic fallback's
    // grant) would ALLOW this if isSpecialCollection() had not been updated
    // to exclude this collection. The dedicated block's self-scope-only
    // design correctly denies it.
    await assertFails(getDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-VICTIM-A')));
  });
});

describe('biometric_face_references — UPDATE (re-enrollment)', () => {
  it('self can re-enroll (replace embedding + model metadata) — ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        embedding: [0.9, 0.8, 0.7],
        embeddingModel: 'mock-model-v2',
        embeddingModelVersion: 'mock-v2',
        reEnrollmentCount: 1,
        updatedBy: 'MUSR-SELF-A',
      }),
    );
  });

  it('Admin (own company) can re-enroll on an employee\'s behalf — ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        embedding: [0.5, 0.5],
        reEnrollmentCount: 1,
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
  });

  it('GroupAdmin can re-enroll a sibling company\'s employee within their own Group — ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('MUSR-GA-A'), 'biometric_face_references', 'MUSR-SELF-C'), {
        embedding: [0.4, 0.4],
        reEnrollmentCount: 1,
        updatedBy: 'MUSR-GA-A',
      }),
    );
  });

  it('unauthorized update denial: an employee cannot update ANOTHER employee\'s reference — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        embedding: [1, 1],
        updatedBy: 'MUSR-SELF-A',
      }),
    );
  });

  it('unauthorized update denial: an unrelated-company Admin cannot update this company\'s reference — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-HR-B'), 'biometric_face_references', 'MUSR-SELF-A'), {
        embedding: [1, 1],
        updatedBy: 'MUSR-HR-B',
      }),
    );
  });

  it('updatedBy forgery: claiming a different acting identity on update — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        embedding: [1, 1],
        updatedBy: 'MUSR-VICTIM-A',
      }),
    );
  });

  it('immutable-field modification denial: userId cannot be changed, even by Admin — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        userId: 'MUSR-SELF-A',
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
  });

  it('immutable-field modification denial: companyId cannot be changed, even by Super Admin — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-SUPER'), 'biometric_face_references', 'MUSR-SELF-A'), {
        companyId: COMPANY_C,
        updatedBy: 'MUSR-SUPER',
      }),
    );
  });

  it('immutable-field modification denial: groupId cannot be changed — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        groupId: 'GROUP-B',
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
  });

  it('immutable-field modification denial: enrolledAt/enrolledBy cannot be changed on re-enrollment — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        enrolledBy: 'MUSR-ADMIN-A',
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
    await assertFails(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        enrolledAt: new Date().toISOString(),
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
  });

  it('immutable-field modification denial: schemaVersion cannot be changed — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        schemaVersion: 2,
        updatedBy: 'MUSR-ADMIN-A',
      }),
    );
  });

  it('self can never revoke/un-revoke themselves via a re-enrollment write — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        status: 'revoked',
        updatedBy: 'MUSR-SELF-A',
      }),
    );
    await assertFails(
      updateDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        revokedAt: new Date().toISOString(),
        revokedBy: 'MUSR-SELF-A',
        updatedBy: 'MUSR-SELF-A',
      }),
    );
  });

  it('Admin/HR CAN revoke an employee\'s reference — ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('MUSR-HR-A'), 'biometric_face_references', 'MUSR-VICTIM-A'), {
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: 'MUSR-HR-A',
        updatedBy: 'MUSR-HR-A',
      }),
    );
  });

  it('GroupAdmin CAN revoke a sibling company\'s reference within their own Group — ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('MUSR-GA-A'), 'biometric_face_references', 'MUSR-SELF-C'), {
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: 'MUSR-GA-A',
        updatedBy: 'MUSR-GA-A',
      }),
    );
  });

  it('an inactive/suspended actor cannot update any reference — DENY', async () => {
    await assertFails(
      updateDoc(doc(ctx('MUSR-INACTIVE-A'), 'biometric_face_references', 'MUSR-SELF-A'), {
        embedding: [1, 1],
        updatedBy: 'MUSR-INACTIVE-A',
      }),
    );
  });

  it('unauthenticated update is denied — DENY', async () => {
    await assertFails(updateDoc(doc(anon(), 'biometric_face_references', 'MUSR-SELF-A'), { embedding: [1, 1] }));
  });
});

describe('biometric_face_references — DELETE', () => {
  it('delete is always denied, for every actor, matching this collection\'s soft-revoke-only retention policy', async () => {
    await assertFails(deleteDoc(doc(ctx('MUSR-ADMIN-A'), 'biometric_face_references', 'MUSR-SELF-A')));
    await assertFails(deleteDoc(doc(ctx('MUSR-SUPER'), 'biometric_face_references', 'MUSR-SELF-A')));
    await assertFails(deleteDoc(doc(ctx('MUSR-SELF-A'), 'biometric_face_references', 'MUSR-SELF-A')));
  });
});
