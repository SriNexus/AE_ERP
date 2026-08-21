/**
 * Regression tests for the "one user creation action creates two users" bug.
 *
 * Root cause: entityProjection.ts's createProjectionWithUserId() called
 * attachUserId() (userIdentity.ts's phone-based master-identity resolution)
 * unconditionally for every projection collection, including USERS. For a
 * brand-new phone number, that resolution unconditionally creates a NEW
 * users/MUSR-{companyId}-{phone} document, seeded with the same
 * name/email/role/status as the real user — a second, phantom row in the
 * SAME `users` collection that Users.tsx's unfiltered
 * getAll(COLLECTIONS.USERS) list query renders identically to a real user.
 *
 * That resolved userId was never even used for USERS: it is unconditionally
 * stripped by projectionUpdateWithoutIdentityOverwrite()'s blocklist before
 * the real users/{authId} document is written. So the phone-resolution step
 * had no benefit for Users and only the harmful duplicate-creation side
 * effect.
 *
 * Fix: createProjectionWithUserId() skips attachUserId() (and therefore
 * createOrResolveUserByPhone()/resolveOrCreateMasterUser()) entirely when
 * col === COLLECTIONS.USERS. Lead/Customer/Employee are unaffected — they
 * still resolve master identity as before, since their `userId` result IS
 * persisted and used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateOrResolveUserByPhone = vi.fn();
const mockGetProjectionRole = vi.fn((...args: any[]) => {
  const col = args[0] as string;
  return {
    collection: col,
    role: col === 'users' ? 'User' : col === 'leads' ? 'Lead' : col === 'employees' ? 'Employee' : 'Customer',
    ownerField: 'userId',
  };
});
vi.mock('../userIdentity', () => ({
  createOrResolveUserByPhone: (...args: any[]) => mockCreateOrResolveUserByPhone(...args),
  getProjectionRole: (...args: any[]) => mockGetProjectionRole(...args),
}));

const mockCreateOrResolveEntity = vi.fn().mockResolvedValue({ entity: { id: 'ENT-001' }, matched: false });
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

const mockCreateDocWithId = vi.fn().mockResolvedValue(undefined);
const mockUpdateDocById = vi.fn().mockResolvedValue(undefined);
const mockGetOne = vi.fn().mockResolvedValue({ id: 'authId-001', name: 'NITESH' });
const mockBatchCreate = vi.fn().mockResolvedValue(undefined);
const mockDeleteDocById = vi.fn().mockResolvedValue(undefined);
vi.mock('../firestore', () => ({
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  updateDocById: (...args: any[]) => mockUpdateDocById(...args),
  getOne: (...args: any[]) => mockGetOne(...args),
  batchCreate: (...args: any[]) => mockBatchCreate(...args),
  deleteDocById: (...args: any[]) => mockDeleteDocById(...args),
  resolveWriteCompanyId: vi.fn(() => 'company-demo-neozy'),
  resolveWriteGroupId: vi.fn(() => ''),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { LEADS: 'leads', CUSTOMERS: 'customers', EMPLOYEES: 'employees', USERS: 'users' },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: { id: 'admin-001' } })) },
}));

describe('createProjectionWithUserId — duplicate-user regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrResolveUserByPhone.mockResolvedValue('MUSR-company-demo-neozy-9876543210');
    mockCreateOrResolveEntity.mockResolvedValue({ entity: { id: 'ENT-001' }, matched: false });
    mockGetOne.mockResolvedValue({ id: 'authId-001', name: 'NITESH' });
  });

  it('does NOT resolve/create a phone-based master identity for the USERS collection (no duplicate document)', async () => {
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('users', 'authId-001', {
      name: 'NITESH', email: 'nitesh@neozy.in', phone: '9876543210', role: 'Sales Executive', status: 'Active',
    });

    // The phone-based master-identity resolver (which creates the phantom
    // MUSR-{companyId}-{phone} document as a side effect) must never be
    // invoked for a User creation — that is the entire fix.
    expect(mockCreateOrResolveUserByPhone).not.toHaveBeenCalled();

    // Exactly one write touches the users collection: the real users/{authId}
    // document (via updateDocById's merge-create), not a second document.
    expect(mockUpdateDocById).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocById.mock.calls[0][0]).toBe('users');
    expect(mockUpdateDocById.mock.calls[0][1]).toBe('authId-001');
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('still resolves master identity for Lead/Customer/Employee projections (unaffected by the fix)', async () => {
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('leads', 'LEAD-001', { name: 'A Lead', phone: '9876543211', companyId: 'company-demo-neozy' });
    expect(mockCreateOrResolveUserByPhone).toHaveBeenCalledTimes(1);

    mockCreateOrResolveUserByPhone.mockClear();
    await createProjectionWithUserId('employees', 'EMP-001', { name: 'An Employee', phone: '9876543212', companyId: 'company-demo-neozy' });
    expect(mockCreateOrResolveUserByPhone).toHaveBeenCalledTimes(1);
  });

  it('the userId field attached to a USERS payload is never populated (nothing to strip — it is simply never computed)', async () => {
    const { createProjectionWithUserId } = await import('../entityProjection');

    await createProjectionWithUserId('users', 'authId-002', { name: 'Second User', email: 'second@neozy.in', phone: '9876543213' });

    const writtenPayload = mockUpdateDocById.mock.calls[0][2];
    expect(writtenPayload.userId).toBeUndefined();
  });
});
