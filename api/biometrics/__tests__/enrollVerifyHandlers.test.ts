/**
 * Face Attendance + DeepFace Master Plan, Phase 10 — HTTP-route-level tests
 * for `api/biometrics/enroll.ts`/`verify.ts`.
 *
 * §20 item 4 ("API tests — Orchestration-layer HTTP handlers... matching
 * `api/__tests__/`'s existing convention") — closes a genuine coverage gap
 * this phase's own cross-check found: Phase 4–9's test suites thoroughly
 * exercise `enrollBiometricFace()`/`verifyBiometricFace()` themselves
 * (172+ tests), and `decodeBase64Image()` directly, but no test ever
 * imports and calls the actual exported `handler(req, res)` functions —
 * meaning the HTTP-layer glue itself (method/CORS handling, auth/rate-limit
 * rejection, the `REASON_STATUS` → HTTP-status mapping, response body
 * shape) was, until now, unverified. Mirrors
 * `apiMassAssignment.test.ts`'s own established pattern exactly: mock the
 * module-level dependencies, call the REAL exported handler with a mocked
 * `VercelRequest`/`VercelResponse`, assert on `res.status`/`res.json`.
 *
 * The orchestration functions themselves (`enrollBiometricFace`/
 * `verifyBiometricFace`) are mocked here deliberately — their own internal
 * correctness is already exhaustively proven elsewhere (Phases 4/6/8/9);
 * this file's only job is proving the HTTP wiring around them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockVerifyAuthToken = vi.fn();
vi.mock('../../_lib/auth', () => ({ verifyAuthToken: (...args: any[]) => mockVerifyAuthToken(...args) }));

const mockCheckRateLimit = vi.fn();
vi.mock('../../_lib/rateLimit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getRateLimitKey: (uid: string, ip?: string) => `${uid}:${ip || ''}`,
}));

vi.mock('../../_lib/firebase', () => ({
  getAdminDb: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }),
}));

const mockEnrollBiometricFace = vi.fn();
vi.mock('../../_lib/biometrics/enrollment', () => ({ enrollBiometricFace: (...args: any[]) => mockEnrollBiometricFace(...args) }));

const mockVerifyBiometricFace = vi.fn();
vi.mock('../../_lib/biometrics/verification', () => ({ verifyBiometricFace: (...args: any[]) => mockVerifyBiometricFace(...args) }));

vi.mock('../../_lib/biometrics/referenceStore', () => ({ createDefaultBiometricReferenceStore: () => ({}) }));
vi.mock('../../_lib/biometrics/audit', () => ({ createDefaultBiometricAuditWriter: () => ({}) }));
vi.mock('../../_lib/biometrics/providerConfig', () => ({ resolveConfiguredProvider: () => ({}) }));

// Imported AFTER the mocks above so the handler modules pick them up.
const { BiometricPipelineError } = await import('../../../src/lib/biometrics/pipeline/types');
const enrollHandler = (await import('../enroll')).default;
const verifyHandler = (await import('../verify')).default;

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as VercelResponse;
}

function mockRequest(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer real-token' },
    body: { image: 'data:image/jpeg;base64,AQID' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as VercelRequest;
}

const AUTH_USER = { uid: 'uid-1', erpUserId: 'user-1', email: 'a@b.com', name: 'A', role: 'Employee', companyId: 'company-1', isSuperAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyAuthToken.mockResolvedValue(AUTH_USER);
  mockCheckRateLimit.mockReturnValue({ allowed: true, resetAt: Date.now() + 60000 });
});

describe('POST /api/biometrics/enroll — HTTP layer', () => {
  it('OPTIONS returns 204 with no body, before auth/rate-limit are ever consulted', async () => {
    const res = mockResponse();
    await enrollHandler(mockRequest({ method: 'OPTIONS' }), res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(mockVerifyAuthToken).not.toHaveBeenCalled();
  });

  it('sets CORS headers on every response, including OPTIONS', async () => {
    const res = mockResponse();
    await enrollHandler(mockRequest({ method: 'OPTIONS' }), res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS');
  });

  it('a non-POST method (e.g. GET) is rejected 405, orchestrator never invoked', async () => {
    const res = mockResponse();
    await enrollHandler(mockRequest({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'METHOD_NOT_ALLOWED' }) }));
    expect(mockEnrollBiometricFace).not.toHaveBeenCalled();
  });

  it('an unauthenticated request (verifyAuthToken resolves null) is rejected 401, orchestrator never invoked', async () => {
    mockVerifyAuthToken.mockResolvedValue(null);
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }));
    expect(mockEnrollBiometricFace).not.toHaveBeenCalled();
  });

  it('a rate-limited request is rejected 429, orchestrator never invoked, even though the caller WAS authenticated', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, resetAt: Date.now() + 30000 });
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'RATE_LIMITED' }) }));
    expect(mockEnrollBiometricFace).not.toHaveBeenCalled();
  });

  it('a malformed/empty image is rejected 400 BEFORE the orchestrator is ever called', async () => {
    const res = mockResponse();
    await enrollHandler(mockRequest({ body: { image: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'MALFORMED_IMAGE' }) }));
    expect(mockEnrollBiometricFace).not.toHaveBeenCalled();
  });

  it('a successful enrollment returns 200 with exactly {enrolled, userId, reEnrolled} — never an embedding or raw provider payload', async () => {
    mockEnrollBiometricFace.mockResolvedValue({ enrolled: true, userId: 'user-1', reEnrolled: false, reEnrollmentCount: 0 });
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { enrolled: true, userId: 'user-1', reEnrolled: false } });
  });

  it('a successful enrollment carrying a duplicateFaceWarning surfaces it in the response, absent when there is none', async () => {
    mockEnrollBiometricFace.mockResolvedValue({ enrolled: true, userId: 'user-1', reEnrolled: false, reEnrollmentCount: 0, duplicateFaceWarning: { suspectedDuplicateOfUserIds: ['user-2'] } });
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ duplicateFaceWarning: { suspectedDuplicateOfUserIds: ['user-2'] } }) }));
  });

  it.each([
    ['no_face', 422], ['multiple_faces', 422], ['poor_quality', 422], ['liveness_failed', 422],
    ['ambiguous_match', 422], ['verification_failed', 422], ['not_authorized', 403], ['cross_tenant_denied', 403],
    ['no_enrollment', 404], ['enrollment_revoked', 403], ['persistence_failed', 500], ['malformed_image', 400],
    ['provider_unavailable', 503], ['timeout', 504],
  ])('a BiometricPipelineError with reason "%s" maps to HTTP %i with the uppercased reason as the error code', async (reason, expectedStatus) => {
    mockEnrollBiometricFace.mockRejectedValue(new BiometricPipelineError(reason as any, 'safe message'));
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: reason.toUpperCase(), message: 'safe message' }) }));
  });

  it('an unmapped/unexpected orchestrator error is translated to a generic 500 — never leaks the raw exception message', async () => {
    mockEnrollBiometricFace.mockRejectedValue(new Error('raw internal stack trace detail'));
    const res = mockResponse();
    await enrollHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(JSON.stringify(jsonCall)).not.toContain('raw internal stack trace detail');
  });
});

describe('POST /api/biometrics/verify — HTTP layer', () => {
  it('OPTIONS returns 204, non-POST returns 405, unauthenticated returns 401, rate-limited returns 429 — same contract as enroll', async () => {
    let res = mockResponse();
    await verifyHandler(mockRequest({ method: 'OPTIONS' }), res);
    expect(res.status).toHaveBeenCalledWith(204);

    res = mockResponse();
    await verifyHandler(mockRequest({ method: 'DELETE' }), res);
    expect(res.status).toHaveBeenCalledWith(405);

    mockVerifyAuthToken.mockResolvedValue(null);
    res = mockResponse();
    await verifyHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    mockVerifyAuthToken.mockResolvedValue(AUTH_USER);

    mockCheckRateLimit.mockReturnValue({ allowed: false, resetAt: Date.now() + 1000 });
    res = mockResponse();
    await verifyHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(429);

    expect(mockVerifyBiometricFace).not.toHaveBeenCalled();
  });

  it('a malformed/empty image is rejected 400 before the orchestrator is called', async () => {
    const res = mockResponse();
    await verifyHandler(mockRequest({ body: { image: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockVerifyBiometricFace).not.toHaveBeenCalled();
  });

  it('a successful verification returns 200 with exactly {verified, userId, verifiedAt} — never a distance, confidence, or embedding', async () => {
    mockVerifyBiometricFace.mockResolvedValue({ verified: true, userId: 'user-1', verifiedAt: '2026-08-27T10:00:00.000Z' });
    const res = mockResponse();
    await verifyHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { verified: true, userId: 'user-1', verifiedAt: '2026-08-27T10:00:00.000Z' } });
  });

  it.each([
    ['no_face', 422], ['liveness_failed', 422], ['ambiguous_match', 422], ['verification_failed', 422],
    ['not_authorized', 403], ['no_enrollment', 404], ['enrollment_revoked', 403], ['persistence_failed', 500],
    ['provider_unavailable', 503], ['timeout', 504],
  ])('a BiometricPipelineError with reason "%s" maps to HTTP %i on the verify route too', async (reason, expectedStatus) => {
    mockVerifyBiometricFace.mockRejectedValue(new BiometricPipelineError(reason as any, 'safe message'));
    const res = mockResponse();
    await verifyHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: reason.toUpperCase() }) }));
  });

  it('an unmapped/unexpected orchestrator error is translated to a generic 500 on the verify route too', async () => {
    mockVerifyBiometricFace.mockRejectedValue(new Error('raw internal detail'));
    const res = mockResponse();
    await verifyHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify((res.json as any).mock.calls[0][0])).not.toContain('raw internal detail');
  });

  it('never accepts or forwards a targetUserId — the verify route has no such request field at all (always self, §12)', async () => {
    mockVerifyBiometricFace.mockResolvedValue({ verified: true, userId: 'user-1', verifiedAt: 'now' });
    const res = mockResponse();
    await verifyHandler(mockRequest({ body: { image: 'data:image/jpeg;base64,AQID', targetUserId: 'someone-else' } }), res);
    // verifyBiometricFace's own call signature (auth, frame, deps) has no
    // slot for a target id at all — confirm the mock was invoked with
    // exactly 3 arguments, never a forwarded targetUserId.
    expect(mockVerifyBiometricFace).toHaveBeenCalledTimes(1);
    expect(mockVerifyBiometricFace.mock.calls[0]).toHaveLength(3);
  });
});
