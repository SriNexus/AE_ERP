/**
 * TXN-001 (Phase 5) — orphan-entity compensation on a failed provisioning
 * write.
 *
 * Root cause: createProjectionWithUserId() (used by Users.tsx's "Add User"
 * flow via createUserProjection()) does two sequential Firestore writes for
 * a brand-new identity: (1) attachEntityId() resolves-or-creates an
 * `entities` doc, then (2) the primary users/{id} document is written. If
 * (1) creates a NEW entity but (2) then fails, the entity doc was an orphan
 * — a masterless CRM identity record with no corresponding user, silently
 * left behind. (user_auth_maps is deliberately NOT part of this: it is a
 * self-owned document Firestore rules only let the new user's own uid write,
 * created lazily on THEIR first login by authIdentity.ts — an admin's
 * session can never write it, so it cannot be part of admin-side
 * provisioning at all.)
 *
 * Fix: createProjectionWithUserId() now hard-deletes a just-created
 * `entities` doc if the subsequent primary-collection write throws — never
 * a MATCHED (pre-existing, possibly shared) entity, and never masking the
 * original error even if the compensating delete itself fails. This mirrors
 * authProvisioning.ts's own existing Auth-account rollback pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateOrResolveUserByPhone = vi.fn();
const mockGetProjectionRole = vi.fn((...args: any[]) => {
  const col = args[0] as string;
  return { collection: col, role: col === 'users' ? 'User' : 'Lead', ownerField: 'userId' };
});
vi.mock('../userIdentity', () => ({
  createOrResolveUserByPhone: (...args: any[]) => mockCreateOrResolveUserByPhone(...args),
  getProjectionRole: (...args: any[]) => mockGetProjectionRole(...args),
}));

const mockCreateOrResolveEntity = vi.fn();
const mockAddEntityRole = vi.fn().mockResolvedValue(undefined);
const mockUpdateEntity = vi.fn().mockResolvedValue(undefined);
const mockSoftDeleteEntity = vi.fn().mockResolvedValue(undefined);
vi.mock('../entities', () => ({
  createOrResolveEntity: (...args: any[]) => mockCreateOrResolveEntity(...args),
  addEntityRole: (...args: any[]) => mockAddEntityRole(...args),
  updateEntity: (...args: any[]) => mockUpdateEntity(...args),
  softDeleteEntity: (...args: any[]) => mockSoftDeleteEntity(...args),
}));

vi.mock('../entityMappers', () => ({
  mapLeadToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Lead', displayName: input.name }),
  mapCustomerToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Customer', displayName: input.name }),
  mapEmployeeToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Employee', displayName: input.name }),
  mapUserToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'User', displayName: input.name }),
}));

const mockCreateDocWithId = vi.fn();
const mockUpdateDocById = vi.fn();
const mockGetOne = vi.fn();
const mockBatchCreate = vi.fn().mockResolvedValue(undefined);
const mockDeleteDocById = vi.fn().mockResolvedValue(undefined);
const mockHardDelete = vi.fn().mockResolvedValue(undefined);
vi.mock('../firestore', () => ({
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  getOne: (...args: any[]) => mockGetOne(...args),
  batchCreate: (...args: any[]) => mockBatchCreate(...args),
  deleteDocById: (...args: any[]) => mockDeleteDocById(...args),
  hardDelete: (...args: any[]) => mockHardDelete(...args),
  resolveWriteCompanyId: vi.fn(() => 'company-demo-neozy'),
  resolveWriteGroupId: vi.fn(() => ''),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { LEADS: 'leads', CUSTOMERS: 'customers', EMPLOYEES: 'employees', USERS: 'users', ENTITIES: 'entities' },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'admin-001' } })) },
}));

describe('createProjectionWithUserId — TXN-001 orphan-entity compensation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOne.mockResolvedValue({ id: 'authId-001', name: 'NITESH', entityId: 'ENT-001' });
    mockUpdateDocById.mockResolvedValue(undefined);
    mockCreateDocWithId.mockResolvedValue(undefined);
  });

  it('a NEW entity is hard-deleted when the subsequent users/{id} write fails', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-001' }, created: true, matched: false });
    mockUpdateDocById.mockRejectedValue(new Error('Firestore write failed'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('users', 'authId-001', {
      name: 'NITESH', email: 'nitesh@neozy.in', phone: '9876543210', role: 'Sales Executive', companyId: 'company-demo-neozy',
    })).rejects.toThrow('Firestore write failed');

    expect(mockHardDelete).toHaveBeenCalledTimes(1);
    expect(mockHardDelete).toHaveBeenCalledWith('entities', 'ENT-NEW-001');
  });

  it('a MATCHED (pre-existing) entity is NEVER deleted, even when the subsequent write fails — it may be shared by other records', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-EXISTING-001' }, created: false, matched: true });
    mockUpdateDocById.mockRejectedValue(new Error('Firestore write failed'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('users', 'authId-002', {
      name: 'Reuses Entity', email: 'reuse@neozy.in', phone: '9876543211', companyId: 'company-demo-neozy',
    })).rejects.toThrow('Firestore write failed');

    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('on success, nothing is compensated — the new entity legitimately backs the new user', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-002' }, created: true, matched: false });
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('users', 'authId-003', {
      name: 'Happy Path', email: 'happy@neozy.in', phone: '9876543212', companyId: 'company-demo-neozy',
    });

    expect(mockHardDelete).not.toHaveBeenCalled();
    expect(mockUpdateDocById).toHaveBeenCalledTimes(1);
  });

  it('the ORIGINAL write failure still propagates to the caller even when compensation succeeds (never swallowed)', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-003' }, created: true, matched: false });
    mockUpdateDocById.mockRejectedValue(new Error('the real, original failure'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('users', 'authId-004', {
      name: 'x', email: 'x@neozy.in', companyId: 'company-demo-neozy',
    })).rejects.toThrow('the real, original failure');
  });

  it('if the compensating delete itself fails, the ORIGINAL write failure is still what the caller sees (not masked)', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-004' }, created: true, matched: false });
    mockUpdateDocById.mockRejectedValue(new Error('the real, original failure'));
    mockHardDelete.mockRejectedValueOnce(new Error('compensation also failed'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('users', 'authId-005', {
      name: 'x', email: 'x@neozy.in', companyId: 'company-demo-neozy',
    })).rejects.toThrow('the real, original failure');
  });

  it('entityJustCreated never leaks into the actual persisted document payload', async () => {
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-005' }, created: true, matched: false });
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('users', 'authId-006', {
      name: 'Clean Payload', email: 'clean@neozy.in', companyId: 'company-demo-neozy',
    });

    const writtenPayload = mockUpdateDocById.mock.calls[0][2];
    expect('entityJustCreated' in writtenPayload).toBe(false);
  });

  it('entityJustCreated never leaks into a batchCreate payload either', async () => {
    mockCreateOrResolveUserByPhone.mockResolvedValue({ id: 'MUSR-company-demo-neozy-9876543210', created: true });
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-006' }, created: true, matched: false });
    const { batchCreateProjectionsWithUserId } = await import('../entityProjection');

    await batchCreateProjectionsWithUserId('leads', [
      { id: 'LEAD-001', name: 'A Lead', phone: '9876543213', companyId: 'company-demo-neozy' },
    ]);

    const batchedItems = mockBatchCreate.mock.calls[0][1];
    expect('entityJustCreated' in batchedItems[0]).toBe(false);
    expect('__masterIdentityId' in batchedItems[0]).toBe(false);
    expect('__masterIdentityCreated' in batchedItems[0]).toBe(false);
  });
});

// TXN-002 (forensic audit — non-atomic Lead creation): the master-identity
// users/MUSR-* doc created by W1 is now ALSO compensated on any downstream
// failure — closing the "permission error + orphan users record + Lead
// missing" contradiction. Mirrors the entity-compensation contract above.
describe('createProjectionWithUserId — TXN-002 orphan master-identity compensation (Lead path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOne.mockResolvedValue({ id: 'PLD-1', name: 'x', entityId: 'ENT-1' });
    mockUpdateDocById.mockResolvedValue(undefined);
    mockCreateDocWithId.mockResolvedValue(undefined);
  });

  const newLead = () => ({ name: 'Ramesh', phone: '9876543210', companyId: 'company-demo-neozy' });

  it('a JUST-CREATED master identity is hard-deleted when the entities write then fails', async () => {
    mockCreateOrResolveUserByPhone.mockResolvedValue({ id: 'MUSR-company-demo-neozy-9876543210', created: true });
    mockCreateOrResolveEntity.mockRejectedValue(new Error('entities create denied'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('leads', 'PLD-1', newLead())).rejects.toThrow('entities create denied');
    expect(mockHardDelete).toHaveBeenCalledWith('users', 'MUSR-company-demo-neozy-9876543210');
  });

  it('a JUST-CREATED master identity AND a JUST-CREATED entity are both hard-deleted when the leads write fails', async () => {
    mockCreateOrResolveUserByPhone.mockResolvedValue({ id: 'MUSR-company-demo-neozy-9876543210', created: true });
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-NEW-9' }, created: true, matched: false });
    mockCreateDocWithId.mockRejectedValue(new Error('leads create denied'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('leads', 'PLD-1', newLead())).rejects.toThrow('leads create denied');
    expect(mockHardDelete).toHaveBeenCalledWith('entities', 'ENT-NEW-9');
    expect(mockHardDelete).toHaveBeenCalledWith('users', 'MUSR-company-demo-neozy-9876543210');
  });

  it('a RESOLVED pre-existing master identity is NEVER deleted on failure (may be shared by other records)', async () => {
    mockCreateOrResolveUserByPhone.mockResolvedValue({ id: 'MUSR-company-demo-neozy-9876543210', created: false });
    mockCreateOrResolveEntity.mockRejectedValue(new Error('entities create denied'));
    const { createProjectionWithUserId } = await import('../entityProjection');

    await expect(createProjectionWithUserId('leads', 'PLD-1', newLead())).rejects.toThrow('entities create denied');
    expect(mockHardDelete).not.toHaveBeenCalledWith('users', expect.anything());
  });

  it('on success nothing is compensated and the lead doc carries no internal __masterIdentity* fields', async () => {
    mockCreateOrResolveUserByPhone.mockResolvedValue({ id: 'MUSR-company-demo-neozy-9876543210', created: true });
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-1' }, created: true, matched: false });
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('leads', 'PLD-1', newLead());

    expect(mockHardDelete).not.toHaveBeenCalled();
    const written = mockCreateDocWithId.mock.calls[0][2];
    expect('__masterIdentityId' in written).toBe(false);
    expect('__masterIdentityCreated' in written).toBe(false);
    expect(written.userId).toBe('MUSR-company-demo-neozy-9876543210');
  });
});
