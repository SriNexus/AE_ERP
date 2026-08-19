import { beforeEach, describe, expect, it } from 'vitest';
import { companyScopedQuery, resolveWriteGroupId } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';
import { getCompanyRoleSeedDocuments, getSystemRoleSeedDocuments, roleDocumentId } from '../roleBootstrap';

const COMPANY_A = 'CO-A';
const COMPANY_B = 'CO-B';
const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';

function setUser(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    user: {
      id: 'admin-1',
      name: 'Admin',
      email: 'admin@test.erp',
      role: 'Admin',
      companyId: COMPANY_A,
      ...overrides,
    } as any,
    activeCompanyId: COMPANY_A,
    isAuthenticated: true,
  });
}

describe('Phase 1 — resolveWriteGroupId (authoritative, never client-supplied)', () => {
  beforeEach(() => {
    useAppStore.setState({
      companyGroupIds: { [COMPANY_A]: GROUP_A, [COMPANY_B]: GROUP_B },
      company: { ...useAppStore.getState().company, id: COMPANY_A },
      globalCompany: null,
    });
    setUser();
  });

  it('resolves the groupId from the companyGroupIds map for the active company', () => {
    expect(resolveWriteGroupId()).toBe(GROUP_A);
  });

  it('resolves the groupId of an EXPLICIT target company (cross-company write by owner/super-admin)', () => {
    expect(resolveWriteGroupId(COMPANY_B)).toBe(GROUP_B);
  });

  it('never returns a client-supplied value — the function takes only a companyId (forged groupId cannot be injected)', () => {
    // A client payload groupId is never an input here: the write helpers strip
    // any client-supplied groupId and call this with the authoritative
    // companyId. Assert the resolution is purely company-derived.
    expect(resolveWriteGroupId(COMPANY_A)).toBe(GROUP_A);
    expect(resolveWriteGroupId('COMPANY-FORGED')).toBe('');
  });

  it('fails closed (empty string) when the target company has no known group', () => {
    expect(resolveWriteGroupId('UNKNOWN-CO')).toBe('');
  });

  it('falls back to the loaded company config object when the map is not yet populated (pre-boot/demo)', () => {
    useAppStore.setState({ companyGroupIds: {}, company: { ...useAppStore.getState().company, id: COMPANY_A, groupId: GROUP_A } });
    expect(resolveWriteGroupId(COMPANY_A)).toBe(GROUP_A);
  });

  it('treats the neutral "default"/"all" placeholders as "no explicit target" — resolves via the standard chain, never to a fabricated group', () => {
    // The neutral placeholders are NOT real company ids, so they are never
    // accepted as a target company; the resolver falls through to the normal
    // company resolution (active → config → user profile) — exactly like
    // resolveWriteCompanyId(). The fail-closed case is an unresolvable real-
    // looking id (tested above: 'UNKNOWN-CO' → '').
    useAppStore.setState({ activeCompanyId: 'default', user: { ...useAppStore.getState().user, companyId: COMPANY_A } as any });
    expect(resolveWriteGroupId()).toBe(GROUP_A);
    expect(resolveWriteGroupId('all')).toBe(GROUP_A);
    expect(resolveWriteGroupId('default')).toBe(GROUP_A);
  });
});

describe('Phase 1 — F-03 role-document keying', () => {
  it('roleDocumentId produces the per-company keyed id', () => {
    expect(roleDocumentId(COMPANY_A, 'Admin')).toBe('CO-A_Admin');
    expect(roleDocumentId(COMPANY_B, 'Manager')).toBe('CO-B_Manager');
  });

  it('getCompanyRoleSeedDocuments returns the same system seeds, keyed per company with companyId stamped', () => {
    const companySeeds = getCompanyRoleSeedDocuments(COMPANY_A);
    const systemSeeds = getSystemRoleSeedDocuments();
    expect(companySeeds).toHaveLength(systemSeeds.length);
    for (const seed of companySeeds) {
      expect(seed.id).toBe(roleDocumentId(COMPANY_A, seed.name));
      expect(seed.companyId).toBe(COMPANY_A);
      expect(seed.isSystem).toBe(true);
    }
    // The seed content itself is identical to the shared template (only the
    // id/companyId differ) — the permission model is preserved exactly.
    const byName = new Map(systemSeeds.map((s) => [s.name, s]));
    for (const seed of companySeeds) {
      const system = byName.get(seed.name)!;
      expect(seed.permissions).toEqual(system.permissions);
      expect(seed.description).toBe(system.description);
      expect(seed.department).toBe(system.department);
    }
  });
});

describe('Phase 1 — companyScopedQuery(ROLES) F-03 closure', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'u1', name: 'U', email: 'u@test.erp', role: 'Sales', companyId: COMPANY_A } as any,
      activeCompanyId: COMPANY_A,
      isAuthenticated: true,
    });
  });

  it('company-scopes roles for an ordinary user', () => {
    const constraints = companyScopedQuery(COLLECTIONS.ROLES);
    expect(constraints).toHaveLength(1);
  });

  it('keeps roles unscoped for owner/super-admin (platform tier)', () => {
    useAppStore.setState({ user: { ...useAppStore.getState().user, isOwner: true, isSuperAdmin: true } as any });
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(0);
  });

  it('still throws fail-closed for an ordinary user stuck on the neutral placeholder', () => {
    useAppStore.setState({ activeCompanyId: 'default', user: { ...useAppStore.getState().user, companyId: 'default' } as any });
    expect(() => companyScopedQuery(COLLECTIONS.ROLES)).toThrow(/no valid companyId/);
  });
});
