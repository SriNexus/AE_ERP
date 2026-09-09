/**
 * apiPartnerLifecycleEligibility.test.ts
 * RBAC Master Implementation Plan §15 BD-3 — OWNER-APPROVED 2026-09-09, the
 * REST-API plane.
 *
 * The REST facade is the second authorization plane (Admin SDK, bypasses
 * firestore.rules). This suite proves it mirrors the rules-layer
 * `partnerCreateEligible()` gate: a Channel-Partner caller may CREATE a new
 * leads / customers / projects / scheme_registrations record only while their
 * `channel_partners.status` is 'active'. KYC is advisory. Non-Partner callers
 * and every other collection are untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fixtures ───────────────────────────────────────────────────────────
const CO1 = 'CO-1';
const CP_ACTIVE = 'PRT-ACTIVE';
const CP_SUSPENDED = 'PRT-SUSP';
const CP_INACTIVE = 'PRT-INACT';
const CP_KYC_REJECTED = 'PRT-KYCREJ';
const CP_MISSING_STATUS = 'PRT-NOSTATUS';

const CHANNEL_PARTNERS: Record<string, Record<string, unknown>> = {
  [CP_ACTIVE]: { companyId: CO1, status: 'active', kycStatus: 'verified', isDeleted: false },
  [CP_SUSPENDED]: { companyId: CO1, status: 'suspended', kycStatus: 'verified', isDeleted: false },
  [CP_INACTIVE]: { companyId: CO1, status: 'inactive', kycStatus: 'verified', isDeleted: false },
  [CP_KYC_REJECTED]: { companyId: CO1, status: 'active', kycStatus: 'rejected', isDeleted: false },
  [CP_MISSING_STATUS]: { companyId: CO1, kycStatus: 'verified', isDeleted: false }, // legacy — no status field
};

const ROLE_DOCS: Record<string, Record<string, unknown>> = {
  [`${CO1}_Partner`]: {
    name: 'Partner', schemaVersion: 1,
    permissions: {
      leads: { view: true, create: true, visibility: 'self' },
      customers: { view: true, create: true, visibility: 'self' },
      projects: { view: true, create: true, visibility: 'self' },
    },
  },
  [`${CO1}_Sales`]: {
    name: 'Sales', schemaVersion: 1,
    permissions: { leads: { view: true, create: true, edit: true } },
  },
};

function makeFakeDb() {
  return {
    collection: (name: string) => {
      if (name === 'channel_partners') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: id in CHANNEL_PARTNERS, data: () => CHANNEL_PARTNERS[id] }),
          }),
        };
      }
      if (name === 'roles') {
        return { doc: (id: string) => ({ get: async () => ({ exists: id in ROLE_DOCS, data: () => ROLE_DOCS[id] }) }) };
      }
      if (name === 'companies') {
        return { doc: (id: string) => ({ get: async () => ({ exists: id === CO1, data: () => ({ id: CO1, companyId: CO1, groupId: '', status: 'Active' }) }) }) };
      }
      // generic entity collection: create() records into a sink
      return {
        doc: (id: string) => ({
          create: vi.fn(async () => ({ id })),
          get: async () => ({ exists: false, data: () => undefined }),
        }),
        add: vi.fn(async () => ({ id: 'generated-id' })),
      };
    },
  };
}

const H = vi.hoisted(() => ({ currentUser: {} as Record<string, unknown> }));
vi.mock('../_lib/firebase', () => ({
  getAdminDb: () => makeFakeDb(),
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

import { assertApiPartnerCanCreate, PartnerNotEligibleError, PARTNER_CREATE_GATED_COLLECTIONS } from '../_lib/partnerEligibility';
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

// ── Unit: assertApiPartnerCanCreate ────────────────────────────────────
describe('BD-3 — assertApiPartnerCanCreate', () => {
  const db = makeFakeDb() as any;

  it('gated-collection set is leads/customers/projects/scheme_registrations', () => {
    expect([...PARTNER_CREATE_GATED_COLLECTIONS].sort()).toEqual(
      ['customers', 'leads', 'projects', 'scheme_registrations'],
    );
  });

  it('active partner → allowed (no throw) on every gated collection', async () => {
    for (const c of PARTNER_CREATE_GATED_COLLECTIONS) {
      await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_ACTIVE }) as any, c)).resolves.toBeUndefined();
    }
  });

  it('KYC-rejected but active partner → allowed (KYC is advisory)', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_KYC_REJECTED }) as any, 'leads')).resolves.toBeUndefined();
  });

  it('partner with a legacy doc that has no status field → grandfathered to active', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_MISSING_STATUS }) as any, 'leads')).resolves.toBeUndefined();
  });

  it('suspended partner → PartnerNotEligibleError (403)', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_SUSPENDED }) as any, 'leads'))
      .rejects.toBeInstanceOf(PartnerNotEligibleError);
  });

  it('inactive partner → PartnerNotEligibleError (403)', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_INACTIVE }) as any, 'customers'))
      .rejects.toBeInstanceOf(PartnerNotEligibleError);
  });

  it('Partner-role caller with no channelPartnerId link → fails closed', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: '' }) as any, 'leads'))
      .rejects.toBeInstanceOf(PartnerNotEligibleError);
  });

  it('non-Partner caller (Sales) → never gated, even for a gated collection', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Sales', channelPartnerId: '' }) as any, 'leads')).resolves.toBeUndefined();
  });

  it('Partner caller on a NON-gated collection (quotations) → not gated', async () => {
    await expect(assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_SUSPENDED }) as any, 'quotations')).resolves.toBeUndefined();
  });

  it('the error carries statusCode 403 and code PARTNER_NOT_ELIGIBLE', async () => {
    try {
      await assertApiPartnerCanCreate(db, mkUser({ role: 'Partner', channelPartnerId: CP_SUSPENDED }) as any, 'leads');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerNotEligibleError);
      expect((e as PartnerNotEligibleError).statusCode).toBe(403);
      expect((e as PartnerNotEligibleError).code).toBe('PARTNER_NOT_ELIGIBLE');
    }
  });
});

// ── End-to-end: POST /api/leads through the real handler ───────────────
describe('BD-3 — handleCreate end-to-end', () => {
  beforeEach(() => { H.currentUser = {}; });

  async function post(user: Record<string, unknown>, entity: string, body: Record<string, unknown>) {
    H.currentUser = user;
    const req: any = { method: 'POST', url: `/api/${entity}`, headers: { host: 'x' }, query: {}, body, socket: {} };
    const res = mockRes();
    await collectionHandler(req, res);
    return res;
  }

  it('suspended partner POST /api/leads → 403 PARTNER_NOT_ELIGIBLE', async () => {
    const res = await post(mkUser({ role: 'Partner', channelPartnerId: CP_SUSPENDED }), 'leads', { name: 'x', phone: '9990001111' });
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('PARTNER_NOT_ELIGIBLE');
  });

  it('inactive partner POST /api/customers → 403 PARTNER_NOT_ELIGIBLE', async () => {
    const res = await post(mkUser({ role: 'Partner', channelPartnerId: CP_INACTIVE }), 'customers', { name: 'x', phone: '9990002222' });
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('PARTNER_NOT_ELIGIBLE');
  });

  it('active partner POST /api/leads → NOT blocked by the eligibility gate', async () => {
    const res = await post(mkUser({ role: 'Partner', channelPartnerId: CP_ACTIVE }), 'leads', { name: 'x', phone: '9990001111' });
    // May be 201 (created) — the point is it is NOT a 403 PARTNER_NOT_ELIGIBLE.
    expect(res.body?.error?.code).not.toBe('PARTNER_NOT_ELIGIBLE');
    expect(res.statusCode).not.toBe(403);
  });

  it('Sales POST /api/leads → not gated by partner eligibility', async () => {
    const res = await post(mkUser({ role: 'Sales', channelPartnerId: '' }), 'leads', { name: 'x', phone: '9990003333' });
    expect(res.body?.error?.code).not.toBe('PARTNER_NOT_ELIGIBLE');
  });
});

// ── Structural: READ / UPDATE / DELETE are NOT gated ───────────────────
describe('BD-3 — the API gate is CREATE-only', () => {
  it('assertApiPartnerCanCreate is referenced only in the create path of api/[entity].ts', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../[entity].ts', import.meta.url), 'utf8');
    // exactly one call site
    expect((src.match(/assertApiPartnerCanCreate\(/g) || []).length).toBe(1);
    // and it sits inside handleCreate (after requirePermission 'create')
    const createIdx = src.indexOf("requirePermission(user, 'create'");
    const gateIdx = src.indexOf('assertApiPartnerCanCreate(');
    expect(createIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeGreaterThan(createIdx);
  });

  it('api/[entity]/[id].ts (get/update/delete) does not reference the create gate', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../[entity]/[id].ts', import.meta.url), 'utf8');
    expect(src.includes('assertApiPartnerCanCreate')).toBe(false);
    expect(src.includes('partnerEligibility')).toBe(false);
  });
});
