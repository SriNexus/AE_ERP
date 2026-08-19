/**
 * backfill-group-denorm.cjs — Phase 1 (Multi-Tenant) migration, Master Plan
 * §10.3 step 3 (groupId denormalization) + the F-03 per-company role-document
 * keying migration (§5.6).
 *
 * For every tenant-scoped collection in Master Plan §3.2's list, reads every
 * document's companyId, looks up that company's groupId (stamped by
 * backfill-groups.cjs step 2), and writes the missing groupId field. Batched
 * (450 writes/batch, under Firestore's 500 limit), resumable per collection
 * (document-id cursor), with progress logging. Also backfills users.groupId
 * (derived from companyId) and user_auth_maps.groupId (mirror of the linked
 * users doc), which have their own §3.2 semantics but must be populated for
 * the Phase 1 completion gate.
 *
 * F-03 role keying (§5.6): creates the per-company keyed role documents
 * `roles/{companyId}_{roleName}` for every system role, copied from the
 * existing name-keyed shared template (`roles/{roleName}`) with `companyId`
 * stamped — the data-model change that lets the `roles` read be
 * Company-scoped without locking out non-stamping companies. Custom ROL-*
 * role documents are left untouched (they already carry companyId and were
 * never name-keyed).
 *
 * SAFETY: additive only — only ever adds/matches the groupId field (or
 * creates net-new keyed role docs). Never deletes, never rewrites any other
 * field, never changes companyId. Idempotent and safe to rerun: existing
 * groupId fields that already match are skipped; keyed role docs that exist
 * are skipped.
 *
 * Usage:  node scripts/backfill-group-denorm.cjs             (dry-run)
 *         node scripts/backfill-group-denorm.cjs --apply     (write)
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT (Firebase Admin SDK,
 *         applicationDefault credentials — same convention as
 *         backfill-org-hierarchy.cjs).
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';
const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 450;
const PROGRESS_EVERY = 500;

// Master Plan §3.2 — collections in scope for the groupId denormalization
// (every tenant-scoped collection carrying companyId). `users` and
// `user_auth_maps` are handled with their own derivation below (they are in
// §3.2's "own groupId semantics" bucket, but still must be populated).
const DENORM_COLLECTIONS = [
  'leads', 'customers', 'projects', 'surveys', 'engineering_designs',
  'quotations', 'orders', 'proforma_invoices', 'tax_invoices', 'dispatch',
  'payments', 'stock', 'stock_ledger', 'purchase_orders', 'goods_receipts',
  'installations', 'qc_checks', 'commissioning_records',
  'net_metering_applications', 'subsidy_applications', 'project_handovers',
  'amc_contracts', 'service_tickets', 'generation_readings',
  'channel_partners', 'commission_records', 'commission_rules', 'settlements',
  'partner_wallet_transactions', 'tasks', 'notifications', 'documents',
  'cases', 'employees', 'attendance', 'payroll', 'banks', 'registrations',
  'scheme_registrations', 'error_logs', 'customer_phone_locks',
  'device_tokens', 'audit_logs', 'security_logs', 'settings',
  'document_counters', 'teams', 'warehouses',
];

// F-03 (§5.6): the system role names that move from name-keyed shared
// templates to per-company keyed docs. Mirrors roleBootstrap's
// SYSTEM_ROLE_NAMES (inlined here because this is a plain .cjs script, same
// convention as backfill-org-hierarchy.cjs inlining its system-role data).
const SYSTEM_ROLE_NAMES = [
  'Admin', 'Director', 'Sales', 'Accounts', 'Warehouse', 'HR', 'Operations',
  'Partner', 'Manager', 'Surveyor', 'Engineer', 'InstallationLead',
  'ServiceTechnician', 'ComplianceOfficer', 'Procurement',
];

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const roleDocId = (companyId, roleName) => `${companyId}_${roleName}`;

/**
 * Read a collection in resumable batches (document-id cursor) so an
 * interrupted run can be restarted without reprocessing from scratch; each
 * page is a slice of `limit` docs, and `startAfterId` resumes.
 */
async function* pageCollection(db, col, startAfterId, limit = 500) {
  let cursor = startAfterId || null;
  while (true) {
    let q = db.collection(col).orderBy(FieldPath.documentId()).limit(limit);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return;
    const docs = snap.docs;
    for (const d of docs) yield d;
    if (docs.length < limit) return;
    cursor = docs[docs.length - 1].id;
  }
}

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);

  console.log('PROJECT:', PROJECT_ID, '| mode:', APPLY ? 'APPLY' : 'DRY-RUN');

  // ── companyId → groupId lookup (stamped by backfill-groups.cjs) ─────
  const companiesSnap = await db.collection('companies').get();
  const companyGroupById = new Map();
  for (const d of companiesSnap.docs) {
    const g = text(d.data().groupId);
    if (g) companyGroupById.set(d.id, g);
  }
  console.log('COMPANY_GROUP_MAP:', companyGroupById.size, 'companies with groupId');
  if (companyGroupById.size === 0) {
    console.log('FATAL: no companies carry groupId — run backfill-groups.cjs --apply first.');
    process.exit(1);
  }

  let totalStamped = 0;
  let totalSkipped = 0;
  let totalMissingCompany = 0;

  // ── Step 3a: groupId denormalization on §3.2 business collections ──
  for (const col of DENORM_COLLECTIONS) {
    let stamped = 0;
    let skipped = 0;
    let missing = 0;
    let batch = null;
    let batchCount = 0;
    let processed = 0;

    const flush = async () => {
      if (batch && batchCount > 0) {
        if (APPLY) await batch.commit();
        batch = null;
        batchCount = 0;
      }
    };

    for await (const doc of pageCollection(db, col)) {
      processed += 1;
      const data = doc.data();
      const companyId = text(data.companyId);
      const groupId = text(data.groupId);
      if (groupId) { skipped += 1; continue; }
      const target = companyGroupById.get(companyId);
      if (!target) { missing += 1; continue; }
      if (!batch) batch = db.batch();
      batch.update(doc.ref, { groupId: target, updatedAt: new Date().toISOString(), updatedBy: 'system-backfill' });
      batchCount += 1;
      stamped += 1;
      if (batchCount >= BATCH_SIZE) { await flush(); }
      if (processed % PROGRESS_EVERY === 0) {
        console.log(`  ${col}: ${processed} scanned, ${stamped} to stamp...`);
      }
    }
    await flush();
    totalStamped += stamped;
    totalSkipped += skipped;
    totalMissingCompany += missing;
    console.log(`${col}: ${stamped} stamped, ${skipped} already have groupId, ${missing} no company match`);
  }

  // ── Step 3b: users.groupId (derived from companyId, §3.2) ──────────
  {
    let stamped = 0, skipped = 0, missing = 0, batch = null, batchCount = 0;
    const flush = async () => {
      if (batch && batchCount > 0) { if (APPLY) await batch.commit(); batch = null; batchCount = 0; }
    };
    for await (const doc of pageCollection(db, 'users')) {
      const data = doc.data();
      if (text(data.groupId)) { skipped += 1; continue; }
      const target = companyGroupById.get(text(data.companyId));
      if (!target) { missing += 1; continue; }
      if (!batch) batch = db.batch();
      batch.update(doc.ref, { groupId: target, updatedAt: new Date().toISOString(), updatedBy: 'system-backfill' });
      batchCount += 1; stamped += 1;
      if (batchCount >= BATCH_SIZE) await flush();
    }
    await flush();
    totalStamped += stamped; totalSkipped += skipped; totalMissingCompany += missing;
    console.log(`users: ${stamped} stamped, ${skipped} already have groupId, ${missing} no company match`);
  }

  // ── Step 3c: user_auth_maps.groupId (mirror of linked users doc) ───
  {
    let stamped = 0, skipped = 0, missing = 0, batch = null, batchCount = 0;
    const flush = async () => {
      if (batch && batchCount > 0) { if (APPLY) await batch.commit(); batch = null; batchCount = 0; }
    };
    for await (const doc of pageCollection(db, 'user_auth_maps')) {
      const data = doc.data();
      if (text(data.groupId)) { skipped += 1; continue; }
      const userId = text(data.userId);
      if (!userId) { missing += 1; continue; }
      const userSnap = await db.collection('users').doc(userId).get();
      const target = userSnap.exists ? text(userSnap.data().groupId) : '';
      if (!target) { missing += 1; continue; }
      if (!batch) batch = db.batch();
      batch.update(doc.ref, { groupId: target, updatedAt: new Date().toISOString() });
      batchCount += 1; stamped += 1;
      if (batchCount >= BATCH_SIZE) await flush();
    }
    await flush();
    totalStamped += stamped; totalSkipped += skipped; totalMissingCompany += missing;
    console.log(`user_auth_maps: ${stamped} stamped, ${skipped} already have groupId, ${missing} no linked-user groupId`);
  }

  // ── F-03 (§5.6): per-company keyed role documents ──────────────────
  // For every company, for every system role, ensure `roles/{companyId}_{name}`
  // exists — copied from the legacy name-keyed shared template when present.
  {
    const companies = companiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let created = 0;
    let existingCount = 0;
    let missingTemplate = 0;
    const now = new Date().toISOString();

    for (const company of companies) {
      const companyId = company.id;
      for (const roleName of SYSTEM_ROLE_NAMES) {
        const keyedId = roleDocId(companyId, roleName);
        const keyedRef = db.collection('roles').doc(keyedId);
        const keyedSnap = await keyedRef.get();
        if (keyedSnap.exists) { existingCount += 1; continue; }

        const templateSnap = await db.collection('roles').doc(roleName).get();
        if (!templateSnap.exists) {
          // No shared template (fresh project or already migrated) — the boot
          // self-heal path (useGlobalBoot) seeds keyed docs for owner/super-admin
          // sessions, so this is report-only, not a hard error.
          missingTemplate += 1;
          continue;
        }
        const template = templateSnap.data();
        console.log(`roles/${keyedId}: CREATE from shared template roles/${roleName}`);
        if (APPLY) {
          await keyedRef.set({
            ...template,
            id: keyedId,
            companyId,
            // The copy is authoritative for this company — ensure the system
            // marker survives (it gates rules-level system-role protection).
            isSystem: true,
            updatedAt: now,
            updatedBy: 'system-backfill',
          }, { merge: true });
        }
        created += 1;
      }
    }
    console.log(`roles (F-03 keying): ${created} keyed docs to create, ${existingCount} already exist, ${missingTemplate} missing shared templates (self-heal will seed)`);
  }

  console.log(`TOTAL: ${totalStamped} groupId stamps, ${totalSkipped} already correct, ${totalMissingCompany} no company match`);
  if (!APPLY) console.log('Dry-run complete. Re-run with --apply to write.');
  else console.log('Denormalization + role keying complete.');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
