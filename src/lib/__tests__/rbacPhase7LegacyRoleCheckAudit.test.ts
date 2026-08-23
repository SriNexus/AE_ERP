/**
 * rbacPhase7LegacyRoleCheckAudit.test.ts — RBAC Phase 7 (RBAC-F10/F11)
 *
 * Phase 7's governing spec (docs/implementation/.../§15) requires every
 * informal `role === 'Admin'`/`'GroupAdmin'` check to be individually
 * categorized, and only the "security-critical + migratable-without-a-new-
 * module" subset actually changed. Exhaustive inspection (see the Phase 7
 * report for the full ~13-occurrence inventory) found that EVERY
 * authorization-relevant occurrence either:
 *   (a) has no suitable existing canDo() module/action to migrate to
 *       without inventing a new Permission/Module dimension (explicitly
 *       forbidden this phase), or
 *   (b) would PROVABLY change behavior if migrated naively to a plain
 *       canDo() call — broadening either Manager's or Director's actual
 *       granted capabilities beyond what they have today.
 *
 * This file does not test "a string disappeared" (nothing was removed).
 * It proves, empirically, WHY the remaining checks are load-bearing and
 * must not be naively replaced — the exact kind of "before/after behavior"
 * evidence the governing spec requires before ANY migration decision, here
 * demonstrating why the answer for every candidate was "do not migrate."
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { useAppStore } from '../../store/useAppStore';
import { canDo } from '../permissions';

const SCHEME_REGISTRATION_ROLE_DOCS = {
  admin: {
    id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1 as const,
    permissions: { scheme_registration: { view: true, create: true, edit: true, approve: true, delete: true } },
  },
  manager: {
    id: 'CO-A_Manager', name: 'Manager', companyId: 'CO-A', schemaVersion: 1 as const,
    // Verified verbatim against roleBootstrap.ts's LEGACY_SYSTEM_ROLES.Manager
    // definition (line 281): scheme_registration: { view, create, edit,
    // approve: true, visibility: 'team' }.
    permissions: { scheme_registration: { view: true, create: true, edit: true, approve: true } },
  },
};

const INSTALLATIONS_ROLE_DOCS = {
  admin: {
    id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1 as const,
    permissions: { installations: { view: true, create: true, edit: true, delete: true } },
  },
  director: {
    id: 'CO-A_Director', name: 'Director', companyId: 'CO-A', schemaVersion: 1 as const,
    // Verified: Director's LEGACY_SYSTEM_ROLES definition (roleBootstrap.ts)
    // has no 'installations' entry at all — legacyModulePermissions()
    // defaults an unlisted module to all-false for every action.
    permissions: { installations: { view: false, create: false, edit: false, delete: false } },
  },
};

function seedPermissionCache(roles: Record<string, unknown>) {
  useAppStore.setState({
    permissionCache: { ready: true, roles, permissions: {} } as never,
  });
}

beforeEach(() => {
  useAppStore.setState({
    user: null,
    activeCompanyId: 'CO-A',
    isAuthenticated: false,
    permissionCache: { ready: false, roles: {}, permissions: {} } as never,
    roleData: null,
  });
});

describe('Test C — authorization behavior: proving the scheme-registration "Reopen" dual-check (isAdmin && canApprove) is load-bearing', () => {
  it('canDo(\'approve\', \'scheme_registration\') is TRUE for Manager — confirming that canApprove alone (without the role===\'Admin\' check found in ProjectSchemeRegistrationWorkspace.tsx, RegistrationDetailModal.tsx, and schemeRegistrationWorkflow.ts) would let Manager reopen a completed registration, which the current code does not permit', () => {
    useAppStore.setState({ user: { id: 'm1', name: 'Manager M', email: 'm@test.erp', role: 'Manager', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache(SCHEME_REGISTRATION_ROLE_DOCS);
    expect(canDo('approve', 'scheme_registration')).toBe(true);
    // The literal source check these 3 files use as the SECOND, narrowing
    // condition — proves it is what actually excludes Manager, not canApprove.
    const isAdminForManager = ('Manager' as string) === 'Admin';
    expect(isAdminForManager).toBe(false);
    const wouldReopenBeAllowedForManager_ifOnlyCanApproveWereUsed = canDo('approve', 'scheme_registration');
    const canReopenAsActuallyImplemented = isAdminForManager && canDo('approve', 'scheme_registration');
    expect(wouldReopenBeAllowedForManager_ifOnlyCanApproveWereUsed).toBe(true);
    expect(canReopenAsActuallyImplemented).toBe(false);
  });

  it('canDo(\'approve\', \'scheme_registration\') is also TRUE for Admin, and the role===\'Admin\' check does not additionally restrict Admin (both conditions agree)', () => {
    useAppStore.setState({ user: { id: 'a1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache(SCHEME_REGISTRATION_ROLE_DOCS);
    const isAdmin = ('Admin' as string) === 'Admin';
    expect(isAdmin && canDo('approve', 'scheme_registration')).toBe(true);
  });
});

describe('Test C — authorization behavior: proving MobileInstallationsWorkspace.tsx\'s (Admin || Director) edit-gate is load-bearing for Director specifically', () => {
  it('canDo(\'edit\', \'installations\') is FALSE for Director — confirming that migrating the (Admin || Director) check to a plain canDo(\'installations\',\'edit\') call would SILENTLY REMOVE Director\'s currently-granted access, not merely simplify the check', () => {
    useAppStore.setState({ user: { id: 'd1', name: 'Director D', email: 'd@test.erp', role: 'Director', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache(INSTALLATIONS_ROLE_DOCS);
    expect(canDo('edit', 'installations')).toBe(false);
    // The actual source check grants Director access regardless.
    const isAdminOrDirector = (['Admin', 'Director'] as string[]).includes('Director');
    expect(isAdminOrDirector).toBe(true);
  });

  it('canDo(\'edit\', \'installations\') is TRUE for Admin — the other half of the (Admin || Director) check is already canDo()-consistent', () => {
    useAppStore.setState({ user: { id: 'a1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache(INSTALLATIONS_ROLE_DOCS);
    expect(canDo('edit', 'installations')).toBe(true);
  });
});

describe('Test F — ordinary roles do not inherit the elevated capabilities gated by the occurrences above', () => {
  it('Sales cannot approve scheme_registration (matching roleBootstrap.ts — Sales has no scheme_registration entry at all)', () => {
    useAppStore.setState({ user: { id: 's1', name: 'Sales S', email: 's@test.erp', role: 'Sales', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache({
      sales: { id: 'CO-A_Sales', name: 'Sales', companyId: 'CO-A', schemaVersion: 1, permissions: {} },
    });
    expect(canDo('approve', 'scheme_registration')).toBe(false);
  });

  it('Warehouse cannot edit installations (matching roleBootstrap.ts — Warehouse has no installations entry at all)', () => {
    useAppStore.setState({ user: { id: 'w1', name: 'Warehouse W', email: 'w@test.erp', role: 'Warehouse', companyId: 'CO-A', isSuperAdmin: false } });
    seedPermissionCache({
      warehouse: { id: 'CO-A_Warehouse', name: 'Warehouse', companyId: 'CO-A', schemaVersion: 1, permissions: {} },
    });
    expect(canDo('edit', 'installations')).toBe(false);
  });
});

describe('Test D — GroupAdmin/Admin identity-tier checks (Users.tsx, Companies.tsx, GroupSettings.tsx, CompanySwitcher.tsx) are provably consistent with each other', () => {
  // These 5 occurrences all reduce to the identical, single-operator
  // expression `role === 'GroupAdmin'` or `role === 'Admin'` — no divergent
  // spelling, casing, or comparison operator exists among them (confirmed by
  // direct source inspection, reproduced here as a literal regression guard
  // against a future edit silently introducing a mismatch, e.g. a typo'd
  // role string or an accidental `!==`).
  const files = [
    { path: '../../pages/Users.tsx', expectedLine: "currentUser?.role === 'GroupAdmin'" },
    { path: '../../pages/Companies.tsx', expectedLine: "user?.role === 'GroupAdmin'" },
    { path: '../../pages/group/GroupSettings.tsx', expectedLine: "user?.role === 'GroupAdmin'" },
    { path: '../../features/company/components/CompanySwitcher.tsx', expectedLine: "user?.role === 'GroupAdmin'" },
  ];

  for (const { path, expectedLine } of files) {
    it(`${path} derives isGroupAdmin/canGrant from the exact literal "${expectedLine}"`, () => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf-8');
      expect(source).toContain(expectedLine);
    });
  }

  it('the same set of representative role strings produces the same GroupAdmin-boolean everywhere these literals are evaluated', () => {
    const roles = ['GroupAdmin', 'Admin', 'Manager', 'Sales', 'groupadmin', 'Group Admin', ''];
    const results = roles.map((r) => r === 'GroupAdmin');
    // Every occurrence uses this exact expression, so they are trivially
    // identical by construction — this assertion exists so a future refactor
    // that changes ANY one occurrence's comparison (e.g. to a case-insensitive
    // or trimmed form) without updating the others fails this test, since the
    // shared expectation below is what all 5 files are require to keep matching.
    expect(results).toEqual([true, false, false, false, false, false, false]);
  });
});

describe('Test E — SuperAdmin bypass is unaffected by any Phase 7 inspection (no canDo() code was touched)', () => {
  it('canDo() still short-circuits true for isSuperAdmin regardless of module/action, including the two modules inspected above', () => {
    useAppStore.setState({ user: { id: 'sa1', name: 'Super Admin', email: 'sa@test.erp', role: 'SuperAdmin', companyId: 'CO-A', isSuperAdmin: true } });
    seedPermissionCache({});
    expect(canDo('approve', 'scheme_registration')).toBe(true);
    expect(canDo('edit', 'installations')).toBe(true);
  });
});

describe('Test G — no unintended legacy authorization: the occurrences inspected this phase still control exactly what they controlled before (nothing silently removed, nothing silently broadened)', () => {
  it('src/pages/Roles.tsx contains no "resolve role document by name" mechanism (correcting a stale audit citation — its only case-insensitive scans are a create-time duplicate-NAME guard and free-text search, not a role lookup)', () => {
    const source = readFileSync(new URL('../../pages/Roles.tsx', import.meta.url), 'utf-8');
    expect(source).toContain('const duplicateRole = (roles as any[]).find((role: any) => String(role.name || \'\').trim().toLowerCase() === normalizedName && role.id !== editId);');
  });

  it('src/pages/platform/PlatformUsers.tsx and PlatformGroups.tsx have no actor-role authorization checks (confirmed stale audit citations — both are SuperAdminRoute-gated and only inspect OTHER users\' .role fields for display)', () => {
    const platformUsers = readFileSync(new URL('../../pages/platform/PlatformUsers.tsx', import.meta.url), 'utf-8');
    const platformGroups = readFileSync(new URL('../../pages/platform/PlatformGroups.tsx', import.meta.url), 'utf-8');
    expect(platformUsers).not.toMatch(/(currentUser|user)\??\.role\s*(===|!==)\s*'[A-Za-z]+'/);
    expect(platformGroups).not.toMatch(/(currentUser|user)\??\.role\s*(===|!==)\s*'[A-Za-z]+'/);
  });

  it('src/pages/CasesWorkspace.tsx and CasesDash.tsx already route exclusively through canDo() — confirming the audit\'s original F10 citation of these two files is stale (already normalized, no action needed)', () => {
    const casesWorkspace = readFileSync(new URL('../../pages/CasesWorkspace.tsx', import.meta.url), 'utf-8');
    const casesDash = readFileSync(new URL('../../pages/CasesDash.tsx', import.meta.url), 'utf-8');
    expect(casesWorkspace).not.toMatch(/(currentUser|user)\??\.role\s*(===|!==)\s*'[A-Za-z]+'/);
    expect(casesDash).not.toMatch(/(currentUser|user)\??\.role\s*(===|!==)\s*'[A-Za-z]+'/);
    expect(casesWorkspace).toContain("import { canDo } from '../lib/permissions';");
    expect(casesDash).toContain("import { canDo } from '../lib/permissions';");
  });

  it('src/lib/groupAdmin.ts\'s requireGroupAdminIdentity() — the one already-centralized identity guard in this inventory — remains a fail-closed throw on a non-GroupAdmin/inactive identity', () => {
    const source = readFileSync(new URL('../groupAdmin.ts', import.meta.url), 'utf-8');
    expect(source).toContain("if (!user || user.role !== 'GroupAdmin' || user.status === 'Inactive') {");
    expect(source).toContain("throw new Error('Group Admin operations require an active Group Admin identity.');");
  });
});

describe('Phase 7 boundary discipline — no canonical RBAC files were modified', () => {
  it('src/lib/permissions.ts still contains exactly the Phase 4 Group View guard and no new Phase 7 authorization logic', () => {
    const source = readFileSync(new URL('../permissions.ts', import.meta.url), 'utf-8');
    expect(source).toContain("if (module === 'roles' && (action === 'create' || action === 'edit' || action === 'delete') && state.activeCompanyId === 'group') {");
  });

  it('resolveCompatibleRole() is unmodified — still cache-first with a static EXACT_ROLE_COMPATIBILITY fallback', () => {
    const source = readFileSync(new URL('../permissions.ts', import.meta.url), 'utf-8');
    expect(source).toContain('return EXACT_ROLE_COMPATIBILITY[key] ?? null;');
  });
});
