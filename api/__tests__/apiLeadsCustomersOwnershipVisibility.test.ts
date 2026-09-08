/**
 * apiLeadsCustomersOwnershipVisibility.test.ts
 * RBAC Master Implementation Plan — Phase 10 (N1 / AUTH-C1), the REST API plane.
 *
 * Phase 7 gave firestore.rules a real ownership predicate for `leads` and
 * `customers` (canReadLeadScoped / canReadCustomerScoped): Partner ('self'
 * seed) sees only own records, Manager/TL ('team' seed) sees own + direct
 * reports'. The generic REST list/get path enforced only company/group scope,
 * so a Partner or Manager calling `/api/leads` or `/api/customers` directly
 * retrieved every same-company record.
 *
 * This suite proves the REST API now mirrors the SDK/rules ownership policy
 * for those two collections, and that every 'all'-visibility role and every
 * other collection is byte-for-byte unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Fixtures ───────────────────────────────────────────────────────────
const CO1 = 'CO-1';
const CO2 = 'CO-2';

const PARTNER_U = 'MUSR-partner';
const CP_ID = 'PRT-1'; // channel_partners doc id
const MGR_U = 'MUSR-mgr';
const REP_ON_TEAM = 'MUSR-rep-a';     // managerId == MGR_U, company CO-1
const REP_OFF_TEAM = 'MUSR-rep-b';    // no managerId, company CO-1
const XCO_REP = 'MUSR-xco';           // managerId == MGR_U BUT company CO-2

const USERS: Record<string, Record<string, unknown>> = {
  [REP_ON_TEAM]: { companyId: CO1, managerId: MGR_U, isDeleted: false, role: 'Sales' },
  [REP_OFF_TEAM]: { companyId: CO1, isDeleted: false, role: 'Sales' },
  [XCO_REP]: { companyId: CO2, managerId: MGR_U, isDeleted: false, role: 'Sales' },
  'MUSR-deleted-rep': { companyId: CO1, managerId: MGR_U, isDeleted: true, role: 'Sales' },
};

const ROLE_DOCS: Record<string, Record<string, unknown>> = {
  [`${CO1}_Partner`]: {
    name: 'Partner', schemaVersion: 1,
    permissions: {
      leads: { view: true, create: true, visibility: 'self' },
      customers: { view: true, create: true, visibility: 'self' },
    },
  },
  [`${CO1}_Manager`]: {
    name: 'Manager', schemaVersion: 1,
    permissions: {
      leads: { view: true, create: true, edit: true, visibility: 'team' },
      customers: { view: true, create: true, edit: true, visibility: 'team' },
    },
  },
  [`${CO1}_Sales`]: {
    name: 'Sales', schemaVersion: 1,
    permissions: {
      leads: { view: true, create: true, edit: true },       // no `visibility` → 'all'
      customers: { view: true, create: true, edit: true },
    },
  },
  // roleBootstrap.ts seeds Admin via createAllModulePermissions() → every
  // module carries every permission + visibility:'all'. The server canDo()
  // reads the persisted doc (no "empty map = allow-all" shortcut).
  [`${CO1}_Admin`]: {
    name: 'Admin', schemaVersion: 1,
    permissions: {
      leads: { view: true, create: true, edit: true, delete: true, visibility: 'all' },
      customers: { view: true, create: true, edit: true, delete: true, visibility: 'all' },
    },
  },
};

// leads fixtures (customers reuse the same shapes)
const LEADS: Record<string, Record<string, unknown>> = {
  'L-partner-created': { companyId: CO1, isDeleted: false, createdBy: PARTNER_U, name: 'a', createdAt: '2026-01-01' },
  'L-partner-assigned': { companyId: CO1, isDeleted: false, assignedToId: PARTNER_U, createdBy: 'someone', name: 'b', createdAt: '2026-01-02' },
  'L-partner-by-partnerId': { companyId: CO1, isDeleted: false, createdBy: 'sales-x', partnerId: CP_ID, name: 'c', createdAt: '2026-01-03' },
  'L-foreign': { companyId: CO1, isDeleted: false, createdBy: 'sales-x', assignedToId: REP_OFF_TEAM, name: 'd', createdAt: '2026-01-04' },
  'L-mgr-created': { companyId: CO1, isDeleted: false, createdBy: MGR_U, name: 'e', createdAt: '2026-01-05' },
  'L-team': { companyId: CO1, isDeleted: false, assignedToId: REP_ON_TEAM, createdBy: 'x', name: 'f', createdAt: '2026-01-06' },
  'L-xco-trap': { companyId: CO1, isDeleted: false, assignedToId: XCO_REP, createdBy: 'x', name: 'g', createdAt: '2026-01-07' },
  'L-co2': { companyId: CO2, isDeleted: false, createdBy: PARTNER_U, assignedToId: MGR_U, name: 'h', createdAt: '2026-01-08' },
};

// ── Fake Admin SDK (equality-aware `where`, like Firestore server-side) ──
function makeFakeDb(entity: string, rows: Record<string, Record<string, unknown>>) {
  function entityRef() {
    const filters: Array<[string, unknown]> = [];
    const run = () => Object.entries(rows)
      .filter(([, data]) => filters.every(([f, v]) => (data as any)[f] === v))
      .map(([id, data]) => ({ id, data: () => ({ id, ...data }) }));
    const chain: any = {
      where: (f: string, _op: string, v: unknown) => { filters.push([f, v]); return chain; },
      orderBy: () => chain,
      offset: () => chain,
      limit: () => chain,
      get: async () => { const docs = run(); return { docs, empty: docs.length === 0 }; },
      doc: (id: string) => ({
        get: async () => ({ exists: id in rows, id, data: () => (id in rows ? { id, ...rows[id] } : undefined) }),
      }),
    };
    return chain;
  }
  return {
    collection: (name: string) => {
      if (name === 'roles') {
        return { doc: (id: string) => ({ get: async () => ({ exists: id in ROLE_DOCS, data: () => ROLE_DOCS[id] }) }) };
      }
      if (name === 'users') {
        return {
          where: (_f: string, _op: string, v: unknown) => ({
            get: async () => ({
              docs: Object.entries(USERS).filter(([, u]) => u.managerId === v).map(([id, u]) => ({ id, data: () => u })),
            }),
          }),
        };
      }
      return entityRef();
    },
  };
}

// Hoisted mutable state so the top-level mocks can switch the backing fixture.
const H = vi.hoisted(() => ({ entity: 'leads', currentUser: {} as Record<string, unknown> }));
vi.mock('../_lib/firebase', () => ({
  getAdminDb: () => makeFakeDb(H.entity, LEADS),
  isAdminConfigured: () => true,
}));
vi.mock('../_lib/auth', async (orig) => {
  const actual = await orig<typeof import('../_lib/auth')>();
  return { ...actual, verifyAuthToken: vi.fn(async () => H.currentUser) };
});
vi.mock('../_lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
  getRateLimitKey: () => 'rk',
}));

import { resolveApiOwnershipScope, apiRecordIsOwned } from '../_lib/ownership';
import { handleGetById } from '../[entity]/[id]';
import collectionHandler from '../[entity]';

function mkUser(over: Record<string, unknown>) {
  return {
    uid: 'u', erpUserId: 'u', email: 'u@test.erp', name: 'U',
    role: 'Sales', companyId: CO1, groupId: '', channelPartnerId: '', isSuperAdmin: false,
    ...over,
  };
}
function mockRes(): any {
  return {
    statusCode: 0, body: undefined,
    status: vi.fn(function (this: any, s: number) { this.statusCode = s; return this; }),
    json: vi.fn(function (this: any, b: unknown) { this.body = b; return this; }),
    end: vi.fn(function (this: any) { return this; }),
    setHeader: vi.fn(function (this: any) { return this; }),
  };
}

beforeEach(() => { H.entity = 'leads'; });

// ── Unit: resolveApiOwnershipScope / apiRecordIsOwned ──────────────────
describe('N1 — resolveApiOwnershipScope', () => {
  it('non-scoped collection → mode:all', async () => {
    expect((await resolveApiOwnershipScope(makeFakeDb('projects', LEADS) as any, mkUser({ role: 'Partner' }) as any, 'projects', 'projects')).mode).toBe('all');
  });
  it('Sales on leads → mode:all (no `visibility` key → all, BD-1)', async () => {
    expect((await resolveApiOwnershipScope(makeFakeDb('leads', LEADS) as any, mkUser({ role: 'Sales', erpUserId: 'sales-1' }) as any, 'leads', 'leads')).mode).toBe('all');
  });
  it('Admin / GroupAdmin / SuperAdmin → mode:all', async () => {
    for (const u of [mkUser({ role: 'Admin', erpUserId: 'a' }), mkUser({ role: 'GroupAdmin', erpUserId: 'g', groupId: 'G' }), mkUser({ isSuperAdmin: true })]) {
      expect((await resolveApiOwnershipScope(makeFakeDb('leads', LEADS) as any, u as any, 'leads', 'leads')).mode).toBe('all');
    }
  });
  it('Partner on leads → mode:owned, allowIds = {erpUserId, channelPartnerId}', async () => {
    const scope = await resolveApiOwnershipScope(makeFakeDb('leads', LEADS) as any, mkUser({ role: 'Partner', erpUserId: PARTNER_U, channelPartnerId: CP_ID }) as any, 'leads', 'leads');
    expect(scope.mode).toBe('owned');
    if (scope.mode !== 'owned') throw new Error('unreachable');
    expect([...scope.allowIds].sort()).toEqual([CP_ID, PARTNER_U].sort());
  });
  it('Manager on customers → mode:owned; allowIds includes same-company non-deleted direct reports only', async () => {
    const scope = await resolveApiOwnershipScope(makeFakeDb('customers', LEADS) as any, mkUser({ role: 'Manager', erpUserId: MGR_U }) as any, 'customers', 'customers');
    expect(scope.mode).toBe('owned');
    if (scope.mode !== 'owned') throw new Error('unreachable');
    expect(scope.allowIds.has(MGR_U)).toBe(true);
    expect(scope.allowIds.has(REP_ON_TEAM)).toBe(true);
    expect(scope.allowIds.has(REP_OFF_TEAM)).toBe(false);
    expect(scope.allowIds.has(XCO_REP)).toBe(false);            // cross-company pointer — must not leak
    expect(scope.allowIds.has('MUSR-deleted-rep')).toBe(false); // deleted
  });
});

describe('N1 — apiRecordIsOwned', () => {
  it('matches on any of assignedToId / createdBy / partnerId; ignores empty/absent/undefined', () => {
    const allow = new Set(['U', 'PRT-1']);
    expect(apiRecordIsOwned({ createdBy: 'U' }, allow)).toBe(true);
    expect(apiRecordIsOwned({ assignedToId: 'U' }, allow)).toBe(true);
    expect(apiRecordIsOwned({ partnerId: 'PRT-1' }, allow)).toBe(true);
    expect(apiRecordIsOwned({ createdBy: 'other', assignedToId: '', partnerId: null }, allow)).toBe(false);
    expect(apiRecordIsOwned(undefined, allow)).toBe(false);
  });
});

// ── handleGetById (real handler + real permissions) ────────────────────
async function getById(user: Record<string, unknown>, entity: 'leads' | 'customers', id: string) {
  H.entity = entity;
  const res = mockRes();
  await handleGetById({} as any, res, { collection: entity, module: entity, searchFields: [] } as any, id, user);
  return res;
}

describe('N1 — handleGetById ownership visibility', () => {
  it('Partner: own / assigned / partnerId-matching record → 200', async () => {
    const p = mkUser({ role: 'Partner', erpUserId: PARTNER_U, channelPartnerId: CP_ID });
    for (const id of ['L-partner-created', 'L-partner-assigned', 'L-partner-by-partnerId']) {
      expect((await getById(p, 'leads', id)).statusCode).toBe(200);
    }
  });
  it('Partner: same-company foreign-owned record → 404 (identical to a tenant miss)', async () => {
    const res = await getById(mkUser({ role: 'Partner', erpUserId: PARTNER_U, channelPartnerId: CP_ID }), 'leads', 'L-foreign');
    expect(res.statusCode).toBe(404);
    expect(res.body?.error?.code).toBe('NOT_FOUND');
  });
  it('Manager: own + direct-team record → 200; unrelated / cross-company-user-assigned same-company record → 404', async () => {
    const m = mkUser({ role: 'Manager', erpUserId: MGR_U });
    expect((await getById(m, 'customers', 'L-mgr-created')).statusCode).toBe(200);
    expect((await getById(m, 'customers', 'L-team')).statusCode).toBe(200);
    expect((await getById(m, 'customers', 'L-foreign')).statusCode).toBe(404);
    expect((await getById(m, 'customers', 'L-xco-trap')).statusCode).toBe(404);
  });
  it('Sales / Admin: any same-company record → 200 (company-wide, unchanged)', async () => {
    for (const u of [mkUser({ role: 'Sales', erpUserId: 'sales-1' }), mkUser({ role: 'Admin', erpUserId: 'admin-1' })]) {
      expect((await getById(u, 'leads', 'L-foreign')).statusCode).toBe(200);
    }
  });
  it('cross-company record → 404 for every role (tenant isolation unchanged)', async () => {
    for (const u of [
      mkUser({ role: 'Partner', erpUserId: PARTNER_U, channelPartnerId: CP_ID }),
      mkUser({ role: 'Sales', erpUserId: 'sales-1' }),
      mkUser({ role: 'Admin', erpUserId: 'admin-1' }),
    ]) {
      expect((await getById(u, 'leads', 'L-co2')).statusCode).toBe(404);
    }
  });
});

// ── list handler (default export routes GET → handleList) ──────────────
async function list(user: Record<string, unknown>, entity: 'leads' | 'customers') {
  H.entity = entity;
  H.currentUser = user;
  const res = mockRes();
  const req: any = { method: 'GET', url: `/api/${entity}`, headers: { host: 'localhost', authorization: 'Bearer x' }, socket: { remoteAddress: '127.0.0.1' }, query: {}, body: undefined };
  await collectionHandler(req, res);
  return res;
}
const ids = (res: any): string[] => ((res.body?.data ?? []) as any[]).map((d) => d.id).sort();
const co1LeadCount = Object.values(LEADS).filter((l) => l.companyId === CO1).length;

describe('N1 — list handler ownership visibility', () => {
  it('Partner GET /api/leads → only own / assigned / partnerId-matching; foreign + cross-company excluded', async () => {
    const res = await list(mkUser({ role: 'Partner', erpUserId: PARTNER_U, channelPartnerId: CP_ID }), 'leads');
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['L-partner-assigned', 'L-partner-by-partnerId', 'L-partner-created']);
  });
  it('Manager GET /api/customers → own + direct-team; off-team, xco-trap, cross-company excluded', async () => {
    const res = await list(mkUser({ role: 'Manager', erpUserId: MGR_U }), 'customers');
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['L-mgr-created', 'L-team']);
  });
  it('Sales GET /api/leads → all same-company leads (company-wide, unchanged); cross-company excluded', async () => {
    const res = await list(mkUser({ role: 'Sales', erpUserId: 'sales-1' }), 'leads');
    expect(res.statusCode).toBe(200);
    expect(ids(res)).not.toContain('L-co2');
    expect(ids(res).length).toBe(co1LeadCount);
  });
  it('Admin GET /api/leads → all same-company leads (unchanged)', async () => {
    const res = await list(mkUser({ role: 'Admin', erpUserId: 'admin-1' }), 'leads');
    expect(res.statusCode).toBe(200);
    expect(ids(res)).not.toContain('L-co2');
    expect(ids(res).length).toBe(co1LeadCount);
  });
});

describe('N1 — READ-only scope: create / update / delete authorization is untouched', () => {
  const idHandlerSrc = readFileSync(join(__dirname, '..', '[entity]', '[id].ts'), 'utf-8');
  const listHandlerSrc = readFileSync(join(__dirname, '..', '[entity].ts'), 'utf-8');

  it('handleUpdate / handleDelete do not consult the ownership helper (N1 is a read fix)', () => {
    const afterGetById = idHandlerSrc.slice(idHandlerSrc.indexOf('export async function handleUpdate'));
    expect(afterGetById).not.toContain('resolveApiOwnershipScope');
    expect(afterGetById).not.toContain('apiRecordIsOwned');
  });

  it('handleCreate does not consult the ownership helper', () => {
    const afterList = listHandlerSrc.slice(listHandlerSrc.indexOf('async function handleCreate'));
    expect(afterList).not.toContain('resolveApiOwnershipScope');
    expect(afterList).not.toContain('apiRecordIsOwned');
  });

  it('firestore.rules is NOT part of this remediation (client SDK plane already enforces AUTH-C1)', () => {
    // ownership.ts references the rules only in prose; no rules file is imported/edited by N1.
    const ownershipSrc = readFileSync(join(__dirname, '..', '_lib', 'ownership.ts'), 'utf-8');
    expect(ownershipSrc).not.toMatch(/import .* firestore\.rules/);
  });
});
