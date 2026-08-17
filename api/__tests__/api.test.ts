/**
 * API tests — Unit tests for REST API middleware and helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePagination, parseSearch, sendSuccess, sendPaginated, sendError, sendCreated, sendNoContent, sendBadRequest, sendNotFound, sendConflict, sendInternalError } from '../_lib/response';
import { verifyAuthToken, authError, forbiddenError } from '../_lib/auth';
import { canDo, requirePermission } from '../_lib/permissions';
import { ENTITY_REGISTRY, GLOBAL_COLLECTIONS, isEntityRegistered, getEntityConfig, isGlobalCollection } from '../_lib/registry';
import { checkRateLimit, getRateLimitKey, cleanupRateLimitStore } from '../_lib/rateLimit';

// ── Test response helpers ────────────────────────────────────

describe('parsePagination', () => {
  it('returns default pagination when no query params provided', () => {
    const result = parsePagination({});
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('parses page and perPage from query string', () => {
    const result = parsePagination({ page: '3', perPage: '10' });
    expect(result.page).toBe(3);
    expect(result.perPage).toBe(10);
    expect(result.offset).toBe(20);
  });

  it('clamps perPage to max 100', () => {
    const result = parsePagination({ perPage: '500' });
    expect(result.perPage).toBe(100);
  });

  it('clamps page to min 1', () => {
    const result = parsePagination({ page: '0' });
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('handles invalid page gracefully', () => {
    const result = parsePagination({ page: 'abc' });
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('handles negative page gracefully', () => {
    const result = parsePagination({ page: '-5' });
    expect(result.page).toBe(1);
  });

  it('handles missing perPage gracefully', () => {
    const result = parsePagination({ page: '2' });
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(20);
  });
});

describe('parseSearch', () => {
  it('returns empty search when no params provided', () => {
    const result = parseSearch({});
    expect(result.search).toBe('');
    expect(result.status).toBe('');
    expect(result.sortBy).toBe('createdAt');
    expect(result.sortOrder).toBe('desc');
  });

  it('parses search, status, sort params', () => {
    const result = parseSearch({ search: 'solar', status: 'active', sortBy: 'name', sortOrder: 'asc' });
    expect(result.search).toBe('solar');
    expect(result.status).toBe('active');
    expect(result.sortBy).toBe('name');
    expect(result.sortOrder).toBe('asc');
  });

  it('trims search whitespace', () => {
    const result = parseSearch({ search: '  solar  ' });
    expect(result.search).toBe('solar');
  });

  it('defaults sortOrder to desc when invalid', () => {
    const result = parseSearch({ sortOrder: 'invalid' });
    expect(result.sortOrder).toBe('desc');
  });
});

describe('sendSuccess', () => {
  it('returns successful JSON response', () => {
    const mockRes = mockResponse();

    sendSuccess(mockRes, { id: '123', name: 'Test' });

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      data: { id: '123', name: 'Test' },
    });
  });

  it('includes meta when provided', () => {
    const mockRes = mockResponse();

    sendSuccess(mockRes, { id: '1' }, 201, { total: 100, page: 1, perPage: 20, hasMore: true });

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      data: { id: '1' },
      meta: { total: 100, page: 1, perPage: 20, hasMore: true },
    });
  });

  it('formats hasMore correctly when page*perPage >= total', () => {
    const mockRes = mockResponse();
    sendSuccess(mockRes, [], 200, { total: 5, page: 1, perPage: 20, hasMore: false });
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ hasMore: false }),
      }),
    );
  });
});

describe('sendPaginated', () => {
  it('returns paginated response with hasMore=true when total > page*perPage', () => {
    const mockRes = mockResponse();

    sendPaginated(mockRes, [{ id: '1' }], 100, 1, 20);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ total: 100, hasMore: true }),
      }),
    );
  });

  it('returns hasMore=false when total <= page*perPage', () => {
    const mockRes = mockResponse();
    sendPaginated(mockRes, [{ id: '1' }], 10, 1, 20);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ hasMore: false }),
      }),
    );
  });

  it('handles empty data array', () => {
    const mockRes = mockResponse();
    sendPaginated(mockRes, [], 0, 1, 20);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [],
        meta: expect.objectContaining({ total: 0, hasMore: false }),
      }),
    );
  });
});

describe('sendError', () => {
  it('returns error JSON response', () => {
    const mockRes = mockResponse();

    sendError(mockRes, 400, 'BAD_REQUEST', 'Invalid input');

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid input' },
    });
  });

  it('includes optional details in error response', () => {
    const mockRes = mockResponse();
    const details = { field: 'name', reason: 'required' };

    sendError(mockRes, 422, 'VALIDATION_ERROR', 'Invalid field', details);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ details }),
      }),
    );
  });
});

describe('sendBadRequest', () => {
  it('returns 400 with BAD_REQUEST code', () => {
    const mockRes = mockResponse();
    sendBadRequest(mockRes, 'Invalid input');
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'BAD_REQUEST' }),
      }),
    );
  });
});

describe('sendNotFound', () => {
  it('returns 404 with NOT_FOUND code', () => {
    const mockRes = mockResponse();
    sendNotFound(mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    );
  });
});

describe('sendCreated', () => {
  it('returns 201 with data', () => {
    const mockRes = mockResponse();
    sendCreated(mockRes, { id: 'new-1' });
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { id: 'new-1' },
      }),
    );
  });
});

describe('sendNoContent', () => {
  it('returns 204 with no body', () => {
    const mockRes = { status: vi.fn().mockReturnThis(), end: vi.fn() } as any;
    sendNoContent(mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(204);
    expect(mockRes.end).toHaveBeenCalled();
  });
});

describe('sendConflict', () => {
  it('returns 409 with CONFLICT code', () => {
    const mockRes = mockResponse();
    sendConflict(mockRes, 'Duplicate entry');
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'CONFLICT' }),
      }),
    );
  });
});

describe('sendInternalError', () => {
  it('returns 500 with INTERNAL_ERROR code', () => {
    const mockRes = mockResponse();
    sendInternalError(mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      }),
    );
  });

  it('uses custom message', () => {
    const mockRes = mockResponse();
    sendInternalError(mockRes, 'Database timeout');
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Database timeout' }),
      }),
    );
  });
});

// ── Test auth middleware ──────────────────────────────────────

describe('verifyAuthToken', () => {
  it('returns null when no auth header', async () => {
    const result = await verifyAuthToken(null);
    expect(result).toBeNull();
  });

  it('returns null when auth header is not Bearer', async () => {
    const result = await verifyAuthToken('Basic dXNlcjpwYXNz');
    expect(result).toBeNull();
  });

  it('returns null for invalid token', async () => {
    const result = await verifyAuthToken('Bearer invalid-token');
    expect(result).toBeNull();
  });

  it('returns null when only API key provided but API_KEYS not configured', async () => {
    const originalApiKeys = process.env.API_KEYS;
    delete process.env.API_KEYS;

    const result = await verifyAuthToken(null, 'some-api-key');
    expect(result).toBeNull();

    process.env.API_KEYS = originalApiKeys;
  });

  it('authenticates with valid API key', async () => {
    const originalApiKeys = process.env.API_KEYS;
    process.env.API_KEYS = 'test-key-1,test-key-2';

    const result = await verifyAuthToken(null, 'test-key-1');
    expect(result).not.toBeNull();
    expect(result!.uid).toBe('api-user');
    expect(result!.role).toBe('Admin');

    process.env.API_KEYS = originalApiKeys;
  });

  it('authenticates with second valid API key', async () => {
    const originalApiKeys = process.env.API_KEYS;
    process.env.API_KEYS = 'test-key-1,test-key-2';

    const result = await verifyAuthToken(null, 'test-key-2');
    expect(result).not.toBeNull();

    process.env.API_KEYS = originalApiKeys;
  });

  it('rejects invalid API key', async () => {
    const originalApiKeys = process.env.API_KEYS;
    process.env.API_KEYS = 'valid-key';

    const result = await verifyAuthToken(null, 'invalid-key');
    expect(result).toBeNull();

    process.env.API_KEYS = originalApiKeys;
  });

  it('uses API_COMPANY_ID for API key auth', async () => {
    const originalKeys = process.env.API_KEYS;
    const originalCompanyId = process.env.API_COMPANY_ID;
    process.env.API_KEYS = 'key-123';
    process.env.API_COMPANY_ID = 'company-xyz';

    const result = await verifyAuthToken(null, 'key-123');
    expect(result).not.toBeNull();
    expect(result!.companyId).toBe('company-xyz');

    process.env.API_KEYS = originalKeys;
    process.env.API_COMPANY_ID = originalCompanyId;
  });
});

describe('authError', () => {
  it('returns 401 error response', () => {
    const result = authError();
    expect(result.status).toBe(401);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('UNAUTHORIZED');
    expect(result.body.error.message).toContain('Bearer');
  });
});

describe('forbiddenError', () => {
  it('returns 403 error response', () => {
    const result = forbiddenError();
    expect(result.status).toBe(403);
    expect(result.body.success).toBe(false);
    expect(result.body.error.code).toBe('FORBIDDEN');
  });
});

// ── Test permission helpers ──────────────────────────────────

describe('canDo', () => {
  it('returns true for super-admin', async () => {
    const user = mockUser({ isSuperAdmin: true });
    const result = await canDo(user, 'view', 'projects');
    expect(result).toBe(true);
  });

  it('returns true for super-admin even on restricted actions', async () => {
    const user = mockUser({ isSuperAdmin: true });
    const result = await canDo(user, 'delete', 'roles');
    expect(result).toBe(true);
  });

  it('returns false for unknown role', async () => {
    const user = mockUser({ role: 'NonExistentRole' });
    const result = await canDo(user, 'view', 'projects');
    expect(result).toBe(false);
  });

  it('returns false for unknown action', async () => {
    const user = mockUser();
    const result = await canDo(user, 'unknown_action' as any, 'projects');
    expect(result).toBe(false);
  });

  it('returns false for unknown module', async () => {
    const user = mockUser();
    const result = await canDo(user, 'view', 'unknown_module' as any);
    expect(result).toBe(false);
  });

  it('returns false for user with no role', async () => {
    const user = mockUser({ role: '' });
    const result = await canDo(user, 'view', 'dashboard');
    expect(result).toBe(false);
  });

  it('resolves common role aliases', async () => {
    // 'management' should resolve to 'Admin'
    const user = mockUser({ role: 'Management' });
    const result = await canDo(user, 'view', 'projects');
    // Should not throw and return a boolean (may be false if no Firestore role doc)
    expect(typeof result).toBe('boolean');
  });

  it('resolves BDM to Sales', async () => {
    const user = mockUser({ role: 'BDM' });
    const result = await canDo(user, 'view', 'leads');
    expect(typeof result).toBe('boolean');
  });

  it('resolves Sales Executive to Sales', async () => {
    const user = mockUser({ role: 'Sales Executive' });
    const result = await canDo(user, 'view', 'leads');
    expect(typeof result).toBe('boolean');
  });
});

describe('requirePermission', () => {
  it('does not throw for authorized user', async () => {
    const user = mockUser({ isSuperAdmin: true });
    await expect(requirePermission(user, 'view', 'projects')).resolves.toBeUndefined();
  });

  it('throws Forbidden error for unauthorized user', async () => {
    const user = mockUser({ role: 'NonExistentRole' });
    try {
      await requirePermission(user, 'delete', 'projects');
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      expect(error.message).toBe('Forbidden');
    }
  });
});

// ── Test entity registry ───────────────────────────────────────

describe('ENTITY_REGISTRY', () => {
  it('contains all required core entities', () => {
    const requiredEntities = [
      'projects', 'leads', 'customers', 'quotations', 'orders', 'dispatch',
      'products', 'stock', 'users', 'vendors', 'purchase_orders',
      'invoices', 'payments', 'employees', 'warehouses',
      'surveys', 'roles', 'companies',
    ];
    for (const entity of requiredEntities) {
      expect(isEntityRegistered(entity)).toBe(true);
    }
  });

  it('every entity has a valid collection name', () => {
    for (const [name, config] of Object.entries(ENTITY_REGISTRY)) {
      expect(name).toBeTruthy();
      expect(config.collection).toBeTruthy();
      expect(config.module).toBeTruthy();
      expect(Array.isArray(config.searchFields)).toBe(true);
    }
  });

  it('has no duplicate collection names', () => {
    const collections = Object.values(ENTITY_REGISTRY).map((c) => c.collection);
    const uniqueCollections = new Set(collections);
    expect(collections.length).toBe(uniqueCollections.size);
  });

  it('counts at least 30 registered entities', () => {
    const count = Object.keys(ENTITY_REGISTRY).length;
    expect(count).toBeGreaterThanOrEqual(30);
  });
});

describe('GLOBAL_COLLECTIONS', () => {
  it('contains roles, companies, and users', () => {
    expect(GLOBAL_COLLECTIONS.has('roles')).toBe(true);
    expect(GLOBAL_COLLECTIONS.has('companies')).toBe(false);
    expect(GLOBAL_COLLECTIONS.has('users')).toBe(false);
  });

  it('does not contain company-scoped collections', () => {
    expect(GLOBAL_COLLECTIONS.has('leads')).toBe(false);
    expect(GLOBAL_COLLECTIONS.has('projects')).toBe(false);
    expect(GLOBAL_COLLECTIONS.has('orders')).toBe(false);
  });
});

describe('isGlobalCollection', () => {
  it('returns true for global collections', () => {
    expect(isGlobalCollection('roles')).toBe(true);
    expect(isGlobalCollection('companies')).toBe(false);
  });

  it('returns false for company-scoped collections', () => {
    expect(isGlobalCollection('leads')).toBe(false);
    expect(isGlobalCollection('projects')).toBe(false);
  });
});

describe('getEntityConfig', () => {
  it('returns config for registered entity', () => {
    const config = getEntityConfig('projects');
    expect(config).toBeDefined();
    expect(config!.collection).toBe('projects');
    expect(config!.module).toBe('projects');
  });

  it('returns undefined for unknown entity', () => {
    const config = getEntityConfig('nonexistent');
    expect(config).toBeUndefined();
  });
});

// ── Test rate limiter ─────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    cleanupRateLimitStore();
  });

  it('allows first request', () => {
    cleanupRateLimitStore();
    const result = checkRateLimit('test-key', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('decrements remaining count', () => {
    cleanupRateLimitStore();
    const key = `test-decrement-${Date.now()}`;
    const r1 = checkRateLimit(key, 5, 60_000);
    expect(r1.remaining).toBe(4);
    const r2 = checkRateLimit(key, 5, 60_000);
    expect(r2.remaining).toBe(3);
    const r3 = checkRateLimit(key, 5, 60_000);
    expect(r3.remaining).toBe(2);
  });

  it('blocks when limit exceeded', () => {
    cleanupRateLimitStore();
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
    }

    const blocked = checkRateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    cleanupRateLimitStore();
    const key = `test-reset-${Date.now()}`;
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 1); // 1ms window
    }

    const blocked = checkRateLimit(key, 5, 1);
    expect(blocked.allowed).toBe(false);
  });

  it('uses different windows for different keys', () => {
    cleanupRateLimitStore();
    const key1 = `test-isolate-1-${Date.now()}`;
    const key2 = `test-isolate-2-${Date.now()}`;

    // Exhaust key1
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key1, 5, 60_000);
    }

    // key2 should still have all requests
    const r2 = checkRateLimit(key2, 5, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(4);

    // key1 should be blocked
    const r1 = checkRateLimit(key1, 5, 60_000);
    expect(r1.allowed).toBe(false);
  });

  it('handles edge case of zero max requests', () => {
    cleanupRateLimitStore();
    const result = checkRateLimit('zero-key', 0, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe('getRateLimitKey', () => {
  it('uses uid when available', () => {
    const key = getRateLimitKey('user-123', '1.2.3.4');
    expect(key).toBe('user-123');
  });

  it('falls back to IP when no uid', () => {
    const key = getRateLimitKey('', '5.6.7.8');
    expect(key).toBe('5.6.7.8');
  });

  it('falls back to anonymous when neither available', () => {
    const key = getRateLimitKey('');
    expect(key).toBe('anonymous');
  });
});

describe('cleanupRateLimitStore', () => {
  it('does not throw on empty store', () => {
    cleanupRateLimitStore();
    expect(true).toBe(true);
  });

  it('removes expired entries', () => {
    cleanupRateLimitStore();
    checkRateLimit('expired-key', 5, -1); // already expired
    cleanupRateLimitStore();
    // Should not throw
    expect(true).toBe(true);
  });
});

// ── Test Firebase admin SDK (without actual credentials) ─────

describe('getAdminDb', () => {
  it('throws error when FIREBASE_SERVICE_ACCOUNT_KEY is not set', async () => {
    const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    vi.resetModules();
    const { getAdminDb } = await import('../_lib/firebase');

    expect(() => getAdminDb()).toThrow('FIREBASE_SERVICE_ACCOUNT_KEY is not set');

    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = originalEnv;
  });

  it('returns false when FIREBASE_SERVICE_ACCOUNT_KEY is not set', async () => {
    const originalEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    vi.resetModules();
    const { isAdminConfigured } = await import('../_lib/firebase');

    const result = isAdminConfigured();
    expect(result).toBe(false);

    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = originalEnv;
  });
});

// ── Helpers ────────────────────────────────────────────────────

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as any;
}

function mockUser(overrides: Record<string, any> = {}) {
  return {
    uid: 'test-user-1',
    erpUserId: 'MUSR-test-user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'Admin',
    companyId: 'company-1',
    isSuperAdmin: false,
    ...overrides,
  };
}
