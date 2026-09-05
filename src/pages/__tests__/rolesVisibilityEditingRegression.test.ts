/**
 * rolesVisibilityEditingRegression.test.ts
 *
 * RBAC Master Implementation Plan — Phase 3 ("Extend roles doc schema +
 * propagation").
 *
 * IMPORTANT FINDING RECORDED HERE (verified against current source, not
 * assumed from the Master Plan): the Plan's Phase 3 text describes this as
 * "make the roles document capable of carrying visibility scope... the
 * Roles & Permissions page gains new UI" as future work. Direct inspection
 * of the current repository found this is ALREADY FULLY IMPLEMENTED and has
 * been for some time (the `visibility` field is already part of
 * `ModulePermissionMap` in src/lib/permissions.ts, `roleBootstrap.ts`'s
 * `legacyModulePermissions()` already writes it into every seeded role
 * document, and `Roles.tsx` already renders a live "Data Visibility"
 * <select> per module, wired to `handleVisibilityChange` and persisted via
 * the same `save` mutation as every other permission field) — none of it
 * carries a "Phase 3" attribution comment, meaning it predates this Master
 * Plan entirely. No redundant second visibility mechanism was built (that
 * would have created exactly the "second source of truth" the Plan warns
 * against). This file instead closes the one real gap: no existing test
 * covered visibility editing as its own regression contract (the closest
 * existing coverage, rolesPermissionMatrixCompleteness.test.ts, is scoped to
 * the boolean permission actions only).
 *
 * Follows this repository's established source-text-verification convention
 * for page components (see rolesPermissionMatrixCompleteness.test.ts /
 * rolesSaveCacheInvalidation.test.ts) plus a behavioral reproduction of
 * handleVisibilityChange's exact reducer algorithm (mirrored, not imported —
 * it is a closure inside the component, not exported).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getSystemRoleSeedDocuments } from '../../lib/roleBootstrap';
import { ALL_MODULES } from '../../lib/permissions';

const rolesPage = readFileSync(resolve(__dirname, '../Roles.tsx'), 'utf-8');

describe('Section A — the Data Visibility control already exists and is wired correctly (source-verified)', () => {
  it('a "Data Visibility" column with a self/team/all select exists in the matrix header and body', () => {
    expect(rolesPage).toContain('Data Visibility');
    expect(rolesPage).toContain("value={form.permissions[mod]?.visibility || 'self'}");
    expect(rolesPage).toContain('onChange={e => handleVisibilityChange(mod, e.target.value)}');
    expect(rolesPage).toContain('<option value="self">Self (Own Data)</option>');
    expect(rolesPage).toContain('<option value="team">Team (Self + Hierarchy)</option>');
    expect(rolesPage).toContain('<option value="all">Global (All Data)</option>');
  });

  it('handleVisibilityChange is a single, generic (mod, vis) reducer — not a per-module special case', () => {
    expect(rolesPage).toContain('function handleVisibilityChange(mod: string, vis: string) {');
    const fnBlock = rolesPage.match(/function handleVisibilityChange\(mod: string, vis: string\) \{[\s\S]*?\n  \}/);
    expect(fnBlock).not.toBeNull();
    // Generic — the reducer body must not hardcode any module name.
    for (const mod of ['leads', 'customers', 'projects', 'orders']) {
      expect(fnBlock![0]).not.toContain(`'${mod}'`);
    }
  });

  it('the visibility select uses the SAME onChange call-site pattern once (not duplicated per module)', () => {
    const onChangeCalls = (rolesPage.match(/onChange=\{e => handleVisibilityChange\(mod, e\.target\.value\)\}/g) || []).length;
    expect(onChangeCalls).toBe(1);
  });

  it('the read-only detail view labels visibility as Global/Team/Self, matching the edit form\'s 3 values', () => {
    expect(rolesPage).toContain("{perm.visibility === 'all' ? 'Global' : perm.visibility === 'team' ? 'Team' : 'Self'}");
  });

  it('the save mutation persists the whole form object unfiltered — visibility flows through exactly like every boolean permission, no special-case stripping', () => {
    const saveMutationBlock = rolesPage.match(/const save = useMutation\(\{[\s\S]*?\n  \}\);/);
    expect(saveMutationBlock).not.toBeNull();
    const body = saveMutationBlock![0];
    expect(body).not.toContain('.permissions[');
    expect(body).not.toMatch(/pick\(|omit\(|delete d\.permissions|visibility:\s*undefined/);
  });
});

// ── Behavioral: mirrors handleVisibilityChange's exact algorithm ─────────
type FormPermissions = Record<string, Record<string, boolean | string>>;

function changeVisibility(prev: FormPermissions, mod: string, vis: string): FormPermissions {
  return {
    ...prev,
    [mod]: {
      ...prev[mod],
      visibility: vis,
    },
  };
}

function initialPerms(): FormPermissions {
  const acc: FormPermissions = {};
  for (const mod of ['leads', 'customers', 'orders']) {
    acc[mod] = { view: false, create: false, edit: false, delete: false, visibility: 'self' };
  }
  return acc;
}

describe('Section B — visibility editing preserves every other field (additive, not destructive)', () => {
  it('changing one module\'s visibility does not touch its own boolean permissions', () => {
    let perms = initialPerms();
    perms.leads.view = true;
    perms.leads.create = true;
    perms = changeVisibility(perms, 'leads', 'team');

    expect(perms.leads.visibility).toBe('team');
    expect(perms.leads.view).toBe(true);
    expect(perms.leads.create).toBe(true);
    expect(perms.leads.edit).toBe(false);
    expect(perms.leads.delete).toBe(false);
  });

  it('changing one module\'s visibility does not touch a SIBLING module\'s visibility or permissions', () => {
    let perms = initialPerms();
    perms.customers.view = true;
    perms = changeVisibility(perms, 'leads', 'all');

    expect(perms.leads.visibility).toBe('all');
    expect(perms.customers.visibility).toBe('self'); // untouched sibling
    expect(perms.customers.view).toBe(true); // untouched sibling permission
  });

  it('visibility can be changed multiple times, ending at the last selected value, with no residual state from earlier selections', () => {
    let perms = initialPerms();
    perms = changeVisibility(perms, 'orders', 'team');
    perms = changeVisibility(perms, 'orders', 'all');
    perms = changeVisibility(perms, 'orders', 'self');
    expect(perms.orders.visibility).toBe('self');
  });

  it('a role with NO visibility field at all (a document created before this feature existed) can still have visibility set for the first time, additively', () => {
    const legacyPerms: FormPermissions = { leads: { view: true, create: true } }; // no visibility key
    const updated = changeVisibility(legacyPerms, 'leads', 'team');
    expect(updated.leads.visibility).toBe('team');
    expect(updated.leads.view).toBe(true); // pre-existing field preserved
    expect(updated.leads.create).toBe(true); // pre-existing field preserved
  });
});

describe('Section C — additive-only contract: every existing seeded role\'s resolved visibility is unchanged by Phase 3 (no code in roleBootstrap.ts/permissions.ts/firestore.ts was touched this phase)', () => {
  const seedDocs = getSystemRoleSeedDocuments();

  it('produces exactly the 15 system roles this Master Plan documents in §4', () => {
    expect(seedDocs.map((d) => d.name).sort()).toEqual([
      'Accounts', 'Admin', 'ComplianceOfficer', 'Director', 'Engineer', 'HR',
      'InstallationLead', 'Manager', 'Operations', 'Partner', 'Procurement',
      'Sales', 'ServiceTechnician', 'Surveyor', 'Warehouse',
    ]);
  });

  it('INVARIANT: every seeded module\'s permissions object always carries an explicit visibility value in {self, team, all} — never absent, never any other value (this is legacyModulePermissions()\'s existing, unmodified normalization, re-asserted here as a Phase 3 regression guard)', () => {
    for (const doc of seedDocs) {
      for (const mod of ALL_MODULES) {
        const modulePerms = (doc.permissions as any)[mod];
        expect(modulePerms, `${doc.name}.${mod} must exist`).toBeDefined();
        expect(['self', 'team', 'all']).toContain(modulePerms.visibility);
      }
    }
  });

  it('spot-check — Partner is seeded self-scoped on leads/customers/projects/surveys/scheme_registration/payouts/partners (§7.7 of the Master Plan)', () => {
    const partner = seedDocs.find((d) => d.name === 'Partner')!;
    for (const mod of ['leads', 'customers', 'projects', 'surveys', 'scheme_registration', 'payouts', 'partners']) {
      expect((partner.permissions as any)[mod].visibility, `Partner.${mod}`).toBe('self');
    }
  });

  it('spot-check — Manager is seeded team-scoped on leads/customers/projects/surveys/scheme_registration/payouts (§7.2 of the Master Plan)', () => {
    const manager = seedDocs.find((d) => d.name === 'Manager')!;
    for (const mod of ['leads', 'customers', 'projects', 'surveys', 'scheme_registration', 'payouts']) {
      expect((manager.permissions as any)[mod].visibility, `Manager.${mod}`).toBe('team');
    }
  });

  it('spot-check — Sales has no visibility override in its raw source definition, so every one of its modules resolves to the default "all" (§7.1/§15 BD-1 of the Master Plan — confirmed, not changed, by this phase)', () => {
    const sales = seedDocs.find((d) => d.name === 'Sales')!;
    for (const mod of ['leads', 'customers', 'quotations', 'orders', 'dispatch']) {
      expect((sales.permissions as any)[mod].visibility, `Sales.${mod}`).toBe('all');
    }
  });

  it('Admin (empty permission map = allow-all) still resolves every module to "all" visibility', () => {
    const admin = seedDocs.find((d) => d.name === 'Admin')!;
    for (const mod of ALL_MODULES) {
      expect((admin.permissions as any)[mod].visibility, `Admin.${mod}`).toBe('all');
    }
  });
});
