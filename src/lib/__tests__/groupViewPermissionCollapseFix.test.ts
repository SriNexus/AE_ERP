/**
 * groupViewPermissionCollapseFix.test.ts — RBAC regression fix (post-Phase-9)
 *
 * ROOT CAUSE (confirmed empirically, not assumed): useGlobalBoot.ts's
 * roles_global query called getAll(COLLECTIONS.ROLES) unconditionally.
 * getAll() applies companyScopedQuery('roles') internally, which — for
 * activeCompanyId === 'group' — intercepts BEFORE the roles-specific branch
 * for EVERY collection and returns a groupId equality constraint. Role
 * documents never carry a groupId field (architectural invariant since
 * Phase 1, §3.2), so this query ALWAYS returned zero documents while
 * genuinely in Group View. buildRoleCache([]) then produced an EMPTY
 * permissionCache.roles map, and canDo() — via getCachedRole() returning
 * null for every role name — collapsed to `false` for EVERY module and
 * action, not just the 'roles' mutations Phase 4 deliberately denies.
 *
 * This was NOT caught by the existing Phase 4/8 test suites because they
 * manually seeded permissionCache with a fully-populated role document via
 * useAppStore.setState() — a shortcut that never exercised the real,
 * always-empty-in-Group-View Firestore fetch this file now fixes.
 *
 * THE FIX: useGlobalBoot.ts's roles_global queryFn now detects Group View
 * and fetches the actor's HOME company's role documents directly (mirroring
 * Users.tsx's own pre-existing Group-View role-query workaround), instead
 * of calling getAll(ROLES) (whose internal group-view branch is
 * structurally incompatible with the roles collection's schema).
 *
 * This file proves BOTH halves:
 *  - Test A: the OLD (buggy) empty-array behavior really did collapse
 *    canDo() for non-roles modules — a permanent regression guard so this
 *    exact failure mode can never silently return.
 *  - Test B: the NEW (fixed) home-company-populated behavior restores
 *    correct canDo() output for non-roles modules, while Phase 4's own
 *    'roles' mutation guard remains fully intact and unaffected.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { useAppStore } from '../../store/useAppStore';
import { canDo } from '../permissions';
import { buildRoleCache } from '../roleBootstrap';

const HOME_COMPANY_ADMIN_ROLE = {
  id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1,
  permissions: {
    customers: { view: true, create: true, edit: true, delete: true },
    users: { view: true, create: true, edit: true, delete: true },
    leads: { view: true, create: true, edit: true, delete: true },
    roles: { view: true, create: true, edit: true, delete: true },
  },
};

function seedGroupAdmin() {
  useAppStore.setState({
    user: { id: 'ga-1', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: 'CO-A', groupId: 'GROUP-A', isSuperAdmin: false },
    activeCompanyId: 'group',
    isAuthenticated: true,
    roleData: null,
  });
}

describe('Test A — the OLD bug, reproduced as a permanent regression guard: an empty roles_global fetch in Group View collapses canDo() for EVERY module', () => {
  it('buildRoleCache([]) (what getAll(ROLES) always produced in Group View, pre-fix) makes canDo() false for customers/users/leads too, not just roles', () => {
    seedGroupAdmin();
    const emptyRoleMap = buildRoleCache([]);
    useAppStore.setState({ permissionCache: { ready: true, roles: emptyRoleMap, permissions: {} } as never });

    expect(canDo('customers', 'edit')).toBe(false);
    expect(canDo('customers', 'view')).toBe(false);
    expect(canDo('users', 'edit')).toBe(false);
    expect(canDo('leads', 'create')).toBe(false);
    // This is the documented, previously-uncaught failure mode: EVERYTHING
    // collapses, not a scoped, intentional denial.
  });
});

describe('Test B — the FIX: home-company-populated roles_global cache restores correct canDo() in Group View', () => {
  beforeEach(() => {
    seedGroupAdmin();
    const populatedRoleMap = buildRoleCache([HOME_COMPANY_ADMIN_ROLE]);
    useAppStore.setState({ permissionCache: { ready: true, roles: populatedRoleMap, permissions: {} } as never });
  });

  it('non-roles modules correctly resolve to the home company\'s real permissions (the actual bug fix)', () => {
    expect(canDo('customers', 'edit')).toBe(true);
    expect(canDo('customers', 'view')).toBe(true);
    expect(canDo('users', 'edit')).toBe(true);
    expect(canDo('leads', 'create')).toBe(true);
  });

  it('Phase 4\'s roles-mutation Group View guard remains fully intact and unaffected by the fix — roles.create/edit/delete are STILL false, even though the role doc itself now grants them', () => {
    // HOME_COMPANY_ADMIN_ROLE explicitly grants roles.create/edit/delete —
    // proving this false result comes from the Phase 4 guard, not from a
    // missing grant.
    expect(canDo('roles', 'create')).toBe(false);
    expect(canDo('roles', 'edit')).toBe(false);
    expect(canDo('roles', 'delete')).toBe(false);
    // roles.view is untouched by the Phase 4 guard (only create/edit/delete).
    expect(canDo('roles', 'view')).toBe(true);
  });

  it('leaving Group View for a real company still gets that company\'s own correctly-scoped permissions (Phase 3 isolation unaffected)', () => {
    useAppStore.setState({ activeCompanyId: 'CO-A' });
    expect(canDo('roles', 'edit')).toBe(true); // Phase 4 guard no longer applies outside Group View
    expect(canDo('customers', 'edit')).toBe(true);
  });
});

describe('Source verification — useGlobalBoot.ts no longer calls getAll(ROLES) unconditionally for the roles_global query', () => {
  it('the roles_global queryFn branches on Group View and fetches the actor\'s home company\'s roles directly instead of relying on getAll()\'s groupId-based (always-empty) scoping', () => {
    const source = readFileSync(new URL('../useGlobalBoot.ts', import.meta.url), 'utf-8');
    expect(source).toContain("if (activeCompanyId === 'group') {");
    expect(source).toContain("where('companyId', '==', homeCompanyId)");
    expect(source).toContain('const rolesGlobalQueryFn = () =>');
    expect(source).toContain('queryFn: rolesGlobalQueryFn');
  });
});

describe('Regression: the sibling Users.tsx role-reassignment gating bug (canEditRoles -> canEditUsers)', () => {
  it('Users.tsx gates the user-role-reassignment field on canEditUsers (perms.can(\'users\',\'edit\')), not canEditRoles', () => {
    const source = readFileSync(new URL('../../pages/Users.tsx', import.meta.url), 'utf-8');
    expect(source).toContain('{canEditUsers ? (');
    expect(source).not.toContain('const canEditRoles');
    expect(source).not.toContain('{canEditRoles ?');
  });

  it('MobileUsersWorkspace.tsx gates the same field on canEdit (perms.can(\'users\',\'edit\')), not canEditRoles', () => {
    const source = readFileSync(new URL('../../components/mobile/users/MobileUsersWorkspace.tsx', import.meta.url), 'utf-8');
    expect(source).toContain('{canEdit\n');
    expect(source).not.toContain("perms.can('roles', 'edit')");
  });
});
