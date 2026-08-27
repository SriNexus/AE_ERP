/**
 * detect-identity-orphans.cjs — Phase 7 (Production Identity/Data Integrity
 * Repair, Master Plan) read-only detection for IDN-001 through IDN-005.
 *
 * Findings covered (Master Plan Phase 7 / TXN-001 root-cause):
 *   IDN-001 — an `employees` or `user_auth_maps` doc whose `userId` does not
 *             resolve to an existing `users` doc.
 *   IDN-002 — a `user_auth_maps` doc that is a dead-end credential: its
 *             mapped `userId` does not resolve to an existing `users` doc
 *             (the auth-map itself is orphaned — a signed-in identity with
 *             nothing to log into).
 *   IDN-003 — a one-directional employee<->user link: `employees.userId`
 *             points at a real `users` doc, but that `users` doc's own
 *             `employeeId` does not point back to this Employee (or is
 *             empty) — the reverse link the app relies on for the "already
 *             linked" idempotency check (EmployeeDomainService) is missing.
 *   IDN-004 — a duplicate identity: 2+ non-deleted `users` docs in the SAME
 *             company sharing the same normalized phone number.
 *   IDN-005 — a `users` doc that is not explicitly inactive/deleted (so it
 *             presents as a usable login) but has NO `user_auth_maps` entry
 *             anywhere pointing at it (userId === this doc's id) — i.e. no
 *             Firebase Auth identity has ever completed the lazy
 *             first-login bootstrap (authIdentity.ts) for this profile.
 *
 * READ-ONLY. Makes zero writes. Safe to run at any time, any number of
 * times — matches the established verify-group-backfill.cjs convention
 * (structured issue counts + JSON summary, non-zero exit only on an
 * unexpected script error, never on findings themselves — findings are the
 * point of this script, not a failure of it).
 *
 * Usage:  node scripts/detect-identity-orphans.cjs
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT (Firebase Admin SDK,
 *         applicationDefault credentials — same pattern as
 *         verify-group-backfill.cjs).
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const normalizePhoneLocal = (v) => text(v).replace(/[^\d]/g, '').replace(/^0+/, '');
const isDeleted = (data) => data.isDeleted === true;
const isInactive = (data) => {
  const s = text(data.status).toLowerCase();
  return s === 'inactive' || s === 'suspended' || s === 'disabled';
};

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);
  console.log('PROJECT:', PROJECT_ID);
  console.log('Mode: READ-ONLY detection — zero writes performed by this script.');

  const findings = { 'IDN-001': [], 'IDN-002': [], 'IDN-003': [], 'IDN-004': [], 'IDN-005': [] };

  // ── Load base collections ───────────────────────────────────────────
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const usersById = new Map(users.map((u) => [u.id, u]));

  const employeesSnap = await db.collection('employees').get();
  const employees = employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const authMapsSnap = await db.collection('user_auth_maps').get();
  const authMaps = authMapsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`Loaded: ${users.length} users, ${employees.length} employees, ${authMaps.length} user_auth_maps`);

  // ── IDN-001 — employees/user_auth_maps referencing a non-existent users doc
  console.log('CHECK IDN-001 — orphan employees/user_auth_maps (userId does not resolve)');
  for (const e of employees) {
    if (isDeleted(e)) continue;
    const userId = text(e.userId);
    if (userId && !usersById.has(userId)) {
      findings['IDN-001'].push({ collection: 'employees', id: e.id, userId, email: text(e.email) });
    }
  }
  for (const m of authMaps) {
    const userId = text(m.userId);
    if (userId && !usersById.has(userId)) {
      findings['IDN-001'].push({ collection: 'user_auth_maps', id: m.id, userId, email: text(m.email) });
    }
  }
  console.log(`  found: ${findings['IDN-001'].length}`);

  // ── IDN-002 — dead-end user_auth_maps credentials (same underlying check
  // as the user_auth_maps half of IDN-001, reported separately per the
  // Master Plan's own finding split — a signed-in identity with nothing to
  // log into, distinct from an employees doc pointing nowhere).
  console.log('CHECK IDN-002 — dead-end user_auth_maps credentials');
  for (const m of authMaps) {
    const userId = text(m.userId);
    if (userId && !usersById.has(userId)) {
      findings['IDN-002'].push({ authMapId: m.id, userId, email: text(m.email), companyId: text(m.companyId) });
    }
  }
  console.log(`  found: ${findings['IDN-002'].length}`);

  // ── IDN-003 — one-directional employee<->user links.
  console.log('CHECK IDN-003 — one-directional employee<->user links');
  for (const e of employees) {
    if (isDeleted(e)) continue;
    const userId = text(e.userId);
    if (!userId) continue;
    const user = usersById.get(userId);
    if (!user) continue; // already reported under IDN-001
    if (isDeleted(user)) continue;
    if (text(user.employeeId) !== e.id) {
      findings['IDN-003'].push({
        employeeId: e.id, userId, employeeEmail: text(e.email),
        usersEmployeeIdField: text(user.employeeId) || '(empty)',
      });
    }
  }
  console.log(`  found: ${findings['IDN-003'].length}`);

  // ── IDN-004 — duplicate identity: 2+ non-deleted users sharing a phone
  // within the same company.
  console.log('CHECK IDN-004 — duplicate identity (shared phone, same company)');
  const byCompanyPhone = new Map();
  for (const u of users) {
    if (isDeleted(u)) continue;
    const phone = normalizePhoneLocal(u.phone);
    if (!phone) continue;
    const key = `${text(u.companyId)}::${phone}`;
    if (!byCompanyPhone.has(key)) byCompanyPhone.set(key, []);
    byCompanyPhone.get(key).push(u);
  }
  for (const [key, group] of byCompanyPhone.entries()) {
    if (group.length > 1) {
      const [companyId, phone] = key.split('::');
      findings['IDN-004'].push({
        companyId, phone,
        userIds: group.map((u) => u.id),
        emails: group.map((u) => text(u.email)),
      });
    }
  }
  console.log(`  found: ${findings['IDN-004'].length}`);

  // ── IDN-005 — users doc presenting as usable (not explicitly inactive/
  // deleted) with no user_auth_maps entry pointing at it anywhere.
  console.log('CHECK IDN-005 — active-looking users doc with no user_auth_maps entry');
  const mappedUserIds = new Set(authMaps.map((m) => text(m.userId)).filter(Boolean));
  for (const u of users) {
    if (isDeleted(u) || isInactive(u)) continue;
    if (!mappedUserIds.has(u.id)) {
      findings['IDN-005'].push({ userId: u.id, email: text(u.email), companyId: text(u.companyId), status: text(u.status) || '(none)' });
    }
  }
  console.log(`  found: ${findings['IDN-005'].length}`);

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('SUMMARY');
  const summary = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
  console.log(JSON.stringify(summary, null, 2));
  console.log('DETAIL');
  console.log(JSON.stringify(findings, null, 2));

  const total = Object.values(findings).reduce((a, v) => a + v.length, 0);
  if (total === 0) {
    console.log('DETECTION COMPLETE — zero orphans/duplicates found in any category.');
  } else {
    console.log(`DETECTION COMPLETE — ${total} finding(s) across ${Object.values(summary).filter((n) => n > 0).length} categor${Object.values(summary).filter((n) => n > 0).length === 1 ? 'y' : 'ies'}. No writes were made. Review before any repair action.`);
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
