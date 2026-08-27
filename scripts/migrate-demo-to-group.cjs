/**
 * migrate-demo-to-group.cjs — Demo-to-Group conversion migration
 * (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md).
 *
 * Converts the existing `Neozy Demo` tenant (already a real Group + Company
 * since scripts/backfill-groups.cjs / backfill-group-denorm.cjs ran — see
 * docs/phase-reports/NEOZY_MULTI_TENANT_PRODUCTION_CLOSURE_REPORT.md §5.2)
 * into a fully real, ordinary Group: renames the Group/Company to "Neozy
 * Demo", promotes demo@neozy.in's user document to role: 'GroupAdmin', and
 * ensures a real per-company 'Admin' system role document exists for
 * company-demo-neozy (the same shape/id scheme every other company's Admin
 * role has — src/lib/roleBootstrap.ts's getCompanyRoleSeedDocuments()).
 *
 * This script does NOT touch firestore.rules (no rules change is required —
 * the GroupAdmin/Group-suspension authorization path is already generic and
 * does not special-case demo@neozy.in or company-demo-neozy in any way), and
 * does NOT remove the pre-existing `company-demo-neozy_Demo Operator` role
 * document (left in place as an inert, unreferenced orphan — nothing
 * resolves to that role name once this script runs; deleting historical
 * documents is out of scope for an additive migration).
 *
 * SAFETY: idempotent and safe to rerun — every write is guarded by a
 * "already correct, skip" check first. No collection is deleted from. No
 * business data (leads/orders/projects/etc.) is touched at all — this
 * script only writes to `groups`, `companies`, `users`, and `roles`, and
 * only the specific documents named above.
 *
 * Usage:  node scripts/migrate-demo-to-group.cjs            (dry-run)
 *         node scripts/migrate-demo-to-group.cjs --apply    (write)
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT (Firebase Admin SDK,
 *         applicationDefault credentials — same convention as
 *         backfill-groups.cjs / repair-default-company.cjs)
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';
const APPLY = process.argv.includes('--apply');

const DEMO_GROUP_ID = 'group-demo-neozy';
const DEMO_COMPANY_ID = 'company-demo-neozy';
const DEMO_USER_ID = 'MUSR-DEMO-0001';
const DEMO_ADMIN_ROLE_ID = `${DEMO_COMPANY_ID}_Admin`;
const TARGET_NAME = 'Neozy Demo';

// ── Real Admin role shape, mirrored from src/lib/roleBootstrap.ts's
// createAllModulePermissions() (Admin gets every capability, visibility:'all')
// applied to the same module list scripts/demo/datasets/foundation.ts now
// seeds for company-demo-neozy — kept in sync manually, matching the
// pre-existing scripts/backfill-group-denorm.cjs convention of mirroring
// src/lib/ shapes rather than importing browser/store-coupled TS modules
// into a CommonJS Admin SDK script.
const MODULE_NAMES = [
  'dashboard','projects','leads','customers','quotations','orders','dispatch','surveys','engineering',
  'installations','qc','commissioning','net_metering','subsidy','service_tickets','inventory','stock',
  'products','payments','invoices','employees','users','roles','reports','categories','warehouses',
  'attendance','payroll','companies','settings','partners','tax_invoices','vendors','purchase_orders',
  'loan_applications','payouts','scheme_registration',
];
function buildAdminPermissions() {
  const perms = {};
  for (const module of MODULE_NAMES) {
    perms[module] = {
      view: true, create: true, edit: true, delete: true, cancel: true,
      approve: true, disburse: true, export: true, import: true,
      view_pricing: true, visibility: 'all',
    };
  }
  return perms;
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);
  const now = new Date().toISOString();

  console.log('PROJECT:', PROJECT_ID, '| mode:', APPLY ? 'APPLY' : 'DRY-RUN');

  // ── Step 1: rename the Group ────────────────────────────────────────
  const groupRef = db.collection('groups').doc(DEMO_GROUP_ID);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    console.log(`groups/${DEMO_GROUP_ID}: MISSING — run scripts/backfill-groups.cjs first. Aborting.`);
    process.exit(1);
  }
  const group = groupSnap.data();
  if (text(group.name) === TARGET_NAME) {
    console.log(`groups/${DEMO_GROUP_ID}: name already "${TARGET_NAME}" (skip)`);
  } else {
    console.log(`groups/${DEMO_GROUP_ID}: name "${group.name}" → "${TARGET_NAME}"`);
    if (APPLY) await groupRef.update({ name: TARGET_NAME, updatedAt: now, updatedBy: 'system-migrate-demo-to-group' });
  }

  // ── Step 2: rename the Company ──────────────────────────────────────
  const companyRef = db.collection('companies').doc(DEMO_COMPANY_ID);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    console.log(`companies/${DEMO_COMPANY_ID}: MISSING — cannot proceed. Aborting.`);
    process.exit(1);
  }
  const company = companySnap.data();
  if (text(company.name) === TARGET_NAME) {
    console.log(`companies/${DEMO_COMPANY_ID}: name already "${TARGET_NAME}" (skip)`);
  } else {
    console.log(`companies/${DEMO_COMPANY_ID}: name "${company.name}" → "${TARGET_NAME}"`);
    if (APPLY) await companyRef.update({ name: TARGET_NAME, updatedAt: now, updatedBy: 'system-migrate-demo-to-group' });
  }
  if (text(company.groupId) !== DEMO_GROUP_ID) {
    console.log(`companies/${DEMO_COMPANY_ID}: WARNING — groupId is "${company.groupId}", expected "${DEMO_GROUP_ID}". Not touching groupId (immutable by design); investigate before proceeding.`);
  }

  // ── Step 3: promote demo@neozy.in to GroupAdmin ─────────────────────
  const userRef = db.collection('users').doc(DEMO_USER_ID);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    console.log(`users/${DEMO_USER_ID}: MISSING — cannot proceed. Aborting.`);
    process.exit(1);
  }
  const user = userSnap.data();
  const userUpdate = {};
  if (user.role !== 'GroupAdmin') userUpdate.role = 'GroupAdmin';
  if (text(user.groupId) !== DEMO_GROUP_ID) userUpdate.groupId = DEMO_GROUP_ID;
  if (Object.keys(userUpdate).length === 0) {
    console.log(`users/${DEMO_USER_ID}: already role="GroupAdmin" groupId="${DEMO_GROUP_ID}" (skip)`);
  } else {
    console.log(`users/${DEMO_USER_ID}: role "${user.role}"→"GroupAdmin"${userUpdate.groupId ? `, groupId "${user.groupId}"→"${DEMO_GROUP_ID}"` : ''}`);
    if (APPLY) await userRef.update({ ...userUpdate, updatedAt: now, updatedBy: 'system-migrate-demo-to-group' });
  }

  // ── Step 4: ensure a real per-company Admin role document exists ───
  const roleRef = db.collection('roles').doc(DEMO_ADMIN_ROLE_ID);
  const roleSnap = await roleRef.get();
  if (roleSnap.exists) {
    console.log(`roles/${DEMO_ADMIN_ROLE_ID}: EXISTS (skip) — already the real Admin role every company's GroupAdmin/Admin resolves to.`);
  } else {
    console.log(`roles/${DEMO_ADMIN_ROLE_ID}: CREATE — full Admin permissions, same shape as any other company's Admin role.`);
    if (APPLY) {
      await roleRef.set({
        id: DEMO_ADMIN_ROLE_ID, name: 'Admin', schemaVersion: 1, companyId: DEMO_COMPANY_ID,
        description: 'Full administrative access, scoped to the Neozy Demo Group like any other Group\'s Admin role.',
        isSystem: true, isDemo: true,
        permissions: buildAdminPermissions(),
        createdAt: now, createdBy: 'system-migrate-demo-to-group',
        updatedAt: now, updatedBy: 'system-migrate-demo-to-group',
        isDeleted: false,
      });
    }
  }

  // ── Step 5: note (not delete) the old restricted role document ─────
  const oldRoleRef = db.collection('roles').doc(`${DEMO_COMPANY_ID}_Demo Operator`);
  const oldRoleSnap = await oldRoleRef.get();
  if (oldRoleSnap.exists) {
    console.log(`roles/${DEMO_COMPANY_ID}_Demo Operator: still present, now unreferenced (no user resolves to this role name anymore) — left in place; delete manually if desired, this migration does not delete documents.`);
  }

  console.log(APPLY ? 'Demo-to-Group conversion complete.' : 'Dry-run complete. Re-run with --apply to write.');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
