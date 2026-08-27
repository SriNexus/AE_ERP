import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEMO_COMPANY_ID, DEMO_ERP_USER_ID } from '../../config/demo';
import { isCanonicalDemoIdentity } from '../demoCapabilityPolicy';
import { resolveSessionCompanyId } from '../tenantRouting';

describe('isolated Demo tenant architecture', () => {
  it('identifies Demo presentation from canonical user and company identity only', () => {
    expect(isCanonicalDemoIdentity({ id: DEMO_ERP_USER_ID, companyId: DEMO_COMPANY_ID })).toBe(true);
    expect(isCanonicalDemoIdentity({ id: 'normal-user', companyId: 'company-production' })).toBe(false);
    expect(isCanonicalDemoIdentity({ id: 'normal-user', companyId: DEMO_COMPANY_ID })).toBe(false);
    expect(isCanonicalDemoIdentity({ id: DEMO_ERP_USER_ID, companyId: 'company-production' })).toBe(false);
  });

  it('cannot change an ordinary user tenant through stale persisted company state', () => {
    expect(resolveSessionCompanyId({ companyId: DEMO_COMPANY_ID }, 'company-production')).toBe(DEMO_COMPANY_ID);
    expect(resolveSessionCompanyId({ companyId: 'company-production' }, DEMO_COMPANY_ID)).toBe('company-production');
  });

  it('preserves intentional owner and super-admin company selection', () => {
    expect(resolveSessionCompanyId({ companyId: 'home', isOwner: true }, 'selected')).toBe('selected');
    expect(resolveSessionCompanyId({ companyId: 'home', isSuperAdmin: true }, 'selected')).toBe('selected');
  });

  it('no capability-gating mechanism remains — Neozy Demo is a real Group, not a restricted sandbox', () => {
    const demoCapabilityPolicySrc = readFileSync('src/lib/demoCapabilityPolicy.ts', 'utf8');
    expect(demoCapabilityPolicySrc).not.toContain('isDemoCapabilityAllowed');
    expect(demoCapabilityPolicySrc).not.toContain('DemoCapability');
  });

  it('does not use deployment-wide Demo mode in public or authenticated presentation', () => {
    const login = readFileSync('src/pages/Login.tsx', 'utf8');
    const topBar = readFileSync('src/components/layout/TopBar.tsx', 'utf8');
    expect(login).not.toMatch(/isUsingDemoMode|demoSignInWithEmailAndPassword|demo@neozy\.in/);
    expect(topBar).toContain('isCanonicalDemoIdentity');
    expect(topBar).not.toContain('isUsingDemoMode');
  });
});