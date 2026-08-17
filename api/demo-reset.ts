/**
 * POST /api/demo-reset — Neozy Sandbox Engine reset endpoint
 *
 * Resets the demo sandbox to a clean state:
 * 1. Authenticates the caller (must be demo user)
 * 2. Verifies rate limit
 * 3. Deletes all existing demo data (preserving identity docs)
 * 4. Seeds fresh demo data using the deterministic plan
 * 5. Returns success summary
 *
 * Rate-limited: max 1 reset per 5 minutes per user.
 *
 * IMPORTANT (Phase 15.1 correction): this endpoint used to build its own,
 * separate, hand-written "V1" demo dataset — a handful of hardcoded
 * customers/projects that never set Customer.type at all and had no
 * B2B/B2C concept whatsoever. Because src/pages/Login.tsx calls this
 * endpoint on every first login per browser for demo@neozy.in (see
 * src/lib/sandboxReset.ts), that hand-written dataset — not the
 * extensively audited scripts/demo/datasets/businessGraph.ts generator —
 * was what actually landed in the LIVE demo Firestore for real users. That
 * is the confirmed root cause of the "B2B customer shows a Project"
 * screenshots: this endpoint's old dataset never modeled B2B/B2C at all,
 * so nothing here enforced (or even could have enforced) the invariant the
 * generator itself has always upheld. Fixed by seeding from the SAME
 * deterministic buildCompleteDemoPlan() every other demo entry point
 * (npm run demo:seed / demo:reset, and the nightly GitHub Actions
 * demo-reset workflow) already uses, and by deleting from the same
 * authoritative DEMO_RESETTABLE_COLLECTIONS list instead of a hand-typed
 * collection list that had silently drifted out of sync with it (missing
 * 'documents' and 'entity_relationships', among others — meaning those
 * collections were never even cleared on a login-triggered reset).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminDb } from './_lib/firebase';
import { verifyAuthToken } from './_lib/auth';
import { DEMO_ERP_USER_ID } from '../src/config/demo';
import { isOfficialDemoCompany } from '../src/config/demo';
import { DEMO_COMPANY_ID, DEMO_RESETTABLE_COLLECTIONS, DEMO_SEED_ID } from '../scripts/demo/config.ts';
import { buildCompleteDemoPlan } from '../scripts/demo/datasets/complete.ts';
import { FieldValue } from 'firebase-admin/firestore';

// ── Rate limiting ────────────────────────────────────────────
const RESET_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const resetTimestamps = new Map<string, number>();

function checkResetRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const lastReset = resetTimestamps.get(userId);
  if (lastReset && Date.now() - lastReset < RESET_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESET_COOLDOWN_MS - (Date.now() - lastReset)) / 1000);
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

function recordReset(userId: string): void {
  resetTimestamps.set(userId, Date.now());
}

// ── Identity documents to preserve on reset ──────────────────
const PRESERVED_COLLECTIONS = new Set<string>(['user_auth_maps']);
const PRESERVED_DOC_IDS = new Set<string>([DEMO_ERP_USER_ID]);

// ── CORS headers ─────────────────────────────────────────────
function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Delete all demo documents ─────────────────────────────────
async function deleteDemoData(db: FirebaseFirestore.Firestore): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};

  for (const collection of DEMO_RESETTABLE_COLLECTIONS) {
    try {
      const snap = await db.collection(collection)
        .where('companyId', '==', DEMO_COMPANY_ID)
        .get();

      if (snap.empty) {
        deleted[collection] = 0;
        continue;
      }

      let count = 0;
      const batch = db.batch();
      for (const doc of snap.docs) {
        if (PRESERVED_DOC_IDS.has(doc.id) && PRESERVED_COLLECTIONS.has(collection)) continue;
        batch.delete(doc.ref);
        count++;
      }
      if (count > 0) await batch.commit();
      deleted[collection] = count;
    } catch (error) {
      console.warn(`[demo-reset] Failed to delete from ${collection}:`, error);
      deleted[collection] = -1; // error indicator
    }
  }

  return deleted;
}

// ── Seed demo documents ───────────────────────────────────────
// Uses the SAME deterministic plan (scripts/demo/datasets/complete.ts) every
// other demo entry point uses — the CLI (npm run demo:seed / demo:reset) and
// the nightly GitHub Actions demo-reset workflow — so a login-triggered
// reset can never diverge from the audited B2B/B2C-correct dataset again.
async function seedDemoData(db: FirebaseFirestore.Firestore, authUid: string): Promise<Record<string, number>> {
  const plan = buildCompleteDemoPlan(authUid);
  const counts: Record<string, number> = {};
  let batch = db.batch();
  let ops = 0;

  for (const record of plan.documents) {
    const ref = db.collection(record.collection).doc(record.id);
    batch.set(ref, {
      ...record.data,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: record.data.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });

    counts[record.collection] = (counts[record.collection] || 0) + 1;
    ops++;

    // Firestore batch limit is 500
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return counts;
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed.' },
    });
  }

  try {
    // Authenticate
    const user = await verifyAuthToken(req.headers.authorization as string | undefined);
    if (!user || user.uid === 'api-user') {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Demo user authentication required.' },
      });
    }

    // Verify this is the demo company
    if (!isOfficialDemoCompany(user.companyId)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only demo users can trigger a sandbox reset.' },
      });
    }

    // Rate limit check
    const rateCheck = checkResetRateLimit(user.uid);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Sandbox reset is rate-limited. Try again in ${rateCheck.retryAfter} seconds.`,
        },
      });
    }

    const db = getAdminDb();

    // Step 1: Delete existing demo data
    const deleted = await deleteDemoData(db);
    const totalDeleted = Object.values(deleted).reduce((sum, c) => sum + (c > 0 ? c : 0), 0);

    // Step 2: Seed fresh data from the audited deterministic plan. authUid
    // must be the caller's real Firebase Auth UID (not the fixed
    // DEMO_ERP_USER_ID constant) — buildFoundationPlan() uses it as the
    // user_auth_maps document id, exactly like resolveOfficialDemoAuthUser()
    // does for the CLI/GitHub Actions reset path.
    const seeded = await seedDemoData(db, user.uid);
    const totalSeeded = Object.values(seeded).reduce((sum, c) => sum + c, 0);

    // Step 3: Record the reset timestamp
    recordReset(user.uid);

    return res.status(200).json({
      success: true,
      data: {
        message: 'Sandbox reset complete.',
        deleted: totalDeleted,
        deletedByCollection: deleted,
        seeded: totalSeeded,
        seededByCollection: seeded,
        companyId: DEMO_COMPANY_ID,
        seedVersion: DEMO_SEED_ID,
      },
    });
  } catch (error: any) {
    console.error('[demo-reset] Error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Sandbox reset failed. Please try again later.' },
    });
  }
}
