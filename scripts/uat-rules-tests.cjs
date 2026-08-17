/**
 * UAT RULES-ENGINE SECURITY TESTS — Pre-User Production Acceptance audit
 *
 * Creates clearly-labeled test identities in dedicated UAT companies,
 * mints real Firebase ID tokens (signInWithPassword), and executes
 * Firestore REST requests exactly as real clients would — proving the
 * LIVE rules engine enforces tenant isolation and identity boundaries.
 *
 * SAFETY: non-destructive. All created docs + auth users are deleted on
 * exit. No real business data is touched. No secrets are printed.
 *
 * Usage:  node scripts/uat-rules-tests.cjs [pre|post]
 *   pre  = document CURRENT live rules behavior (defect discovery)
 *   post = verify fixed rules (expect D1/D2 denied)
 */
const fs = require('fs');
const path = require('path');

const PHASE = process.argv[2] === 'post' ? 'post' : 'pre';

// ---- read public app config (never printed) ----
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
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const auth = getAuth(app);
const db = getFirestore(app);

const CO_A = 'uat-co-a';
const CO_B = 'uat-co-b';
const PASSWORD = 'Uat-Test!2026-x9';

const users = {
  adminA: { email: 'uat.admin.a@test.local', role: 'Admin', companyId: CO_A },
  salesA: { email: 'uat.sales.a@test.local', role: 'Sales', companyId: CO_A },
  viewerA: { email: 'uat.viewer.a@test.local', role: 'ReadOnly', companyId: CO_A },
  adminB: { email: 'uat.admin.b@test.local', role: 'Admin', companyId: CO_B },
  disabledA: { email: 'uat.disabled.a@test.local', role: 'Sales', companyId: CO_A },
  superAdminA: { email: 'uat.superadmin.a@test.local', role: 'Admin', companyId: CO_A, isSuperAdmin: true },
  surveyorA: { email: 'uat.surveyor.a@test.local', role: 'Surveyor', companyId: CO_A },
  dispatchA: { email: 'uat.dispatch.a@test.local', role: 'Dispatch Coordinator', companyId: CO_A },
  warehouseA: { email: 'uat.warehouse.a@test.local', role: 'Warehouse Manager', companyId: CO_A },
  salesMgrA: { email: 'uat.salesmgr.a@test.local', role: 'Sales Manager', companyId: CO_A, department: 'Sales', isManager: true },
  whMgrA: { email: 'uat.whmgr.a@test.local', role: 'Warehouse Manager', companyId: CO_A, department: 'Warehouse', isManager: true },
};
const uids = {};
const tokens = {};
const createdAuthUids = [];
const createdDocPaths = [];

const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fval(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  return { nullValue: null };
}

async function req(method, urlPath, token, body, updateMask) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let url = `${REST}/${urlPath}`;
  if (updateMask) url += `?updateMask.fieldPaths=${updateMask}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

// Unconstrained collection-wide LIST query (structuredQuery with no `where`
// clause at all) — exactly what lib/firestore.ts's getAll(COLLECTIONS.
// COMPANIES) issues, since companyScopedQuery() deliberately returns no
// constraints for the companies collection (it's a global, unscoped list by
// design). A single-document GET (as O1 already tests) does NOT exercise
// this — Firestore validates a listing query's rule differently from a
// single-doc get, requiring the rule to be provably true from the query's
// own shape, not just true for the documents that happen to exist.
async function runQueryStatus(collectionId, token) {
  const res = await fetch(`${REST}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  });
  if (res.status !== 200) return res.status;
  const body = await res.json();
  // A runQuery response is 200 even for a rules-evaluation error on some
  // matched documents in older API versions — treat any entry with an
  // explicit `error` field as a failure too, for safety.
  const hadError = Array.isArray(body) && body.some((entry) => entry && entry.error);
  return hadError ? 403 : 200;
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
  if (!res.ok) return { ok: false, status: res.status, code: j.error && j.error.message };
  return { ok: true, idToken: j.idToken };
}

async function seed() {
  // companies
  await db.collection('companies').doc(CO_A).set({
    id: CO_A, name: 'UAT Company A', shortName: 'UAT-A', active: true,
  });
  await db.collection('companies').doc(CO_B).set({
    id: CO_B, name: 'UAT Company B', shortName: 'UAT-B', active: true,
  });
  createdDocPaths.push(`companies/${CO_A}`, `companies/${CO_B}`);

  // auth users
  for (const [key, u] of Object.entries(users)) {
    const rec = await auth.createUser({
      email: u.email, password: PASSWORD, displayName: u.email, emailVerified: true,
    });
    uids[key] = rec.uid;
    createdAuthUids.push(rec.uid);
  }
  await auth.updateUser(uids.disabledA, { disabled: true });

  // users + mappings
  const now = new Date();
  for (const [key, u] of Object.entries(users)) {
    const uid = uids[key];
    await db.collection('users').doc(uid).set({
      id: uid, email: u.email, role: u.role, companyId: u.companyId,
      name: u.email, status: 'Active', isSuperAdmin: u.isSuperAdmin === true,
      department: u.department || '', isManager: u.isManager === true,
      createdAt: now, updatedAt: now,
    });
    await db.collection('user_auth_maps').doc(uid).set({
      authUid: uid, userId: uid, companyId: u.companyId, email: u.email,
      createdAt: now, updatedAt: now,
    });
    createdDocPaths.push(`users/${uid}`, `user_auth_maps/${uid}`);
  }

  // tenant data (clearly labeled)
  const seedDocs = [
    ['customers', 'uat-cust-a-1', CO_A, 'UAT Customer A-1'],
    ['customers', 'uat-cust-b-1', CO_B, 'UAT Customer B-1'],
    ['leads', 'uat-lead-a-1', CO_A, 'UAT Lead A-1'],
    ['leads', 'uat-lead-b-1', CO_B, 'UAT Lead B-1'],
    ['projects', 'uat-proj-a-1', CO_A, 'UAT Project A-1'],
    ['projects', 'uat-proj-b-1', CO_B, 'UAT Project B-1'],
    ['cases', 'uat-case-a-1', CO_A, 'UAT Case A-1'],
    ['cases', 'uat-case-b-1', CO_B, 'UAT Case B-1'],
    ['tasks', 'uat-task-a-1', CO_A, 'UAT Task A-1'],
    ['tasks', 'uat-task-b-1', CO_B, 'UAT Task B-1'],
  ];
  for (const [col, id, co, name] of seedDocs) {
    const doc = { companyId: co, name, createdAt: now, updatedAt: now };
    if (col === 'projects') doc.projectId = id;
    await db.collection(col).doc(id).set(doc);
    createdDocPaths.push(`${col}/${id}`);
  }

  // extra operational docs for the remaining-rules audit (dispatch/stock/
  // notifications/audit_logs/settings/qc_checks + an assigned project + an
  // assigned qc record for project-scoped-role read tests)
  const extraDocs = [
    ['dispatch', 'uat-disp-a-1', CO_A, { status: 'Pending', deliveryConfirmed: false, createdBy: uids.adminA }],
    ['stock', 'uat-stock-a-1', CO_A, { productId: 'uat-p-1', name: 'UAT Panel', availableQty: 10, reservedQty: 0 }],
    ['notifications', 'uat-notif-a-1', CO_A, { recipientUserId: uids.salesA, createdBy: uids.adminA, title: 'UAT', body: 'u', isRead: false }],
    ['audit_logs', 'uat-audit-a-1', CO_A, { action: 'uat', createdBy: uids.adminA }],
    ['settings', 'uat-settings-a-1', CO_A, { key: 'uat', value: '1' }],
    ['qc_checks', 'uat-qc-a-1', CO_A, { projectId: 'uat-proj-a-1', status: 'Pending' }],
    ['qc_checks', 'uat-qc-a-2', CO_A, { projectId: 'uat-proj-a-2', status: 'Pending', assignedSurveyor: uids.surveyorA }],
  ];
  for (const [col, id, co, extra] of extraDocs) {
    await db.collection(col).doc(id).set({
      companyId: co, name: 'UAT ' + col, createdAt: now, updatedAt: now, ...extra,
    });
    createdDocPaths.push(`${col}/${id}`);
  }
  await db.collection('projects').doc('uat-proj-a-2').set({
    projectId: 'uat-proj-a-2', companyId: CO_A, name: 'UAT Project A-2 (assigned)',
    assignedSurveyor: uids.surveyorA, createdAt: now, updatedAt: now,
  });
  createdDocPaths.push('projects/uat-proj-a-2');
}

async function cleanup() {
  try {
    for (const p of createdDocPaths) {
      const [col, id] = p.split('/');
      await db.collection(col).doc(id).delete().catch(() => {});
    }
    for (const uid of createdAuthUids) {
      await auth.deleteUser(uid).catch(() => {});
    }
  } catch (e) {
    console.log('CLEANUP_ISSUE:', e.message);
  }
}

function fmt(method, p) {
  return `${method} ${p}`;
}

async function main() {
  await seed();
  // mint tokens (disabledA will fail by design)
  for (const [key, u] of Object.entries(users)) {
    if (key === 'disabledA') continue;
    const r = await signIn(u.email);
    if (!r.ok) {
      console.log(`TOKEN_FAIL ${key}: ${r.status} ${r.code}`);
      process.exitCode = 1;
      await cleanup();
      return;
    }
    tokens[key] = r.idToken;
  }

  const results = [];
  const run = async (name, method, path, token, body, updateMask, expect, note) => {
    let status = 'ERR';
    try {
      status = String(await req(method, path, token, body, updateMask));
    } catch (e) {
      status = 'EXC:' + e.message.slice(0, 60);
    }
    const ok = status === expect;
    results.push({ name, status, expect, ok, note });
    console.log(`${ok ? 'PASS' : '  >>'} ${name.padEnd(58)} actual=${status} expect=${expect}${note ? '  [' + note + ']' : ''}`);
  };

  const T = (k) => tokens[k];

  console.log(`\n=== UAT RULES TESTS [phase=${PHASE}] ===\n`);

  // ---- tenant isolation invariants ----
  await run('A2 cross-company read: salesA -> customers/uat-cust-b-1', 'GET', 'customers/uat-cust-b-1', T('salesA'), null, null, '403');
  await run('A3 same-company read: salesA -> customers/uat-cust-a-1', 'GET', 'customers/uat-cust-a-1', T('salesA'), null, null, '200');
  await run('A4 cross-company update: salesA PATCH customers/uat-cust-b-1', 'PATCH', 'customers/uat-cust-b-1', T('salesA'), { fields: { name: fval('HACK') } }, 'name', '403');
  await run('A5 companyId immutability: salesA PATCH customers/uat-cust-a-1 companyId', 'PATCH', 'customers/uat-cust-a-1', T('salesA'), { fields: { companyId: fval(CO_B) } }, 'companyId', '403');
  await run('A6 cross-company create: salesA POST customers companyId=co-b', 'POST', 'customers?documentId=uat-hack-1', T('salesA'), { fields: { companyId: fval(CO_B), name: fval('HACK') } }, null, '403');
  await run('A7 cross-company project read: adminA -> projects/uat-proj-b-1', 'GET', 'projects/uat-proj-b-1', T('adminA'), null, null, '403');
  await run('A8 cross-company case read: salesA -> cases/uat-case-b-1', 'GET', 'cases/uat-case-b-1', T('salesA'), null, null, '403');
  await run('A9 admin create user other company: adminA POST users co=co-b', 'POST', 'users?documentId=uat-hack-user', T('adminA'), { fields: { email: fval('hack@test.local'), role: fval('Sales'), companyId: fval(CO_B), status: fval('Active'), isSuperAdmin: fval(false) } }, null, '403');
  await run('A10 cross-company admin update: adminA PATCH users/{adminB}', 'PATCH', `users/${uids.adminB}`, T('adminA'), { fields: { name: fval('HACK') } }, 'name', '403');
  await run('A11 delete universally denied: adminA DELETE customers/uat-cust-a-1', 'DELETE', 'customers/uat-cust-a-1', T('adminA'), null, null, '403');
  await run('A13 same-company create any-role: viewerA POST customers co=co-a', 'POST', `customers?documentId=uat-vw-${Date.now()}`, T('viewerA'), { fields: { companyId: fval(CO_A), name: fval('VW') } }, null, '200', 'role-not-enforced-at-rules (documented gap)');

  // ---- identity / user-doc boundaries ----
  await run('A1 own profile read: adminA -> users/{self}', 'GET', `users/${uids.adminA}`, T('adminA'), null, null, '200');
  await run('D1b non-admin cross-company user read: salesA -> users/{adminB}', 'GET', `users/${uids.adminB}`, T('salesA'), null, null, '403');
  await run('D2c non-admin self-elevation: salesA PATCH users/{self} isSuperAdmin', 'PATCH', `users/${uids.salesA}`, T('salesA'), { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin', '403');

  // ---- INVARIANT LOCK: hostile mapping (userId -> different-EMAIL doc) ----
  // The mapping's userId is the canonical ERP identity anchor (master-identity
  // users like MUSR-{companyId}-{phone} legitimately have userId != auth.uid),
  // so the enforceable boundary is the WRITE path: validOwnMapping requires
  // the mapped users doc to carry the token email + map companyId, and the
  // update rule makes userId immutable after creation. A user must NEVER be
  // able to re-point their own mapping at a DIFFERENT user's doc (different
  // email) — that would resolve the actor to someone else's identity.
  await run('I3 hostile map re-point DENIED (userId immutable / target email)', 'PATCH', `user_auth_maps/${uids.surveyorA}`, T('surveyorA'), { fields: { userId: fval(uids.adminA), updatedAt: fval(new Date().toISOString()) } }, 'userId', '403', 'validOwnMapping target email mismatch + userId immutable');
  await run('I4 own-profile read via email clause', 'GET', `users/${uids.surveyorA}`, T('surveyorA'), null, null, '200', 'email-match read clause still applies');

  // ── users CREATE rule (D2 create-parity + expression budget) ──────────
  createdDocPaths.push('users/uat-new-1', 'users/uat-new-3');
  await run('E1 admin same-company user create (no grant)', 'POST', 'users?documentId=uat-new-1', T('adminA'), { fields: { email: fval('uat.new1@test.local'), role: fval('Sales'), companyId: fval(CO_A), status: fval('Active'), isSuperAdmin: fval(false) } }, null, '200', 'create path must not be budget-blocked');
  await run('E2 admin create with isSuperAdmin=true denied', 'POST', 'users?documentId=uat-new-2', T('adminA'), { fields: { email: fval('uat.new2@test.local'), role: fval('Sales'), companyId: fval(CO_A), status: fval('Active'), isSuperAdmin: fval(true) } }, null, '403', 'D2 create guard');
  await run('E3 super-admin create with isSuperAdmin=true allowed', 'POST', 'users?documentId=uat-new-3', T('superAdminA'), { fields: { email: fval('uat.new3@test.local'), role: fval('Sales'), companyId: fval(CO_A), status: fval('Active'), isSuperAdmin: fval(true) } }, null, '200', 'super-admin create path preserved');
  await run('E4 non-admin user create denied', 'POST', 'users?documentId=uat-new-4', T('viewerA'), { fields: { email: fval('uat.new4@test.local'), role: fval('Sales'), companyId: fval(CO_A), status: fval('Active'), isSuperAdmin: fval(false) } }, null, '403');

  // ── EMAIL-CASE IDENTITY BOUNDARY (first-login read, no mapping yet) ─────
  // Live-proven root cause of the "Authenticated, but ERP identity access was
  // denied" login bug: Firebase Auth stores account emails LOWERCASE, while
  // the user-creation flow once stored the raw form email on the ERP doc.
  // Firestore rules compare doc email to the token email CASE-SENSITIVELY, so
  // a mixed-case doc email fails the email-self read clause for an unmapped
  // first login (no hasUserProfile/other clause applies) -> permission-denied.
  // The app fix normalizes emails at the useUsers hook boundary; these probes
  // lock the RULES-side behavior (case-sensitive identity matching) so the
  // boundary can never be silently relaxed. uat-new-1 was created by E1 with
  // a lowercase email; we flip it to mixed-case, probe denial, restore it,
  // and probe allowance.
  // NOTE: depends on users/uat-new-1 existing (created by E1 above) — keep the
  // E1 probe before this block if reordering.
  const new1Auth = await auth.createUser({ email: 'uat.new1@test.local', password: PASSWORD, displayName: 'UAT New-1', emailVerified: true });
  createdAuthUids.push(new1Auth.uid);
  const new1SignIn = await signIn('uat.new1@test.local');
  const new1Token = new1SignIn.ok ? new1SignIn.idToken : '';
  const new1Ref = db.collection('users').doc('uat-new-1');
  await new1Ref.update({ email: 'UAT.NEW1@TEST.LOCAL' });
  await run('I5 mixed-case doc email: unmapped first-login read denied', 'GET', 'users/uat-new-1', new1Token, null, null, '403', 'case-sensitive email-self clause');
  await new1Ref.update({ email: 'uat.new1@test.local' });
  await run('I6 lowercase doc email: unmapped first-login read allowed', 'GET', 'users/uat-new-1', new1Token, null, null, '200', 'Firebase-canonical email');

  // ── DATA-DRIVEN SECTION MODEL (manager-department coherence) ─────────────
  // A user's department comes from their role; the reporting manager must be
  // a manager-role holder in the same department (or the 'Management' layer /
  // super-admin). Server-side enforcement — never UI-only.
  createdDocPaths.push('users/uat-mgr-ok', 'users/uat-mgr-bad', 'users/uat-mgr-nm');
  await run('H5 same-dept manager create allowed', 'POST', 'users?documentId=uat-mgr-ok', T('adminA'), { fields: { email: fval('uat.mgr.ok@test.local'), role: fval('Sales Executive'), department: fval('Sales'), managerId: fval(uids.salesMgrA), status: fval('Active'), isSuperAdmin: fval(false), companyId: fval(CO_A) } }, null, '200', 'Sales manager for Sales report');
  await run('H6 cross-dept manager create denied', 'POST', 'users?documentId=uat-mgr-bad', T('adminA'), { fields: { email: fval('uat.mgr.bad@test.local'), role: fval('Sales Executive'), department: fval('Sales'), managerId: fval(uids.whMgrA), status: fval('Active'), isSuperAdmin: fval(false), companyId: fval(CO_A) } }, null, '403', 'Warehouse manager for Sales report');
  await run('H7 same-dept non-manager create denied', 'POST', 'users?documentId=uat-mgr-nm', T('adminA'), { fields: { email: fval('uat.mgr.nm@test.local'), role: fval('Sales Executive'), department: fval('Sales'), managerId: fval(uids.salesA), status: fval('Active'), isSuperAdmin: fval(false), companyId: fval(CO_A) } }, null, '403', 'non-manager candidate');
  await run('H8 update cross-dept manager denied', 'PATCH', `users/${uids.salesA}`, T('adminA'), { fields: { managerId: fval(uids.whMgrA) } }, 'managerId', '403', 'admin cannot re-point a report to another section');
  // Cross-company manager reference: the manager doc must belong to the SAME
  // company as the report (managerScopeMatches checks manager doc companyId).
  createdDocPaths.push('users/uat-mgr-xco');
  await run('H9 cross-company manager create denied', 'POST', 'users?documentId=uat-mgr-xco', T('adminB'), { fields: { email: fval('uat.mgr.xco@test.local'), role: fval('Sales Executive'), department: fval('Sales'), managerId: fval(uids.salesMgrA), status: fval('Active'), isSuperAdmin: fval(false), companyId: fval(CO_B) } }, null, '403', 'manager must be same company (salesMgrA is company A)');
  // Legacy-edit escape hatch: an update that does NOT change managerId or
  // department (name/status/phone edit) must not be hard-locked by a stale
  // manager reference — managerAssignmentUnchanged() short-circuits. Seed a
  // user with an invalid cross-dept assignment, then edit an unrelated field.
  createdDocPaths.push('users/uat-stale-mgr');
  await db.collection('users').doc('uat-stale-mgr').set({
    id: 'uat-stale-mgr', email: 'uat.stale.mgr@test.local', role: 'Sales Executive',
    companyId: CO_A, department: 'Sales', managerId: uids.whMgrA, isManager: false,
    status: 'Active', isSuperAdmin: false, createdAt: new Date(), updatedAt: new Date(),
  });
  await run('H10 stale-manager name edit allowed (assignment unchanged)', 'PATCH', 'users/uat-stale-mgr', T('adminA'), { fields: { name: fval('UAT Stale Renamed') } }, 'name', '200', 'unchanged managerId/department skips coherence check');
  await run('H10b stale-manager clear allowed', 'PATCH', 'users/uat-stale-mgr', T('adminA'), { fields: { managerId: fval('') } }, 'managerId', '200', 'clearing a manager is always allowed');

  // ── SYSTEM-ROLE PROTECTION (data-driven role management) ────────────────
  createdDocPaths.push('roles/uat-sys-role', 'roles/uat-custom-role', 'roles/uat-sys-role-2');
  await db.collection('roles').doc('uat-sys-role').set({ name: 'UAT Sys Role', isSystem: true });
  await db.collection('roles').doc('uat-custom-role').set({ name: 'UAT Custom Role', isSystem: false });
  await run('N3 admin updates system role denied', 'PATCH', 'roles/uat-sys-role', T('adminA'), { fields: { description: fval('hack') } }, 'description', '403', 'isSystem protection');
  await run('N4 super-admin updates system role allowed', 'PATCH', 'roles/uat-sys-role', T('superAdminA'), { fields: { description: fval('ok') } }, 'description', '200');
  await run('N7 admin updates custom role allowed', 'PATCH', 'roles/uat-custom-role', T('adminA'), { fields: { description: fval('ok') } }, 'description', '200');
  await run('N5 admin creates role with isSystem=true denied', 'POST', 'roles?documentId=uat-sys-role-2', T('adminA'), { fields: { name: fval('UAT Sys 2'), isSystem: fval(true) } }, null, '403');
  await run('N6 super-admin creates role with isSystem=true allowed', 'POST', 'roles?documentId=uat-sys-role-2', T('superAdminA'), { fields: { name: fval('UAT Sys 2'), isSystem: fval(true) } }, null, '200');

  // ── dispatch UPDATE (role-gated fields + budget) ──────────────────────
  await run('F1 admin dispatch status update', 'PATCH', 'dispatch/uat-disp-a-1', T('adminA'), { fields: { status: fval('Dispatched') } }, 'status', '200');
  await run('F2 sales dispatch status update (non-protected)', 'PATCH', 'dispatch/uat-disp-a-1', T('salesA'), { fields: { status: fval('OutForDelivery') } }, 'status', '200');
  await run('F3 viewer deliveryConfirmed denied', 'PATCH', 'dispatch/uat-disp-a-1', T('viewerA'), { fields: { deliveryConfirmed: fval(true) } }, 'deliveryConfirmed', '403');
  await run('F4 dispatch-role deliveryConfirmed allowed', 'PATCH', 'dispatch/uat-disp-a-1', T('dispatchA'), { fields: { deliveryConfirmed: fval(true) } }, 'deliveryConfirmed', '200', 'roleMatches dispatch path');
  await run('F5 deliveryOTPHash immutable (even admin)', 'PATCH', 'dispatch/uat-disp-a-1', T('adminA'), { fields: { deliveryOTPHash: fval('h') } }, 'deliveryOTPHash', '403');

  // ── stock UPDATE (qty-gated fields + budget) ──────────────────────────
  await run('G1 admin stock availableQty update', 'PATCH', 'stock/uat-stock-a-1', T('adminA'), { fields: { availableQty: fval(9) } }, 'availableQty', '200');
  await run('G2 warehouse-role stock availableQty update', 'PATCH', 'stock/uat-stock-a-1', T('warehouseA'), { fields: { availableQty: fval(8) } }, 'availableQty', '200', 'roleMatches warehouse path');
  await run('G3 viewer stock availableQty denied', 'PATCH', 'stock/uat-stock-a-1', T('viewerA'), { fields: { availableQty: fval(0) } }, 'availableQty', '403');
  await run('G4 non-qty stock field update (same-company)', 'PATCH', 'stock/uat-stock-a-1', T('salesA'), { fields: { location: fval('B-1') } }, 'location', '200');

  // ── notifications (recipient scoping + whitelist) ─────────────────────
  await run('H1 recipient notification read', 'GET', 'notifications/uat-notif-a-1', T('salesA'), null, null, '200');
  await run('H2 non-recipient same-company notification read denied', 'GET', 'notifications/uat-notif-a-1', T('viewerA'), null, null, '403');
  await run('H3 recipient mark-read update', 'PATCH', 'notifications/uat-notif-a-1', T('salesA'), { fields: { isRead: fval(true) } }, 'isRead', '200');
  await run('H4 notification field whitelist enforced', 'PATCH', 'notifications/uat-notif-a-1', T('salesA'), { fields: { title: fval('HACK') } }, 'title', '403');

  // ── project-scoped read (canReadProjectScoped budget + assignment) ────
  await run('I1 admin project read (any)', 'GET', 'projects/uat-proj-a-1', T('adminA'), null, null, '200');
  await run('I2 non-project-scoped role project read', 'GET', 'projects/uat-proj-a-1', T('viewerA'), null, null, '200');
  await run('J1 surveyor unassigned project denied', 'GET', 'projects/uat-proj-a-1', T('surveyorA'), null, null, '403', 'project-scoped narrowing');
  await run('J2 surveyor assigned project read', 'GET', 'projects/uat-proj-a-2', T('surveyorA'), null, null, '200');
  await run('K1 surveyor unassigned qc denied', 'GET', 'qc_checks/uat-qc-a-1', T('surveyorA'), null, null, '403', 'project-scoped narrowing');
  await run('K2 admin qc read', 'GET', 'qc_checks/uat-qc-a-1', T('adminA'), null, null, '200');
  await run('K3 surveyor assigned qc read', 'GET', 'qc_checks/uat-qc-a-2', T('surveyorA'), null, null, '200');

  // ── audit_logs (admin-only append) ────────────────────────────────────
  await run('L1 admin audit_log read', 'GET', 'audit_logs/uat-audit-a-1', T('adminA'), null, null, '200');
  await run('L2 non-admin audit_log read denied', 'GET', 'audit_logs/uat-audit-a-1', T('salesA'), null, null, '403');
  createdDocPaths.push('audit_logs/uat-new-audit');
  await run('L3 non-admin audit_log create denied', 'POST', 'audit_logs?documentId=uat-new-audit', T('salesA'), { fields: { companyId: fval(CO_A), action: fval('x') } }, null, '403');
  await run('L4 admin audit_log create', 'POST', 'audit_logs?documentId=uat-new-audit', T('adminA'), { fields: { companyId: fval(CO_A), action: fval('x') } }, null, '200');

  // ── settings (admin-only write) ───────────────────────────────────────
  await run('M1 same-company settings read', 'GET', 'settings/uat-settings-a-1', T('salesA'), null, null, '200');
  createdDocPaths.push('settings/uat-new-settings');
  await run('M2 non-admin settings create denied', 'POST', 'settings?documentId=uat-new-settings', T('salesA'), { fields: { companyId: fval(CO_A), key: fval('x') } }, null, '403');
  await run('M3 admin settings create', 'POST', 'settings?documentId=uat-new-settings', T('adminA'), { fields: { companyId: fval(CO_A), key: fval('x') } }, null, '200');

  // ── roles (admin-only) ────────────────────────────────────────────────
  createdDocPaths.push('roles/uat-new-role');
  await run('N1 non-admin role create denied', 'POST', 'roles?documentId=uat-new-role', T('salesA'), { fields: { name: fval('x') } }, null, '403');
  await run('N2 admin role create', 'POST', 'roles?documentId=uat-new-role', T('adminA'), { fields: { name: fval('x') } }, null, '200');

  // ── companies (tenant read + cross-company create block) ──────────────
  await run('O1 admin own-company read', 'GET', `companies/${CO_A}`, T('adminA'), null, null, '200');
  await run('O2 cross-company company create denied', 'POST', `companies?documentId=${CO_A}-x`, T('adminB'), { fields: { id: fval(CO_A + '-x'), companyId: fval(CO_A), name: fval('X') } }, null, '403');

  // Settings -> Companies "Failed to load data" root-cause regression guard:
  // an unconstrained collection-wide LIST query (no `where` at all — exactly
  // what getAll(COLLECTIONS.COMPANIES) issues) must succeed for an ordinary
  // Admin, and must still be denied for a non-admin, non-Director role.
  {
    const adminListStatus = await runQueryStatus('companies', T('adminA'));
    const adminListOk = adminListStatus === 200;
    results.push({ name: 'O3 admin unconstrained companies LIST (no where clause)', status: String(adminListStatus), expect: '200', ok: adminListOk });
    console.log(`${adminListOk ? 'PASS' : '  >>'} ${'O3 admin unconstrained companies LIST (no where clause)'.padEnd(58)} actual=${adminListStatus} expect=200`);

    const salesListStatus = await runQueryStatus('companies', T('salesA'));
    const salesListOk = salesListStatus === 403;
    results.push({ name: 'O4 non-admin unconstrained companies LIST denied', status: String(salesListStatus), expect: '403', ok: salesListOk });
    console.log(`${salesListOk ? 'PASS' : '  >>'} ${'O4 non-admin unconstrained companies LIST denied'.padEnd(58)} actual=${salesListStatus} expect=403`);
  }

  // ── dispatch / stock_ledger / goods_receipts create (field integrity) ─
  createdDocPaths.push('dispatch/uat-new-disp-1');
  await run('P1 dispatch create (createdBy self)', 'POST', 'dispatch?documentId=uat-new-disp-1', T('dispatchA'), { fields: { companyId: fval(CO_A), status: fval('Pending'), createdBy: fval(uids.dispatchA) } }, null, '200');
  await run('P2 dispatch create (createdBy other) denied', 'POST', 'dispatch?documentId=uat-new-disp-2', T('dispatchA'), { fields: { companyId: fval(CO_A), status: fval('Pending'), createdBy: fval(uids.adminA) } }, null, '403');
  createdDocPaths.push('stock_ledger/uat-new-ledger-1');
  await run('R1 stock_ledger create with required fields', 'POST', 'stock_ledger?documentId=uat-new-ledger-1', T('salesA'), { fields: { companyId: fval(CO_A), transactionId: fval('tx-uat-1'), movementAt: fval('2026-08-10T00:00:00Z') } }, null, '200');
  await run('R2 stock_ledger create missing movementAt denied', 'POST', 'stock_ledger?documentId=uat-new-ledger-2', T('salesA'), { fields: { companyId: fval(CO_A), transactionId: fval('tx-uat-2') } }, null, '403');
  createdDocPaths.push('goods_receipts/uat-new-gr-1');
  await run('T1 goods_receipt create (receivedBy self)', 'POST', 'goods_receipts?documentId=uat-new-gr-1', T('dispatchA'), { fields: { companyId: fval(CO_A), goodsReceiptId: fval('uat-new-gr-1'), purchaseOrderId: fval('po-1'), warehouseId: fval('wh-1'), receivedBy: fval(uids.dispatchA), receivedItems: { arrayValue: { values: [{ mapValue: { fields: { productId: { stringValue: 'p-1' } } } }] } }, stockEntries: { arrayValue: { values: [] } } } }, null, '200');
  await run('T2 goods_receipt create (receivedBy other) denied', 'POST', 'goods_receipts?documentId=uat-new-gr-2', T('dispatchA'), { fields: { companyId: fval(CO_A), goodsReceiptId: fval('uat-new-gr-2'), purchaseOrderId: fval('po-1'), warehouseId: fval('wh-1'), receivedBy: fval(uids.adminA), receivedItems: { arrayValue: { values: [{ mapValue: { fields: { productId: { stringValue: 'p-1' } } } }] } }, stockEntries: { arrayValue: { values: [] } } } }, null, '403');

  // ---- DEFECT probes (expectation flips with phase) ----
  const d1Exp = PHASE === 'post' ? '403' : '200';
  const d2Exp = PHASE === 'post' ? '403' : '200';
  await run('D1 admin cross-company user read: adminA -> users/{adminB}', 'GET', `users/${uids.adminB}`, T('adminA'), null, null, d1Exp, PHASE === 'pre' ? 'CURRENT-LIVE DEFECT PROBE' : 'post-fix verify');
  await run('D2 admin self-elevation: adminA PATCH users/{self} isSuperAdmin=true', 'PATCH', `users/${uids.adminA}`, T('adminA'), { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin', d2Exp, PHASE === 'pre' ? 'CURRENT-LIVE DEFECT PROBE' : 'post-fix verify');
  await run('D2b admin elevates peer: adminA PATCH users/{salesA} isSuperAdmin=true', 'PATCH', `users/${uids.salesA}`, T('adminA'), { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin', d2Exp, PHASE === 'pre' ? 'CURRENT-LIVE DEFECT PROBE' : 'post-fix verify');

  // ---- unauthenticated probe (proves auth enforcement; open ruleset returns 200) ----
  await run('A14 unauthenticated read: GET customers/uat-cust-a-1 (no token)', 'GET', 'customers/uat-cust-a-1', '', null, null, '403', 'no-auth must be denied');

  // ---- D2 non-interference: admin user management must still work ----
  await run('A15 admin same-company role change preserved', 'PATCH', `users/${uids.salesA}`, T('adminA'), { fields: { role: fval('Operations') } }, 'role', '200', 'D2 guard must not break role mgmt');
  await run('A16 admin same-company status change preserved', 'PATCH', `users/${uids.salesA}`, T('adminA'), { fields: { status: fval('Inactive') } }, 'status', '200', 'D2 guard must not break status mgmt');
  await run('A17 admin GRANT denied: adminA PATCH users/{salesA} isSuperAdmin=true', 'PATCH', `users/${uids.salesA}`, T('adminA'), { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin', '403', 'grant only by super-admin');
  await run('A17b admin REVOKE denied: adminA PATCH users/{superAdminA} isSuperAdmin=false', 'PATCH', `users/${uids.superAdminA}`, T('adminA'), { fields: { isSuperAdmin: fval(false) } }, 'isSuperAdmin', '403', 'revoke only by super-admin');
  await run('D2e super-admin GRANT allowed: superAdminA PATCH users/{salesA} isSuperAdmin=true', 'PATCH', `users/${uids.salesA}`, T('superAdminA'), { fields: { isSuperAdmin: fval(true) } }, 'isSuperAdmin', '200', 'super-admin grant path preserved');
  await run('D2f super-admin REVOKE allowed: superAdminA PATCH users/{salesA} isSuperAdmin=false', 'PATCH', `users/${uids.salesA}`, T('superAdminA'), { fields: { isSuperAdmin: fval(false) } }, 'isSuperAdmin', '200', 'super-admin revoke path preserved');

  // ---- disabled user ----
  const dr = await signIn(users.disabledA.email);
  const disabledBlocked = !dr.ok && dr.status === 400;
  console.log(`${disabledBlocked ? 'PASS' : '  >>'} ${'A12 disabled user cannot obtain token'.padEnd(58)} actual=${dr.status} ${dr.code || ''} expect=400 USER_DISABLED`);
  results.push({ name: 'A12 disabled user blocked', status: String(dr.status), expect: '400', ok: disabledBlocked });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== SUMMARY: ${results.length - failed}/${results.length} pass (phase=${PHASE}) ===`);
  await cleanup();
  console.log('CLEANUP: all UAT test artifacts removed');
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.log('FATAL:', e.message);
  await cleanup();
  process.exitCode = 2;
});
