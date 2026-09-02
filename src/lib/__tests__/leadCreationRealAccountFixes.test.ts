import { beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveRoleDocument } from '../useGlobalBoot';
import { resolveWriteCompanyId, resolveReadCompanyId } from '../firestore';
import { useAppStore } from '../../store/useAppStore';

/**
 * Regression coverage for the Sales-Executive Lead-creation forensic debug
 * (2026-09-02). A user whose role string is "Sales Executive" in a company
 * that only seeded the canonical "Sales" role hit: empty Sales-Executive
 * selector, "Missing or insufficient permissions", a users/MUSR record left
 * behind, and the Lead invisible in the Leads module.
 *
 *   RC-A: role "Sales Executive" has no exact per-company role document (the
 *         company only seeded the canonical "Sales" role) → useGlobalBoot set
 *         roleData=null → resolveVisibility() fell through to 'self' → every
 *         lead not personally owned by the viewer was hidden.
 *   RC-C: a stale persisted activeCompanyId ('company-demo-neozy' from a prior
 *         demo session) is "real-looking" and won in resolveWriteCompanyId() /
 *         companyScopedQuery() before the boot tenant-routing effect reconciled
 *         it → writes stamped the wrong tenant → rules denied → partial data.
 */

describe('RC-A — resolveActiveRoleDocument (roleData resolution stays alias-aware)', () => {
  const roles = [
    { id: 'CO_Sales', name: 'Sales', permissions: { leads: { create: true, visibility: 'all' } } },
    { id: 'CO_Manager', name: 'Manager', permissions: { leads: { create: true, visibility: 'all' } } },
    { id: 'CO_Admin', name: 'Admin', permissions: { leads: { visibility: 'all' } } },
  ];

  it('exact role-name match wins', () => {
    expect(resolveActiveRoleDocument(roles, 'Sales')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'Manager')?.id).toBe('CO_Manager');
  });

  it('a data-driven role with only a compatibility alias resolves to the aliased doc (RC-A: "Sales Executive" -> "Sales")', () => {
    expect(resolveActiveRoleDocument(roles, 'Sales Executive')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'BDM')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'TL')?.id).toBe('CO_Manager');
  });

  it('is case / whitespace insensitive', () => {
    expect(resolveActiveRoleDocument(roles, '  sales executive  ')?.id).toBe('CO_Sales');
  });

  it('returns null for a genuinely unknown role and for an empty role', () => {
    expect(resolveActiveRoleDocument(roles, 'Astronaut')).toBeNull();
    expect(resolveActiveRoleDocument(roles, '')).toBeNull();
    expect(resolveActiveRoleDocument(roles, undefined)).toBeNull();
  });

  it('the alias resolves but the target doc is absent → null (no crash)', () => {
    expect(resolveActiveRoleDocument([{ id: 'x', name: 'Warehouse' }], 'Sales Executive')).toBeNull();
  });
});

describe('RC-C — resolveWriteCompanyId binds an ordinary user to their profile company', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      activeCompanyId: 'default',
      company: null,
      globalCompany: null,
      isAuthenticated: false,
    } as never);
  });

  it('an ordinary user with a stale "real-looking" activeCompanyId still writes to their OWN company', () => {
    useAppStore.setState({
      user: { id: 'u1', name: 'Test Sales Exec', email: 'sales-exec@example.test', role: 'Sales Executive', companyId: 'CO-REAL', isSuperAdmin: false } as never,
      activeCompanyId: 'company-demo-neozy', // stale leftover from a prior demo session
      company: { id: 'CO-REAL', name: 'Test Enterprises' } as never,
    });
    expect(resolveWriteCompanyId()).toBe('CO-REAL');
    expect(resolveReadCompanyId()).toBe('CO-REAL');
  });

  it('an ordinary user whose activeCompanyId already matches is unchanged', () => {
    useAppStore.setState({
      user: { id: 'u1', role: 'Sales', companyId: 'CO-REAL', isSuperAdmin: false } as never,
      activeCompanyId: 'CO-REAL',
    });
    expect(resolveWriteCompanyId()).toBe('CO-REAL');
  });

  it('owner / super-admin keep their explicit company selection', () => {
    useAppStore.setState({
      user: { id: 'o1', role: 'Admin', companyId: 'CO-HOME', isOwner: true, isSuperAdmin: true } as never,
      activeCompanyId: 'CO-OTHER',
      company: { id: 'CO-OTHER' } as never,
    });
    expect(resolveWriteCompanyId()).toBe('CO-OTHER');
  });

  it('GroupAdmin keeps their explicit (sibling-company) selection', () => {
    useAppStore.setState({
      user: { id: 'ga1', role: 'GroupAdmin', companyId: 'CO-HOME', groupId: 'G1', isSuperAdmin: false } as never,
      activeCompanyId: 'CO-SIBLING',
      company: { id: 'CO-SIBLING' } as never,
    });
    expect(resolveWriteCompanyId()).toBe('CO-SIBLING');
  });

  it('falls back to company / profile id when no real activeCompanyId resolves', () => {
    useAppStore.setState({
      user: { id: 'u1', role: 'Sales', companyId: '', isSuperAdmin: false } as never,
      activeCompanyId: 'default',
      company: { id: 'CO-FROM-CONFIG' } as never,
    });
    expect(resolveWriteCompanyId()).toBe('CO-FROM-CONFIG');
  });
});
