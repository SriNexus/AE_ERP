/**
 * RBAC Phase 1 (AUTH-D4) — GroupAdmin server-side API role resolution.
 *
 * Before this phase, `EXACT_ROLE_COMPATIBILITY` in `api/_lib/permissions.ts`
 * had no entry for 'groupadmin' (or 'tl', 'demo operator', 'demo admin'), so
 * `resolveCompatibleRole()` returned null and `canDo()`/`requirePermission()`
 * failed closed for EVERY module/action, for EVERY GroupAdmin, on every
 * `/api/*` request — a false DENY, not an intentional restriction (the
 * client's own alias table has always resolved GroupAdmin to the Admin
 * template — GroupAdmin is a scope extension, not a distinct permission set).
 *
 * These tests mock Firestore (`getAdminDb`) directly so the actual resolved
 * permission value can be asserted, not just "did not throw" — the existing
 * `api/__tests__/api.test.ts` `canDo` alias tests intentionally run without a
 * Firestore mock and only assert `typeof result === 'boolean'`, since
 * `getRoleDocument`'s try/catch swallows the real connection failure.
 *
 * This file deliberately does NOT fix `getRoleDocument`'s case-sensitivity
 * bug (AUTH-D1, deferred to Phase 6) — the fake Firestore below reproduces
 * that exact, still-current lookup path (primary query always empty,
 * fallback full-collection scan matches case-insensitively) so these tests
 * exercise the real, current runtime behavior, not a hypothetical fixed one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth';

type FakeRoleDoc = { name: string; schemaVersion: 1; permissions: Record<string, Record<string, boolean> | undefined> };

let roleDocs: FakeRoleDoc[] = [];

vi.mock('../firebase', () => ({
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name !== 'roles') throw new Error(`unexpected collection: ${name}`);
      return {
        // Mirrors getRoleDocument's real primary query: where('name','==',
        // <lowercased key>) against docs whose stored `name` is capitalized
        // (e.g. 'Admin') — this NEVER matches today (AUTH-D1, not fixed here).
        where: () => ({
          limit: () => ({
            get: async () => ({ empty: true, docs: [] }),
          }),
        }),
        // Mirrors the real fallback: an unscoped read of the whole
        // collection, matched case-insensitively by the caller.
        get: async () => ({ docs: roleDocs.map((d) => ({ data: () => d })) }),
      };
    },
  }),
}));

// Imported AFTER the mock so the module under test picks up the fake db.
const { canDo, requirePermission } = await import('../permissions');
const { canAccessApiResource } = await import('../registry');

function mockUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    uid: 'test-uid',
    erpUserId: 'test-uid',
    email: 'user@example.com',
    name: 'Test User',
    role: 'GroupAdmin',
    companyId: 'company-a',
    isSuperAdmin: false,
    ...overrides,
  } as AuthenticatedUser;
}

const ADMIN_ROLE_DOC: FakeRoleDoc = {
  name: 'Admin',
  schemaVersion: 1,
  permissions: {
    projects: { view: true, create: true, edit: true, delete: true },
    roles: { view: true, create: true, edit: true, delete: true },
    leads: { view: true, create: true },
  },
};

const SALES_ROLE_DOC: FakeRoleDoc = {
  name: 'Sales',
  schemaVersion: 1,
  permissions: {
    leads: { view: true, create: true },
    // No 'roles' key at all — Sales has zero roles-module grant.
  },
};

const MANAGER_ROLE_DOC: FakeRoleDoc = {
  name: 'Manager',
  schemaVersion: 1,
  permissions: {
    leads: { view: true },
  },
};

beforeEach(() => {
  roleDocs = [ADMIN_ROLE_DOC, SALES_ROLE_DOC, MANAGER_ROLE_DOC];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AUTH-D4 — GroupAdmin server-side role resolution', () => {
  it('POSITIVE: a GroupAdmin resolves to the Admin role document and can perform an action Admin is granted', async () => {
    const user = mockUser({ role: 'GroupAdmin' });
    await expect(canDo(user, 'view', 'projects')).resolves.toBe(true);
    await expect(canDo(user, 'delete', 'roles')).resolves.toBe(true);
  });

  it('POSITIVE: requirePermission does not throw for a GroupAdmin on an Admin-granted action', async () => {
    const user = mockUser({ role: 'GroupAdmin' });
    await expect(requirePermission(user, 'view', 'projects')).resolves.toBeUndefined();
  });

  it('POSITIVE: the previously-missing legacy aliases (TL -> Manager, demo operator/admin -> Admin) now resolve instead of failing closed', async () => {
    // TL -> Manager: before this phase, 'tl' had no EXACT_ROLE_COMPATIBILITY
    // entry, so this always returned false regardless of the Manager doc's
    // actual grants. It now correctly reaches and reflects that grant.
    await expect(canDo(mockUser({ role: 'TL' }), 'view', 'leads')).resolves.toBe(true);
    await expect(canDo(mockUser({ role: 'TL' }), 'delete', 'roles')).resolves.toBe(false); // Manager's real (lack of) grant, not a new escalation
    await expect(canDo(mockUser({ role: 'demo operator' }), 'view', 'projects')).resolves.toBe(true);
    await expect(canDo(mockUser({ role: 'demo admin' }), 'delete', 'roles')).resolves.toBe(true);
  });

  it('NEGATIVE: an ordinary company role (Sales) does NOT gain GroupAdmin/Admin capability as a side effect of this fix', async () => {
    const user = mockUser({ role: 'Sales', companyId: 'company-a' });
    await expect(canDo(user, 'view', 'leads')).resolves.toBe(true); // Sales' own genuine grant, unaffected
    await expect(canDo(user, 'delete', 'roles')).resolves.toBe(false); // Sales has no roles-module grant at all
  });

  it('NEGATIVE: an unknown/malformed role string still fails closed (not opened by the new alias entries)', async () => {
    const user = mockUser({ role: 'TotallyMadeUpRole123' });
    await expect(canDo(user, 'view', 'projects')).resolves.toBe(false);
  });

  it('NEGATIVE: an empty role string still fails closed', async () => {
    const user = mockUser({ role: '' });
    await expect(canDo(user, 'view', 'dashboard' as never)).resolves.toBe(false);
  });

  it('SUPER ADMIN: unconditional bypass is unaffected by the GroupAdmin alias addition', async () => {
    const user = mockUser({ role: 'GroupAdmin', isSuperAdmin: true });
    await expect(canDo(user, 'delete', 'roles')).resolves.toBe(true);
    const user2 = mockUser({ role: 'AnyRandomString', isSuperAdmin: true });
    await expect(canDo(user2, 'delete', 'roles')).resolves.toBe(true);
  });

  it('TENANT BOUNDARY: this fix does not touch company/group scoping — a non-superAdmin GroupAdmin still cannot access another company\'s record via canAccessApiResource', () => {
    const groupAdminUser = { companyId: 'company-a', isSuperAdmin: false };
    expect(canAccessApiResource(groupAdminUser, 'projects', { companyId: 'company-b' })).toBe(false);
    expect(canAccessApiResource(groupAdminUser, 'projects', { companyId: 'company-a' })).toBe(true);
  });
});
