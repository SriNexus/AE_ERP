/**
 * Backfill Settlements — Migration Utility (Phase 2F.7)
 *
 * Purpose:
 *   Backfills existing settlement data from `partner_wallet_transactions`
 *   into the new dedicated `settlements` collection.
 *
 * This migration is necessary because settlement records were previously
 * embedded inside `partner_wallet_transactions` (co-mingled with wallet
 * credits, withdrawals, and adjustments).
 *
 * Rules:
 *   - Idempotent: skips documents that already exist in settlements collection
 *   - Dry-run support: pass --dry-run to see what would be migrated
 *   - Logs progress to console
 *   - Dual-write period: existing data in partner_wallet_transactions remains
 *
 * Usage:
 *   npx ts-node --esm scripts/backfill-settlements.ts
 *   npx ts-node --esm scripts/backfill-settlements.ts --dry-run
 *   npx ts-node --esm scripts/backfill-settlements.ts --company COMPANY_ID
 *
 * IMPORTANT:
 *   - Do NOT run this automatically.
 *   - Run manually after deploy to ensure all existing settlement records
 *     are available in the `settlements` collection.
 *   - After verification, the dual-write period may be ended and consumers
 *     may be updated to read exclusively from `settlements`.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  query,
  where,
  limit,
  type Firestore,
} from 'firebase/firestore';

// ── Configuration ───────────────────────────────────────────
// These Firestore collection names should match src/lib/firebase.ts
const COLLECTION_WALLET_TXNS = 'partner_wallet_transactions';
const COLLECTION_SETTLEMENTS = 'settlements';

const BATCH_SIZE = 50;

// ── Firebase Init ───────────────────────────────────────────
function initFirebase(): { db: Firestore; app: FirebaseApp } {
  const firebaseConfig = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };

  const app = getApps()[0] ?? initializeApp(firebaseConfig as any);
  const db = getFirestore(app);
  return { db, app };
}

// ── CLI Args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TARGET_COMPANY = args.find((a) => a.startsWith('--company='))?.split('=')[1] || null;

// ── Progress Logging ────────────────────────────────────────
let processedCount = 0;
let skippedCount = 0;
let createdCount = 0;
let errorCount = 0;

function logProgress() {
  console.log(
    `[Backfill] Processed: ${processedCount} | Created: ${createdCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`
  );
}

function logSummary() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  BACKFILL MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:           ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Total processed: ${processedCount}`);
  console.log(`  Created:         ${createdCount}`);
  console.log(`  Skipped (exists): ${skippedCount}`);
  console.log(`  Errors:          ${errorCount}`);
  console.log('═══════════════════════════════════════════════════\n');
}

// ── Main Migration Logic ────────────────────────────────────
async function backfillSettlements() {
  const { db } = initFirebase();

  console.log('═══════════════════════════════════════════════════');
  console.log('  SETTLEMENT BACKFILL MIGRATION');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (TARGET_COMPANY) console.log(`  Company filter: ${TARGET_COMPANY}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Step 1: Query all existing settlement records from the settlement collection
  // (to know which ones already exist and skip them)
  const existingSettlementIds = new Set<string>();
  const settlementSnap = await getDocs(
    collection(db, COLLECTION_SETTLEMENTS)
  );
  settlementSnap.docs.forEach((d) => {
    existingSettlementIds.add(d.id);
  });
  console.log(`[Backfill] Found ${existingSettlementIds.size} existing settlement records.\n`);

  // Step 2: Query wallet transactions that are settlements (have commissionIds array)
  const walletQuery = TARGET_COMPANY
    ? query(
        collection(db, COLLECTION_WALLET_TXNS),
        where('companyId', '==', TARGET_COMPANY),
        where('commissionIds', '!=', null),
        limit(BATCH_SIZE)
      )
    : query(
        collection(db, COLLECTION_WALLET_TXNS),
        where('commissionIds', '!=', null),
        limit(BATCH_SIZE)
      );

  let hasMore = true;
  let lastDoc: any = null;

  while (hasMore) {
    const batchQuery = lastDoc
      ? query(
          collection(db, COLLECTION_WALLET_TXNS),
          where('commissionIds', '!=', null),
          ...(TARGET_COMPANY ? [where('companyId', '==', TARGET_COMPANY)] : []),
          limit(BATCH_SIZE)
        )
      : walletQuery;

    const batchSnap = await getDocs(batchQuery);

    if (batchSnap.empty) {
      hasMore = false;
      break;
    }

    for (const docSnap of batchSnap.docs) {
      processedCount++;
      const data = docSnap.data() as Record<string, unknown>;
      const docId = docSnap.id;

      // Skip if document has no commissionIds (not a settlement)
      const commissionIds = data.commissionIds;
      if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
        skippedCount++;
        continue;
      }

      // Check if already backfilled
      if (existingSettlementIds.has(docId)) {
        skippedCount++;
        continue;
      }

      // Build settlement record
      const settlementRecord = {
        id: docId,
        companyId: data.companyId || '',
        partnerId: data.partnerId || '',
        partnerName: data.partnerName || '',
        commissionIds: commissionIds.map(String),
        commissionCount: data.commissionCount || commissionIds.length,
        totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : 0,
        walletTransactionId: docId,
        status: data.status || 'pending',
        processedBy: data.processedBy || '',
        processedAt: data.processedAt || '',
        completedAt: data.completedAt || '',
        failedAt: data.failedAt || '',
        failureReason: data.failureReason || '',
        cancelledBy: data.cancelledBy || '',
        cancelledAt: data.cancelledAt || '',
        cancellationReason: data.cancellationReason || '',
        successCount: typeof data.successCount === 'number' ? data.successCount : 0,
        skippedCount: typeof data.skippedCount === 'number' ? data.skippedCount : 0,
        failedCount: typeof data.failedCount === 'number' ? data.failedCount : 0,
        createdBy: data.createdBy || '',
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
        isDeleted: Boolean(data.isDeleted),
      };

      // Check for duplicates in the collection (avoid race condition with the set)
      const existingDoc = await getDoc(doc(db, COLLECTION_SETTLEMENTS, docId));
      if (existingDoc.exists()) {
        skippedCount++;
        if (processedCount % 10 === 0) logProgress();
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Would create settlement: ${docId} (partner: ${settlementRecord.partnerName || settlementRecord.partnerId}, amount: ${settlementRecord.totalAmount})`);
      } else {
        await setDoc(doc(db, COLLECTION_SETTLEMENTS, docId), settlementRecord);
        console.log(`  [LIVE] Created settlement: ${docId} (partner: ${settlementRecord.partnerName || settlementRecord.partnerId}, amount: ₹${settlementRecord.totalAmount})`);
      }
      createdCount++;

      if (processedCount % 10 === 0) logProgress();
    }

    // Check if there are more results
    const lastVisible = batchSnap.docs[batchSnap.docs.length - 1];
    if (lastVisible) {
      lastDoc = lastVisible;
    }

    if (batchSnap.docs.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  logSummary();
}

// ── Run ─────────────────────────────────────────────────────
backfillSettlements().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
