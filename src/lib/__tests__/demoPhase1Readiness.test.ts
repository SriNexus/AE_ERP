import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { companyScopedQuery } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

describe('Demo Mode Phase 1 readiness', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'demo-user', name: 'Demo User', email: 'demo@neozy.in', role: 'Demo Operator', companyId: 'company-demo-neozy' },
      activeCompanyId: 'default',
      isAuthenticated: true,
    });
  });

  it('keeps the public login experience free of Demo presentation and credentials', () => {
    const login = readFileSync('src/pages/Login.tsx', 'utf8');
    expect(login).not.toContain('demo@neozy.in');
    expect(login).not.toContain('admin123');
    expect(login).not.toContain('sales123');
    expect(login).not.toContain('manager123');
    expect(login).not.toContain('Demo Credentials for Testing');
    expect(login).not.toContain('Demo Mode Active');
    expect(login).not.toContain('demoSignInWithEmailAndPassword');
    expect(login).toContain('signInWithEmailAndPassword(auth, email, password)');
    expect(login).toContain('resolveAuthenticatedErpUser(firebaseUser)');
  });

  it('adds a tenant constraint to business collections', () => {
    expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.CUSTOMERS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.SETTINGS)).toHaveLength(1);
  });

  // F-03 closure (Phase 1): `roles` is now company-scoped for ordinary users
  // (per-company keyed role documents, Master Plan §5.6 — the Phase 0
  // BLOCKED status is resolved by the Phase 1 role-document keying migration).
  // F-01 (Phase 0): `companies` is company-scoped for ordinary users — the
  // pre-fix open read was the audit's CRITICAL cross-tenant disclosure.
  it('company-scopes roles and companies for ordinary users (F-01 + F-03 closure)', () => {
    expect(companyScopedQuery(COLLECTIONS.COMPANIES)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(1);
  });

  it('documents the official demo and its single canonical reset path in the current demo-mode documentation', () => {
    // Phase 1's blueprint (docs/DEMO_MODE_IMPLEMENTATION_BLUEPRINT.md) was
    // superseded as demo mode evolved; re-pin against the real current
    // documentation and its actual invariants: one canonical seed plan
    // (buildCompleteDemoPlan) and tenant-isolated reset scripts, with
    // company-demo-neozy as the sole isolation boundary.
    const doc = readFileSync('docs/DEMO_MODE_BUSINESS_FLOW_REMEDIATION.md', 'utf8');
    expect(doc).toContain('buildCompleteDemoPlan()');
    expect(doc).toContain('seedDemoData.ts');
    expect(doc).toContain('resetDemoData.ts');
    expect(doc).toContain('cleanupDemoData.ts');
    expect(doc).toContain('company-demo-neozy');
  });
});
