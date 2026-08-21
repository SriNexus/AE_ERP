/**
 * EmployeeDomainService.test.ts — Phase 12 coverage.
 *
 * warehouseId/managerId are User-domain fields (Option A — link, not
 * consolidate): Employee only ever carries a userId FK. Previously
 * create()/update() had no awareness of these fields at all, so even if a
 * form supplied them there was nowhere for them to go. Fixed: both now sync
 * warehouseId/managerId onto the linked User record and explicitly exclude
 * them from the Employee document itself, avoiding a second, driftable copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  genId: { employee: vi.fn(() => 'EMP-001') },
  resolveOrCreateMasterUser: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  genId: mocks.genId,
}));

vi.mock('../../lib/userIdentity', () => ({
  resolveOrCreateMasterUser: mocks.resolveOrCreateMasterUser,
  normalizePhone: (raw: string) => String(raw || '').replace(/\D/g, '').slice(-10),
  masterUserId: (companyId: string, phone: string) => `MUSR-${companyId}-${phone}`,
}));

vi.mock('../../lib/firebase', () => ({
  COLLECTIONS: { EMPLOYEES: 'employees', USERS: 'users' },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: mocks.getDocs,
}));

import { EmployeeDomainService } from '../EmployeeDomainService';

describe('EmployeeDomainService.create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDocWithId.mockResolvedValue(undefined);
    mocks.updateDocById.mockResolvedValue(undefined);
    mocks.resolveOrCreateMasterUser.mockResolvedValue({ id: 'USR-NEW' });
  });

  it('syncs warehouseId/managerId onto the linked User and excludes them from the Employee doc', async () => {
    await EmployeeDomainService.create({
      companyId: 'comp-1', phone: '9999999999', name: 'New Hire', role: 'Sales',
      warehouseId: 'WH-1', managerId: 'USR-1',
    });

    expect(mocks.updateDocById).toHaveBeenCalledWith('users', 'USR-NEW', { warehouseId: 'WH-1', managerId: 'USR-1' });
    const employeeWrite = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'employees');
    expect(employeeWrite?.[2]).not.toHaveProperty('warehouseId');
    expect(employeeWrite?.[2]).not.toHaveProperty('managerId');
    expect(employeeWrite?.[2]).toMatchObject({ userId: 'USR-NEW', companyId: 'comp-1' });
  });

  it('does not touch the User record when no warehouseId/managerId are supplied', async () => {
    await EmployeeDomainService.create({ companyId: 'comp-1', phone: '9999999999', name: 'New Hire' });
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });
});

describe('EmployeeDomainService.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDocById.mockResolvedValue(undefined);
    mocks.getOne.mockResolvedValue({ id: 'EMP-1', userId: 'USR-EXISTING' });
  });

  it('syncs warehouseId/managerId onto the linked User and excludes them from the Employee write', async () => {
    await EmployeeDomainService.update('EMP-1', { name: 'Updated Name', warehouseId: 'WH-2', managerId: 'USR-2' });

    expect(mocks.updateDocById).toHaveBeenCalledWith('employees', 'EMP-1', { name: 'Updated Name' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('users', 'USR-EXISTING', {
      name: 'Updated Name', warehouseId: 'WH-2', managerId: 'USR-2',
    });
  });

  it('allows clearing the warehouse/manager assignment with an empty string', async () => {
    await EmployeeDomainService.update('EMP-1', { warehouseId: '', managerId: '' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('users', 'USR-EXISTING', { warehouseId: '', managerId: '' });
  });

  it('skips the User sync entirely when the employee has no linked user yet', async () => {
    mocks.getOne.mockResolvedValueOnce({ id: 'EMP-2' }); // no userId
    await EmployeeDomainService.update('EMP-2', { warehouseId: 'WH-1' });
    expect(mocks.updateDocById).toHaveBeenCalledTimes(1); // only the Employee write
    expect(mocks.updateDocById).toHaveBeenCalledWith('employees', 'EMP-2', {});
  });
});

// ═══════════════════════════════════════════════════════════════════
// linkOrCreateForUser — User → Employee provisioning regression tests
// ═══════════════════════════════════════════════════════════════════
describe('EmployeeDomainService.linkOrCreateForUser', () => {
  function snapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
    return {
      empty: docs.length === 0,
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDocWithId.mockResolvedValue(undefined);
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  it('creates a brand-new Employee, keyed to the given userId directly — never via resolveOrCreateMasterUser', async () => {
    mocks.getDocs.mockResolvedValue(snapshot([])); // no existing match, by userId or master identity

    const employeeId = await EmployeeDomainService.linkOrCreateForUser('AUTH-UID-001', {
      name: 'NITESH', phone: '9876543210', email: 'nitesh@neozy.in', role: 'Sales Executive', companyId: 'comp-1',
    });

    expect(employeeId).toBe('EMP-001');
    expect(mocks.resolveOrCreateMasterUser).not.toHaveBeenCalled();
    expect(mocks.createDocWithId).toHaveBeenCalledTimes(1);
    const [col, id, payload] = mocks.createDocWithId.mock.calls[0];
    expect(col).toBe('employees');
    expect(id).toBe('EMP-001');
    expect(payload).toMatchObject({ userId: 'AUTH-UID-001', companyId: 'comp-1', name: 'NITESH', phone: '9876543210' });
  });

  it('is idempotent — a second call for the same userId returns the already-linked Employee and creates nothing', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshot([{ id: 'EMP-EXISTING', data: { userId: 'AUTH-UID-001' } }]));

    const employeeId = await EmployeeDomainService.linkOrCreateForUser('AUTH-UID-001', {
      name: 'NITESH', phone: '9876543210', companyId: 'comp-1',
    });

    expect(employeeId).toBe('EMP-EXISTING');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('re-links a pre-existing Employee (created HR-first via create()) sharing the same phone, instead of creating a duplicate', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(snapshot([])) // not yet linked to this userId
      .mockResolvedValueOnce(snapshot([{ id: 'EMP-PREEXISTING', data: { userId: 'MUSR-comp-1-9876543210' } }])); // found via deterministic master-identity id

    const employeeId = await EmployeeDomainService.linkOrCreateForUser('AUTH-UID-002', {
      name: 'NITESH', phone: '9876543210', companyId: 'comp-1',
    });

    expect(employeeId).toBe('EMP-PREEXISTING');
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
    expect(mocks.updateDocById).toHaveBeenCalledWith('employees', 'EMP-PREEXISTING', { userId: 'AUTH-UID-002' });
  });

  it('requires companyId', async () => {
    await expect(EmployeeDomainService.linkOrCreateForUser('AUTH-UID-003', { name: 'X', companyId: '' }))
      .rejects.toThrow(/companyId is required/);
  });
});
