/**
 * POST /api/biometrics/verify — Face Attendance + DeepFace Master Plan, Phase 4.
 *
 * Authenticated Neozy API boundary for biometric verification. Always
 * self-service (Master Plan §12) — there is no target-user parameter here
 * by design (unlike /enroll).
 *
 * Request body: `{ image: string (base64) }`.
 * Response: `{ verified: true, userId, verifiedAt }` on success, or a
 * structured error — never a distance/confidence value, never the
 * stored/candidate embedding (Master Plan Phase 4 requirement 13/14:
 * "Return only the minimum information required by the client... Never
 * expose stored embeddings in an API response"). `verifiedAt` (Phase 8
 * addition) is the server-stamped freshness anchor
 * `AttendanceService.checkIn()`/`checkOut()` independently re-validates
 * before accepting a `source: 'biometric'` attendance write — see this
 * module's own `verifiedAt` field doc comment in
 * `api/_lib/biometrics/verification.ts`.
 *
 * Deliberately does NOT write an attendance record — see
 * `api/_lib/biometrics/verification.ts`'s own doc comment for the exact
 * Phase 4/Phase 8 boundary.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken } from '../_lib/auth';
import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit';
import { sendSuccess, sendError, sendInternalError } from '../_lib/response';
import { BiometricPipelineError, malformedImage } from '../../src/lib/biometrics/pipeline/types';
import { verifyBiometricFace } from '../_lib/biometrics/verification';
import { createDefaultBiometricReferenceStore } from '../_lib/biometrics/referenceStore';
import { createDefaultBiometricAuditWriter } from '../_lib/biometrics/audit';
import { resolveConfiguredProvider } from '../_lib/biometrics/providerConfig';
import { decodeBase64Image } from './enroll';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

const REASON_STATUS: Record<string, number> = {
  no_face: 422,
  multiple_faces: 422,
  poor_quality: 422,
  liveness_failed: 422,
  ambiguous_match: 422,
  verification_failed: 422,
  not_authorized: 403,
  cross_tenant_denied: 403,
  no_enrollment: 404,
  enrollment_revoked: 403,
  persistence_failed: 500,
  malformed_image: 400,
  provider_unavailable: 503,
  timeout: 504,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
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
    const body = (req.body || {}) as { image?: unknown };
    let frame: Uint8Array;
    try {
      frame = decodeBase64Image(body.image);
    } catch {
      throw malformedImage();
    }

    const provider = resolveConfiguredProvider();
    const result = await verifyBiometricFace(user, frame, {
      provider,
      store: createDefaultBiometricReferenceStore(),
      audit: createDefaultBiometricAuditWriter(),
    });

    return sendSuccess(res, { verified: result.verified, userId: result.userId, verifiedAt: result.verifiedAt });
  } catch (error) {
    if (error instanceof BiometricPipelineError) {
      const status = REASON_STATUS[error.reason] || 422;
      return sendError(res, status, error.reason.toUpperCase(), error.message);
    }
    return sendInternalError(res, 'Verification failed unexpectedly.');
  }
}
