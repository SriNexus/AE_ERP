/**
 * Phase 10 (F-CACHE-01, Master Plan "Cache / Query Isolation
 * Verification") — queryKeys.forCompany() proves a distinct cache key per
 * company for every tenant-scoped key, and every fixed hook (Reports.tsx +
 * the useHR.ts/useCategories.ts/useWarehouses.ts/useEmployees.ts/
 * useTeams.ts sweep) is confirmed to actually route through it rather than
 * a raw, company-unscoped literal — a genuine "was this really fixed"
 * check on the source text, not just a unit test of the factory in
 * isolation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { queryKeys } from '../queryKeys';

describe('queryKeys.forCompany — distinct cache key per company (Phase 10)', () => {
  it('the same logical key differs across two different companies', () => {
    const a = queryKeys.forCompany('COMPANY-A');
    const b = queryKeys.forCompany('COMPANY-B');
    expect(a.attendance).not.toEqual(b.attendance);
    expect(a.payroll).not.toEqual(b.payroll);
    expect(a.employees).not.toEqual(b.employees);
    expect(a.categories).not.toEqual(b.categories);
    expect(a.warehouses).not.toEqual(b.warehouses);
    expect(a.teams).not.toEqual(b.teams);
  });

  it('the same company produces an identical (stable) cache key across calls — no spurious re-fetch', () => {
    const a1 = queryKeys.forCompany('COMPANY-A');
    const a2 = queryKeys.forCompany('COMPANY-A');
    expect(a1.attendance).toEqual(a2.attendance);
    expect(a1.payroll).toEqual(a2.payroll);
  });

  it('an empty/unresolved companyId fails closed to a distinct, non-colliding placeholder key ("default"), never silently reusing another company\'s cache', () => {
    const empty = queryKeys.forCompany('');
    const real = queryKeys.forCompany('COMPANY-A');
    expect(empty.attendance).not.toEqual(real.attendance);
    expect(empty.attendance).toEqual(['attendance', 'default']);
  });

  it('teams is now defined (Phase 10 sweep found it missing from the factory entirely)', () => {
    const keys = queryKeys.forCompany('COMPANY-A');
    expect(keys.teams).toEqual(['teams', 'COMPANY-A']);
  });
});

describe('Phase 10 sweep — fixed call sites actually route through queryKeys.forCompany(), not a raw literal', () => {
  // Strip comments first so a mention of the OLD pattern inside an
  // explanatory code comment (documenting what was fixed and why) can never
  // produce a false failure here — only real, active code is checked.
  const stripComments = (src: string) => src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const cases: Array<{ file: string; forbidden: RegExp; label: string }> = [
    { file: 'src/features/hr/hooks/useHR.ts', forbidden: /queryKey:\s*\['attendance'\]|queryKey:\s*\['payroll'\]/, label: 'useHR.ts' },
    { file: 'src/features/categories/hooks/useCategories.ts', forbidden: /const QK = \['product_categories'\]/, label: 'useCategories.ts' },
    { file: 'src/features/warehouses/hooks/useWarehouses.ts', forbidden: /const QK = \['warehouses'\]/, label: 'useWarehouses.ts' },
    { file: 'src/features/employees/hooks/useEmployees.ts', forbidden: /const QK = \['employees'\]/, label: 'useEmployees.ts' },
    { file: 'src/features/teams/hooks/useTeams.ts', forbidden: /const QK = \['teams'\]/, label: 'useTeams.ts' },
  ];

  for (const { file, forbidden, label } of cases) {
    it(`${label} no longer contains the raw, company-unscoped queryKey literal in active code`, () => {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(forbidden.test(src)).toBe(false);
    });

    it(`${label} actually calls queryKeys.forCompany(...)`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('queryKeys.forCompany(');
    });
  }

  it('Reports.tsx uses activeCompanyId in every one of its 11 queryKeys', () => {
    const src = readFileSync('src/pages/Reports.tsx', 'utf8');
    const matches = src.match(/queryKey:\s*\[[^\]]*activeCompanyId[^\]]*\]/g) || [];
    expect(matches.length).toBe(11);
  });
});
