#!/usr/bin/env node
/**
 * record-backup-status.cjs — records a `backup_metadata` document for the
 * nightly Firestore managed export (.github/workflows/firestore-backup.yml),
 * per Master Plan §3.1 / §12.5.
 *
 * Uses firebase-admin's applicationDefault() credential (the workflow's
 * Workload Identity Federation service account) — the Admin SDK bypasses
 * Firestore rules by design, which is exactly the intended boundary: the
 * collection's rules block (firestore.rules, Phase 0) restricts client access
 * to Super Admin read-only, so only this automation (or a Super Admin via the
 * Admin SDK) can write it.
 *
 * Follows the repository's migration-script convention (Master Plan §16.8):
 * DRY-RUN by default, `--apply` required to write, deterministic document id
 * (safe to re-run — a rerun overwrites the same id, never duplicates).
 *
 * Usage:
 *   node scripts/record-backup-status.cjs \
 *     --id 20260817-0115 \
 *     --status Running|Success|Failed \
 *     [--uri gs://bucket/firestore/20260817-011500] \
 *     [--sizeBytes 123456] \
 *     [--error "message"] \
 *     [--collections all] \
 *     [--triggeredBy scheduled|manual] \
 *     [--apply]
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    args[key.slice(2)] = value === undefined || value.startsWith('--') ? true : value;
    if (value !== undefined && !value.startsWith('--')) i++;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const id = args.id || new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const status = args.status || 'Running';
  const uri = typeof args.uri === 'string' ? args.uri : '';
  const sizeBytes = args.sizeBytes ? Number(args.sizeBytes) : undefined;
  const errorMessage = typeof args.error === 'string' ? args.error : '';
  const collections = typeof args.collections === 'string' ? String(args.collections).split(',').map((c) => c.trim()).filter(Boolean) : ['all'];
  const triggeredBy = args.triggeredBy === 'manual' ? 'manual' : 'scheduled';
  const apply = args.apply === true;

  if (!['Running', 'Success', 'Failed'].includes(status)) {
    console.error(`Invalid --status "${status}" (expected Running|Success|Failed).`);
    process.exit(2);
  }

  const now = new Date().toISOString();
  const doc = {
    id,
    startedAt: now,
    completedAt: status === 'Running' ? undefined : now,
    status,
    ...(uri ? { exportUri: uri } : {}),
    collectionsIncluded: collections,
    ...(sizeBytes !== undefined && Number.isFinite(sizeBytes) ? { sizeBytes } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    triggeredBy,
  };

  console.log(`[record-backup-status] ${apply ? 'WRITE' : 'DRY-RUN'} backup_metadata/${id}`);
  console.log(JSON.stringify(doc, null, 2));
  if (!apply) {
    console.log('(dry-run — pass --apply to write)');
    return;
  }

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  await db.collection('backup_metadata').doc(id).set(doc);
  console.log(`[record-backup-status] Wrote backup_metadata/${id} (status=${status}).`);
}

main().catch((error) => {
  console.error('[record-backup-status] Failed:', error);
  process.exit(1);
});
