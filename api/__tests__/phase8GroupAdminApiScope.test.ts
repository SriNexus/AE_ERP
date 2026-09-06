/**
 * phase8GroupAdminApiScope.test.ts — RBAC Master Implementation Plan,
 * Phase 8 (SuperAdmin / GroupAdmin Hardening), the REST API plane.
 *
 * ROOT CAUSE this closes: the client and firestore.rules planes now grant a
 * GroupAdmin group-wide authority within their own group; the REST API did
 * not. `AuthenticatedUser` / `ApiTenantIdentity` carried no `groupId`, and
 * api/[entity].ts / api/[entity]/[id].ts enforced tenant scope with inline
 * `data.companyId !== user.companyId` checks — so every `/api/*` request
 * from a GroupAdmin was confined to their HOME company regardless of the
 * rules.
 *
 * FIX: `groupId` threaded onto `AuthenticatedUser` from the trusted
 * `users/{id}` doc; one centralized set of helpers in api/_lib/registry.ts
 * (`isApiGroupAdmin`, `canAccessApiResource`, `resolveApiCreateTenant`)
 * wired into the ~5 previously-inline call sites. A GroupAdmin now reaches
 * any resource whose `groupId` equals their authoritative group (mirrors
 * firestore.rules' `groupAdminCanRead`), and API-created documents are
 * stamped with the authoritative `groupId` (the client write path already
 * does this).
 *
 * This file proves BOTH the new GroupAdmin capability AND that every
 * non-GroupAdmin role's authorization is byte-for-byte unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isApiGroupAdmin,
  canAccessApiResource,
  resolveApiCreateTenant,
  resolveApiCompanyScope,
  ApiTenantScopeError,
} from '../_lib/registry';
import { handleGetById } from '../[entity]/[id]';
import { getAdminDb } from '../_lib/firebase';

vi.mock('../_lib/firebase', () => ({ getAdminDb: vi.fn() }));
const getAdminDbMock = vi.mocked(getAdminDb);

const GROUP_A = 'GROUP-A';
const GROUP_B = 'GROUP-B';
const CO_HOME = 'CO-HOME';
const CO_SIBLING = 'CO-SIBLING'; // in GROUP-A
const CO_OTHER = 'CO-OTHER';     // in GROUP-B

const groupAdmin = (over: Record<string, unknown> = {}) => ({
  uid: 'ga-1', erpUserId: 'MUSR-ga', email: 'ga@test.erp', name: 'GA',
  role: 'GroupAdmin', companyId: CO_HOME, groupId: GROUP_A, isSuperAdmin: false, ...over,
});

// ── isApiGroupAdmin ─────────────────────────────────────────────────────
describe('Phase 8 API — isApiGroupAdmin', () => {
  it('true only for role=GroupAdmin (case-insensitive) + a real groupId + not SuperAdmin', () => {
    expect(isApiGroupAdmin(groupAdmin())).toBe(true);
    expect(isApiGroupAdmin(groupAdmin({ role: 'groupadmin' }))).toBe(true);
    expect(isApiGroupAdmin(groupAdmin({ role: ' GroupAdmin ' }))).toBe(true);
    expect(isApiGroupAdmin(groupAdmin({ groupId: '' }))).toBe(false);      // no group -> ordinary user
    expect(isApiGroupAdmin(groupAdmin({ groupId: undefined }))).toBe(false);
    expect(isApiGroupAdmin(groupAdmin({ isSuperAdmin: true }))).toBe(false); // super bypass owns this path
    expect(isApiGroupAdmin({ companyId: CO_HOME, role: 'Admin', groupId: GROUP_A })).toBe(false);
    expect(isApiGroupAdmin({ companyId: CO_HOME, role: 'Sales', groupId: GROUP_A })).toBe(false);
  });
});

// ── canAccessApiResource ───────────────────────────────────────────────
describe('Phase 8 API — canAccessApiResource', () => {
  it('GroupAdmin reaches any in-group document (groupId match) — NEW', () => {
    const ga = groupAdmin();
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_SIBLING, groupId: GROUP_A })).toBe(true);
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_HOME, groupId: GROUP_A })).toBe(true);
  });

  it('GroupAdmin is DENIED a document in another group', () => {
    const ga = groupAdmin();
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_OTHER, groupId: GROUP_B })).toBe(false);
  });

  it('GroupAdmin is DENIED a document with NO groupId that is not their own company (fail closed)', () => {
    const ga = groupAdmin();
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_SIBLING })).toBe(false);
    // ...but their OWN company's groupId-less doc is still reachable (companyId rule)
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_HOME })).toBe(true);
  });

  it('a GroupAdmin with NO authoritative groupId is confined to their company, exactly like an ordinary user', () => {
    const ga = groupAdmin({ groupId: '' });
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_SIBLING, groupId: GROUP_A })).toBe(false);
    expect(canAccessApiResource(ga, 'projects', { companyId: CO_HOME })).toBe(true);
  });

  it('NON-GroupAdmin roles: byte-identical to the previous inline check (companyId only, groupId irrelevant)', () => {
    for (const role of ['Admin', 'Sales', 'Manager', 'Warehouse', 'Accounts', 'Partner', 'Director']) {
      const u = { companyId: CO_HOME, role, groupId: GROUP_A, isSuperAdmin: false };
      expect(canAccessApiResource(u, 'projects', { companyId: CO_HOME })).toBe(true);
      expect(canAccessApiResource(u, 'projects', { companyId: CO_SIBLING, groupId: GROUP_A })).toBe(false);
      expect(canAccessApiResource(u, 'projects', { companyId: CO_OTHER })).toBe(false);
    }
  });

  it('SuperAdmin / Owner: unconditional (unchanged); global collections (roles): always (unchanged)', () => {
    expect(canAccessApiResource({ companyId: CO_HOME, isSuperAdmin: true }, 'projects', { companyId: CO_OTHER })).toBe(true);
    expect(canAccessApiResource({ companyId: CO_HOME, isSuperAdmin: false }, 'roles', { companyId: CO_OTHER })).toBe(true);
  });
});

// ── resolveApiCreateTenant ─────────────────────────────────────────────
function fakeCompaniesDb(companyGroupIds: Record<string, string>) {
  return {
    collection: (name: string) => {
      if (name !== 'companies') throw new Error(`unexpected collection ${name}`);
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: id in companyGroupIds, data: () => ({ groupId: companyGroupIds[id] }) }),
        }),
      };
    },
  } as never;
}

describe('Phase 8 API — resolveApiCreateTenant', () => {
  const db = fakeCompaniesDb({ [CO_HOME]: GROUP_A, [CO_SIBLING]: GROUP_A, [CO_OTHER]: GROUP_B });

  it('GroupAdmin, no explicit company -> home company + authoritative groupId stamped', async () => {
    expect(await resolveApiCreateTenant(db, groupAdmin(), undefined)).toEqual({ companyId: CO_HOME, groupId: GROUP_A });
  });

  it('GroupAdmin, explicit IN-GROUP sibling -> that company + the group (NEW capability)', async () => {
    expect(await resolveApiCreateTenant(db, groupAdmin(), CO_SIBLING)).toEqual({ companyId: CO_SIBLING, groupId: GROUP_A });
  });

  it('GroupAdmin, explicit OUT-OF-GROUP company -> 403 ApiTenantScopeError (never a silent redirect)', async () => {
    await expect(resolveApiCreateTenant(db, groupAdmin(), CO_OTHER)).rejects.toBeInstanceOf(ApiTenantScopeError);
  });

  it('NON-GroupAdmin: explicit company is IGNORED (unchanged) — always home; groupId is now additionally stamped', async () => {
    const sales = { companyId: CO_HOME, role: 'Sales', groupId: GROUP_A, isSuperAdmin: false };
    expect(await resolveApiCreateTenant(db, sales, CO_SIBLING)).toEqual({ companyId: CO_HOME, groupId: GROUP_A });
    expect(await resolveApiCreateTenant(db, sales, undefined)).toEqual({ companyId: CO_HOME, groupId: GROUP_A });
  });

  it('SuperAdmin: may target any company (unchanged); groupId resolved from that company', async () => {
    const sa = { companyId: CO_HOME, isSuperAdmin: true };
    expect(await resolveApiCreateTenant(db, sa, CO_OTHER)).toEqual({ companyId: CO_OTHER, groupId: GROUP_B });
    expect(await resolveApiCreateTenant(db, sa, undefined)).toEqual({ companyId: CO_HOME, groupId: GROUP_A });
  });

  it('resolveApiCompanyScope (write company only) — unchanged for every role', () => {
    expect(resolveApiCompanyScope({ companyId: CO_HOME, isSuperAdmin: true }, CO_OTHER)).toBe(CO_OTHER);
    expect(resolveApiCompanyScope({ companyId: CO_HOME, isSuperAdmin: false }, CO_OTHER)).toBe(CO_HOME);
    expect(resolveApiCompanyScope(groupAdmin(), CO_SIBLING)).toBe(CO_HOME); // scope helper stays company-only; create uses resolveApiCreateTenant
  });
});

// ── handleGetById end-to-end (real handler, real requirePermission) ────
function mockResponse() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() } as any;
}

function fakeEntityDb(doc: Record<string, unknown> | null) {
  const adminRoleDoc = {
    name: 'Admin', schemaVersion: 1,
    permissions: { projects: { view: true, create: true, edit: true, delete: true } },
  };
  // RBAC Master Plan §5.2: a GroupAdmin acting on a same-group sibling company
  // is now gated by THAT company's Admin role document — so both CO_HOME's and
  // CO_SIBLING's Admin templates must resolve (every real company is seeded
  // with the system role docs). CO_OTHER (foreign group) is never reached: the
  // tenant check (canAccessApiResource) 404s it before the permission check.
  const seededAdminRoleIds = new Set([`${CO_HOME}_Admin`, `${CO_SIBLING}_Admin`]);
  return {
    collection: (name: string) => {
      if (name === 'roles') {
        return { doc: (id: string) => ({ get: async () => ({ exists: seededAdminRoleIds.has(id), data: () => adminRoleDoc }) }) };
      }
      return { doc: () => ({ get: async () => ({ exists: doc !== null, id: 'doc-1', data: () => doc }) }) };
    },
  } as never;
}

const projectsConfig = { collection: 'projects', module: 'projects', searchFields: [] } as any;

describe('Phase 8 API — handleGetById end-to-end: GroupAdmin group-wide read', () => {
  it('GroupAdmin READS a sibling-company (same-group) resource — 200, NEW', async () => {
    getAdminDbMock.mockReturnValue(fakeEntityDb({ companyId: CO_SIBLING, groupId: GROUP_A, isDeleted: false, name: 'Sibling Project' }));
    const res = mockResponse();
    await handleGetById({} as any, res, projectsConfig, 'doc-1', groupAdmin());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('GroupAdmin READS their own home-company resource — 200 (unchanged)', async () => {
    getAdminDbMock.mockReturnValue(fakeEntityDb({ companyId: CO_HOME, groupId: GROUP_A, isDeleted: false }));
    const res = mockResponse();
    await handleGetById({} as any, res, projectsConfig, 'doc-1', groupAdmin());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('GroupAdmin is DENIED an out-of-group resource — 404', async () => {
    getAdminDbMock.mockReturnValue(fakeEntityDb({ companyId: CO_OTHER, groupId: GROUP_B, isDeleted: false }));
    const res = mockResponse();
    await handleGetById({} as any, res, projectsConfig, 'doc-1', groupAdmin());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('a non-group actor (role Admin, NO groupId) reading a sibling-company resource — still 404 (byte-identical to the pre-Phase-8 inline check)', async () => {
    getAdminDbMock.mockReturnValue(fakeEntityDb({ companyId: CO_SIBLING, groupId: GROUP_A, isDeleted: false }));
    const res = mockResponse();
    await handleGetById({} as any, res, projectsConfig, 'doc-1', { ...groupAdmin(), role: 'Admin', groupId: '' });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('a non-group actor reading their OWN home-company resource — 200 (unchanged)', async () => {
    getAdminDbMock.mockReturnValue(fakeEntityDb({ companyId: CO_HOME, groupId: GROUP_A, isDeleted: false }));
    const res = mockResponse();
    await handleGetById({} as any, res, projectsConfig, 'doc-1', { ...groupAdmin(), role: 'Admin', groupId: '' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
