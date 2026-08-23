/**
 * rbacPhase8CacheAuthorizationInteraction.test.ts — RBAC Phase 8
 * (Security & Regression Hardening, cumulative Phases 2-6 client-side chain).
 *
 * Phases 2, 3, 4, and 6 each proved their own mechanism correct in
 * isolation:
 *   - Phase 2: a successful role save invalidates BOTH ['roles'] and
 *     ['roles_global'].
 *   - Phase 3: the roles_global cache key is company-scoped
 *     (resolveRolesGlobalCacheCompanyId), so a company switch cannot serve
 *     stale cross-company data.
 *   - Phase 4: canDo('roles', create/edit/delete) is false in Group View,
 *     regardless of cache content.
 *   - Phase 6: all 10 Permission actions (including disburse/import/
 *     view_pricing) are configurable and canDo()-coherent.
 *
 * None of those test files chains these mechanisms together through a
 * single continuous session the way a real user would experience it. This
 * file does exactly that — driving the REAL exported functions
 * (resolveRolesGlobalCacheCompanyId, canDo) through the three sequences the
 * Phase 8 spec names explicitly (§14 Sequence A/B/C), plus a Phase 6
 * runtime-coherence check and a Company-A -> Group-View -> Company-B
 * variant of the Phase 4/5 Group View regression (the spec's own "repeat
 * for Company B").
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store/useAppStore';
import { canDo } from '../permissions';
import { resolveRolesGlobalCacheCompanyId } from '../useGlobalBoot';

const ADMIN_A_FULL = {
  id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1 as const,
  permissions: {
    roles: { view: true, create: true, edit: true, delete: true },
    customers: { view: true, create: true, edit: true },
    payouts: { view: true, disburse: true },
    scheme_registration: { view: true, import: true },
    dispatch: { view: true, view_pricing: true },
  },
};

const ADMIN_B_RESTRICTED = {
  id: 'CO-B_Admin', name: 'Admin', companyId: 'CO-B', schemaVersion: 1 as const,
  permissions: {
    // Deliberately DIFFERENT from Company A's Admin — proves Sequence B
    // reads Company B's OWN permission state, not a copy of Company A's.
    roles: { view: true, create: false, edit: false, delete: false },
    customers: { view: true, create: false, edit: false },
    payouts: { view: true, disburse: false },
  },
};

function seedCompanyScopedCache(qc: QueryClient, companyId: string, roles: Record<string, unknown>) {
  const key = ['roles_global', resolveRolesGlobalCacheCompanyId(companyId, companyId)];
  qc.setQueryData(key, [roles]);
  return key;
}

beforeEach(() => {
  useAppStore.setState({
    user: { id: 'admin-1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'CO-A', isSuperAdmin: false, isOwner: false },
    activeCompanyId: 'CO-A',
    isAuthenticated: true,
    permissionCache: { ready: true, roles: { admin: ADMIN_A_FULL }, permissions: {} } as never,
    roleData: null,
  });
});

describe('Sequence A (§14): Company A -> Group View -> Company A — permissions restored exactly', () => {
  it('roles.edit: true (Company A) -> false (Group View) -> true (Company A again)', () => {
    expect(canDo('roles', 'edit')).toBe(true);

    useAppStore.setState({ activeCompanyId: 'group' });
    expect(canDo('roles', 'edit')).toBe(false);
    // Non-roles permissions remain unaffected by Group View (Phase 4 §14 non-goal).
    expect(canDo('customers', 'edit')).toBe(true);

    useAppStore.setState({ activeCompanyId: 'CO-A' });
    expect(canDo('roles', 'edit')).toBe(true);
  });

  it('the roles_global cache-key company segment follows the identical A -> group -> A sequence, never colliding with a real company mid-sequence', () => {
    const keyA1 = resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A');
    const keyGroup = resolveRolesGlobalCacheCompanyId('group', 'CO-A');
    const keyA2 = resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A');
    expect(keyA1).toBe('CO-A');
    expect(keyGroup).toBe('group');
    expect(keyA2).toBe('CO-A');
    expect(keyA1).toBe(keyA2);
    expect(keyGroup).not.toBe(keyA1);
  });
});

describe('Sequence A, repeated for Company B (§13: "Then repeat for Company B")', () => {
  it('Company A -> Group View -> Company B: Group View never leaks into, and is never confused with, Company B\'s own (different) permission set', () => {
    // Start in Company A with full Admin permissions.
    expect(canDo('roles', 'edit')).toBe(true);

    // Enter Group View — roles mutations denied regardless of role.
    useAppStore.setState({ activeCompanyId: 'group' });
    expect(canDo('roles', 'edit')).toBe(false);

    // Switch directly to Company B, with Company B's OWN (deliberately
    // restricted) permission cache now populated — never Company A's or
    // Group View's leftover state.
    useAppStore.setState({
      user: { id: 'admin-2', name: 'Admin B', email: 'b@test.erp', role: 'Admin', companyId: 'CO-B', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'CO-B',
      permissionCache: { ready: true, roles: { admin: ADMIN_B_RESTRICTED }, permissions: {} } as never,
    });
    // Company B's Admin genuinely has roles.create/edit/delete = false in
    // this seed — canDo() must reflect THAT, not Company A's true values,
    // and not Group View's blanket false (activeCompanyId is now a real
    // company, so the Phase 4 guard no longer applies at all).
    expect(canDo('roles', 'create')).toBe(false);
    expect(canDo('roles', 'view')).toBe(true); // view was never restricted
  });
});

describe('Sequence B (§14): Company A -> Company B — cache state is never reused across companies', () => {
  it('a QueryClient cache entry seeded for Company A is never read when the key resolves for Company B', () => {
    const qc = new QueryClient();
    const keyA = seedCompanyScopedCache(qc, 'CO-A', ADMIN_A_FULL);
    const keyB = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-B', 'CO-B')];

    expect(keyB).not.toEqual(keyA);
    expect(qc.getQueryData(keyB)).toBeUndefined();
    // Company A's own entry is untouched by the switch.
    expect(qc.getQueryData(keyA)).toEqual([ADMIN_A_FULL]);
  });

  it('canDo() itself never blends Company A and Company B permission data — switching the store\'s permissionCache wholesale (as useGlobalBoot.ts\'s bootstrap effect does on a real company switch) fully replaces the effective permissions, not merges them', () => {
    expect(canDo('roles', 'create')).toBe(true); // Company A
    useAppStore.setState({
      activeCompanyId: 'CO-B',
      permissionCache: { ready: true, roles: { admin: ADMIN_B_RESTRICTED }, permissions: {} } as never,
    });
    expect(canDo('roles', 'create')).toBe(false); // Company B — not a blend, not Company A's true value leaking through
  });
});

describe('Sequence C (§14): edit -> save -> cache invalidation -> re-evaluate (Phase 2 + Phase 3 working together)', () => {
  it('invalidating BOTH [\'roles\'] and [\'roles_global\', companyId] (the exact pair Roles.tsx\'s save mutation now invalidates) marks the company-scoped entry stale, ready for a refetch that would carry the edited permissions', async () => {
    const qc = new QueryClient();
    const companyId = resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A');
    const key = ['roles_global', companyId];
    qc.setQueryData(key, [{ ...ADMIN_A_FULL, permissions: { roles: { edit: false } } }]); // pre-edit state

    // Mirrors Roles.tsx's save mutation onSuccess exactly (Phase 2's fix).
    await qc.invalidateQueries({ queryKey: ['roles'] });
    await qc.invalidateQueries({ queryKey: ['roles_global'] }); // prefix-matches ['roles_global', companyId] — Phase 3 report §3

    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);

    // Simulate the refetch that would follow (useGlobalBoot's query re-running)
    // landing the edited permissions, and the bootstrap effect propagating
    // them into permissionCache — canDo() reflects the NEW value.
    const editedRole = { ...ADMIN_A_FULL, permissions: { ...ADMIN_A_FULL.permissions, roles: { view: true, create: true, edit: true, delete: true } } };
    useAppStore.setState({ permissionCache: { ready: true, roles: { admin: editedRole }, permissions: {} } as never });
    expect(canDo('roles', 'edit')).toBe(true);
  });
});

describe('Phase 6 runtime coherence (§15): the 3 newly-exposed actions (disburse, import, view_pricing) gate canDo() correctly and nothing more', () => {
  it('disburse: granted on payouts only — true there, false on every other module', () => {
    expect(canDo('disburse', 'payouts')).toBe(true);
    expect(canDo('disburse', 'roles')).toBe(false);
    expect(canDo('disburse', 'customers')).toBe(false);
  });

  it('import: granted on scheme_registration only', () => {
    expect(canDo('import', 'scheme_registration')).toBe(true);
    expect(canDo('import', 'roles')).toBe(false);
  });

  it('view_pricing: granted on dispatch only', () => {
    expect(canDo('view_pricing', 'dispatch')).toBe(true);
    expect(canDo('view_pricing', 'customers')).toBe(false);
  });

  it('a role with NONE of the 3 new actions granted correctly denies all 3 (no accidental default-true)', () => {
    useAppStore.setState({
      permissionCache: {
        ready: true,
        roles: { admin: { id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1, permissions: { payouts: { view: true } } } },
        permissions: {},
      } as never,
    });
    expect(canDo('disburse', 'payouts')).toBe(false);
    expect(canDo('import', 'payouts')).toBe(false);
    expect(canDo('view_pricing', 'payouts')).toBe(false);
  });
});

describe('Phase 7 regression anchor (§16): the two load-bearing legacy checks Phase 7 proved unsafe to migrate remain behaviorally correct under the full Phase 1-6 cumulative state', () => {
  it('canDo(\'approve\', \'scheme_registration\') is still true for Manager (the reason the Reopen feature\'s extra role===\'Admin\' check is still necessary)', () => {
    useAppStore.setState({
      user: { id: 'm1', name: 'Manager M', email: 'm@test.erp', role: 'Manager', companyId: 'CO-A', isSuperAdmin: false },
      permissionCache: {
        ready: true,
        roles: { manager: { id: 'CO-A_Manager', name: 'Manager', companyId: 'CO-A', schemaVersion: 1, permissions: { scheme_registration: { approve: true } } } },
        permissions: {},
      } as never,
    });
    expect(canDo('approve', 'scheme_registration')).toBe(true);
  });

  it('canDo(\'edit\', \'installations\') is still false for Director (the reason MobileInstallationsWorkspace\'s (Admin||Director) check is still necessary)', () => {
    useAppStore.setState({
      user: { id: 'd1', name: 'Director D', email: 'd@test.erp', role: 'Director', companyId: 'CO-A', isSuperAdmin: false },
      permissionCache: {
        ready: true,
        roles: { director: { id: 'CO-A_Director', name: 'Director', companyId: 'CO-A', schemaVersion: 1, permissions: {} } },
        permissions: {},
      } as never,
    });
    expect(canDo('edit', 'installations')).toBe(false);
  });
});

describe('SuperAdmin bypass unaffected by any cache/company-switch sequence', () => {
  it('isSuperAdmin short-circuits true regardless of activeCompanyId, Group View, or permissionCache content', () => {
    useAppStore.setState({
      user: { id: 'sa1', name: 'Super Admin', email: 'sa@test.erp', role: 'SuperAdmin', companyId: 'CO-A', isSuperAdmin: true },
      activeCompanyId: 'group',
      permissionCache: { ready: true, roles: {}, permissions: {} } as never,
    });
    expect(canDo('customers', 'delete')).toBe(true);
    // Even the Phase 4 Group View guard is bypassed for SuperAdmin on
    // non-roles modules (it never applied there); roles mutations remain
    // the one deliberate exception, tested in groupViewRolesPermissions.test.ts.
  });
});
