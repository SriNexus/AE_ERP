/**
 * companyBusinessMode.test.ts — Phase 1 (Company Business Mode) foundation.
 *
 * Covers: safe default resolution for companies created before this field
 * existed (never silently narrows an existing company's capability), the
 * B2B -> hide-B2C-only-modules gate, and the deliberate non-gating of shared
 * financial/logistics modules (orders/quotations/dispatch/invoices/payments)
 * which both B2B and B2C use. Also verifies RoleRoute/Sidebar/ModuleNavDrawer
 * actually wire the gate in (source-text, this codebase's established
 * convention for cross-file wiring checks).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  B2C_ONLY_MODULES,
  COMPANY_BUSINESS_MODES,
  DEFAULT_BUSINESS_MODE,
  isModuleAllowedForBusinessMode,
  resolveBusinessMode,
} from '../companyBusinessMode';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

describe('resolveBusinessMode — safe default for pre-Phase-1 company records', () => {
  it('returns the real value when businessMode is set', () => {
    expect(resolveBusinessMode({ businessMode: 'B2B' })).toBe('B2B');
    expect(resolveBusinessMode({ businessMode: 'B2C' })).toBe('B2C');
    expect(resolveBusinessMode({ businessMode: 'Both' })).toBe('Both');
  });

  it('defaults to Both for a company doc with no businessMode field at all (existing companies)', () => {
    expect(resolveBusinessMode({})).toBe('Both');
    expect(resolveBusinessMode(null)).toBe('Both');
    expect(resolveBusinessMode(undefined)).toBe('Both');
  });

  it('defaults to Both for a garbage/unexpected value rather than throwing', () => {
    expect(resolveBusinessMode({ businessMode: 'something-else' })).toBe('Both');
  });

  it('DEFAULT_BUSINESS_MODE is Both, matching the Blueprint-locked migration default', () => {
    expect(DEFAULT_BUSINESS_MODE).toBe('Both');
  });
});

describe('isModuleAllowedForBusinessMode — B2B hides B2C-only modules; B2C and Both hide nothing at the nav/route level', () => {
  it('B2B mode blocks every B2C-only module', () => {
    for (const module of B2C_ONLY_MODULES) {
      expect(isModuleAllowedForBusinessMode(module, 'B2B')).toBe(false);
    }
  });

  it('B2C mode does not hide B2C-only modules (obviously) nor shared ones', () => {
    for (const module of B2C_ONLY_MODULES) {
      expect(isModuleAllowedForBusinessMode(module, 'B2C')).toBe(true);
    }
  });

  it('Both mode hides nothing', () => {
    for (const module of [...B2C_ONLY_MODULES, 'orders', 'quotations', 'dispatch'] as const) {
      expect(isModuleAllowedForBusinessMode(module, 'Both')).toBe(true);
    }
  });

  it('shared financial/logistics modules are never gated by business mode in either direction — the B2C "Project-only" rule is enforced at Order/Quotation creation time (Phase 3/4), not by hiding these pages', () => {
    for (const shared of ['orders', 'quotations', 'dispatch', 'invoices', 'payments'] as const) {
      expect(isModuleAllowedForBusinessMode(shared, 'B2B')).toBe(true);
      expect(isModuleAllowedForBusinessMode(shared, 'B2C')).toBe(true);
      expect(isModuleAllowedForBusinessMode(shared, 'Both')).toBe(true);
    }
  });

  it('COMPANY_BUSINESS_MODES enumerates exactly the three allowed values', () => {
    expect(COMPANY_BUSINESS_MODES).toEqual(['B2B', 'B2C', 'Both']);
  });
});

describe('Wiring — RoleRoute, Sidebar, and ModuleNavDrawer actually consult the business-mode gate (not just the module exists)', () => {
  it('RoleRoute blocks a business-mode-disallowed route and shows a distinct toast from the demo-restriction one', () => {
    const src = read('../../components/auth/RoleRoute.tsx');
    expect(src).toContain("import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../lib/companyBusinessMode'");
    expect(src).toContain('const businessModeBlocked = !isModuleAllowedForBusinessMode(module, resolveBusinessMode(company));');
    expect(src).toContain('if (businessModeBlocked) {');
    expect(src).toContain("Not available for this company");
  });

  it('Sidebar filters both top-level and child nav items by business mode, alongside the existing permission/demo filters', () => {
    const src = read('../../components/layout/Sidebar.tsx');
    expect(src).toContain("import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../lib/companyBusinessMode'");
    expect(src).toContain('if (item.module && !isModuleAllowedForBusinessMode(item.module, businessMode)) return acc;');
    expect(src).toContain('if (c.module && !isModuleAllowedForBusinessMode(c.module, businessMode)) return false;');
  });

  it('ModuleNavDrawer (mobile) applies the same business-mode filter as the desktop Sidebar', () => {
    const src = read('../../components/mobile/shell/ModuleNavDrawer.tsx');
    expect(src).toContain("import { isModuleAllowedForBusinessMode, resolveBusinessMode } from '../../../lib/companyBusinessMode'");
    expect(src).toContain('if (item.module && !isModuleAllowedForBusinessMode(item.module, businessMode)) return acc;');
  });
});

describe('Company config carries businessMode with the locked-default value', () => {
  it('DEFAULT_COMPANY and DEMO_COMPANY both set businessMode: Both, so no existing/demo company is silently narrowed', () => {
    const companyConfigSrc = read('../../config/company.ts');
    expect(companyConfigSrc).toContain("businessMode: 'Both'");
    const demoCompanySrc = read('../../config/demoCompany.ts');
    expect(demoCompanySrc).toContain("businessMode: 'Both'");
  });

  it('Companies.tsx form defaults new companies to Both and offers all three modes', () => {
    const companiesPageSrc = read('../../pages/Companies.tsx');
    expect(companiesPageSrc).toContain('businessMode: DEFAULT_BUSINESS_MODE');
    expect(companiesPageSrc).toContain('COMPANY_BUSINESS_MODES.map');
  });
});
