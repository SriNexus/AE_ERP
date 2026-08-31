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
 *
 * Final completion pass: this route now optionally accepts `?targetUserId=`
 * (Employee-View "Register Face" follow-up) — authorized via the REAL,
 * unmocked `resolveEnrollmentTarget()` (the exact same function
 * `enroll.ts` already uses for on-behalf-of enrollment), so `getAdminDb()`
 * is mocked with a CONFIGURABLE `readUser`-backing stub (unlike
 * `enrollVerifyHandlers.test.ts`, which mocks the whole orchestration
 * function away — `status.ts` has no such orchestration layer of its own,
 * so `resolveEnrollmentTarget()` genuinely runs here).
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

// Backs resolveEnrollmentTarget()'s `readUser()` dependency for the
// on-behalf-of (targetUserId) case — never called at all for the self case
// (resolveEnrollmentTarget short-circuits before touching Firestore).
const mockUserDocGet = vi.fn();
vi.mock('../../_lib/firebase', () => ({
  getAdminDb: () => ({ collection: () => ({ doc: () => ({ get: (...args: any[]) => mockUserDocGet(...args) }) }) }),
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
    query: {},
    ...overrides,
  } as unknown as VercelRequest;
}

const AUTH_USER = { uid: 'uid-1', erpUserId: 'user-1', email: 'a@b.com', name: 'A', role: 'Employee', companyId: 'company-1', isSuperAdmin: false };
const ADMIN_USER = { uid: 'uid-admin', erpUserId: 'admin-1', email: 'admin@b.com', name: 'Admin', role: 'Admin', companyId: 'company-1', isSuperAdmin: false };

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

  it('a request body smuggling a target field is ignored — targeting is query-string only (?targetUserId=), never read from the body', async () => {
    mockGetReference.mockResolvedValue(null);
    const res = mockResponse();
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

describe('GET /api/biometrics/status?targetUserId= — Employee-View "Register Face" on-behalf-of status check', () => {
  it('an explicit targetUserId equal to the caller\'s own id is still self — readUser (Firestore) is never touched', async () => {
    mockGetReference.mockResolvedValue(null);
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'user-1' } }), res);
    expect(mockUserDocGet).not.toHaveBeenCalled();
    expect(mockGetReference).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('Admin checking another active, same-company employee\'s status succeeds and reads THAT employee\'s reference', async () => {
    mockVerifyAuthToken.mockResolvedValue(ADMIN_USER);
    mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ companyId: 'company-1', status: 'Active' }) });
    mockGetReference.mockResolvedValue(null);
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'employee-9' } }), res);
    expect(mockUserDocGet).toHaveBeenCalled();
    expect(mockGetReference).toHaveBeenCalledWith('employee-9');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { status: 'none' } });
  });

  it('a plain Employee (not Admin/HR/SuperAdmin) checking someone else\'s status is rejected 403 NOT_AUTHORIZED, store never touched', async () => {
    mockVerifyAuthToken.mockResolvedValue(AUTH_USER); // role: 'Employee'
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'employee-9' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    const call = (res.json as any).mock.calls[0][0];
    expect(call.error.code).toBe('NOT_AUTHORIZED');
    expect(mockGetReference).not.toHaveBeenCalled();
  });

  it('Admin checking an employee in a DIFFERENT company is rejected 403 CROSS_TENANT_DENIED, store never touched', async () => {
    mockVerifyAuthToken.mockResolvedValue(ADMIN_USER); // companyId: 'company-1'
    mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ companyId: 'company-2', status: 'Active' }) });
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'employee-9' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    const call = (res.json as any).mock.calls[0][0];
    expect(call.error.code).toBe('CROSS_TENANT_DENIED');
    expect(mockGetReference).not.toHaveBeenCalled();
  });

  it('Admin checking a target employee that does not exist is rejected, store never touched', async () => {
    mockVerifyAuthToken.mockResolvedValue(ADMIN_USER);
    mockUserDocGet.mockResolvedValue({ exists: false });
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'ghost-employee' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockGetReference).not.toHaveBeenCalled();
  });

  it('the response shape for a target lookup is still exactly {status} — never leaks the target embedding either', async () => {
    mockVerifyAuthToken.mockResolvedValue(ADMIN_USER);
    mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ companyId: 'company-1', status: 'Active' }) });
    mockGetReference.mockResolvedValue({ id: 'employee-9', userId: 'employee-9', companyId: 'company-1', status: 'active', embedding: [0.9, 0.1] });
    const res = mockResponse();
    await statusHandler(mockRequest({ query: { targetUserId: 'employee-9' } }), res);
    const call = (res.json as any).mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(['status']);
  });
});
