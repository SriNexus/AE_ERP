/**
 * backfill-groupadmin-employees.cjs — Group Admin identity completeness.
 *
 * A Group Admin must be a complete ERP identity — Auth -> User -> Employee ->
 * Company/Group scope, not merely an authentication-only account. This
 * mirrors src/services/EmployeeDomainService.ts's linkOrCreateForUser() logic
 * exactly (the same method Users.tsx's "Create User" flow already calls for
 * every newly-created login), applied retroactively to any EXISTING
 * GroupAdmin whose users/{id} document predates that flow (seeded, migrated,
 * or bootstrap-created rather than created through the UI).
 *
 * Applies generically to every Group's GroupAdmin found in production — not
 * a Demo-only fix. No new authentication identity is ever created; the
 * existing users/{id} document (and its user_auth_maps entry) remains
 * canonical. Only a missing employees/{id} document is added, linked via the
 * same userId <-> employeeId bidirectional relationship the UI flow uses.
 *
 * SAFETY: idempotent and safe to rerun.
 *   - A GroupAdmin already correctly linked (users.employeeId points at a
 *     real, live employees/{id} doc) is skipped entirely — no write.
 *   - An employees/{id} doc that already exists for this exact userId (just
 *     not yet back-referenced from users.employeeId) is reused, not
 *     duplicated — only the missing users.employeeId backfill is written.
 *   - A pre-existing Employee under the deterministic master-identity id
 *     (MUSR-{companyId}-{phone}, matching resolveOrCreateMasterUser()'s
 *     scheme) is re-linked to this login instead of creating a duplicate.
 *   - Only when none of the above match is a brand-new Employee created.
 * No business data is touched. No Firestore rules change is required (a
 * GroupAdmin creating/being-linked-to an Employee record uses the exact same
 * companies/groups they already have write access to as themselves).
 *
 * Usage:  node scripts/backfill-groupadmin-employees.cjs            (dry-run)
 *         node scripts/backfill-groupadmin-employees.cjs --apply    (write)
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT (Firebase Admin SDK,
 *         applicationDefault credentials — same convention as
 *         migrate-demo-to-group.cjs / backfill-groups.cjs)
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';
const APPLY = process.argv.includes('--apply');
const ACTOR = 'system-groupadmin-employee-backfill';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Mirrors src/lib/userIdentity.ts's normalizePhone() exactly.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}
// Mirrors src/lib/userIdentity.ts's masterUserId() exactly.
function masterUserId(companyId, phone) {
  return `MUSR-${encodeURIComponent(companyId)}-${phone}`;
}
// Mirrors src/lib/firestore.ts's genId.employee() exactly.
function rnd(len = 4) {
  return Array.from({ length: len }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}
function dp() {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function genEmployeeId() {
  return `EMP-${dp()}-${rnd()}`;
}

async function findEmployeeByUserId(db, companyId, userId) {
  const snap = await db.collection('employees')
    .where('companyId', '==', companyId)
    .where('userId', '==', userId)
    .get();
  const live = snap.docs.filter((d) => d.data().isDeleted !== true);
  return live.length > 0 ? live[0] : null;
}

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);
  const now = new Date().toISOString();

  console.log('PROJECT:', PROJECT_ID, '| mode:', APPLY ? 'APPLY' : 'DRY-RUN');

  const usersSnap = await db.collection('users').where('role', '==', 'GroupAdmin').get();
  console.log(`Found ${usersSnap.size} user(s) with role=GroupAdmin.\n`);

  let linked = 0, created = 0, alreadyOk = 0, skippedInvalid = 0;

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    const userId = userDoc.id;
    const companyId = text(user.companyId);
    const groupId = text(user.groupId);
    console.log(`--- users/${userId} (${user.email || '-'}) | company=${companyId} | group=${groupId} ---`);

    if (!companyId) {
      console.log('  SKIP — no companyId on this GroupAdmin user; cannot scope an Employee record. Investigate before proceeding.');
      skippedInvalid += 1;
      continue;
    }

    // 1) Already correctly linked?
    const existingEmployeeId = text(user.employeeId);
    if (existingEmployeeId) {
      const existingDoc = await db.collection('employees').doc(existingEmployeeId).get();
      if (existingDoc.exists && existingDoc.data().isDeleted !== true) {
        console.log(`  OK — already linked to employees/${existingEmployeeId} (skip).`);
        alreadyOk += 1;
        continue;
      }
      console.log(`  users.employeeId="${existingEmployeeId}" does not resolve to a live employees doc — will re-resolve.`);
    }

    // 2) An Employee already exists for this exact userId (created but never
    //    back-linked on the User doc)?
    const byUserId = await findEmployeeByUserId(db, companyId, userId);
    if (byUserId) {
      console.log(`  FOUND — employees/${byUserId.id} already has userId="${userId}"; backfilling users.employeeId.`);
      if (APPLY) {
        await db.collection('users').doc(userId).update({ employeeId: byUserId.id, updatedAt: now, updatedBy: ACTOR });
      }
      linked += 1;
      continue;
    }

    // 3) A pre-existing Employee under the deterministic master-identity id
    //    (predates this login, same as EmployeeDomainService.linkOrCreateForUser).
    const phone = normalizePhone(text(user.phone));
    if (phone) {
      const candidateId = masterUserId(companyId, phone);
      const byMasterIdentity = await findEmployeeByUserId(db, companyId, candidateId);
      if (byMasterIdentity) {
        console.log(`  FOUND (master identity) — employees/${byMasterIdentity.id} under userId="${candidateId}"; re-linking to userId="${userId}".`);
        if (APPLY) {
          await db.collection('employees').doc(byMasterIdentity.id).update({ userId, updatedAt: now, updatedBy: ACTOR });
          await db.collection('users').doc(userId).update({ employeeId: byMasterIdentity.id, updatedAt: now, updatedBy: ACTOR });
        }
        linked += 1;
        continue;
      }
    }

    // 4) Genuinely missing — create, using the exact same shape
    //    EmployeeDomainService.linkOrCreateForUser()'s create-branch uses:
    //    role mirrors the User's own role (GroupAdmin), never a bespoke
    //    "SpecialEmployeeType" — plus the same groupId denormalization every
    //    other tenant-scoped collection gets (createDocWithId() normally
    //    stamps this from the company automatically; this script writes
    //    directly, so it is looked up and stamped explicitly here).
    const employeeId = genEmployeeId();
    console.log(`  CREATE — employees/${employeeId}: name="${user.name || '-'}" role="${user.role}" companyId="${companyId}" groupId="${groupId || '(none)'}"`);
    if (APPLY) {
      await db.collection('employees').doc(employeeId).set({
        id: employeeId,
        companyId,
        ...(groupId ? { groupId } : {}),
        userId,
        name: text(user.name),
        phone: text(user.phone),
        email: text(user.email),
        role: text(user.role) || 'GroupAdmin',
        status: 'Active',
        isDeleted: false,
        createdAt: now,
        createdBy: ACTOR,
        updatedAt: now,
        updatedBy: ACTOR,
      });
      await db.collection('users').doc(userId).update({ employeeId, updatedAt: now, updatedBy: ACTOR });
    }
    created += 1;
  }

  console.log(`\nSUMMARY: alreadyLinked=${alreadyOk} backfilledLink=${linked} created=${created} skippedInvalid=${skippedInvalid}`);
  console.log(APPLY ? 'Backfill complete.' : 'Dry-run complete. Re-run with --apply to write.');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
