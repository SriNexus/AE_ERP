/**
 * apiMassAssignment.test.ts — DI-03 (Phase 4) end-to-end coverage for
 * handleUpdate(), the generic PATCH/PUT handler in api/[entity]/[id].ts.
 *
 * Kept in its own file (rather than folded into api.test.ts) because it
 * needs a module-level vi.mock('../_lib/firebase', ...) to swap out the
 * Firestore Admin SDK boundary — api.test.ts's own `describe('getAdminDb', ...)`
 * block needs the REAL, unmocked module for its dynamic-import tests, and
 * Vitest mocks are hoisted file-wide, so the two can't safely share a file.
 *
 * Only the Admin SDK I/O boundary is mocked here — the actual DI-03 security
 * logic (buildWritableUpdatePayload, inside handleUpdate) and the actual
 * permission-check code path (requirePermission/canDo) both run for real.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleUpdate } from '../[entity]/[id]';
import { getAdminDb } from '../_lib/firebase';

vi.mock('../_lib/firebase', () => ({ getAdminDb: vi.fn() }));
const getAdminDbMock = vi.mocked(getAdminDb);

function mockResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as any;
}

function mockUser(overrides: Record<string, any> = {}) {
  return {
    uid: 'test-user-1',
    erpUserId: 'MUSR-test-user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'Admin',
    companyId: 'company-1',
    isSuperAdmin: false,
    ...overrides,
  };
}

const config = { collection: 'quotations', module: 'quotations', searchFields: [] } as any;

// requirePermission()/canDo() run for real (unmocked) — a non-super-admin
// actor's 'edit' grant is resolved through a fake `roles` collection query
// so the actual permission-check code path is exercised too, not just the
// field-filtering logic.
function fakeDb(existingData: Record<string, unknown> | null, moduleName = config.module) {
  let currentData = existingData;
  const updateCalls: Record<string, unknown>[] = [];
  const entityDocRef = {
    get: vi.fn(async () => ({
      exists: currentData !== null,
      id: 'doc-1',
      data: () => currentData,
    })),
    update: vi.fn(async (data: Record<string, unknown>) => {
      updateCalls.push(data);
      currentData = { ...(currentData || {}), ...data };
    }),
  };
  // RBAC Phase 6 (AUTH-D1): getRoleDocument() now fetches by deterministic
  // id ('{companyId}_{RoleName}', mirroring src/lib/roleBootstrap.ts's
  // roleDocumentId()) via a direct .doc(id).get() — no where()/limit()/
  // unscoped collection scan remains in the code path. mockUser() below
  // defaults to role:'Admin', companyId:'company-1', so the actor's role
  // document id is deterministically 'company-1_Admin'.
  const rolesCollection: any = {
    doc: vi.fn((id: string) => ({
      get: vi.fn(async () => ({
        exists: id === 'company-1_Admin',
        data: () => ({ name: 'Admin', schemaVersion: 1, permissions: { [moduleName]: { view: true, create: true, edit: true, delete: true } } }),
      })),
    })),
  };
  return {
    db: {
      collection: vi.fn((name: string) => (name === 'roles' ? rolesCollection : { doc: vi.fn(() => entityDocRef) })),
    } as any,
    updateCalls,
    getCurrentData: () => currentData,
  };
}

describe('handleUpdate (DI-03 — end-to-end mass-assignment protection through the real handler)', () => {
  it('a legitimate PATCH field succeeds and is actually persisted (not merely accepted in the response)', async () => {
    const { db, updateCalls, getCurrentData } = fakeDb({ id: 'doc-1', companyId: 'company-1', status: 'Draft', isDeleted: false });
    getAdminDbMock.mockReturnValue(db);
    const res = mockResponse();
    await handleUpdate({ body: { status: 'Sent' } } as any, res, config, 'doc-1', mockUser({ companyId: 'company-1' }));
    expect(updateCalls[0].status).toBe('Sent');
    expect(getCurrentData()?.status).toBe('Sent');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('an attacker payload cannot reach the persisted document: companyId/groupId/role/isSuperAdmin never appear in the actual Firestore update() call', async () => {
    const { db, updateCalls, getCurrentData } = fakeDb({ id: 'doc-1', companyId: 'company-1', status: 'Draft', isDeleted: false });
    getAdminDbMock.mockReturnValue(db);
    const res = mockResponse();
    await handleUpdate(
      { body: { status: 'Sent', companyId: 'OTHER-COMPANY', groupId: 'OTHER-GROUP', role: 'Admin', isSuperAdmin: true } } as any,
      res, config, 'doc-1', mockUser({ companyId: 'company-1' }),
    );
    const persisted = updateCalls[0];
    expect('companyId' in persisted).toBe(false);
    expect('groupId' in persisted).toBe(false);
    expect('role' in persisted).toBe(false);
    expect('isSuperAdmin' in persisted).toBe(false);
    expect(getCurrentData()?.companyId).toBe('company-1'); // unchanged
    expect(persisted.status).toBe('Sent'); // legitimate field still applied
  });

  it('cross-company access remains denied (unchanged, pre-existing behavior — regression check)', async () => {
    const { db } = fakeDb({ id: 'doc-1', companyId: 'a-different-company', status: 'Draft', isDeleted: false });
    getAdminDbMock.mockReturnValue(db);
    const res = mockResponse();
    await handleUpdate({ body: { status: 'Sent' } } as any, res, config, 'doc-1', mockUser({ companyId: 'company-1', isSuperAdmin: false }));
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('a malformed (non-object) payload fails safely (unchanged, pre-existing behavior — regression check)', async () => {
    const { db } = fakeDb({ id: 'doc-1', companyId: 'company-1', status: 'Draft', isDeleted: false });
    getAdminDbMock.mockReturnValue(db);
    const res = mockResponse();
    await handleUpdate({ body: ['not', 'an', 'object'] } as any, res, config, 'doc-1', mockUser({ companyId: 'company-1' }));
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
