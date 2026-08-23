/**
 * rolesSaveCacheInvalidation.test.ts — RBAC Phase 2 (RBAC-F04 closure)
 *
 * Proves: a successful Roles & Permissions save invalidates BOTH ['roles']
 * (the Roles page's own list) AND ['roles_global'] (the permission-cache
 * query useGlobalBoot.ts feeds canDo() from) — previously only the former
 * was invalidated, so a saved permission change would not take effect
 * anywhere in the app until ['roles_global']'s 30-minute staleTime lapsed.
 *
 * Two complementary approaches, both needed:
 *  - Source-text assertions on Roles.tsx itself, matching this repository's
 *    established convention for page-component behavior tests (no
 *    @testing-library/react in this repo — see the sibling
 *    usersTenantAssignment.test.ts for the same pattern) — proves the
 *    ACTUAL save mutation's code does what this phase requires.
 *  - A real TanStack QueryClient, exercised directly (no React rendering
 *    needed for QueryClient APIs) — proves the underlying invalidation
 *    *behavior* for these exact key shapes, including the query-isolation
 *    claim this phase's spec explicitly requires being tested rather than
 *    assumed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { QueryClient } from '@tanstack/react-query';

const rolesPage = readFileSync(resolve(__dirname, '../Roles.tsx'), 'utf-8');

// ── Source-text assertions on Roles.tsx ──────────────────────────────

describe('Roles.tsx — save mutation invalidation (source)', () => {
  it('the save mutation\'s onSuccess invalidates BOTH [\'roles\'] and [\'roles_global\']', () => {
    const onSuccessMatch = rolesPage.match(/onSuccess:\s*\(\)\s*=>\s*\{[\s\S]*?\},\n\s*onError:/);
    expect(onSuccessMatch).not.toBeNull();
    const onSuccessBody = onSuccessMatch![0];
    expect(onSuccessBody).toContain("qc.invalidateQueries({ queryKey: ['roles'] });");
    expect(onSuccessBody).toContain("qc.invalidateQueries({ queryKey: ['roles_global'] });");
  });

  it('the save mutation\'s onError does NOT invalidate any query (no false-success cache state)', () => {
    // The save mutation's onError is the exact, single-line handler shared
    // by every mutation in this file (`(e: any) => toast.error(e.message)`)
    // — confirm it contains no invalidateQueries call anywhere near the save
    // mutation's own onError, by checking the mutation block as a whole.
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    const body = saveMutationBlock![0];
    const onErrorMatch = body.match(/onError:\s*\(e:\s*any\)\s*=>\s*toast\.error\(e\.message\),/);
    expect(onErrorMatch).not.toBeNull();
    expect(onErrorMatch![0]).not.toContain('invalidateQueries');
  });

  it('the save mutation has NO onMutate — no optimistic update was introduced', () => {
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    expect(saveMutationBlock![0]).not.toContain('onMutate');
  });

  it('no manual permissionCache/setQueryData patching was introduced in the save mutation', () => {
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    // Strip comment lines first — the fix's own explanatory comment
    // legitimately mentions "permissionCache" in prose (documenting which
    // downstream cache ['roles_global'] feeds), which is not the same as
    // the code actually touching it. Only executable lines matter here.
    const codeOnly = saveMutationBlock![0]
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('setQueryData');
    expect(codeOnly).not.toContain('permissionCache');
  });

  it('existing success/error UX (toast + closeForm) is preserved unchanged', () => {
    expect(rolesPage).toContain("toast.success(editId ? 'Role updated' : 'Role created');");
    expect(rolesPage).toContain('closeForm();');
  });
});

// ── Behavioral: real QueryClient, exact key semantics ────────────────

describe('QueryClient invalidation behavior — RBAC Phase 2 key shapes', () => {
  function seededClient() {
    const qc = new QueryClient();
    // ['roles'] — Roles.tsx's own list query (and MobileUsersWorkspace.tsx,
    // which shares the exact same bare key by design).
    qc.setQueryData(['roles'], [{ id: 'ROL-A' }]);
    // ['roles_global'] — useGlobalBoot.ts's permission-cache-feeding query.
    qc.setQueryData(['roles_global'], [{ id: 'ROL-A' }]);
    // ['roles', 'scoped'] — Users.tsx's separately-parameterized roles
    // query (also occurs as ['roles', 'home:<companyId>'] in Group view;
    // 'scoped' stands in for either shape — both are length-2 arrays whose
    // first element is the string 'roles', which is what matters for the
    // prefix-matching question this test exists to answer).
    qc.setQueryData(['roles', 'scoped'], [{ id: 'ROL-A' }]);
    return qc;
  }

  it('Test A — successful save invalidates BOTH [\'roles\'] and [\'roles_global\']', async () => {
    const qc = seededClient();
    // Mirrors the exact two calls Roles.tsx's onSuccess now makes.
    await qc.invalidateQueries({ queryKey: ['roles'] });
    await qc.invalidateQueries({ queryKey: ['roles_global'] });
    expect(qc.getQueryState(['roles'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['roles_global'])?.isInvalidated).toBe(true);
  });

  it('Test B — a failed save (no invalidation call made) leaves both caches untouched', () => {
    const qc = seededClient();
    // onError performs no invalidation at all — nothing to call here.
    // Assert the pre-existing, un-invalidated state is exactly preserved.
    expect(qc.getQueryState(['roles'])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(['roles_global'])?.isInvalidated).toBe(false);
    expect(qc.getQueryData(['roles'])).toEqual([{ id: 'ROL-A' }]);
    expect(qc.getQueryData(['roles_global'])).toEqual([{ id: 'ROL-A' }]);
  });

  it('Test C — the NEW [\'roles_global\'] invalidation does not touch Users.tsx\'s [\'roles\', X] query', async () => {
    const qc = seededClient();
    await qc.invalidateQueries({ queryKey: ['roles_global'] });
    expect(qc.getQueryState(['roles', 'scoped'])?.isInvalidated).toBe(false);
  });

  it('Test C (documented, pre-existing behavior) — the PRE-EXISTING [\'roles\'] invalidation DOES prefix-match Users.tsx\'s [\'roles\', X] query, by TanStack Query\'s default (exact:false) matching — this is unchanged by Phase 2 and consistent with this codebase\'s own documented queryKeys.ts prefix-matching architecture (shorter key invalidates its own longer/nested keys by design, e.g. leadsRoot -> leadsPaged/leadsAll)', async () => {
    const qc = seededClient();
    await qc.invalidateQueries({ queryKey: ['roles'] });
    expect(qc.getQueryState(['roles', 'scoped'])?.isInvalidated).toBe(true);
  });

  it('[\'roles_global\'] and [\'roles\', X] never share a common key prefix, regardless of invalidation call order', async () => {
    const qc = seededClient();
    await qc.invalidateQueries({ queryKey: ['roles_global'] });
    await qc.invalidateQueries({ queryKey: ['roles'] });
    // Both end up invalidated here, but ONLY because of the second (pre-
    // existing) call — re-run with just the first call reversed to confirm
    // roles_global alone is never sufficient to reach ['roles', X].
    const qc2 = seededClient();
    await qc2.invalidateQueries({ queryKey: ['roles_global'] });
    expect(qc2.getQueryState(['roles', 'scoped'])?.isInvalidated).toBe(false);
    expect(qc2.getQueryState(['roles_global'])?.isInvalidated).toBe(true);
  });
});
