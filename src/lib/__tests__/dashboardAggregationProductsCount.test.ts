/**
 * Phase 12 (DEFECT-002, Master Plan "Performance Hardening") — Dashboards.tsx's
 * Products stat card was the one collection on that page used ONLY for a raw
 * count (no chart/breakdown reads the `products` array elsewhere in that
 * file). getProductsCount() replaces the previous unbounded
 * getAll(COLLECTIONS.PRODUCTS) full-collection fetch with a company-scoped
 * count-aggregation query, reusing the existing countDocumentsSafe()/
 * countVisibleDocuments() pattern already used elsewhere in this module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCountDocumentsSafe = vi.fn();
vi.mock('../firebase', () => ({
  COLLECTIONS: { PRODUCTS: 'products' },
  db: {},
  countDocumentsSafe: (...args: any[]) => mockCountDocumentsSafe(...args),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: any, col: string) => ({ __col: col })),
  getDocs: vi.fn(),
  limit: vi.fn((n: number) => ({ __limit: n })),
  orderBy: vi.fn((field: string, dir: string) => ({ __orderBy: field, dir })),
  query: vi.fn((...args: any[]) => ({ __query: args })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ __where: field, op, value })),
}));

describe('getProductsCount (Phase 12, DEFECT-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountDocumentsSafe.mockResolvedValue(42);
  });

  it('resolves via countDocumentsSafe (aggregation), never a full document fetch', async () => {
    const { getProductsCount } = await import('../dashboardAggregation');
    const result = await getProductsCount('COMPANY-A');

    expect(result).toBe(42);
    expect(mockCountDocumentsSafe).toHaveBeenCalledTimes(1);
  });

  it('scopes the count query to the given companyId', async () => {
    const { getProductsCount } = await import('../dashboardAggregation');
    await getProductsCount('COMPANY-A');

    const [firestoreQuery, cacheKey] = mockCountDocumentsSafe.mock.calls[0];
    expect(JSON.stringify(firestoreQuery)).toContain('COMPANY-A');
    expect(cacheKey).toContain('COMPANY-A');
  });

  it('returns 0 without querying when companyId is empty (unresolved tenant, fail closed)', async () => {
    const { getProductsCount } = await import('../dashboardAggregation');
    const result = await getProductsCount('');

    expect(result).toBe(0);
    expect(mockCountDocumentsSafe).not.toHaveBeenCalled();
  });
});
