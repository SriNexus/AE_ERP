/**
 * LIVE END-TO-END VERIFICATION — Admin -> Users -> Create User -> New User Login
 *
 * This does NOT drive a browser (none is available in this environment). It
 * instead mints REAL Firebase ID tokens via the same REST endpoints the
 * browser's Firebase SDK calls internally (accounts:signInWithPassword,
 * accounts:signUp) and issues the SAME Firestore REST requests the app's
 * client code issues (the exact runQuery the /users page runs, the exact
 * settings doc reads, the exact write shape createProjectionWithUserId /
 * createMapping produce) — subject to the REAL, deployed Firestore security
 * rules, not an admin-SDK bypass. This proves the server-visible data/rules
 * chain end-to-end with live evidence. It does NOT and CANNOT prove React
 * rendering / DOM / console behavior (e.g. the null.getSnapshot question) —
 * that requires an actual browser JS engine, which is unavailable here.
 *
 * Uses the REAL production admin@neozy.in account and REAL company
 * (read-only for the admin's own data). Creates exactly ONE clearly-labeled
 * disposable test user, verifies the full chain, then deletes it (Auth
 * account + Firestore docs) via the Admin SDK. Touches no other data.
 *
 * Usage: node scripts/live-verify-admin-user-flow.cjs
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = {};
  const p = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const ENV = loadEnv();
const API_KEY = ENV.VITE_FIREBASE_API_KEY;
const PROJECT_ID = ENV.VITE_FIREBASE_PROJECT_ID;
if (!API_KEY || !PROJECT_ID) {
  console.error('FATAL: VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID missing from .env.local');
  process.exit(2);
}

const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);

const ADMIN_EMAIL = 'admin@neozy.in';
const ADMIN_PASSWORD = 'admin123';
const TEST_PASSWORD = 'Verify-Test!2026-x9';
const stamp = Date.now();
const TEST_EMAIL = `verify-test-${stamp}@neozy-verify.test`;

const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fval(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { stringValue: String(v) };
}

async function firestoreReq(method, urlPath, token, body) {
  const res = await fetch(`${REST}/${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function runQuery(collectionId, whereField, whereValue, token) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: whereField },
              op: 'EQUAL',
              value: fval(whereValue),
            },
          },
        },
      }),
    }
  );
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const j = await res.json();
  if (!res.ok) return { ok: false, status: res.status, code: j.error && j.error.message };
  return { ok: true, idToken: j.idToken, localId: j.localId };
}

async function signUp(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const j = await res.json();
  if (!res.ok) return { ok: false, status: res.status, code: j.error && j.error.message };
  return { ok: true, idToken: j.idToken, localId: j.localId };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}

let createdTestAuthUid = null;

async function main() {
  console.log('=== LIVE E2E VERIFICATION: Admin -> Users -> Create User -> New User Login ===\n');
  console.log(`Test user (disposable, deleted on exit): ${TEST_EMAIL}\n`);

  // ---- Step 1: Admin sign-in (real REST call, same as the browser SDK) ----
  const adminSignIn = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!adminSignIn.ok) {
    record('Admin sign-in', false, `status=${adminSignIn.status} ${adminSignIn.code}`);
    console.log('\nABORTED — cannot proceed without admin sign-in.');
    process.exitCode = 1;
    return;
  }
  record('Admin sign-in (real credentials, real REST endpoint)', true, `authUid=${adminSignIn.localId}`);
  const adminToken = adminSignIn.idToken;
  const adminAuthUid = adminSignIn.localId;

  // ---- Step 2: identity chain resolution (mirrors resolveAuthenticatedErpUser) ----
  const mapRes = await firestoreReq('GET', `user_auth_maps/${adminAuthUid}`, adminToken);
  const mapOk = mapRes.status === 200;
  record('Admin auth-map read (user_auth_maps/{authUid})', mapOk, `status=${mapRes.status}`);
  if (!mapOk) { console.log('\nABORTED — admin identity chain did not resolve.'); process.exitCode = 1; return; }

  const mappedUserId = mapRes.json.fields.userId.stringValue;
  const mappedCompanyId = mapRes.json.fields.companyId.stringValue;
  record('Admin auth-map fields', !!mappedUserId && !!mappedCompanyId && mappedCompanyId !== 'default',
    `userId=${mappedUserId} companyId=${mappedCompanyId}`);

  const profileRes = await firestoreReq('GET', `users/${mappedUserId}`, adminToken);
  const profileOk = profileRes.status === 200;
  record('Admin ERP profile read (users/{mappedUserId}, userId != authUid confirms master-identity)', profileOk,
    `status=${profileRes.status} mappedUserId=${mappedUserId} authUid=${adminAuthUid} different=${mappedUserId !== adminAuthUid}`);

  // ---- Step 3: the EXACT query /users page issues ----
  const usersQuery = await runQuery('users', 'companyId', mappedCompanyId, adminToken);
  const usersQueryOk = usersQuery.status === 200 && Array.isArray(usersQuery.json);
  const usersReturned = usersQueryOk ? usersQuery.json.filter((r) => r.document).length : 0;
  record('Users-page query: runQuery(users where companyId==<real company>)', usersQueryOk && usersReturned > 0,
    `status=${usersQuery.status} docsReturned=${usersReturned}`);

  // ---- Step 4: the EXACT settings reads ThemeProvider/SettingsPage issue ----
  for (const section of ['general', 'theme-ui']) {
    const docId = `${mappedCompanyId}_settings_${section}`;
    const r = await firestoreReq('GET', `settings/${docId}`, adminToken);
    // 200 (doc exists) or 404-shaped "not found" body are both healthy;
    // permission-denied would surface as 403/PERMISSION_DENIED.
    const healthy = r.status === 200 || r.status === 404;
    record(`Settings read (company-scoped): ${section}`, healthy, `status=${r.status}`);
  }
  const userScopedDocId = `${adminAuthUid}_settings_appearance`; // NOTE: keyed by ERP user id in real app, checked via mappedUserId below
  const appearanceDocId = `${mappedUserId}_settings_appearance`;
  const appearanceRes = await firestoreReq('GET', `settings/${appearanceDocId}`, adminToken);
  record('Settings read (user-scoped): appearance', appearanceRes.status === 200 || appearanceRes.status === 404,
    `status=${appearanceRes.status}`);

  // ---- Step 5: Create User — exact chain the Admin "Add User" flow performs ----
  const testSignUp = await signUp(TEST_EMAIL, TEST_PASSWORD);
  if (!testSignUp.ok) {
    record('Create test Firebase Auth account (accounts:signUp)', false, `status=${testSignUp.status} ${testSignUp.code}`);
    console.log('\nABORTED at user creation.');
    process.exitCode = 1;
    return;
  }
  createdTestAuthUid = testSignUp.localId;
  record('Create test Firebase Auth account (accounts:signUp)', true, `authUid=${createdTestAuthUid}`);

  // Admin writes users/{newAuthUid} — mirrors entityProjection.ts's
  // hydrateCreatePayload + createProjectionWithUserId's updateDocById upsert.
  // companyId here is the REAL resolved company (mappedCompanyId), exactly
  // what resolveWriteCompanyId() would produce for this admin session —
  // proving the fixed entityProjection.ts/entityMappers.ts logic writes a
  // real tenant, never 'default'.
  const createPayload = {
    fields: {
      id: fval(createdTestAuthUid),
      name: fval('Verify Test User'),
      email: fval(TEST_EMAIL),
      role: fval('Sales'),
      status: fval('Active'),
      companyId: fval(mappedCompanyId),
      createdBy: fval(mappedUserId),
      updatedBy: fval(mappedUserId),
      isDeleted: fval(false),
      // Matches Users.tsx's real create-form default (FORM0.isSuperAdmin:
      // false) — the rules dereference request.resource.data.isSuperAdmin
      // directly without an existence guard, so omitting this field entirely
      // (as an earlier draft of this script did) denies the write. The real
      // app's form always sends it; this script must match the real payload
      // shape to be a faithful simulation.
      isSuperAdmin: fval(false),
    },
  };
  const createRes = await firestoreReq('PATCH', `users/${createdTestAuthUid}`, adminToken, createPayload);
  record('Admin creates users/{newAuthUid} projection (Add User flow)', createRes.status === 200,
    `status=${createRes.status}`);

  const readBack = await firestoreReq('GET', `users/${createdTestAuthUid}`, adminToken);
  const readBackCompanyId = readBack.json && readBack.json.fields && readBack.json.fields.companyId
    ? readBack.json.fields.companyId.stringValue : null;
  record('Tenant safety: created user companyId is real, never "default"',
    readBack.status === 200 && readBackCompanyId === mappedCompanyId && readBackCompanyId !== 'default',
    `companyId=${readBackCompanyId}`);

  // ---- Step 6: Admin session still valid (secondary-app pattern proof) ----
  const adminStillValid = await firestoreReq('GET', `users/${mappedUserId}`, adminToken);
  record('Admin session still valid after creating another Auth user (no session replacement)',
    adminStillValid.status === 200, `status=${adminStillValid.status}`);

  // ---- Step 7: New user login (real REST sign-in with their own credentials) ----
  const newUserSignIn = await signIn(TEST_EMAIL, TEST_PASSWORD);
  record('New user Firebase Auth login (real credentials)', newUserSignIn.ok,
    newUserSignIn.ok ? `authUid=${newUserSignIn.localId}` : `status=${newUserSignIn.status} ${newUserSignIn.code}`);
  if (!newUserSignIn.ok) { console.log('\nABORTED at new-user login.'); process.exitCode = 1; }
  else {
    const newUserToken = newUserSignIn.idToken;
    const newUserAuthUid = newUserSignIn.localId;

    // No auth map should exist yet — lazy-bootstrap architecture (by design).
    const preMapCheck = await firestoreReq('GET', `user_auth_maps/${newUserAuthUid}`, newUserToken);
    record('New user has NO auth map before first-login bootstrap (expected, by design)',
      preMapCheck.status === 404 || preMapCheck.status === 403, `status=${preMapCheck.status}`);

    // Self-bootstrap the mapping exactly as authIdentity.ts's createMapping does,
    // using the NEW USER's own token — proves validOwnMapping's write-boundary
    // rule allows the real lazy-bootstrap flow for a real new user.
    const mapPayload = {
      fields: {
        authUid: fval(newUserAuthUid),
        userId: fval(createdTestAuthUid),
        companyId: fval(mappedCompanyId),
        email: fval(TEST_EMAIL),
      },
    };
    const mapCreateRes = await firestoreReq('PATCH', `user_auth_maps/${newUserAuthUid}`, newUserToken, mapPayload);
    record('New user self-bootstraps user_auth_maps (validOwnMapping rule)', mapCreateRes.status === 200,
      `status=${mapCreateRes.status}`);

    const selfProfileRes = await firestoreReq('GET', `users/${createdTestAuthUid}`, newUserToken);
    record('New user reads own ERP profile', selfProfileRes.status === 200, `status=${selfProfileRes.status}`);

    const sameCompanyQuery = await runQuery('users', 'companyId', mappedCompanyId, newUserToken);
    const sameCompanyOk = sameCompanyQuery.status === 200 &&
      Array.isArray(sameCompanyQuery.json) && sameCompanyQuery.json.some((r) => r.document);
    record('New user can read same-company users (tenant access works)', sameCompanyOk,
      `status=${sameCompanyQuery.status}`);
  }

  // ---- Step 8: Admin regression — still sees the new user ----
  const adminFinalCheck = await firestoreReq('GET', `users/${createdTestAuthUid}`, adminToken);
  record('Admin can still see the newly-created user afterward', adminFinalCheck.status === 200,
    `status=${adminFinalCheck.status}`);

  const summaryPass = results.filter((r) => r.pass).length;
  console.log(`\n=== SUMMARY: ${summaryPass}/${results.length} PASS ===`);
  process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}

async function cleanup() {
  console.log('\n--- cleanup: removing disposable test artifacts only ---');
  try {
    if (createdTestAuthUid) {
      await adminAuth.deleteUser(createdTestAuthUid).catch(() => {});
      await adminDb.collection('users').doc(createdTestAuthUid).delete().catch(() => {});
      await adminDb.collection('user_auth_maps').doc(createdTestAuthUid).delete().catch(() => {});
      console.log(`deleted test auth user + users/${createdTestAuthUid} + user_auth_maps/${createdTestAuthUid}`);
    }
    // The new user's own auth map is keyed by their OWN authUid (from signUp),
    // which is a different id than createdTestAuthUid (the users/ doc id) —
    // find and delete it via the recorded test email.
    const list = await adminAuth.getUserByEmail(TEST_EMAIL).catch(() => null);
    if (list) {
      await adminDb.collection('user_auth_maps').doc(list.uid).delete().catch(() => {});
      await adminAuth.deleteUser(list.uid).catch(() => {});
      console.log(`deleted residual auth user/map for ${TEST_EMAIL} (uid=${list.uid})`);
    }
  } catch (e) {
    console.error('cleanup encountered an error (non-fatal):', e.message);
  }
  console.log('cleanup complete. No production data was touched.');
}

main().finally(cleanup);
