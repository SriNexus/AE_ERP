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
 * mechanism every other route in this directory uses. Always self — reads
 * the CALLER's own reference (`user.erpUserId`), exactly like `verify.ts`;
 * there is no target-user parameter, by design (never a 1:N/employee-picker
 * surface).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken } from '../_lib/auth';
import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit';
import { sendSuccess, sendError, sendInternalError } from '../_lib/response';
import { createDefaultBiometricReferenceStore } from '../_lib/biometrics/referenceStore';

export type BiometricEnrollmentStatus = 'none' | 'active' | 'revoked';

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
    const store = createDefaultBiometricReferenceStore();
    const reference = await store.getReference(user.erpUserId);
    const status: BiometricEnrollmentStatus = !reference
      ? 'none'
      : reference.status === 'active'
        ? 'active'
        : 'revoked';

    // Deliberately the ONLY field returned — never `embedding`, never any
    // other reference field (model/detector metadata, history, etc.).
    return sendSuccess(res, { status });
  } catch {
    return sendInternalError(res, 'Could not determine enrollment status.');
  }
}
