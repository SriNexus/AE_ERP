/**
 * backfill-groups.cjs — Phase 1 (Multi-Tenant) migration, Master Plan §10.3
 * steps 1 + 2.
 *
 * Creates the `groups` documents and stamps `companies.groupId`:
 *
 *   1. One Group for the real customer (isDefault: true) — by default named
 *      "CSGPL Group", the tenant that owns ChaitanyaSri Greentech Pvt Ltd and
 *      Santosh Techno (per the approved brief's own example hierarchy).
 *   2. One Group for the demo tenant (isDemo: true) — `group-demo-neozy`,
 *      parent of `company-demo-neozy` (never folded into the production
 *      default Group).
 *   3. Every `companies` document gets its `groupId`: the demo company → the
 *      demo Group, every other real company → the default Group.
 *
 * SAFETY: additive only — creates net-new groups docs and adds a groupId
 * field to companies docs. Never deletes, never rewrites any existing field,
 * never touches business collections (that is backfill-group-denorm.cjs).
 * Idempotent and safe to rerun: existing groups are left untouched, and an
 * existing company groupId that already matches is skipped.
 *
 * Usage:  node scripts/backfill-groups.cjs                          (dry-run)
 *         node scripts/backfill-groups.cjs --apply                  (write)
 *         node scripts/backfill-groups.cjs --defaultGroupId=GROUP-C \
 *             --defaultGroupName="CSGPL Group" --defaultGroupShortName=CSGPL
 * Env:    DEMO_FIREBASE_PROJECT_ID or GCLOUD_PROJECT (Firebase Admin SDK,
 *         applicationDefault credentials — same convention as
 *         repair-default-company.cjs / backfill-org-hierarchy.cjs)
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.DEMO_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ae-erp-d933d';
const APPLY = process.argv.includes('--apply');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DEFAULT_GROUP_ID = arg('defaultGroupId', 'group-csgpl');
const DEFAULT_GROUP_NAME = arg('defaultGroupName', 'CSGPL Group');
const DEFAULT_GROUP_SHORT_NAME = arg('defaultGroupShortName', 'CSGPL');
const DEMO_GROUP_ID = 'group-demo-neozy';
const DEMO_COMPANY_ID = 'company-demo-neozy';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

(async () => {
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app);

  console.log('PROJECT:', PROJECT_ID, '| mode:', APPLY ? 'APPLY' : 'DRY-RUN');

  const companiesSnap = await db.collection('companies').get();
  const companies = companiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (companies.length === 0) {
    console.log('FATAL: no companies documents found in', PROJECT_ID);
    process.exit(1);
  }
  console.log('COMPANIES:', companies.length);

  // ── Step 1: create the Group documents (idempotent) ────────────────
  const groupPlan = [
    {
      id: DEFAULT_GROUP_ID,
      data: {
        id: DEFAULT_GROUP_ID,
        name: DEFAULT_GROUP_NAME,
        shortName: DEFAULT_GROUP_SHORT_NAME,
        status: 'Active',
        isDefault: true,
        settings: {},
      },
    },
    {
      id: DEMO_GROUP_ID,
      data: {
        id: DEMO_GROUP_ID,
        name: 'Neozy Demo Group',
        shortName: 'Demo',
        status: 'Active',
        isDefault: false,
        isDemo: true,
        settings: {},
      },
    },
  ];

  for (const group of groupPlan) {
    const existing = await db.collection('groups').doc(group.id).get();
    if (existing.exists) {
      const cur = existing.data();
      console.log(`groups/${group.id}: EXISTS (skip) — name="${cur.name}" isDefault=${cur.isDefault === true} isDemo=${cur.isDemo === true}`);
      continue;
    }
    const now = new Date().toISOString();
    const doc = {
      ...group.data,
      createdAt: now,
      createdBy: 'system-backfill',
      updatedAt: now,
      updatedBy: 'system-backfill',
    };
    console.log(`groups/${group.id}: CREATE — name="${group.data.name}" shortName="${group.data.shortName}"`);
    if (APPLY) {
      await db.collection('groups').doc(group.id).set(doc, { merge: true });
    }
  }

  // ── Step 2: stamp companies.groupId (idempotent) ───────────────────
  let stamped = 0;
  let skipped = 0;
  let conflict = 0;
  for (const company of companies) {
    const targetGroupId = company.id === DEMO_COMPANY_ID ? DEMO_GROUP_ID : DEFAULT_GROUP_ID;
    const current = text(company.groupId);
    if (current === targetGroupId) {
      skipped += 1;
      continue;
    }
    if (current) {
      // Existing groupId pointing elsewhere — never overwrite (additive);
      // report so the operator can resolve the discrepancy.
      conflict += 1;
      console.log(`companies/${company.id}: CONFLICT groupId="${current}" vs expected="${targetGroupId}" (left untouched)`);
      continue;
    }
    console.log(`companies/${company.id}: groupId → "${targetGroupId}" | name="${text(company.name) || '-'}"`);
    if (APPLY) {
      await db.collection('companies').doc(company.id).update({
        groupId: targetGroupId,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system-backfill',
      });
    }
    stamped += 1;
  }

  console.log(`COMPANIES_GROUPID: ${stamped} stamped, ${skipped} already correct, ${conflict} conflicting (untouched)`);
  if (!APPLY) console.log('Dry-run complete. Re-run with --apply to write.');
  else console.log('Backfill complete: groups + companies.groupId established.');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
