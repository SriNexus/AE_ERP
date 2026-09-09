/**
 * POST /api/biometrics/enroll — Face Attendance + DeepFace Master Plan, Phase 4.
 *
 * Authenticated Neozy API boundary for biometric enrollment. Reuses this
 * repo's existing `api/_lib/auth.ts` token verification and
 * `api/_lib/rateLimit.ts` rate limiting exactly like every other route in
 * this directory (`api/[entity].ts`) — no new authentication mechanism.
 *
 * Request body: `{ image: string (base64), targetUserId?: string }`.
 * `targetUserId` is NEVER trusted as an identity anchor by itself — see
 * `api/_lib/biometrics/authorization.ts`'s `resolveEnrollmentTarget()` for
 * how it is independently re-validated against the target's own server-side
 * profile before anything is authorized.
 *
 * Response never includes the stored embedding or any raw image bytes —
 * only `{ enrolled, userId, reEnrolled }`.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuthToken } from '../_lib/auth.js';
import { checkRateLimit, getRateLimitKey } from '../_lib/rateLimit.js';
import { sendSuccess, sendError, sendBadRequest, sendInternalError } from '../_lib/response.js';
import { getAdminDb } from '../_lib/firebase.js';
import { COLLECTIONS } from '../../src/lib/collections.js';
import { BiometricPipelineError, malformedImage } from '../../src/lib/biometrics/pipeline/types.js';
import { enrollBiometricFace } from '../_lib/biometrics/enrollment.js';
import { createDefaultBiometricReferenceStore } from '../_lib/biometrics/referenceStore.js';
import { createDefaultBiometricAuditWriter } from '../_lib/biometrics/audit.js';
import { resolveConfiguredProvider } from '../_lib/biometrics/providerConfig.js';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
}

function decodeBase64Image(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) throw malformedImage();
  const commaIndex = value.indexOf(',');
  const raw = value.startsWith('data:') && commaIndex !== -1 ? value.slice(commaIndex + 1) : value;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw malformedImage();
  }
  if (buffer.length === 0) throw malformedImage();
  return new Uint8Array(buffer);
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
    const body = (req.body || {}) as { image?: unknown; targetUserId?: unknown };
    const frame = decodeBase64Image(body.image);
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : undefined;

    const db = getAdminDb();
    const provider = resolveConfiguredProvider();
    const result = await enrollBiometricFace(user, frame, targetUserId, {
      provider,
      store: createDefaultBiometricReferenceStore(),
      audit: createDefaultBiometricAuditWriter(),
      userReader: {
        async readUser(userId: string) {
          const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
          return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        },
      },
    });

    return sendSuccess(res, {
      enrolled: result.enrolled,
      userId: result.userId,
      reEnrolled: result.reEnrolled,
      ...(result.duplicateFaceWarning ? { duplicateFaceWarning: result.duplicateFaceWarning } : {}),
    });
  } catch (error) {
    if (error instanceof BiometricPipelineError) {
      const status = REASON_STATUS[error.reason] || 422;
      return sendError(res, status, error.reason.toUpperCase(), error.message);
    }
    return sendInternalError(res, 'Enrollment failed unexpectedly.');
  }
}

// Re-exported for tests only — never used by the handler above beyond
// input validation, so a malformed body is rejected before any provider
// call (Master Plan Phase 4 requirement 8: "Fail closed when a mandatory
// stage fails").
export { decodeBase64Image };
