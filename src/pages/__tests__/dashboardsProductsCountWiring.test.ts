/**
 * Phase 12 (DEFECT-002, Master Plan "Performance Hardening") — Dashboards.tsx
 * previously fetched the ENTIRE products collection via getAll(COLLECTIONS.PRODUCTS)
 * solely to read `.length` for the "Products" stat card (verified: no chart/
 * breakdown on this page reads the `products` array). Fixed to use
 * getProductsCount() (a countDocumentsSafe()-based aggregation, see
 * dashboardAggregation.ts) instead.
 *
 * Source-text analysis, matching the repository's established convention for
 * this page tier (see customerWorkspace.test.ts) — there is no
 * @testing-library/react dependency in this repository.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../Dashboards.tsx'), 'utf-8');

describe('Dashboards.tsx — Products stat card uses count aggregation (Phase 12, DEFECT-002)', () => {
  it('no longer fetches the full products collection', () => {
    expect(source).not.toMatch(/getAll\(COLLECTIONS\.PRODUCTS\)/);
  });

  it('imports and uses getProductsCount() from dashboardAggregation.ts', () => {
    expect(source).toContain("import { getProductsCount } from '../lib/dashboardAggregation'");
    expect(source).toContain('getProductsCount(companyId)');
  });

  it('the Products StatCard reads the aggregated count, not products.length', () => {
    expect(source).toMatch(/label="Products"\s+value=\{fmtCompactNumber\(productsCount\)\}/);
  });

  it('every other collection on this page (leads/orders/customers/etc.) is left as a full fetch — they feed real per-status/per-source breakdown charts, not just a count', () => {
    expect(source).toContain('getAll(COLLECTIONS.LEADS)');
    expect(source).toContain('getAll(COLLECTIONS.ORDERS)');
    expect(source).toContain('getAll(COLLECTIONS.CUSTOMERS)');
  });
});
