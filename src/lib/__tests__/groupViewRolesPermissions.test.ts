/**
 * groupViewRolesPermissions.test.ts — RBAC Phase 4 (RBAC-F03 closure, AD-2)
 *
 * AD-2: Group View ('All Companies') is a cross-company overview context
 * with NO single company's role-permission documents to evaluate a roles
 * mutation against — role documents are strictly per-company (never carry a
 * groupId). canDo('roles','create'|'edit'|'delete') therefore returns false
 * for every actor while activeCompanyId === 'group', regardless of role
 * (including Super Admin — this is a CONTEXT rule, not an authorization
 * downgrade) and regardless of whatever happens to be cached under the
 * 'roles' permissionCache key. Every other module/action is unaffected.
 *
 * Follows this repository's established canDo()-testing convention (see
 * phase13RolesPermissions.test.ts): useAppStore.setState() to seed identity/
 * activeCompanyId/permissionCache directly, then assert on canDo() itself —
 * no component rendering, no @testing-library/react.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { canDo } from '../permissions';

const ADMIN_ROLE_WITH_FULL_ROLES_ACCESS = {
  id: 'CO-A_Admin',
  name: 'Admin',
  companyId: 'company-alpha',
  schemaVersion: 1 as const,
  permissions: {
    roles: { view: true, create: true, edit: true, delete: true },
    customers: { view: true, create: true, edit: true },
    orders: { view: true, create: true, edit: true },
  },
};

function seedAdminInRealCompany() {
  useAppStore.setState({
    user: { id: 'admin-1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'company-alpha', isSuperAdmin: false, isOwner: false },
    activeCompanyId: 'company-alpha',
    isAuthenticated: true,
    permissionCache: {
      ready: true,
      roles: { admin: ADMIN_ROLE_WITH_FULL_ROLES_ACCESS },
      permissions: {},
    } as never,
    roleData: null,
  });
}

function switchToGroupView() {
  useAppStore.setState({ activeCompanyId: 'group' });
}

beforeEach(() => {
  useAppStore.setState({
    user: null,
    activeCompanyId: 'default',
    isAuthenticated: false,
    permissionCache: { ready: false, roles: {}, permissions: {} } as never,
    roleData: null,
  });
});

describe('Test A/B/C — Group View: roles.create / roles.edit / roles.delete are all false', () => {
  beforeEach(() => {
    seedAdminInRealCompany();
    // Sanity: in the real home company, this Admin genuinely has full
    // roles access — proves the false result below comes from the Group
    // View context rule, not from an underlying missing grant.
    expect(canDo('roles', 'create')).toBe(true);
    expect(canDo('roles', 'edit')).toBe(true);
    expect(canDo('roles', 'delete')).toBe(true);
    switchToGroupView();
  });

  it('Test A — canDo(\'roles\',\'create\') is false in Group View', () => {
    expect(canDo('roles', 'create')).toBe(false);
  });

  it('Test B — canDo(\'roles\',\'edit\') is false in Group View', () => {
    expect(canDo('roles', 'edit')).toBe(false);
  });

  it('Test C — canDo(\'roles\',\'delete\') is false in Group View', () => {
    expect(canDo('roles', 'delete')).toBe(false);
  });

  it('holds for the (module, action) call-order overload too, not just (action, module)', () => {
    expect(canDo('create', 'roles')).toBe(false);
    expect(canDo('edit', 'roles')).toBe(false);
    expect(canDo('delete', 'roles')).toBe(false);
  });
});

describe('Test D — cached home-company permissions cannot override Group View', () => {
  it('an explicitly-passed role whose cached document grants full roles access still evaluates false in Group View', () => {
    useAppStore.setState({
      user: { id: 'admin-1', name: 'Admin A', email: 'a@test.erp', role: 'Admin', companyId: 'company-alpha', isSuperAdmin: false, isOwner: false },
      activeCompanyId: 'group',
      isAuthenticated: true,
      permissionCache: {
        ready: true,
        // Deliberately seeded as if the home company's cache were still
        // warm/fresh under the 'admin' key with roles.edit: true — the
        // result must not depend on this cache content at all.
        roles: { admin: ADMIN_ROLE_WITH_FULL_ROLES_ACCESS },
        permissions: {},
      } as never,
      roleData: null,
    });
    expect(canDo('roles', 'edit', 'Admin')).toBe(false);
  });
});

describe('Test E — non-roles modules remain unaffected by Group View', () => {
  beforeEach(() => {
    seedAdminInRealCompany();
    switchToGroupView();
  });

  it('customers permissions are unchanged in Group View', () => {
    expect(canDo('customers', 'view')).toBe(true);
    expect(canDo('customers', 'create')).toBe(true);
    expect(canDo('customers', 'edit')).toBe(true);
  });

  it('orders permissions are unchanged in Group View', () => {
    expect(canDo('orders', 'view')).toBe(true);
    expect(canDo('orders', 'create')).toBe(true);
    expect(canDo('orders', 'edit')).toBe(true);
  });

  it('roles.view (not a mutation) is unaffected — only create/edit/delete are special-cased', () => {
    expect(canDo('roles', 'view')).toBe(true);
  });
});

describe('Test F — real company after Group View: permission context is fully restored', () => {
  it('Company A -> Group View -> Company A: Company A\'s roles.edit is true again after leaving Group View', () => {
    seedAdminInRealCompany();
    expect(canDo('roles', 'edit')).toBe(true);

    switchToGroupView();
    expect(canDo('roles', 'edit')).toBe(false);

    useAppStore.setState({ activeCompanyId: 'company-alpha' });
    expect(canDo('roles', 'edit')).toBe(true);
  });
});

describe('Test G — Super Admin: Group View still forces roles mutations false (context rule, not an authorization restriction)', () => {
  it('a Super Admin, who otherwise bypasses every permission check, still gets false for roles.create/edit/delete in Group View', () => {
    useAppStore.setState({
      user: { id: 'sa-1', name: 'Super Admin', email: 'sa@test.erp', role: 'SuperAdmin', companyId: 'company-alpha', isSuperAdmin: true, isOwner: false },
      activeCompanyId: 'group',
      isAuthenticated: true,
      permissionCache: { ready: true, roles: {}, permissions: {} } as never,
      roleData: null,
    });
    // Sanity: Super Admin's usual unconditional bypass, proven on a
    // different module, so the false results below are provably the
    // Group View rule specifically, not some other gap.
    expect(canDo('customers', 'delete')).toBe(true);

    expect(canDo('roles', 'create')).toBe(false);
    expect(canDo('roles', 'edit')).toBe(false);
    expect(canDo('roles', 'delete')).toBe(false);
  });

  it('the same Super Admin, back in a real company, has the normal unconditional bypass for roles too', () => {
    useAppStore.setState({
      user: { id: 'sa-1', name: 'Super Admin', email: 'sa@test.erp', role: 'SuperAdmin', companyId: 'company-alpha', isSuperAdmin: true, isOwner: false },
      activeCompanyId: 'company-alpha',
      isAuthenticated: true,
      permissionCache: { ready: true, roles: {}, permissions: {} } as never,
      roleData: null,
    });
    expect(canDo('roles', 'create')).toBe(true);
    expect(canDo('roles', 'edit')).toBe(true);
    expect(canDo('roles', 'delete')).toBe(true);
  });
});

describe('Source verification — the Group View guard is narrowly scoped, not a general scope-checking engine', () => {
  it('canDo() special-cases exactly module===\'roles\' + create/edit/delete + activeCompanyId===\'group\', checked before the Super Admin bypass', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/lib/permissions.ts', 'utf-8');
    const guardIdx = source.indexOf("module === 'roles' && (action === 'create' || action === 'edit' || action === 'delete') && state.activeCompanyId === 'group'");
    const bypassIdx = source.indexOf('if (state.user?.isSuperAdmin === true) return true;');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(bypassIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(bypassIdx);
  });

  it('the guard checks activeCompanyId directly — no new dependency on GroupAdmin-specific role/authorization logic', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/lib/permissions.ts', 'utf-8');
    const guardLine = source.split('\n').find((line) => line.includes("state.activeCompanyId === 'group'"));
    expect(guardLine).toBeDefined();
    expect(guardLine).not.toContain('groupAdminCan');
    expect(guardLine).not.toContain('isGroupAdmin');
  });
});
