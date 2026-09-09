/**
 * GET /api/biometrics/status — Face Attendance product-integration follow-up
 * (post-Phase-13), closing the gap identified when wiring the real employee
 * UX: the frontend needs to know, BEFORE opening the camera, whether the
 * authenticated employee already has an active biometric reference — so it
 * can show "Mark Attendance" (first-time, enroll-then-verify) vs "Check
 * In"/"Check Out" (verify-only) and the right in-camera copy.
 *
 * Deliberately NOT a client-SDK Firestore read of `biometric_face_references`
 * (even though `firestore.rules`' `biometricReadAllowed()` already permits an
 * employee to read their OWN reference document) — that document also
 * carries the full `embedding` array, and reading the whole document client-
 * side would transmit it to the browser, violating this initiative's
 * permanent "never expose stored embeddings to the client" rule (Phase 4
 * requirement 13/14, restated throughout every phase). This route is a thin,
 * Admin-SDK-backed PROJECTION of the existing `biometric_face_references`
 * collection via the existing `referenceStore.ts` — reusing the exact same
 * store `enroll.ts`/`verify.ts` already use, never a second storage model —
 * and returns ONLY a status enum, never the embedding or any other field.
 *
 * Authenticated via the same `api/_lib/auth.ts`/`api/_lib/rateLimit.ts`
 * mechanism every other route in this directory uses.
 *
 * Employee-View "Register Face" follow-up: optionally accepts `?targetUserId=`
 * so an Admin/HR viewer can see ANOTHER employee's enrollment status (to
 * render "Not Registered" / "Face Registered" / "Revoked" in the Employee
 * View popup) — reusing the EXACT SAME `resolveEnrollmentTarget()`
 * authorization `api/biometrics/enroll.ts` already uses for on-behalf-of
 * enrollment (self, or Admin/HR/SuperAdmin of the SAME company; cross-tenant
 * and inactive-target are rejected there). No new authorization model. Omit
 * the param (or pass your own id) for the original self-only behavior —
 * every existing caller is unaffected.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken } from '../_lib/auth.js';
import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit.js';
import { sendSuccess, sendError, sendInternalError } from '../_lib/response.js';
import { getAdminDb } from '../_lib/firebase.js';
import { COLLECTIONS } from '../../src/lib/collections.js';
import { createDefaultBiometricReferenceStore } from '../_lib/biometrics/referenceStore.js';
import { resolveEnrollmentTarget } from '../_lib/biometrics/authorization.js';
import { BiometricPipelineError } from '../../src/lib/biometrics/pipeline/types.js';

export type BiometricEnrollmentStatus = 'none' | 'active' | 'revoked';

const REASON_STATUS: Record<string, number> = {
  not_authorized: 403,
  cross_tenant_denied: 403,
};

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
  }

  const user = await verifyAuthToken(req.headers.authorization, req.headers['x-api-key'] as string | undefined);
  if (!user) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required. Provide a Firebase ID token (Bearer) or API key (X-API-Key header).');
  }

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress;
  const rateCheck = checkRateLimit(getRateLimitKey(user.uid, clientIp));
  if (!rateCheck.allowed) {
    return sendError(res, 429, 'RATE_LIMITED', `Too many requests. Try again after ${Math.ceil((rateCheck.resetAt - Date.now()) / 1000)} seconds.`);
  }

  try {
    const requestedTargetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined;
    const db = getAdminDb();
    const target = await resolveEnrollmentTarget(user, requestedTargetUserId, {
      async readUser(userId: string) {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        return snap.exists ? (snap.data() as Record<string, unknown>) : null;
      },
    });

    const store = createDefaultBiometricReferenceStore();
    const reference = await store.getReference(target.targetUserId);
    const status: BiometricEnrollmentStatus = !reference
      ? 'none'
      : reference.status === 'active'
        ? 'active'
        : 'revoked';

    // Deliberately the ONLY field returned — never `embedding`, never any
    // other reference field (model/detector metadata, history, etc.).
    return sendSuccess(res, { status });
  } catch (error) {
    if (error instanceof BiometricPipelineError) {
      const status = REASON_STATUS[error.reason] || 422;
      return sendError(res, status, error.reason.toUpperCase(), error.message);
    }
    return sendInternalError(res, 'Could not determine enrollment status.');
  }
}
