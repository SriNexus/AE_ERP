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
}));

vi.mock('../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  genId: mocks.genId,
}));

vi.mock('../../lib/userIdentity', () => ({
  resolveOrCreateMasterUser: mocks.resolveOrCreateMasterUser,
}));

vi.mock('../../lib/firebase', () => ({
  COLLECTIONS: { EMPLOYEES: 'employees', USERS: 'users' },
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
