/**
 * verify-deployed-rules-parity.cjs — post-deploy release-gate check.
 *
 * Pulls the ACTIVE deployed Firestore ruleset for `ae-erp-d933d` via the
 * Firebase Rules REST API (Application Default credentials — the same
 * `applicationDefault()` the other live-diagnostic scripts use) and:
 *
 *   1. compares it, comment/whitespace-normalised, against the repo's
 *      `firestore.rules` (the file that was just deployed),
 *   2. asserts every Phase-8 / INVENTORY missing-document guard is present in
 *      the DEPLOYED content (not just the repo).
 *
 * Read-only. Issues zero writes. Prints no secrets. Run it right after
 * `firebase deploy --only firestore:rules --project ae-erp-d933d`.
 *
 * Usage:  node scripts/verify-deployed-rules-parity.cjs
 * Env:    GCLOUD_PROJECT (default ae-erp-d933d), GOOGLE_APPLICATION_CREDENTIALS
 *         or a `firebase login`'d gcloud/ADC context.
 *
 * Exit: 0 = deployed rules match the repo AND carry every required guard.
 *       1 = mismatch or a required guard is missing in the deployed rules.
 */
const fs = require('node:fs');
const path = require('node:path');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.DEMO_FIREBASE_PROJECT_ID || 'ae-erp-d933d';
const REPO_RULES = path.join(__dirname, '..', 'firestore.rules');

// Every guard/block that the deployed 2026-07-06 ruleset was missing and that
// the Phase-8 / INVENTORY release adds. Each must appear in the DEPLOYED text.
const REQUIRED_MARKERS = [
  // generic fallback missing-doc guard (products, serial_numbers, …)
  '!isSpecialCollection(collectionId) && (resource == null',
  // dedicated deterministic-lock / ledger / counter blocks
  'match /product_sku_locks/{lockId}',
  'match /stock_reservations/{reservationId}',
  'match /stock_transfers/{transferId}',
  'match /customer_returns/{returnId}',
  'match /dispatch_serials/{lockId}',
  // per-collection missing-doc guards
  'match /document_counters/{counterId}',
  'match /payments/{paymentId}',
  // GroupAdmin group-scope helpers
  'function groupAdminCanCreate(data)',
  'function actorGroupId()',
  'function groupIdMatchesCompany(data)',
];

function normalise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1')        // line comments (keep `://`)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function main() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });
  const client = await auth.getClient();

  const rel = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
  });
  const rulesetName = rel.data.rulesetName;
  console.log(`Active release -> ${rulesetName}`);

  const rs = await client.request({
    url: `https://firebaserules.googleapis.com/v1/${rulesetName}`,
  });
  const deployed = (rs.data.source.files || []).map((f) => f.content).join('\n');
  const createTime = rs.data.createTime;
  console.log(`Ruleset createTime -> ${createTime}`);

  const repo = fs.readFileSync(REPO_RULES, 'utf8');

  let ok = true;

  // 1. required markers present in the DEPLOYED text
  const missing = REQUIRED_MARKERS.filter((m) => !deployed.includes(m));
  if (missing.length) {
    ok = false;
    console.error('\n✗ DEPLOYED rules are MISSING required Phase-8 markers:');
    missing.forEach((m) => console.error(`    - ${m}`));
  } else {
    console.log('\n✓ every required Phase-8 / INVENTORY marker is present in the deployed rules');
  }

  // 2. normalised parity with the repo file
  if (normalise(deployed) === normalise(repo)) {
    console.log('✓ deployed rules match repo firestore.rules (comment/whitespace-normalised)');
  } else {
    ok = false;
    const dLines = normalise(deployed).split('\n');
    const rLines = normalise(repo).split('\n');
    console.error(`\n✗ deployed rules DIFFER from repo (deployed ${dLines.length} lines vs repo ${rLines.length} lines)`);
    let shown = 0;
    for (let i = 0; i < Math.max(dLines.length, rLines.length) && shown < 15; i++) {
      if (dLines[i] !== rLines[i]) {
        console.error(`  L${i + 1}\n    repo:     ${rLines[i] ?? '<none>'}\n    deployed: ${dLines[i] ?? '<none>'}`);
        shown++;
      }
    }
  }

  console.log(ok ? '\nPARITY OK' : '\nPARITY FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('probe failed:', err.message || err);
  process.exit(1);
});
