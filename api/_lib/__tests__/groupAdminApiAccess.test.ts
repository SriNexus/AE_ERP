/**
 * RBAC Phase 1 (AUTH-D4) — GroupAdmin server-side API role resolution, and
 * RBAC Phase 6 (AUTH-D1) — the deterministic, company-scoped role-document
 * lookup these tests now exercise.
 *
 * AUTH-D4 history: before Phase 1, `EXACT_ROLE_COMPATIBILITY` in
 * `api/_lib/permissions.ts` had no entry for 'groupadmin' (or 'tl', 'demo
 * operator', 'demo admin'), so `resolveCompatibleRole()` returned null and
 * `canDo()`/`requirePermission()` failed closed for EVERY module/action, for
 * EVERY GroupAdmin, on every `/api/*` request — a false DENY, not an
 * intentional restriction (the client's own alias table has always resolved
 * GroupAdmin to the Admin template — GroupAdmin is a scope extension, not a
 * distinct permission set).
 *
 * AUTH-D1 history (fixed this phase): `getRoleDocument()` used to query
 * `where('name', '==', roleName.toLowerCase())` against docs whose stored
 * `name` is capitalized — that primary query always returned empty, on
 * every request, and the "fallback" it fell through to every time was an
 * UNSCOPED `db.collection('roles').get()` across every company, matched
 * case-insensitively, first-match-wins. This file's fake Firestore now
 * mirrors the FIXED lookup — a direct `.doc('{companyId}_{RoleName}').get()`
 * — and includes an explicit multi-company isolation test proving the old
 * cross-tenant leak is closed: two companies' identically-named "Sales"
 * role, with DIFFERENT grants, now resolve independently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth';

type FakeRoleDoc = { name: string; schemaVersion: 1; permissions: Record<string, Record<string, boolean> | undefined> };

// Keyed by the exact deterministic id scheme (`{companyId}_{RoleName}`,
// mirroring src/lib/roleBootstrap.ts's roleDocumentId()) the fixed
// getRoleDocument() now looks up directly.
let roleDocsById: Record<string, FakeRoleDoc> = {};

vi.mock('../firebase', () => ({
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name !== 'roles') throw new Error(`unexpected collection: ${name}`);
      return {
        doc: (id: string) => ({
          get: async () => {
            const data = roleDocsById[id];
            return { exists: Boolean(data), data: () => data };
          },
        }),
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
  roleDocsById = {
    'company-a_Admin': ADMIN_ROLE_DOC,
    'company-a_Sales': SALES_ROLE_DOC,
    'company-a_Manager': MANAGER_ROLE_DOC,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AUTH-D4 — GroupAdmin server-side role resolution', () => {
  it('POSITIVE: a GroupAdmin resolves to their own company\'s Admin role document and can perform an action Admin is granted', async () => {
    const user = mockUser({ role: 'GroupAdmin' });
    await expect(canDo(user, 'view', 'projects')).resolves.toBe(true);
    await expect(canDo(user, 'delete', 'roles')).resolves.toBe(true);
  });

  it('POSITIVE: requirePermission does not throw for a GroupAdmin on an Admin-granted action', async () => {
    const user = mockUser({ role: 'GroupAdmin' });
    await expect(requirePermission(user, 'view', 'projects')).resolves.toBeUndefined();
  });

  it('POSITIVE: the previously-missing legacy aliases (TL -> Manager, demo operator/admin -> Admin) now resolve instead of failing closed', async () => {
    // TL -> Manager: before Phase 1, 'tl' had no EXACT_ROLE_COMPATIBILITY
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

  it('TENANT BOUNDARY: an ordinary non-super identity (no GroupAdmin role/groupId) still cannot access another company\'s record via canAccessApiResource — byte-identical to the pre-Phase-8 inline check', () => {
    const ordinaryUser = { companyId: 'company-a', isSuperAdmin: false };
    expect(canAccessApiResource(ordinaryUser, 'projects', { companyId: 'company-b' })).toBe(false);
    expect(canAccessApiResource(ordinaryUser, 'projects', { companyId: 'company-a' })).toBe(true);
    // A groupId on the doc changes nothing for a non-GroupAdmin.
    expect(canAccessApiResource(ordinaryUser, 'projects', { companyId: 'company-b', groupId: 'GROUP-A' })).toBe(false);
  });
});

describe('AUTH-D1 — deterministic, company-scoped role-document lookup', () => {
  it('POSITIVE: a missing role document (unknown role name for this company) fails closed, not by accidentally matching another document', async () => {
    const user = mockUser({ role: 'Sales', companyId: 'company-nonexistent' });
    await expect(canDo(user, 'view', 'leads')).resolves.toBe(false);
  });

  it('NEGATIVE (the exact bug this phase closes): two companies with an identically-named "Sales" role, holding DIFFERENT grants, resolve completely independently — Company B\'s customization never leaks into Company A\'s evaluation, and vice versa', async () => {
    // Company A's Sales: as seeded above — leads view+create, no roles grant.
    // Company B customizes its OWN "Sales" role document to ALSO grant
    // roles:delete — a deliberately dangerous customization that must never
    // be visible to a Company A caller.
    roleDocsById['company-b_Sales'] = {
      name: 'Sales',
      schemaVersion: 1,
      permissions: {
        leads: { view: true, create: true },
        roles: { view: true, create: true, edit: true, delete: true },
      },
    };

    const companyAUser = mockUser({ role: 'Sales', companyId: 'company-a' });
    const companyBUser = mockUser({ role: 'Sales', companyId: 'company-b' });

    // Company A's Sales must NOT inherit Company B's customization.
    await expect(canDo(companyAUser, 'delete', 'roles')).resolves.toBe(false);
    // Company B's Sales genuinely does have it — on its OWN document only.
    await expect(canDo(companyBUser, 'delete', 'roles')).resolves.toBe(true);
    // Both still see their own, identical leads:view/create grant.
    await expect(canDo(companyAUser, 'view', 'leads')).resolves.toBe(true);
    await expect(canDo(companyBUser, 'view', 'leads')).resolves.toBe(true);
  });

  it('NEGATIVE: a caller with no companyId fails closed rather than resolving an unscoped/malformed document id', async () => {
    const user = mockUser({ role: 'Admin', companyId: '' });
    await expect(canDo(user, 'view', 'projects')).resolves.toBe(false);
  });

  it('the lookup never calls an unscoped collection-wide read — this mock\'s collection() only ever exposes doc(id), proving the fixed code path cannot fall back to a full scan even if it wanted to', async () => {
    const user = mockUser({ role: 'Admin', companyId: 'company-a' });
    await expect(canDo(user, 'view', 'projects')).resolves.toBe(true);
    // If getRoleDocument() still called collection('roles').where(...) or
    // collection('roles').get() anywhere, the mock above would throw
    // (no such methods exist on it) rather than let this resolve — this
    // test passing IS the proof.
  });
});

describe('§5.2 — a GroupAdmin acting on a same-group sibling company is gated by THAT company’s Admin template', () => {
  beforeEach(() => {
    // company-a (home) Admin: NO products grant at all.
    roleDocsById['company-a_Admin'] = {
      name: 'Admin', schemaVersion: 1,
      permissions: { projects: { view: true }, roles: { view: true } },
    };
    // company-b (same group, sibling) Admin: full products grant.
    roleDocsById['company-b_Admin'] = {
      name: 'Admin', schemaVersion: 1,
      permissions: { products: { view: true, create: true, edit: true, delete: true } },
    };
    // company-c (foreign group) Admin: also grants products — must NEVER be
    // consulted for a group-A GroupAdmin.
    roleDocsById['company-c_Admin'] = {
      name: 'Admin', schemaVersion: 1,
      permissions: { products: { view: true, create: true, edit: true, delete: true } },
    };
  });

  it('POSITIVE: GroupAdmin (home company-a, group-A) creating in same-group sibling company-b resolves company-b’s Admin template', async () => {
    const ga = mockUser({ role: 'GroupAdmin', companyId: 'company-a', groupId: 'group-A' });
    // Home template has no products grant...
    await expect(canDo(ga, 'create', 'products')).resolves.toBe(false);
    // ...but the sibling's template does — and the request targets the sibling.
    await expect(canDo(ga, 'create', 'products', 'company-b')).resolves.toBe(true);
    await expect(canDo(ga, 'delete', 'products', 'company-b')).resolves.toBe(true);
  });

  it('NEGATIVE: an ordinary Admin (no groupId) never shifts template — a stray target companyId is ignored, home template governs', async () => {
    const admin = mockUser({ role: 'Admin', companyId: 'company-a' });
    // Even if a caller somehow passes company-b, a non-GroupAdmin stays on home.
    await expect(canDo(admin, 'create', 'products', 'company-b')).resolves.toBe(false);
  });

  it('NEGATIVE: a GroupAdmin with no authoritative groupId cannot shift template', async () => {
    const ga = mockUser({ role: 'GroupAdmin', companyId: 'company-a' }); // no groupId
    await expect(canDo(ga, 'create', 'products', 'company-b')).resolves.toBe(false);
  });

  it('targetCompanyId === home is a no-op (byte-identical to the 3-arg call)', async () => {
    const ga = mockUser({ role: 'GroupAdmin', companyId: 'company-a', groupId: 'group-A' });
    await expect(canDo(ga, 'view', 'projects', 'company-a')).resolves.toBe(true);
    await expect(canDo(ga, 'create', 'products', 'company-a')).resolves.toBe(false);
  });
});
