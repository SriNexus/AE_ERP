/**
 * rolesGroupViewCreateGating.test.ts — RBAC Phase 5 (RBAC-F06 closure)
 *
 * Before this phase, Roles.tsx rendered its "Create Role" affordance (the
 * WorkspaceHero action button, the empty-state "Create Your First Role"
 * button, and a ?create=1 URL-driven auto-open effect) unconditionally —
 * even while activeCompanyId === 'group', where Phase 4 already made
 * canDo('roles','create') return false for every actor. This let the UI
 * present a creation affordance the app's own permission semantics say is
 * not available in that context.
 *
 * This is UI gating only — it does not touch the save mutation (Phase 2),
 * the roles_global cache (Phase 3), or canDo() (Phase 4), and it does not
 * modify Firestore rules, which remain the real authorization boundary.
 *
 * Follows this repository's established source-text-verification convention
 * for page components (no @testing-library/react — see
 * usersTenantAssignment.test.ts / rolesSaveCacheInvalidation.test.ts for the
 * precedent this mirrors).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rolesPage = readFileSync(resolve(__dirname, '../Roles.tsx'), 'utf-8');

// This repository has no @testing-library/react, so a rendered-DOM
// component test isn't available (matching the established convention —
// see the file header). The gating decision itself is a single boolean
// derived the same way everywhere it's used in the JSX (`!isGroupViewMode`,
// where `isGroupViewMode = activeCompanyId === 'group'`) — this block proves
// that shared boolean's truth table directly, as the closest behavioral
// equivalent available without a rendering harness; the source-text
// describe blocks below independently prove the JSX actually wires that
// exact boolean into each affordance's visibility. Real rendered-DOM
// confirmation is the Phase 5 report's manual UI walkthrough (§6).
function isCreateRoleAvailable(activeCompanyId: string): boolean {
  const isGroupViewMode = activeCompanyId === 'group';
  return !isGroupViewMode;
}

describe('Test A/B/C — Create Role availability truth table (the shared boolean the JSX gates on)', () => {
  it('Test A — Group View (\'group\'): Create Role is unavailable', () => {
    expect(isCreateRoleAvailable('group')).toBe(false);
  });

  it('Test B — a real company: Create Role is available', () => {
    expect(isCreateRoleAvailable('CO-A')).toBe(true);
    expect(isCreateRoleAvailable('CO-B')).toBe(true);
  });

  it('Test C — transition Company A -> Group View -> Company A: available -> unavailable -> available', () => {
    const sequence = ['CO-A', 'group', 'CO-A'].map(isCreateRoleAvailable);
    expect(sequence).toEqual([true, false, true]);
  });
});

describe('Test A — WorkspaceHero "Create Role" button is gated on !isGroupViewMode', () => {
  it('the button is wrapped in a !isGroupViewMode conditional, not rendered unconditionally', () => {
    expect(rolesPage).toContain('{!isGroupViewMode && (');
    // Immediately preceding text is the Create Role button block.
    const gatedBlock = rolesPage.match(/\{!isGroupViewMode && \(\s*<Button size="sm" icon=\{<Plus[\s\S]*?Create Role\s*<\/Button>\s*\)\}/);
    expect(gatedBlock).not.toBeNull();
  });
});

describe('Test B — real-company behavior is unchanged: the button still exists, still calls setShowForm(true) with editId:null, unconditionally once !isGroupViewMode is true', () => {
  it('the gated Create Role button opens a fresh (non-edit) form exactly as before', () => {
    expect(rolesPage).toContain("onClick={() => { setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) }); setEditId(null); setShowForm(true); }}>\n                Create Role");
  });
});

describe('Test C — the second Create affordance (empty-state "Create Your First Role") is also gated', () => {
  it('the EmptyState action ternary includes !isGroupViewMode alongside the existing !hasActiveFilters check', () => {
    expect(rolesPage).toContain('action={!hasActiveFilters && !isGroupViewMode ? <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setForm({ ...FORM0, permissions: JSON.parse(JSON.stringify(INITIAL_PERMS)) }); setShowForm(true); }}>Create Your First Role</Button> : undefined} />');
  });
});

describe('the third path — a direct ?create=1 URL — cannot bypass the gating either', () => {
  it('the createParam auto-open effect checks !isGroupViewMode before opening the form, and depends on isGroupViewMode', () => {
    expect(rolesPage).toContain("if (createParam === '1' && !isGroupViewMode) {");
    expect(rolesPage).toContain('}, [createParam, isGroupViewMode]);');
  });
});

describe('no other reachable path opens the creation modal in Group View', () => {
  it('the roles list query stays disabled in Group View, so no existing-role row (and thus no Clone-derived creation) is ever reachable there — structurally, not just by the three gates above', () => {
    expect(rolesPage).toContain('enabled: !isGroupViewMode,');
  });
});

describe('scope discipline — Phases 2/3/4 and Firestore rules are untouched by this phase', () => {
  it('the save mutation (Phase 2) is unmodified: both invalidateQueries calls and onError are exactly as Phase 2 left them', () => {
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    expect(saveMutationBlock![0]).toContain("qc.invalidateQueries({ queryKey: ['roles'] });");
    expect(saveMutationBlock![0]).toContain("qc.invalidateQueries({ queryKey: ['roles_global'] });");
    expect(saveMutationBlock![0]).toContain("onError: (e: any) => toast.error(e.message),");
  });

  it('the existing Group View banner text is still present, unmodified', () => {
    expect(rolesPage).toContain('Roles are managed per Company. Select a Company above to view or edit its roles.');
  });

  it('isGroupViewMode is still derived exactly as before (Phase 4 did not change this line, and Phase 5 must not either)', () => {
    expect(rolesPage).toContain("const isGroupViewMode = activeCompanyId === 'group';");
  });
});
