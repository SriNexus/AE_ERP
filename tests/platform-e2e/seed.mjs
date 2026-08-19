// Phase 8 (Master Plan §17.3) — throwaway seed script for the LOCAL Firebase
// emulator suite only, mirroring tests/customer-workspace-e2e/seed.mjs's
// pattern exactly. Never run this against a real project: firebase-admin's
// Application Default credential path auto-routes to the emulator when
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set (see
// run-emulator-tests.mjs).
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('REFUSING TO SEED: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST not set. This script must only run against the local emulator.');
  process.exit(1);
}

// MUST match VITE_FIREBASE_PROJECT_ID in .env.emulator.local — the Firestore/
// Auth emulators are project-namespaced, and the app (started with
// `--mode emulator`, reusing that same env file) connects under this exact
// project id. A mismatch here means the app's client SDK and this seed
// script silently write to two different, mutually invisible namespaces on
// the same emulator instance (a real footgun this project has already hit
// once, in storage.rules cross-service testing — see
// vitest.emulator.storage.config.ts).
const PROJECT_ID = 'demo-neozy-local';
const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);

// The Super Admin identity is purely Auth-email-based client-side
// (isOwnerFirebaseUser() in src/lib/ownerAccess.ts) — the app synthesizes
// the Owner's ERP identity at login time (Login.tsx -> createOwnerAppIdentity()),
// no Firestore users/user_auth_maps doc required for this actor.
export const SEED = {
  ownerUid: 'OWNER-E2E-1',
  ownerEmail: 'shreeniwas.tripathi0@gmail.com',
  ownerPassword: 'TestOwnerPass123!',
};

async function seed() {
  try { await auth.deleteUser(SEED.ownerUid); } catch { /* did not exist */ }
  await auth.createUser({
    uid: SEED.ownerUid,
    email: SEED.ownerEmail,
    password: SEED.ownerPassword,
    emailVerified: true,
  });
  console.log('[seed] Super Admin (owner) auth user ready:', SEED.ownerEmail);
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error('SEED_FAILED:', err);
  process.exit(1);
});
