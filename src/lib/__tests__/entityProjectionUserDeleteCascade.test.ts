/**
 * Regression tests for the "deleting a User leaves its linked HR/Employee
 * record behind as an orphan" bug (live-reported, 2026-08-23).
 *
 * Root cause: every login-capable User created via Users.tsx gets a linked
 * HR/Employee record stamped onto users/{id}.employeeId (see
 * EmployeeDomainService.linkOrCreateForUser, called from Users.tsx's create
 * flow). deleteProjectionWithEntity() (the shared delete path both
 * useUsers.ts's deleteUserProjection() and useEmployees.ts's
 * useDeleteEmployee() route through) already cascaded to the generic
 * cross-module `entityId` link on delete, but never looked at `employeeId` —
 * so deleting a User from Settings > Users left its Employee record fully
 * intact and Active in the HR module, with no corresponding login.
 *
 * Fix: deleteProjectionWithEntity() now also soft-deletes the linked
 * Employee record (via the same deleteDocById -> isDeleted:true path every
 * other record in this app is retired through — never a hard delete) when
 * deleting a USERS document that carries an employeeId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateOrResolveUserByPhone = vi.fn();
const mockGetProjectionRole = vi.fn((...args: any[]) => {
  const col = args[0] as string;
  return {
    collection: col,
    role: col === 'users' ? 'User' : col === 'employees' ? 'Employee' : 'Customer',
    ownerField: 'userId',
  };
});
vi.mock('../userIdentity', () => ({
  createOrResolveUserByPhone: (...args: any[]) => mockCreateOrResolveUserByPhone(...args),
  getProjectionRole: (...args: any[]) => mockGetProjectionRole(...args),
}));

const mockSoftDeleteEntity = vi.fn().mockResolvedValue(undefined);
vi.mock('../entities', () => ({
  createOrResolveEntity: vi.fn(),
  addEntityRole: vi.fn(),
  updateEntity: vi.fn(),
  softDeleteEntity: (...args: any[]) => mockSoftDeleteEntity(...args),
}));

vi.mock('../entityMappers', () => ({
  mapLeadToEntity: (input: any) => input,
  mapCustomerToEntity: (input: any) => input,
  mapEmployeeToEntity: (input: any) => input,
  mapUserToEntity: (input: any) => input,
}));

const mockGetOne = vi.fn();
const mockDeleteDocById = vi.fn().mockResolvedValue(undefined);
vi.mock('../firestore', () => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: (...args: any[]) => mockGetOne(...args),
  batchCreate: vi.fn(),
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

describe('deleteProjectionWithEntity — User -> Employee delete cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleting a User with a linked employeeId also soft-deletes that Employee record', async () => {
    const { deleteProjectionWithEntity } = await import('../entityProjection');
    mockGetOne.mockResolvedValueOnce({ id: 'authId-001', name: 'NITESH', employeeId: 'EMP-001', entityId: 'ENT-001' });

    await deleteProjectionWithEntity('users', 'authId-001');

    expect(mockDeleteDocById).toHaveBeenCalledWith('users', 'authId-001');
    expect(mockDeleteDocById).toHaveBeenCalledWith('employees', 'EMP-001');
    expect(mockSoftDeleteEntity).toHaveBeenCalledWith('ENT-001', 'admin-001');
  });

  it('deleting a User with no employeeId does not touch the employees collection', async () => {
    const { deleteProjectionWithEntity } = await import('../entityProjection');
    mockGetOne.mockResolvedValueOnce({ id: 'authId-002', name: 'No Employee Link' });

    await deleteProjectionWithEntity('users', 'authId-002');

    expect(mockDeleteDocById).toHaveBeenCalledWith('users', 'authId-002');
    expect(mockDeleteDocById).not.toHaveBeenCalledWith('employees', expect.anything());
  });

  it('deleting an Employee directly (not via a User) is unaffected — no employeeId cascade applies', async () => {
    const { deleteProjectionWithEntity } = await import('../entityProjection');
    mockGetOne.mockResolvedValueOnce({ id: 'EMP-002', name: 'Direct Employee Delete', entityId: 'ENT-002' });

    await deleteProjectionWithEntity('employees', 'EMP-002');

    expect(mockDeleteDocById).toHaveBeenCalledTimes(1);
    expect(mockDeleteDocById).toHaveBeenCalledWith('employees', 'EMP-002');
    expect(mockSoftDeleteEntity).toHaveBeenCalledWith('ENT-002', 'admin-001');
  });
});
