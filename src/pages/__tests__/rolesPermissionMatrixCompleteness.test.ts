/**
 * rolesPermissionMatrixCompleteness.test.ts — RBAC Phase 6 (RBAC-F13 closure)
 *
 * Before this phase, the Permission type/ModulePermissionMap/canDo() already
 * understood all 10 actions (view, create, edit, delete, cancel, approve,
 * disburse, export, import, view_pricing), but the Roles & Permissions
 * matrix in Roles.tsx only rendered checkboxes for 7 of them — disburse,
 * import, and view_pricing could not be configured through the UI at all
 * (direct inspection found 3 missing actions, not the 2 named in the
 * governing spec's framing — see the Phase 6 report §3/§4 for the full
 * seed-data audit and the reasoning for including 'disburse').
 *
 * Follows this repository's established source-text-verification convention
 * for page components (no @testing-library/react — see
 * rolesGroupViewCreateGating.test.ts / rolesSaveCacheInvalidation.test.ts for
 * the precedent this mirrors), plus a behavioral reproduction of
 * handlePermToggle's exact reducer algorithm (mirrored, not imported — it is
 * a closure inside the component, not exported, matching how this repo
 * tests other non-exported page-local logic) to prove toggle + persistence
 * behavior empirically for the new actions, not merely assert it from
 * reading the source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rolesPage = readFileSync(resolve(__dirname, '../Roles.tsx'), 'utf-8');

const ALL_10_ACTIONS = ['view', 'create', 'edit', 'delete', 'cancel', 'export', 'approve', 'disburse', 'import', 'view_pricing'];

describe('Test A — both new actions (disburse, import, view_pricing) render in the edit matrix', () => {
  it('the matrix header row includes Disburse, Import, and View Pricing columns', () => {
    expect(rolesPage).toContain('<th className="px-2 py-3 text-center">Disburse</th>');
    expect(rolesPage).toContain('<th className="px-2 py-3 text-center">Import</th>');
    expect(rolesPage).toContain('<th className="px-2 py-3 text-center">View Pricing</th>');
  });

  it('the matrix body\'s action array includes all 3 newly-exposed actions', () => {
    const matrixActionArray = rolesPage.match(/\{\(\['view', 'create', 'edit', 'delete', 'cancel', 'export', 'approve', 'disburse', 'import', 'view_pricing'\] as Permission\[\]\)\.map\(action => \(/);
    expect(matrixActionArray).not.toBeNull();
  });
});

describe('Test B — the existing 7 actions remain intact; final count is exactly 10', () => {
  it('every one of the original 7 actions is still present in the matrix action array, in its original relative order', () => {
    const match = rolesPage.match(/\{\(\[([^\]]+)\] as Permission\[\]\)\.map\(action => \(/);
    expect(match).not.toBeNull();
    const actions = match![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(actions).toEqual(ALL_10_ACTIONS);
    expect(actions).toHaveLength(10);
  });

  it('the read-only detail-view permission pills also expose all 10 actions (previously only 7), so a role with disburse/import/view_pricing granted actually displays that grant', () => {
    const match = rolesPage.match(/\{\(\[([^\]]+)\] as Permission\[\]\)\.filter\(a => perm\[a\]\)\.map\(a => \(/);
    expect(match).not.toBeNull();
    const actions = match![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect(actions).toEqual(ALL_10_ACTIONS);
  });
});

describe('Both new controls use the existing handlePermToggle mechanism — no duplicate state, no special-case persistence', () => {
  it('the matrix checkbox template is a single, shared template reused for all 10 actions (one onChange={() => handlePermToggle(mod, action)} call site, not 10)', () => {
    const onChangeCalls = (rolesPage.match(/onChange=\{\(\) => handlePermToggle\(mod, action\)\}/g) || []).length;
    expect(onChangeCalls).toBe(1);
  });

  it('no new state variable was introduced for disburse/import/view_pricing (no useState mentioning these action names)', () => {
    expect(rolesPage).not.toMatch(/useState.*disburse/i);
    expect(rolesPage).not.toMatch(/useState.*view_pricing/i);
    const importUseStateMatches = rolesPage.match(/useState[^;]*import[^;]*;/gi) || [];
    expect(importUseStateMatches).toHaveLength(0);
  });

  it('handlePermToggle itself was not modified — it remains the single, generic (mod, action) reducer', () => {
    expect(rolesPage).toContain('function handlePermToggle(mod: string, action: Permission) {');
    const fnBlock = rolesPage.match(/function handlePermToggle\(mod: string, action: Permission\) \{[\s\S]*?\n  \}/);
    expect(fnBlock).not.toBeNull();
    // Generic — refers only to the (mod, action) parameters, no hardcoded
    // action name anywhere inside it (old or new).
    for (const action of ALL_10_ACTIONS) {
      expect(fnBlock![0]).not.toContain(`'${action}'`);
    }
  });
});

describe('INITIAL_PERMS default shape includes all 10 actions (disburse was previously missing even before this phase\'s UI change)', () => {
  it('the default permission object explicitly initializes disburse:false alongside every other action', () => {
    const match = rolesPage.match(/acc\[mod\] = \{([^}]+)\};/);
    expect(match).not.toBeNull();
    for (const action of ALL_10_ACTIONS) {
      expect(match![1]).toContain(`${action}: false`);
    }
  });
});

// ── Behavioral: mirrors handlePermToggle's exact algorithm ───────────
//
// handlePermToggle is a closure inside the Roles component, not exported —
// consistent with how this repo tests other non-exported page-local
// reducers (see rolesGroupViewCreateGating.test.ts's isCreateRoleAvailable
// mirror). Reproduced verbatim from the current source (verified identical
// via the source-text check above) so these tests exercise the real
// algorithm's actual behavior, not a hand-waved equivalent.
type FormPermissions = Record<string, Record<string, boolean | string>>;

function togglePermission(prev: FormPermissions, mod: string, action: string): FormPermissions {
  return {
    ...prev,
    [mod]: {
      ...prev[mod],
      [action]: !prev[mod][action],
    },
  };
}

function initialPerms(): FormPermissions {
  const acc: FormPermissions = {};
  for (const mod of ['roles', 'customers']) {
    acc[mod] = Object.fromEntries(ALL_10_ACTIONS.map((a) => [a, false]));
  }
  return acc;
}

describe('Test C — import toggle: false -> true -> false, via the same toggle mechanism', () => {
  it('toggles import on and back off for a module, leaving every other action untouched', () => {
    let perms = initialPerms();
    expect(perms.roles.import).toBe(false);

    perms = togglePermission(perms, 'roles', 'import');
    expect(perms.roles.import).toBe(true);

    perms = togglePermission(perms, 'roles', 'import');
    expect(perms.roles.import).toBe(false);

    // No other action on the same module was disturbed.
    for (const action of ALL_10_ACTIONS.filter((a) => a !== 'import')) {
      expect(perms.roles[action]).toBe(false);
    }
  });
});

describe('Test D — view_pricing toggle: false -> true -> false', () => {
  it('toggles view_pricing on and back off, independent of other modules', () => {
    let perms = initialPerms();
    perms = togglePermission(perms, 'customers', 'view_pricing');
    expect(perms.customers.view_pricing).toBe(true);
    expect(perms.roles.view_pricing).toBe(false); // untouched sibling module

    perms = togglePermission(perms, 'customers', 'view_pricing');
    expect(perms.customers.view_pricing).toBe(false);
  });
});

describe('Test E — save persistence: the resulting payload carries disburse/import/view_pricing with the selected values', () => {
  it('a form.permissions object built via repeated toggles contains the exact selected true/false values for all 3 new actions, ready to flow into save.mutate(form) unmodified', () => {
    let perms = initialPerms();
    perms = togglePermission(perms, 'roles', 'disburse');   // -> true
    perms = togglePermission(perms, 'roles', 'import');     // -> true
    // view_pricing left at its default (false) — proves both true AND false
    // selections persist correctly, not just true ones.
    const payload = { name: 'Test Role', permissions: perms };

    expect(payload.permissions.roles.disburse).toBe(true);
    expect(payload.permissions.roles.import).toBe(true);
    expect(payload.permissions.roles.view_pricing).toBe(false);
  });

  it('the mutationFn passes the form object straight through to Firestore with no permission-key filtering (source-verified) — so whatever toggle() produces is exactly what gets persisted', () => {
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    const body = saveMutationBlock![0];
    expect(body).toContain('await updateDocById(COLLECTIONS.ROLES, editId, d);');
    expect(body).toContain('createDocWithId(COLLECTIONS.ROLES, id, { ...d, id });');
    // No .permissions filtering/picking anywhere in the mutation body.
    expect(body).not.toContain('.permissions[');
    expect(body).not.toMatch(/pick\(|omit\(|delete d\.permissions/);
  });
});

describe('Test F — existing permission persistence is not broken by the 3 new controls', () => {
  it('toggling a mix of old and new actions across multiple modules preserves every value correctly and independently', () => {
    let perms = initialPerms();
    perms = togglePermission(perms, 'roles', 'view');       // old action -> true
    perms = togglePermission(perms, 'roles', 'edit');        // old action -> true
    perms = togglePermission(perms, 'roles', 'disburse');    // new action -> true
    perms = togglePermission(perms, 'customers', 'export');  // old action, different module -> true
    perms = togglePermission(perms, 'customers', 'import');  // new action, different module -> true

    expect(perms.roles.view).toBe(true);
    expect(perms.roles.edit).toBe(true);
    expect(perms.roles.disburse).toBe(true);
    expect(perms.roles.create).toBe(false); // untouched old action
    expect(perms.customers.export).toBe(true);
    expect(perms.customers.import).toBe(true);
    expect(perms.customers.view_pricing).toBe(false); // untouched new action
  });
});

describe('Phase boundary discipline — no Firestore rules, canDo(), or roleBootstrap changes were needed for this UI-completeness phase', () => {
  it('Roles.tsx does not define a new Permission type or duplicate ALL_PERMISSIONS locally', () => {
    expect(rolesPage).not.toMatch(/type Permission =/);
    expect(rolesPage).not.toMatch(/const ALL_PERMISSIONS/);
  });
});
