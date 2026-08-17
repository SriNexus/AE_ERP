/**
 * UAT MASTER-IDENTITY RULES PROBE — the real production user shape.
 *
 * The canonical login resolver (authIdentity.resolveAuthenticatedErpUser)
 * maps a Firebase Auth UID to the ERP users doc via user_auth_maps/{uid}.
 * For real accounts the ERP doc is the master identity
 * users/MUSR-{companyId}-{phone} and map.userId != auth.uid — the shape the
 * previous rules anchor (`map.userId == request.auth.uid`, currentUser() =
 * users/{auth.uid}) silently denied everywhere (Admin settings/aggregation
 * 403 storm with a fully-correct tenant context).
 *
 * This probe recreates that EXACT production shape in a throwaway UAT
 * company and proves the fixed rules now authorize the operations a real
 * Admin performs: own profile read, self-update, same-company user
 * management, settings create/read/update (company + personal appearance),
 * and still DENY super-admin grants and cross-company access.
 *
 * SAFETY: non-destructive. All created auth users + docs are deleted on
 * exit. No real business data is touched. No secrets are printed.
 *
 * Usage: node scripts/uat-master-identity-probe.cjs
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

const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const auth = getAuth(app);
const db = getFirestore(app);

const CO = 'uat-co-master';
const PASSWORD = 'Uat-Master!2026-x9';
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const results = [];
let failures = 0;

function fval(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (v && typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fval(x)])) } };
  }
  return { nullValue: null };
}

async function req(method, urlPath, token, body, updateMask) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let url = `${REST}/${urlPath}`;
  if (updateMask) url += `?updateMask.fieldPaths=${updateMask}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.status;
}

async function signIn(email) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }
  );
  const j = await res.json();
  if (!res.ok) return { ok: false, code: j.error && j.error.message };
  return { ok: true, idToken: j.idToken };
}

function run(name, actual, expect, note) {
  const ok = String(actual) === String(expect);
  if (!ok) failures += 1;
  results.push({ name, actual, expect, ok, note });
  console.log(`${ok ? 'PASS' : '  >>'} ${name.padEnd(64)} actual=${actual} expect=${expect}${note ? '  [' + note + ']' : ''}`);
}

const createdAuthUids = [];
const createdDocs = [];

async function main() {
  // ── seed master-identity company + users (exact production shape) ──
  await db.collection('companies').doc(CO).set({ id: CO, name: 'UAT Master Co', shortName: 'UAT-M', active: true });
  createdDocs.push(`companies/${CO}`);

  const adminRec = await auth.createUser({ email: 'uat.master.admin@test.local', password: PASSWORD, displayName: 'Master Admin', emailVerified: true });
  const userRec = await auth.createUser({ email: 'uat.master.user@test.local', password: PASSWORD, displayName: 'Master User', emailVerified: true });
  const coBRec = await auth.createUser({ email: 'uat.master.cob@test.local', password: PASSWORD, displayName: 'Master CO-B', emailVerified: true });
  createdAuthUids.push(adminRec.uid, userRec.uid, coBRec.uid);

  const adminId = `MUSR-${CO}-9000000001`;
  const userId = `MUSR-${CO}-9000000002`;
  const coBId = `MUSR-uat-co-master-b-9000000003`;
  const now = new Date().toISOString();

  const mkUser = (id, email, role, companyId, status) => ({
    id, userId: id, phone: id.slice(-10), companyId, name: email, email, role,
    status, isSuperAdmin: false, isManager: false, department: 'Management',
    createdAt: now, updatedAt: now, isDeleted: false,
  });
  await db.collection('users').doc(adminId).set(mkUser(adminId, 'uat.master.admin@test.local', 'Admin', CO, 'Active'));
  await db.collection('users').doc(userId).set(mkUser(userId, 'uat.master.user@test.local', 'Sales', CO, 'Active'));
  await db.collection('companies').doc('uat-co-master-b').set({ id: 'uat-co-master-b', name: 'UAT Master Co B', shortName: 'UAT-MB', active: true });
  createdDocs.push('companies/uat-co-master-b');
  await db.collection('users').doc(coBId).set(mkUser(coBId, 'uat.master.cob@test.local', 'Sales', 'uat-co-master-b', 'Active'));
  createdDocs.push(`users/${adminId}`, `users/${userId}`, `users/${coBId}`);

  // mapping userId = MUSR id (NOT auth uid) — the master-identity anchor
  const mkMap = (uid, userIdValue, email) => ({ authUid: uid, userId: userIdValue, companyId: CO, email, createdAt: now, updatedAt: now });
  await db.collection('user_auth_maps').doc(adminRec.uid).set(mkMap(adminRec.uid, adminId, 'uat.master.admin@test.local'));
  await db.collection('user_auth_maps').doc(userRec.uid).set(mkMap(userRec.uid, userId, 'uat.master.user@test.local'));
  await db.collection('user_auth_maps').doc(coBRec.uid).set(mkMap(coBRec.uid, coBId, 'uat.master.cob@test.local'));
  createdDocs.push(`user_auth_maps/${adminRec.uid}`, `user_auth_maps/${userRec.uid}`, `user_auth_maps/${coBRec.uid}`);

  const adminSignIn = await signIn('uat.master.admin@test.local');
  const userSignIn = await signIn('uat.master.user@test.local');
  if (!adminSignIn.ok || !userSignIn.ok) {
    console.error('FATAL: could not sign in seeded master users', adminSignIn.code, userSignIn.code);
    process.exit(2);
  }
  const T = adminSignIn.idToken;
  const TU = userSignIn.idToken;

  console.log(`\n=== MASTER-IDENTITY RULES PROBE (map.userId=${adminId} != uid=${adminRec.uid}) ===\n`);

  // ── own identity reads ──
  await run('M1 own ERP profile read (users/MUSR-*)', await req('GET', `users/${adminId}`, T), '200');
  await run('M2 own auth-map get', await req('GET', `user_auth_maps/${adminRec.uid}`, T), '200');

  // ── settings: the exact browser-failing paths ──
  // Clean slate: earlier runs may have left these deterministically-keyed docs
  // (they are created via the REST API and must be tracked for cleanup below).
  const settingsDocIds = [`${CO}_settings_general`, `${adminId}_settings_appearance`, `uat-co-master-b_settings_general`];
  for (const id of settingsDocIds) { try { await db.doc(`settings/${id}`).delete(); } catch {} }
  await run('M3 company settings get (missing doc -> 404 not 403)', await req('GET', `settings/${CO}_settings_general`, T), '404', 'missing doc read must not deny');
  await run('M4 company settings create (general)', await req('POST', `settings?documentId=${CO}_settings_general`, T, { fields: { companyId: fval(CO), section: fval('general'), data: fval({ testKey: 'v1' }), updatedBy: fval(adminId), updatedAt: fval(now), isDeleted: fval(false) } }), '200');
  await run('M5 company settings get (exists)', await req('GET', `settings/${CO}_settings_general`, T), '200');
  await run('M6 company settings update', await req('PATCH', `settings/${CO}_settings_general`, T, { fields: { updatedAt: fval(now) } }, 'updatedAt'), '200');
  await run('M7 personal appearance create (MUSR-keyed)', await req('POST', `settings?documentId=${adminId}_settings_appearance`, T, { fields: { companyId: fval(CO), section: fval('appearance'), data: fval({ selectedTheme: 'classic' }), updatedBy: fval(adminId), updatedAt: fval(now), isDeleted: fval(false) } }), '200', 'isOwnPersonalSettings path');
  await run('M8 personal appearance read', await req('GET', `settings/${adminId}_settings_appearance`, T), '200');
  await run('M9 personal appearance update', await req('PATCH', `settings/${adminId}_settings_appearance`, T, { fields: { updatedAt: fval(now) } }, 'updatedAt'), '200');
  createdDocs.push(...settingsDocIds.map((id) => `settings/${id}`));

  // ── user management (the /users page core) ──
  await run('M10 self profile update (name)', await req('PATCH', `users/${adminId}`, T, { fields: { name: fval('Master Admin Renamed'), updatedAt: fval(now), updatedBy: fval(adminId) } }, 'name'), '200', 'self branch via map.userId');
  await run('M11 admin updates same-company user (status)', await req('PATCH', `users/${userId}`, T, { fields: { status: fval('Active'), updatedAt: fval(now), updatedBy: fval(adminId) } }, 'status'), '200', 'admin branch via map.userId');
  await run('M12 admin updates same-company user (role)', await req('PATCH', `users/${userId}`, T, { fields: { role: fval('Operations'), updatedAt: fval(now), updatedBy: fval(adminId) } }, 'role'), '200');
  await run('M13 admin grants isSuperAdmin DENIED', await req('PATCH', `users/${userId}`, T, { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin'), '403', 'grant guard intact');
  await run('M14 non-admin cannot create user', await req('POST', `users?documentId=uat-master-hack`, TU, { fields: { email: fval('hack@test.local'), role: fval('Sales'), companyId: fval(CO), status: fval('Active'), isSuperAdmin: fval(false) } }), '403');

  // ── tenant isolation from a master-identity user ──
  await run('M15 cross-company user read DENIED', await req('GET', `users/${coBId}`, T), '403', 'company B doc');
  await db.collection('settings').doc(`uat-co-master-b_settings_general`).set({ companyId: 'uat-co-master-b', section: 'general', data: { x: 'y' }, updatedBy: coBId, updatedAt: now, isDeleted: false });
  createdDocs.push('settings/uat-co-master-b_settings_general');
  await run('M16 cross-company settings read DENIED (existing doc)', await req('GET', 'settings/uat-co-master-b_settings_general', TU), '403', 'company B settings doc from company A user');

  // ── demo-shape regression: master user in a non-admin role reads own data ──
  await run('M17 same-company customer read as Sales master user', await (async () => {
    await db.collection('customers').doc('uat-master-cust-1').set({ companyId: CO, name: 'Master Cust', isDeleted: false });
    createdDocs.push('customers/uat-master-cust-1');
    return req('GET', 'customers/uat-master-cust-1', TU);
  })(), '200');

  // cleanup
  for (const uid of createdAuthUids) { try { await auth.deleteUser(uid); } catch {} }
  for (const p of createdDocs) { try { await db.doc(p).delete(); } catch {} }

  const passed = results.length - failures;
  console.log(`\nMASTER-IDENTITY PROBE: ${passed}/${results.length} PASS${failures ? ` — ${failures} FAILURES` : ' — ALL PASS'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('PROBE ERROR:', err.message);
  process.exit(2);
});
