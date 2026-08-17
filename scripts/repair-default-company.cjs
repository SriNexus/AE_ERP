/**
 * repair-default-company.cjs — additive tenant repair for the Admin
 * companyId='default' 403-storm defect.
 *
 * Root cause (live-verified): several ERP records (users, user_auth_maps,
 * leads, customers, notifications, settings) carry companyId 'default' — a
 * neutral placeholder that is NOT a real company (live companies are
 * CO-1783978330465-3EV9 and company-demo-neozy). Authenticated sessions
 * resolved to 'default', every company-scoped query ran
 * where companyId == 'default', and Firestore rules (correctly) denied them.
 *
 * This script additively repoints ONLY documents whose companyId is exactly
 * 'default' to the canonical company (the companies doc with isDefault ===
 * true, excluding the demo company). It never touches the demo tenant, never
 * deletes, never rewrites any other field, and never prints credentials.
 *
 * Usage:  node scripts/repair-default-company.cjs            (dry-run)
 *         node scripts/repair-default-company.cjs --apply    (write)
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT or ae-erp-d933d default
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';
const APPLY = process.argv.includes('--apply');

const COLLECTIONS_TO_SCAN = [
  'users', 'user_auth_maps', 'leads', 'customers', 'notifications', 'settings',
];
const TARGET_FIELD = 'companyId';
const BAD_VALUE = 'default';

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);

  // Resolve the canonical target company (isDefault, excluding the demo tenant).
  const companies = await db.collection('companies').get();
  const canonical = companies.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.id !== 'company-demo-neozy' && c.isDemo !== true)
    .sort((a, b) => (b.isDefault === true ? 1 : 0) - (a.isDefault === true ? 1 : 0))[0];
  if (!canonical) {
    console.log('FATAL: no canonical (non-demo) company found in', PROJECT_ID);
    process.exit(1);
  }
  console.log('PROJECT:', PROJECT_ID, '| mode:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('CANONICAL_TARGET:', canonical.id, '| name:', canonical.name, '| isDefault:', canonical.isDefault === true);

  let total = 0;
  const perCollection = {};

  for (const col of COLLECTIONS_TO_SCAN) {
    const snap = await db.collection(col).get();
    const candidates = snap.docs.filter((d) => d.data()[TARGET_FIELD] === BAD_VALUE);
    if (candidates.length === 0) continue;

    perCollection[col] = candidates.length;
    total += candidates.length;

    console.log(`--- ${col}: ${candidates.length} doc(s) with companyId 'default' ---`);
    for (const doc of candidates) {
      const data = doc.data();
      if (data.isDemo === true || data.demoSeedId) {
        console.log(`  SKIP (demo-marked, unexpected): ${doc.id}`);
        continue;
      }
      console.log(`  ${col}/${doc.id.slice(0, 40)} | role: ${data.role || '-'} | email: ${String(data.email || '').slice(0, 22) || '-'}`);
      if (APPLY) {
        await db.collection(col).doc(doc.id).update({ [TARGET_FIELD]: canonical.id, updatedAt: new Date().toISOString(), updatedBy: 'system-repair' });
      }
    }
  }

  console.log('TOTAL_CANDIDATES:', total, perCollection);
  if (!APPLY) console.log('Dry-run complete. Re-run with --apply to repoint to', canonical.id);
  else console.log(`Repair complete: repointed ${total} doc(s) to ${canonical.id}.`);
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
