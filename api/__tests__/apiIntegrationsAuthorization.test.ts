/**
 * RBAC Phase 1 (AUTH-D5) — /api/integrations authorization.
 *
 * Before this phase: `if (!auth.isSuperAdmin && auth.role !== 'Admin')` was a
 * raw, alias-blind string check — a GroupAdmin (Admin-equivalent everywhere
 * else in the app) 403'd here specifically. Fixed with an explicit literal
 * addition (`auth.role !== 'GroupAdmin'`), NOT by routing through the shared
 * EXACT_ROLE_COMPATIBILITY alias table, so this endpoint's authorization
 * stays exactly as narrow as before plus GroupAdmin — it must NOT also admit
 * 'Management'/'demo operator'/'demo admin' or any ordinary business role
 * that happens to alias to Admin elsewhere.
 */
import { describe, expect, it, vi } from 'vitest';
import { handleIntegrationsRequest, type IntegrationHandlerDeps } from '../integrations';
import type { IntegrationPlatformAdapter } from '../_lib/integrationPlatform';
import type { AuthenticatedUser } from '../_lib/auth';

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: vi.fn(function (this: any, s: number) { this.statusCode = s; return this; }),
    json: vi.fn(function (this: any, b: unknown) { this.body = b; return this; }),
    end: vi.fn(function (this: any) { return this; }),
    setHeader: vi.fn(function (this: any) { return this; }),
  };
  return res;
}

function mockReq(method: string, query: Record<string, unknown> = {}, body?: unknown) {
  return {
    method,
    headers: {},
    query,
    body,
  } as any;
}

function mockUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    uid: 'test-uid',
    erpUserId: 'test-uid',
    email: 'user@example.com',
    name: 'Test User',
    role: 'Admin',
    companyId: 'company-a',
    isSuperAdmin: false,
    ...overrides,
  } as AuthenticatedUser;
}

// A minimal adapter — only `readSecretEnvelope` is exercised (GET/'status'
// path), which is all these authorization-boundary tests need to reach.
function mockAdapter(): IntegrationPlatformAdapter {
  return {
    readSecretEnvelope: vi.fn().mockResolvedValue(null),
    writeSecretEnvelope: vi.fn().mockResolvedValue(undefined),
    deleteSecretEnvelope: vi.fn().mockResolvedValue(undefined),
    writeMaskedStatus: vi.fn().mockResolvedValue(undefined),
    appendAuditLog: vi.fn().mockResolvedValue(undefined),
  };
}

async function callAsRole(role: string, isSuperAdmin = false) {
  const res = mockRes();
  const deps: Partial<IntegrationHandlerDeps> = {
    adapter: mockAdapter(),
    authenticate: async () => mockUser({ role, isSuperAdmin }),
  };
  await handleIntegrationsRequest(mockReq('GET', { section: 'email' }), res, deps);
  return res;
}

describe('AUTH-D5 — /api/integrations authorization', () => {
  it('ALLOWS: Admin retains access (pre-existing, must remain unchanged)', async () => {
    const res = await callAsRole('Admin');
    expect(res.statusCode).not.toBe(403);
  });

  it('ALLOWS: GroupAdmin now resolves (the false-DENY this phase fixes)', async () => {
    const res = await callAsRole('GroupAdmin');
    expect(res.statusCode).not.toBe(403);
  });

  it('ALLOWS: Super Admin bypass is unaffected', async () => {
    const res = await callAsRole('AnyRoleAtAll', true);
    expect(res.statusCode).not.toBe(403);
  });

  it('DENIES: Sales must remain denied (not widened by this fix)', async () => {
    const res = await callAsRole('Sales');
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
  });

  it('DENIES: Manager must remain denied', async () => {
    const res = await callAsRole('Manager');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: HR must remain denied', async () => {
    const res = await callAsRole('HR');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: Warehouse must remain denied', async () => {
    const res = await callAsRole('Warehouse');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: Operations must remain denied', async () => {
    const res = await callAsRole('Operations');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: Partner must remain denied', async () => {
    const res = await callAsRole('Partner');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: Director must remain denied', async () => {
    const res = await callAsRole('Director');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: an arbitrary custom role must remain denied', async () => {
    const res = await callAsRole('Custom Regional Lead');
    expect(res.statusCode).toBe(403);
  });

  it('DENIES: roles that alias to Admin elsewhere (Management, demo operator, demo admin) are deliberately NOT widened by this narrow, literal fix', async () => {
    for (const role of ['Management', 'demo operator', 'demo admin']) {
      const res = await callAsRole(role);
      expect(res.statusCode).toBe(403);
    }
  });

  it('DENIES: malformed/unknown/empty role remains denied', async () => {
    const res = await callAsRole('');
    expect(res.statusCode).toBe(403);
  });
});
