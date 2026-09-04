/**
 * apiListIndexFallback.test.ts — INVENTORY-11 (§11b / BRAIN.md API-6)
 * =====================================================================
 *
 * `handleList`'s missing-index fallback (fetch the WHOLE collection, filter
 * in-memory) is a real, documented scale/cost concern (P3-6) — this proves
 * the "make it loud" hardening: when the indexed query throws
 * `failed-precondition`, the fallback still serves the request (behavior
 * UNCHANGED — never a hard 500 for a resilience path every registered
 * entity relies on) but now logs a clear, actionable warning naming the
 * collection and the query shape that needs an index. The normal (indexed)
 * path logs nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ forceIndexError: false }));

function makeQueryBuilder(collectionName: string) {
  let chained = false;
  const builder: any = {
    where: () => { chained = true; return builder; },
    orderBy: () => { chained = true; return builder; },
    offset: () => { chained = true; return builder; },
    limit: () => { chained = true; return builder; },
    get: async () => {
      if (chained && mocks.forceIndexError) {
        const err: any = new Error(`The query requires an index. Collection: ${collectionName}`);
        err.code = 'failed-precondition';
        throw err;
      }
      // Either the indexed path succeeded, or this is the fallback's raw
      // (un-chained) full-collection fetch — both return the same fixture.
      return {
        docs: [
          { id: 'P-1', data: () => ({ id: 'P-1', name: 'Panel', companyId: 'CO-1', isDeleted: false, createdAt: '2026-01-01T00:00:00.000Z' }) },
          { id: 'P-2', data: () => ({ id: 'P-2', name: 'Inverter', companyId: 'CO-OTHER', isDeleted: false, createdAt: '2026-01-02T00:00:00.000Z' }) },
        ],
        empty: false,
      };
    },
  };
  return builder;
}

vi.mock('../_lib/firebase', () => ({
  getAdminDb: () => ({
    collection: (name: string) => makeQueryBuilder(name),
  }),
  isAdminConfigured: () => true,
}));
vi.mock('../_lib/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ uid: 'u-1', erpUserId: 'MUSR-u-1', email: 'a@b.test', role: 'Admin', companyId: 'CO-1', isSuperAdmin: false })),
}));
vi.mock('../_lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
  getRateLimitKey: () => 'rk',
}));
vi.mock('../_lib/permissions', () => ({
  requirePermission: vi.fn(async () => undefined),
}));

import collectionHandler from '../[entity]';

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: vi.fn(function (this: any, s: number) { this.statusCode = s; return this; }),
    json: vi.fn(function (this: any, b: unknown) { this.body = b; return this; }),
    end: vi.fn(function (this: any) { return this; }),
    setHeader: vi.fn(function (this: any) { return this; }),
  };
  return res;
}
function mockReq(path: string) {
  return { method: 'GET', url: path, headers: { host: 'localhost', authorization: 'Bearer x' }, socket: { remoteAddress: '127.0.0.1' }, query: {}, body: undefined } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.forceIndexError = false;
});

describe('INVENTORY-11 (§11b) — GET /api/products missing-index fallback', () => {
  it('a missing composite index still serves the list (fallback behavior unchanged)', async () => {
    mocks.forceIndexError = true;
    const res = mockRes();
    await collectionHandler(mockReq('/api/products'), res);
    expect(res.statusCode).not.toBe(500);
    expect(res.body?.success).not.toBe(false);
    expect(res.body?.data).toHaveLength(1); // company-scoped filter still applied in the fallback (CO-OTHER excluded)
  });

  it('logs a clear, actionable warning naming the collection when the fallback fires', async () => {
    mocks.forceIndexError = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await collectionHandler(mockReq('/api/products'), res);
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/products.*index/i),
      expect.objectContaining({ collection: 'products', code: 'failed-precondition' }),
    );
    spy.mockRestore();
  });

  it('the normal (indexed) path logs nothing', async () => {
    mocks.forceIndexError = false;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await collectionHandler(mockReq('/api/products'), res);
    expect(res.statusCode).not.toBe(500);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
