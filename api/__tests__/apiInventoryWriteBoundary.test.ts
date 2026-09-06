/**
 * apiInventoryWriteBoundary.test.ts — INVENTORY-02 (P0-2)
 * ======================================================
 *
 * Proves the REST inventory write boundary:
 *   - `stock` and `stock_ledger` are READ-ONLY over the generic REST API.
 *   - POST / PUT / PATCH / DELETE against them -> 405 Method Not Allowed,
 *     BEFORE any auth / rate-limit / DB access, with ZERO Firestore mutation.
 *   - GET against them still reaches the normal list/get code path.
 *   - Every other registered entity is UNCHANGED (writes still route through
 *     the real handlers).
 *
 * The Admin SDK I/O boundary is mocked with a spy that records every write
 * call, so a "no mutation" assertion is exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the handler dependencies ────────────────────────────────────────────
const writeSpy = vi.hoisted(() => ({
  update: vi.fn(async () => undefined),
  create: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  add: vi.fn(async () => ({ id: 'generated-id' })),
  get: vi.fn(async () => ({ exists: false, data: () => null })),
}));

vi.mock('../_lib/firebase', () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({ update: writeSpy.update, create: writeSpy.create, set: writeSpy.set, get: writeSpy.get }),
      add: writeSpy.add,
      where: function () { return this; },
      orderBy: function () { return this; },
      offset: function () { return this; },
      limit: function () { return this; },
      get: async () => ({ docs: [], empty: true }),
    }),
  }),
  isAdminConfigured: () => true,
}));

vi.mock('../_lib/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ uid: 'u-1', erpUserId: 'MUSR-u-1', email: 'a@b.test', role: 'Admin', companyId: 'company-1', isSuperAdmin: false })),
}));
vi.mock('../_lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
  getRateLimitKey: () => 'rk',
}));
vi.mock('../_lib/permissions', () => ({
  requirePermission: vi.fn(async () => undefined),
}));

import collectionHandler from '../[entity]';
import idHandler from '../[entity]/[id]';
import { handleUpdate } from '../[entity]/[id]';
import { ENTITY_REGISTRY, isRestWriteBlocked } from '../_lib/registry';
import { verifyAuthToken } from '../_lib/auth';
import { requirePermission } from '../_lib/permissions';

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
function mockReq(method: string, path: string, body?: unknown) {
  return {
    method,
    url: path,
    headers: { host: 'localhost', authorization: 'Bearer x' },
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
    body,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSpy.get.mockResolvedValue({ exists: false, data: () => null });
});
afterEach(() => {
  // Assert NOTHING was written to Firestore in any 405 test (each test also asserts explicitly).
});

function assertNoFirestoreWrite() {
  expect(writeSpy.update).not.toHaveBeenCalled();
  expect(writeSpy.create).not.toHaveBeenCalled();
  expect(writeSpy.set).not.toHaveBeenCalled();
  expect(writeSpy.add).not.toHaveBeenCalled();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Registry + pure helper
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — registry + isRestWriteBlocked', () => {
  it('stock and stock_ledger are registered read-only', () => {
    expect(ENTITY_REGISTRY.stock?.readOnly).toBe(true);
    expect(ENTITY_REGISTRY.stock_ledger?.readOnly).toBe(true);
  });

  it('writable entities are NOT read-only (regression — the flag is opt-in)', () => {
    for (const e of ['orders', 'quotations', 'dispatch', 'products', 'warehouses', 'goods_receipts', 'purchase_orders', 'customers']) {
      expect(ENTITY_REGISTRY[e]?.readOnly, `${e} must stay writable`).not.toBe(true);
    }
  });

  it('isRestWriteBlocked: mutating methods on read-only entities => true', () => {
    for (const entity of ['stock', 'stock_ledger']) {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'put', 'delete']) {
        expect(isRestWriteBlocked(entity, m), `${m} ${entity}`).toBe(true);
      }
      expect(isRestWriteBlocked(entity, 'GET')).toBe(false);
      expect(isRestWriteBlocked(entity, 'HEAD')).toBe(false);
      expect(isRestWriteBlocked(entity, 'OPTIONS')).toBe(false);
    }
  });

  it('isRestWriteBlocked: writable + unknown entities => false for every method', () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isRestWriteBlocked('orders', m)).toBe(false);
      expect(isRestWriteBlocked('nonexistent_entity', m)).toBe(false);
      expect(isRestWriteBlocked('', m)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. /api/stock  (collection handler — list / create)
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — /api/stock collection endpoint', () => {
  it('E5: GET /api/stock reaches the list path (NOT 405) — read access preserved', async () => {
    const res = mockRes();
    await collectionHandler(mockReq('GET', '/api/stock'), res);
    expect(res.statusCode).not.toBe(405);
    expect(verifyAuthToken).toHaveBeenCalled();      // auth still runs for reads
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), 'view', 'stock');
  });

  it('stock POST -> 405, no auth, no Firestore write', async () => {
    const res = mockRes();
    await collectionHandler(mockReq('POST', '/api/stock', { availableQty: 999, productId: 'P', warehouseId: 'W', companyId: 'X' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
    expect(verifyAuthToken).not.toHaveBeenCalled();  // rejected before auth
    assertNoFirestoreWrite();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. /api/stock/:id  (id handler — get / update / delete)
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — /api/stock/:id endpoint', () => {
  it('E4 (primary P0-2 regression): PUT /api/stock/:id -> 405, no Firestore write', async () => {
    const res = mockRes();
    await idHandler(mockReq('PUT', '/api/stock/SUM-comp-1-P-1-W-1', { availableQty: 0, reservedQty: 0, warehouseId: 'OTHER', productId: 'OTHER', companyId: 'OTHER' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
    expect(verifyAuthToken).not.toHaveBeenCalled();
    assertNoFirestoreWrite();
  });

  it('PATCH /api/stock/:id -> 405, no write', async () => {
    const res = mockRes();
    await idHandler(mockReq('PATCH', '/api/stock/SUM-1', { availableQty: 5 }), res);
    expect(res.statusCode).toBe(405);
    assertNoFirestoreWrite();
  });

  it('DELETE /api/stock/:id -> 405, no write (stock doc untouched)', async () => {
    const res = mockRes();
    await idHandler(mockReq('DELETE', '/api/stock/SUM-1'), res);
    expect(res.statusCode).toBe(405);
    assertNoFirestoreWrite();
  });

  it('E5: GET /api/stock/:id reaches the get path (NOT 405)', async () => {
    // An existing, same-company doc so the full get path runs (permission
    // check now follows the existence + tenant check — see api/[entity]/[id].ts).
    writeSpy.get.mockResolvedValue({ exists: true, id: 'SUM-1', data: () => ({ companyId: 'company-1', isDeleted: false }) });
    const res = mockRes();
    await idHandler(mockReq('GET', '/api/stock/SUM-1'), res);
    expect(res.statusCode).not.toBe(405);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), 'view', 'stock', 'company-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. /api/stock_ledger  (writes blocked; the ledger cannot be fabricated)
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — /api/stock_ledger endpoint', () => {
  it('POST /api/stock_ledger -> 405, no ledger doc created', async () => {
    const res = mockRes();
    await collectionHandler(mockReq('POST', '/api/stock_ledger', { type: 'OUT', qty: 100, beforeQty: 0, afterQty: 0, sourceId: 'x', referenceId: 'y', productId: 'P', warehouseId: 'W' }), res);
    expect(res.statusCode).toBe(405);
    assertNoFirestoreWrite();
  });

  it('PUT /api/stock_ledger/:id -> 405, existing ledger data untouched', async () => {
    const res = mockRes();
    await idHandler(mockReq('PUT', '/api/stock_ledger/STK-1', { qty: 0, afterQty: 0 }), res);
    expect(res.statusCode).toBe(405);
    assertNoFirestoreWrite();
  });

  it('DELETE /api/stock_ledger/:id -> 405, immutable ledger unchanged', async () => {
    const res = mockRes();
    await idHandler(mockReq('DELETE', '/api/stock_ledger/STK-1'), res);
    expect(res.statusCode).toBe(405);
    assertNoFirestoreWrite();
  });

  it('GET /api/stock_ledger reaches the list path (NOT 405)', async () => {
    const res = mockRes();
    await collectionHandler(mockReq('GET', '/api/stock_ledger'), res);
    expect(res.statusCode).not.toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Regression — the shared generic handler still writes OTHER entities
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — other entities are UNCHANGED', () => {
  it('PUT /api/orders/:id is NOT blocked by the inventory boundary (reaches handleUpdate)', async () => {
    // orders is writable; an existing same-company doc so handleUpdate runs
    // the full path (the permission check now follows the existence + tenant
    // check). The point is this is NOT the inventory-boundary 405.
    writeSpy.get.mockResolvedValue({ exists: true, id: 'ORD-1', data: () => ({ companyId: 'company-1', isDeleted: false, status: 'Draft' }) });
    const res = mockRes();
    await idHandler(mockReq('PUT', '/api/orders/ORD-1', { status: 'Confirmed' }), res);
    expect(res.statusCode).not.toBe(405);
    expect(verifyAuthToken).toHaveBeenCalled();       // auth ran => not short-circuited by the boundary
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), 'edit', 'orders', 'company-1');
  });

  it('POST /api/quotations is NOT blocked by the inventory boundary (reaches handleCreate)', async () => {
    const res = mockRes();
    await collectionHandler(mockReq('POST', '/api/quotations', { customer: 'Acme' }), res);
    expect(res.statusCode).not.toBe(405);
    // handleCreate resolves the write tenant first, then gates on that
    // company's template (a no-op company shift for this non-GroupAdmin Admin).
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), 'create', 'quotations', 'company-1');
  });

  it('DELETE /api/dispatch/:id is NOT blocked by the inventory boundary', async () => {
    const res = mockRes();
    await idHandler(mockReq('DELETE', '/api/dispatch/DSP-1'), res);
    expect(res.statusCode).not.toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Defense in depth — calling handleUpdate directly for a read-only entity
// ─────────────────────────────────────────────────────────────────────────────

describe('INVENTORY-02 — defense in depth (sub-handlers)', () => {
  it('handleUpdate() called directly with a read-only config -> 405, no write', async () => {
    const res = mockRes();
    await handleUpdate(
      { body: { availableQty: 0 } } as any,
      res,
      { collection: 'stock', module: 'stock', searchFields: [], readOnly: true } as any,
      'SUM-1',
      { uid: 'u', companyId: 'company-1', isSuperAdmin: false } as any,
    );
    expect(res.statusCode).toBe(405);
    expect(requirePermission).not.toHaveBeenCalled();
    assertNoFirestoreWrite();
  });
});
