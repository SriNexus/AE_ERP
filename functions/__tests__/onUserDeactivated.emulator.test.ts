/**
 * Face Attendance + DeepFace Master Plan — real Cloud Function runtime
 * verification, resolving Phase 9's own documented limitation.
 *
 * Phase 9 recorded: "neither firebase-functions nor firebase-admin is
 * installed anywhere in this repository... functions/index.js itself
 * cannot be require()d/executed in this environment at all... only its
 * extracted pure decision logic (biometricRevocation.js) was verified."
 * Phase 11 installed both packages (real, narrow peer-dependency fix:
 * `functions/package.json`'s `firebase-functions` bumped ^6.3.2 -> ^7.3.2,
 * whose peer range covers the already-declared `firebase-admin@^14.1.0`).
 *
 * IMPORTANT, evidence-based pivot from the first attempt at this test:
 * a `vi.mock()`-based approach (mocking `firebase-admin/app|auth|firestore`
 * and dynamically `import()`-ing the real `functions/index.js`, a
 * CommonJS `require()`-based file) was tried first and abandoned after
 * discovering, empirically, via a debug probe, that Vitest 4.1.10 does
 * NOT intercept `require()` calls made from inside a CJS module that is
 * itself loaded via dynamic `import()` — the mock factories silently
 * never ran. Worse: because this machine has real Google Application
 * Default Credentials configured (`gcloud auth application-default
 * login`, project `ae-erp-d933d`), the "mocked" test was silently issuing
 * REAL read queries against that REAL Firebase project. No write would
 * have occurred (the synthetic test doc ID `user-1` almost certainly does
 * not exist there, and the code only ever writes when an existing ACTIVE
 * reference is read back), but this was a genuine near-miss, not a
 * fabricated concern — recorded here so it is never silently repeated.
 *
 * The safe, genuinely real-runtime alternative (this file): run the
 * REAL `functions/index.js` (real `firebase-functions` v2 trigger
 * machinery, real `firebase-admin` SDK, zero mocking) against the
 * Firestore + Auth EMULATORS, the same `firebase emulators:exec` pattern
 * this repo already established for `npm run test:rules`, extended to
 * also start the `auth` emulator (needed for `revokeRefreshTokens`) and
 * pointed at a throwaway `--project neozy-functions-emulator-test` id —
 * never the real project. Run via `npm run test:functions:emulator`
 * (see vitest.functions.emulator.config.ts). This is MORE faithful to
 * "verify the actual Firestore read/update behavior" than a mocked unit
 * test would have been: real Admin SDK reads/writes, real Auth-emulator
 * token revocation (verified via the user's own `tokensValidAfterTime`,
 * not a spy), against a real (local, disposable) emulator instance.
 *
 * What this STILL does not and cannot prove (recorded honestly): that
 * this code behaves correctly when actually DEPLOYED to a real Firebase
 * project's Cloud Functions runtime, under real IAM and network
 * conditions — that requires a real deployment this environment has no
 * credentials or authorization to perform.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let db: Firestore;
let auth: Auth;
let onUserDeactivated: any;

beforeAll(async () => {
  // functions/index.js calls initializeApp() (no args) at its own
  // module-load time; `firebase emulators:exec` has already set
  // FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST / GCLOUD_PROJECT
  // in this process's env before Vitest even started, so that default app
  // is created pointed at the local emulators, never real GCP.
  expect(process.env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST must be set by firebase emulators:exec').toBeTruthy();
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'FIREBASE_AUTH_EMULATOR_HOST must be set by firebase emulators:exec').toBeTruthy();

  ({ onUserDeactivated } = await import('../index.js'));
  db = getFirestore();
  auth = getAuth();
});

function buildEvent(userId: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  return {
    params: { userId },
    data: {
      before: { data: () => before },
      after: { data: () => after },
    },
  };
}

async function seedAuthMap(authUid: string, userId: string) {
  await db.collection('user_auth_maps').doc(authUid).set({ userId });
}

async function seedEmulatorAuthUser(uid: string) {
  try {
    await auth.createUser({ uid, email: `${uid}@example.test` });
  } catch (error: any) {
    if (error?.code !== 'auth/uid-already-exists') throw error;
  }
}

async function seedBiometricReference(userId: string, data: Record<string, unknown>) {
  await db.collection('biometric_face_references').doc(userId).set({
    id: userId, userId, companyId: 'company-1', status: 'active', ...data,
  });
}

describe('onUserDeactivated — real firebase-functions v2 + real functions/index.js, real Firestore/Auth EMULATORS (no mocking)', () => {
  it('a genuine deactivation transition revokes refresh tokens for the mapped auth uid AND revokes the active biometric reference', async () => {
    const authUid = 'emu-auth-1';
    const userId = 'emu-user-1';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    await seedBiometricReference(userId, {});

    const before = await auth.getUser(authUid);
    const revokeCallTime = Date.now();

    const event = buildEvent(userId, { status: 'Active' }, { status: 'Inactive', updatedBy: 'admin-42' });
    await onUserDeactivated.run(event);

    const after = await auth.getUser(authUid);
    // revokeRefreshTokens() stamps tokensValidAfterTime to "now" — proof the
    // real Admin SDK call actually reached the real (emulated) Auth backend,
    // not a spy assertion.
    expect(after.tokensValidAfterTime).toBeTruthy();
    expect(new Date(after.tokensValidAfterTime as string).getTime()).toBeGreaterThanOrEqual(revokeCallTime - 5000);
    expect(after.tokensValidAfterTime).not.toBe(before.tokensValidAfterTime);

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.data()).toMatchObject({ status: 'revoked', revokedBy: 'admin-42' });
    expect(bioDoc.data()?.revokedAt).toBeTruthy();
    expect(Object.keys(bioDoc.data() ?? {}).sort()).toEqual(
      ['companyId', 'id', 'revokedAt', 'revokedBy', 'status', 'userId'].sort(),
    );
  });

  it('a non-deactivation edit (active user, unrelated field change) never revokes tokens or touches the biometric reference', async () => {
    const authUid = 'emu-auth-2';
    const userId = 'emu-user-2';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    await seedBiometricReference(userId, {});

    const before = await auth.getUser(authUid);
    const event = buildEvent(userId, { status: 'Active', name: 'A' }, { status: 'Active', name: 'B' });
    await onUserDeactivated.run(event);

    const after = await auth.getUser(authUid);
    expect(after.tokensValidAfterTime).toBe(before.tokensValidAfterTime);

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.data()?.status).toBe('active');
  });

  it('a never-enrolled user (no biometric_face_references document) is a safe no-op for the revocation half — no error, no write attempted', async () => {
    const authUid = 'emu-auth-3';
    const userId = 'emu-user-3';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    // No seedBiometricReference call — the document does not exist.

    const event = buildEvent(userId, { status: 'Active' }, { status: 'Inactive', updatedBy: 'admin-42' });
    await expect(onUserDeactivated.run(event)).resolves.not.toThrow();

    const after = await auth.getUser(authUid);
    expect(after.tokensValidAfterTime).toBeTruthy(); // primary behavior still ran

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.exists).toBe(false); // nothing fabricated for a never-enrolled user
  });

  it('an already-revoked reference is left untouched (idempotent) — no duplicate/conflicting write on a redelivered or repeated event', async () => {
    const authUid = 'emu-auth-4';
    const userId = 'emu-user-4';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    await seedBiometricReference(userId, {
      status: 'revoked', revokedAt: '2026-01-01T00:00:00.000Z', revokedBy: 'admin-1',
    });

    const event = buildEvent(userId, { status: 'Active' }, { status: 'Inactive', updatedBy: 'admin-42' });
    await onUserDeactivated.run(event);

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    // Original revocation record is completely undisturbed — not overwritten
    // with a new revokedBy/revokedAt from this redelivered/repeat event.
    expect(bioDoc.data()).toMatchObject({ revokedAt: '2026-01-01T00:00:00.000Z', revokedBy: 'admin-1' });
  });

  it('revokedBy falls back to the honest system sentinel when the after-snapshot has no real updatedBy actor', async () => {
    const authUid = 'emu-auth-5';
    const userId = 'emu-user-5';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    await seedBiometricReference(userId, {});

    const event = buildEvent(userId, { status: 'Active' }, { status: 'Inactive' }); // no updatedBy field
    await onUserDeactivated.run(event);

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.data()?.revokedBy).toBe('system:onUserDeactivated');
  });

  it('a deactivation transition for a user with NO auth mapping still attempts the biometric revocation (the two side effects are independent)', async () => {
    const userId = 'emu-user-6';
    // No seedAuthMap call — no user_auth_maps entry exists for this user.
    await seedBiometricReference(userId, {});

    const event = buildEvent(userId, { status: 'Active' }, { status: 'Inactive', updatedBy: 'admin-42' });
    await expect(onUserDeactivated.run(event)).resolves.not.toThrow();

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.data()?.status).toBe('revoked'); // still revoked despite no auth mapping
  });

  it('an isDeleted:true transition (not just a status string change) also triggers both side effects', async () => {
    const authUid = 'emu-auth-7';
    const userId = 'emu-user-7';
    await seedEmulatorAuthUser(authUid);
    await seedAuthMap(authUid, userId);
    await seedBiometricReference(userId, {});

    const before = await auth.getUser(authUid);
    const event = buildEvent(userId, { status: 'Active', isDeleted: false }, { status: 'Active', isDeleted: true, updatedBy: 'admin-9' });
    await onUserDeactivated.run(event);

    const after = await auth.getUser(authUid);
    expect(after.tokensValidAfterTime).not.toBe(before.tokensValidAfterTime);

    const bioDoc = await db.collection('biometric_face_references').doc(userId).get();
    expect(bioDoc.data()?.status).toBe('revoked');
  });

  it('the exported function is a real, callable Cloud Functions v2 CloudFunction (registered via the real onDocumentUpdated trigger)', () => {
    expect(typeof onUserDeactivated).toBe('function');
    expect(typeof onUserDeactivated.run).toBe('function');
  });
});
