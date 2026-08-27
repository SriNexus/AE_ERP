/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * HTTP-route-level tests for `api/biometrics/status.ts`, mirroring
 * `enrollVerifyHandlers.test.ts`'s own established pattern exactly: mock the
 * module-level dependencies (ESM imports, real `vi.mock()` interception —
 * this route has no CommonJS `require()`/dynamic-import hazard of the kind
 * found and fixed in `functions/index.js`'s own test, see that file's
 * Phase 11 completion record), call the REAL exported handler with a mocked
 * `VercelRequest`/`VercelResponse`, assert on `res.status`/`res.json`.
 *
 * The one thing this route must never do — return the embedding or any
 * field beyond `{status}` — is asserted directly against the exact response
 * body shape, not just "no error thrown".
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

const mockGetReference = vi.fn();
vi.mock('../../_lib/biometrics/referenceStore', () => ({
  createDefaultBiometricReferenceStore: () => ({ getReference: (...args: any[]) => mockGetReference(...args) }),
}));

// Imported AFTER the mocks above so the handler module picks them up.
const statusHandler = (await import('../status')).default;

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
    method: 'GET',
    headers: { authorization: 'Bearer real-token' },
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

describe('GET /api/biometrics/status — HTTP layer', () => {
  it('OPTIONS returns 204 with no body, before auth/rate-limit are ever consulted', async () => {
    const res = mockResponse();
    await statusHandler(mockRequest({ method: 'OPTIONS' }), res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(mockVerifyAuthToken).not.toHaveBeenCalled();
  });

  it('sets CORS headers on every response, including OPTIONS', async () => {
    const res = mockResponse();
    await statusHandler(mockRequest({ method: 'OPTIONS' }), res);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, OPTIONS');
  });

  it('a non-GET method (e.g. POST) is rejected 405', async () => {
    const res = mockResponse();
    await statusHandler(mockRequest({ method: 'POST' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockVerifyAuthToken).not.toHaveBeenCalled();
  });

  it('an unauthenticated request is rejected 401, store never touched', async () => {
    mockVerifyAuthToken.mockResolvedValue(null);
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockGetReference).not.toHaveBeenCalled();
  });

  it('a rate-limited request is rejected 429, store never touched', async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, resetAt: Date.now() + 5000 });
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockGetReference).not.toHaveBeenCalled();
  });

  it('no reference document at all -> {status: "none"}', async () => {
    mockGetReference.mockResolvedValue(null);
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(mockGetReference).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'none' } });
  });

  it('an active reference -> {status: "active"}', async () => {
    mockGetReference.mockResolvedValue({ id: 'user-1', userId: 'user-1', companyId: 'company-1', status: 'active', embedding: [0.1, 0.2] });
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'active' } });
  });

  it('a revoked reference -> {status: "revoked"}', async () => {
    mockGetReference.mockResolvedValue({ id: 'user-1', userId: 'user-1', companyId: 'company-1', status: 'revoked', embedding: [0.1, 0.2] });
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'revoked' } });
  });

  it('the response body NEVER includes the embedding or any field beyond {status} — the exact shape is asserted, not just "no throw"', async () => {
    mockGetReference.mockResolvedValue({
      id: 'user-1', userId: 'user-1', companyId: 'company-1', status: 'active',
      embedding: [0.123456, 0.654321], embeddingModel: 'ArcFace', history: [{ enrolledAt: 'x', enrolledBy: 'y' }],
    });
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    const call = (res.json as any).mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(['status']);
  });

  it('always reads the CALLER OWN erpUserId — never a client-suppliable target field (no such field exists on the request shape at all)', async () => {
    mockGetReference.mockResolvedValue(null);
    const res = mockResponse();
    // Even a request body that TRIES to smuggle a target field is ignored —
    // this route reads no body at all.
    await statusHandler(mockRequest({ body: { targetUserId: 'someone-else' } } as any), res);
    expect(mockGetReference).toHaveBeenCalledWith('user-1');
    expect(mockGetReference).not.toHaveBeenCalledWith('someone-else');
  });

  it('a store failure is mapped to a safe 500, never a raw exception leaked to the caller', async () => {
    mockGetReference.mockRejectedValue(new Error('Firestore is on fire, do not repeat this message to the client'));
    const res = mockResponse();
    await statusHandler(mockRequest(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    const call = (res.json as any).mock.calls[0][0];
    expect(JSON.stringify(call)).not.toContain('on fire');
  });
});
