/**
 * Phase 11 (OWNERSHIP-001, Master Plan "Record Ownership / Business
 * Authorization Audit") — createdBy/updatedBy must always be the
 * authoritative, actually-signed-in actor, never a caller-supplied value.
 *
 * Root cause: entityProjection.ts's systemUserId() previously trusted
 * `payload.createdBy`/`payload.updatedBy` FIRST — since this is client-side
 * (browser) code reachable directly (not just through the UI form), any
 * authenticated user could forge who a create/update is attributed to,
 * corrupting the audit trail every logCreate()/logUpdate() and "created/
 * updated by" display relies on. Unlike companyId (which Firestore rules
 * independently re-validate via sameCompany()), nothing server-side
 * re-checks createdBy/updatedBy — this is a real, exploitable gap, not a
 * latent one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateOrResolveUserByPhone = vi.fn().mockResolvedValue({ id: 'MUSR-identity-1', created: false });
const mockGetProjectionRole = vi.fn((...args: any[]) => {
  const col = args[0] as string;
  return { collection: col, role: col === 'users' ? 'User' : 'Lead', ownerField: 'userId' };
});
vi.mock('../userIdentity', () => ({
  createOrResolveUserByPhone: (...args: any[]) => mockCreateOrResolveUserByPhone(...args),
  getProjectionRole: (...args: any[]) => mockGetProjectionRole(...args),
}));

const mockCreateOrResolveEntity = vi.fn().mockResolvedValue({ entity: { id: 'ENT-001' }, created: true, matched: false });
const mockAddEntityRole = vi.fn().mockResolvedValue(undefined);
const mockUpdateEntity = vi.fn().mockResolvedValue(undefined);
vi.mock('../entities', () => ({
  createOrResolveEntity: (...args: any[]) => mockCreateOrResolveEntity(...args),
  addEntityRole: (...args: any[]) => mockAddEntityRole(...args),
  updateEntity: (...args: any[]) => mockUpdateEntity(...args),
  softDeleteEntity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../entityMappers', () => ({
  mapLeadToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Lead', displayName: input.name }),
  mapCustomerToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Customer', displayName: input.name }),
  mapEmployeeToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'Employee', displayName: input.name }),
  mapUserToEntity: (input: any) => ({ companyId: input.companyId, primaryRole: 'User', displayName: input.name }),
}));

const mockCreateDocWithId = vi.fn().mockResolvedValue(undefined);
const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn().mockResolvedValue({ id: 'doc-1', name: 'x', entityId: 'ENT-001' });
vi.mock('../firestore', () => ({
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  getOne: (...args: any[]) => mockGetOne(...args),
  batchCreate: vi.fn().mockResolvedValue(undefined),
  deleteDocById: vi.fn().mockResolvedValue(undefined),
  hardDelete: vi.fn().mockResolvedValue(undefined),
  resolveWriteCompanyId: vi.fn(() => 'company-real-session'),
  resolveWriteGroupId: vi.fn(() => ''),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { LEADS: 'leads', CUSTOMERS: 'customers', EMPLOYEES: 'employees', USERS: 'users', ENTITIES: 'entities' },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'REAL-SIGNED-IN-USER' } })) },
}));

describe('entityProjection — createdBy/updatedBy cannot be forged (Phase 11, OWNERSHIP-001)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('createProjectionWithUserId ignores a forged createdBy/updatedBy in the payload — always stamps the real signed-in actor', async () => {
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('leads', 'LEAD-001', {
      name: 'Forged Lead', companyId: 'company-real-session',
      createdBy: 'FORGED-VICTIM-USER', updatedBy: 'ANOTHER-FORGED-USER',
    });

    const written = mockCreateDocWithId.mock.calls[0][2];
    expect(written.createdBy).toBe('REAL-SIGNED-IN-USER');
    expect(written.updatedBy).toBe('REAL-SIGNED-IN-USER');
    expect(written.createdBy).not.toBe('FORGED-VICTIM-USER');
  });

  it('createProjectionWithUserId for USERS also ignores a forged updatedBy (createdBy is intentionally never persisted on this path — projectionUpdateWithoutIdentityOverwrite\'s own blocklist)', async () => {
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('users', 'authId-001', {
      name: 'Forged User', email: 'x@test.erp', companyId: 'company-real-session',
      createdBy: 'FORGED-VICTIM-USER', updatedBy: 'FORGED-VICTIM-USER',
    });

    const written = mockUpdateDocById.mock.calls[0][2];
    expect(written.updatedBy).toBe('REAL-SIGNED-IN-USER');
    expect(written.updatedBy).not.toBe('FORGED-VICTIM-USER');
  });

  it('updateProjectionWithEntity ignores a forged updatedBy in the payload — always stamps the real signed-in actor', async () => {
    const { updateProjectionWithEntity } = await import('../entityProjection');

    await updateProjectionWithEntity('leads', 'LEAD-001', {
      name: 'Renamed Lead', updatedBy: 'FORGED-VICTIM-USER',
    });

    const written = mockUpdateDocById.mock.calls[0][2];
    expect(written.updatedBy).toBe('REAL-SIGNED-IN-USER');
    expect(written.updatedBy).not.toBe('FORGED-VICTIM-USER');
  });
});
