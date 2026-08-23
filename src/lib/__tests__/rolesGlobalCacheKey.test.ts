/**
 * rolesGlobalCacheKey.test.ts — RBAC Phase 3 (RBAC-F05 closure)
 *
 * Proves: the useGlobalBoot.ts roles_global query key now carries the same
 * resolved company id that companyScopedQuery() (firestore.ts) actually
 * scopes the live `roles` collection read to — so switching activeCompanyId
 * from one real company to another gives each company its own TanStack
 * Query cache entry, instead of both companies silently sharing the single,
 * static ['roles_global'] key that let a company switch keep serving the
 * PREVIOUS company's still-fresh (staleTime: 30min) cached role permissions.
 *
 * Two complementary approaches, matching this repository's established
 * conventions:
 *  - Direct unit tests against resolveRolesGlobalCacheCompanyId() — the
 *    pure, exported decision function useGlobalBoot.ts's query key is built
 *    from — proving its branch-by-branch behavior empirically.
 *  - A real TanStack QueryClient, exercised directly, proving the actual
 *    cache-isolation/restoration behavior these key values produce (Tests
 *    A/D/E), and a source-text check confirming the real hook wires the
 *    function into its actual queryKey (not just that the function exists
 *    in isolation).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { QueryClient } from '@tanstack/react-query';
import { resolveRolesGlobalCacheCompanyId } from '../useGlobalBoot';
import { companyScopedQuery } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

const hookSource = readFileSync(new URL('../useGlobalBoot.ts', import.meta.url), 'utf-8');

// ── resolveRolesGlobalCacheCompanyId — pure function behavior ────────

describe('resolveRolesGlobalCacheCompanyId — branch-by-branch, mirroring companyScopedQuery\'s roles-collection scoping', () => {
  it('a real, distinct company id is used as-is (Company A)', () => {
    expect(resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A')).toBe('CO-A');
  });

  it('a real, distinct company id is used as-is (Company B) — differs from Company A\'s result', () => {
    expect(resolveRolesGlobalCacheCompanyId('CO-B', 'CO-B')).toBe('CO-B');
    expect(resolveRolesGlobalCacheCompanyId('CO-B', 'CO-B')).not.toBe(resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A'));
  });

  it('Group View (\'group\') resolves to the distinct sentinel \'group\', never the actor\'s home company id — this is the material divergence from the naive isRealCompanyId(x)?x:user.companyId shorthand: companyScopedQuery() scopes Group View by groupId (structurally distinct from any companyId, and roles docs never carry groupId), so aliasing it to the home company id here would let a Group-View refetch silently overwrite the real home company\'s own cache entry', () => {
    expect(resolveRolesGlobalCacheCompanyId('group', 'CO-A')).toBe('group');
    expect(resolveRolesGlobalCacheCompanyId('group', 'CO-A')).not.toBe('CO-A');
  });

  it('the neutral \'all\' sentinel (owner/super-admin unscoped context) falls back to the actor\'s own companyId, matching companyScopedQuery()\'s non-owner fallback branch', () => {
    expect(resolveRolesGlobalCacheCompanyId('all', 'CO-A')).toBe('CO-A');
  });

  it('the neutral \'default\' placeholder (pre-boot) falls back to the actor\'s own companyId', () => {
    expect(resolveRolesGlobalCacheCompanyId('default', 'CO-A')).toBe('CO-A');
  });

  it('no resolvable company at all yields a stable, explicit sentinel rather than undefined/empty-string (never silently produces an unstable or colliding key)', () => {
    expect(resolveRolesGlobalCacheCompanyId(undefined, undefined)).toBe('unresolved');
    expect(resolveRolesGlobalCacheCompanyId(null, null)).toBe('unresolved');
    expect(resolveRolesGlobalCacheCompanyId('default', '')).toBe('unresolved');
  });

  it('Test E — stable key: repeated evaluation with the same inputs produces the exact same value every time (no fragmentation/refetch-loop risk)', () => {
    const results = Array.from({ length: 20 }, () => resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A'));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('CO-A');
  });

  it('Test B — an irrelevant re-render (same activeCompanyId/user.companyId inputs) never changes the resolved value', () => {
    const first = resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A');
    const second = resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A');
    expect(second).toBe(first);
  });
});

// ── Source-text: the real hook actually wires this into its queryKey ──

describe('useGlobalBoot.ts — roles_global query is actually keyed by the resolved company id (source)', () => {
  it('computes rolesGlobalCompanyId via resolveRolesGlobalCacheCompanyId(activeCompanyId, user?.companyId)', () => {
    expect(hookSource).toContain('const rolesGlobalCompanyId = resolveRolesGlobalCacheCompanyId(activeCompanyId, user?.companyId);');
  });

  it('the roles_global useQuery call uses the company-suffixed key, not the old static one', () => {
    expect(hookSource).toContain("queryKey:['roles_global', rolesGlobalCompanyId]");
    // The old, static two-element-free key must be gone from the query call
    // itself (it may still appear inside comments describing the fix).
    expect(hookSource).not.toContain("queryKey:['roles_global'],");
  });

  it('both self-heal setQueryData writes use the SAME company-suffixed key as the query (no orphaned cache entry under the old key shape)', () => {
    const setQueryDataCalls = hookSource.match(/queryClient\.setQueryData\(\['roles_global'[^)]*\)/g) || [];
    expect(setQueryDataCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of setQueryDataCalls) {
      expect(call).toContain("['roles_global', rolesGlobalCompanyId]");
    }
  });

  it('isRealCompanyId is imported from firestore.ts, not re-implemented locally (single source of truth)', () => {
    expect(hookSource).toContain("import { createDocWithId, getAll, isRealCompanyId, resolveWriteCompanyId, updateDocById } from './firestore';");
  });
});

// ── Test C: cache key cross-validated against the REAL companyScopedQuery() ──
//
// Per the phase spec: "Prove that the company ID embedded in the key is the
// same company ID actually used by the roles fetch. Do not simply inspect
// two lines of source code and call this verified." This drives real
// useAppStore state through the ACTUAL companyScopedQuery(COLLECTIONS.ROLES)
// (the exact function the roles_global queryFn's getAll() call invokes
// internally) and compares its resulting constraint against
// resolveRolesGlobalCacheCompanyId()'s output for the SAME state — an
// independent, executable cross-check, not two static assertions.

describe('Test C — cache key vs. the ACTUAL companyScopedQuery(COLLECTIONS.ROLES) fetch scope', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      activeCompanyId: 'default',
      isAuthenticated: false,
      permissionCache: { ready: false, roles: {}, permissions: {} } as never,
      roleData: null,
      companyGroupIds: {},
    });
  });

  it('a real company (non-owner Admin): the constraint\'s companyId value matches resolveRolesGlobalCacheCompanyId()\'s output exactly', () => {
    useAppStore.setState({
      user: { id: 'u1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'CO-A', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'CO-A',
      isAuthenticated: true,
    });
    const constraints = companyScopedQuery(COLLECTIONS.ROLES);
    expect(constraints).toHaveLength(1);
    const serialized = JSON.stringify(constraints[0]);
    // The real fetch constraint is a companyId equality filter...
    expect(serialized).toContain('companyId');
    // ...and its VALUE is literally the string 'CO-A' — the same value
    // resolveRolesGlobalCacheCompanyId produces for this exact state.
    expect(serialized).toContain('CO-A');
    const cacheKeyCompanyId = resolveRolesGlobalCacheCompanyId(
      useAppStore.getState().activeCompanyId,
      useAppStore.getState().user?.companyId,
    );
    expect(cacheKeyCompanyId).toBe('CO-A');
    expect(serialized).toContain(cacheKeyCompanyId);
  });

  it('a second, distinct real company (Company B): same cross-check, different value — proves this is not coincidental for one fixed string', () => {
    useAppStore.setState({
      user: { id: 'u2', name: 'Admin B', email: 'b@test.erp', role: 'Admin', companyId: 'CO-B', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'CO-B',
      isAuthenticated: true,
    });
    const constraints = companyScopedQuery(COLLECTIONS.ROLES);
    const serialized = JSON.stringify(constraints[0]);
    const cacheKeyCompanyId = resolveRolesGlobalCacheCompanyId(
      useAppStore.getState().activeCompanyId,
      useAppStore.getState().user?.companyId,
    );
    expect(cacheKeyCompanyId).toBe('CO-B');
    expect(serialized).toContain(cacheKeyCompanyId);
  });

  it('an Admin whose activeCompanyId has not resolved to a real id yet (still \'default\') — the fetch falls back to user.companyId, and so does the cache key, identically', () => {
    useAppStore.setState({
      user: { id: 'u3', name: 'Admin C', email: 'c@test.erp', role: 'Admin', companyId: 'CO-C', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'default',
      isAuthenticated: true,
    });
    const constraints = companyScopedQuery(COLLECTIONS.ROLES);
    const serialized = JSON.stringify(constraints[0]);
    const cacheKeyCompanyId = resolveRolesGlobalCacheCompanyId('default', 'CO-C');
    expect(cacheKeyCompanyId).toBe('CO-C');
    expect(serialized).toContain(cacheKeyCompanyId);
  });

  it('Group View: the real fetch constraint is groupId-based (never companyId), and the cache key deliberately uses the non-colliding \'group\' sentinel rather than falsely claiming any real companyId', () => {
    useAppStore.setState({
      user: { id: 'ga-1', name: 'Group Admin', email: 'ga@test.erp', role: 'GroupAdmin', companyId: 'CO-A', groupId: 'GROUP-A', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'group',
      isAuthenticated: true,
    });
    const constraints = companyScopedQuery(COLLECTIONS.ROLES);
    const serialized = JSON.stringify(constraints[0]);
    // The real fetch, in Group View, is scoped by groupId — NOT companyId.
    expect(serialized).toContain('groupId');
    expect(serialized).not.toContain('companyId');
    const cacheKeyCompanyId = resolveRolesGlobalCacheCompanyId('group', 'CO-A');
    expect(cacheKeyCompanyId).toBe('group');
    // Critically, 'group' must not equal (and thus cannot collide with) the
    // actor's own real home-company id — proving the key does not silently
    // misrepresent this fundamentally different (groupId-scoped) fetch as
    // if it were CO-A's own companyId-scoped fetch.
    expect(cacheKeyCompanyId).not.toBe('CO-A');
  });
});

// ── Behavioral: real QueryClient, exact company-switch semantics ─────

describe('QueryClient behavior — company-switch cache isolation (RBAC Phase 3)', () => {
  it('Test A — Company A and Company B resolve to distinct query keys and thus distinct, independently-invalidatable cache entries', async () => {
    const qc = new QueryClient();
    const keyA = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A')];
    const keyB = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-B', 'CO-B')];
    qc.setQueryData(keyA, [{ id: 'ROL-A-Admin', companyId: 'CO-A' }]);
    qc.setQueryData(keyB, [{ id: 'ROL-B-Admin', companyId: 'CO-B' }]);

    expect(qc.getQueryData(keyA)).toEqual([{ id: 'ROL-A-Admin', companyId: 'CO-A' }]);
    expect(qc.getQueryData(keyB)).toEqual([{ id: 'ROL-B-Admin', companyId: 'CO-B' }]);

    // Invalidating Company A's own key must not touch Company B's entry.
    await qc.invalidateQueries({ queryKey: keyA, exact: true });
    expect(qc.getQueryState(keyA)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keyB)?.isInvalidated).toBe(false);
  });

  it('Test D — switching from Company A to Company B never serves Company A\'s cached roles as Company B\'s fresh result', () => {
    const qc = new QueryClient();
    const keyA = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A')];
    qc.setQueryData(keyA, [{ id: 'ROL-A-Admin', name: 'Admin', companyId: 'CO-A', permissions: { roles: { edit: true } } }]);

    // Switch: activeCompanyId is now Company B. The SAME formula the real
    // hook uses is re-evaluated with the new inputs, exactly as a re-render
    // would do — this is the crux of the fix: a company switch must produce
    // a DIFFERENT key so TanStack cannot serve the old entry for it.
    const keyB = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-B', 'CO-B')];
    expect(keyB).not.toEqual(keyA);

    // Company B's key has no data yet — proves it is not aliased to A's
    // entry (a query mounted with this key would be `undefined`/pending,
    // never accidentally reading A's array).
    expect(qc.getQueryData(keyB)).toBeUndefined();
    // Company A's own entry is completely unaffected by the switch.
    expect(qc.getQueryData(keyA)).toEqual([{ id: 'ROL-A-Admin', name: 'Admin', companyId: 'CO-A', permissions: { roles: { edit: true } } }]);
  });

  it('Group View gets its own isolated key too — switching Company A -> Group View -> Company A cannot leave Group View\'s (always-empty, groupId-scoped) fetch overwriting Company A\'s real cache entry', () => {
    const qc = new QueryClient();
    const keyA = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A')];
    qc.setQueryData(keyA, [{ id: 'ROL-A-Admin', companyId: 'CO-A' }]);

    const keyGroup = ['roles_global', resolveRolesGlobalCacheCompanyId('group', 'CO-A')];
    expect(keyGroup).not.toEqual(keyA);
    // Simulate the Group-View fetch actually running (companyScopedQuery's
    // groupId branch always returns zero role docs) and being written under
    // its OWN key.
    qc.setQueryData(keyGroup, []);

    // Returning to the real company: its key is identical to before, and
    // its data was never touched by the Group-View write.
    const keyARestored = ['roles_global', resolveRolesGlobalCacheCompanyId('CO-A', 'CO-A')];
    expect(keyARestored).toEqual(keyA);
    expect(qc.getQueryData(keyARestored)).toEqual([{ id: 'ROL-A-Admin', companyId: 'CO-A' }]);
  });
});
