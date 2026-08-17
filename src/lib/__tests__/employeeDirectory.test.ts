/**
 * employeeDirectory.test.ts — Phase 12 coverage.
 *
 * Employee.userId already links to a real AppUser (built by
 * EmployeeDomainService.create()); warehouseId/managerId live on that User.
 * These helpers make "which warehouse does this employee work at", "who is
 * their reporting manager", and "warehouse-wise employee count" real,
 * query-backed capabilities for the first time.
 */
import { describe, expect, it } from 'vitest';
import {
  buildUserMap,
  buildWarehouseMap,
  resolveEmployeeWarehouseInfo,
  getWarehouseEmployeeCounts,
  getDirectReportEmployeeIds,
} from '../employeeDirectory';

const users = [
  { id: 'USR-1', name: 'Top Manager', warehouseId: '', managerId: '' },
  { id: 'USR-2', name: 'Mid Manager', warehouseId: 'WH-1', managerId: 'USR-1' },
  { id: 'USR-3', name: 'Field Employee', warehouseId: 'WH-1', managerId: 'USR-2' },
  { id: 'USR-4', name: 'Other Warehouse Employee', warehouseId: 'WH-2', managerId: 'USR-2' },
];
const warehouses = [
  { id: 'WH-1', name: 'Central Warehouse' },
  { id: 'WH-2', name: 'West Depot' },
];
const employees = [
  { id: 'EMP-1', userId: 'USR-2' },
  { id: 'EMP-2', userId: 'USR-3' },
  { id: 'EMP-3', userId: 'USR-4' },
  { id: 'EMP-4', userId: '' }, // no linked user yet
  { id: 'EMP-5', userId: 'USR-3', isDeleted: true }, // soft-deleted, excluded
];

describe('resolveEmployeeWarehouseInfo', () => {
  const usersById = buildUserMap(users);
  const warehousesById = buildWarehouseMap(warehouses);

  it('resolves warehouse and manager names via the Employee.userId link', () => {
    const info = resolveEmployeeWarehouseInfo(employees[1], usersById, warehousesById); // EMP-2 -> USR-3
    expect(info).toEqual({ warehouseId: 'WH-1', warehouseName: 'Central Warehouse', managerId: 'USR-2', managerName: 'Mid Manager' });
  });

  it('returns empty info for an employee with no linked user yet', () => {
    const info = resolveEmployeeWarehouseInfo(employees[3], usersById, warehousesById);
    expect(info).toEqual({ warehouseId: '', warehouseName: '', managerId: '', managerName: '' });
  });

  it('returns empty info for a null/undefined employee', () => {
    expect(resolveEmployeeWarehouseInfo(null, usersById, warehousesById).warehouseId).toBe('');
    expect(resolveEmployeeWarehouseInfo(undefined, usersById, warehousesById).warehouseId).toBe('');
  });

  it('resolves a manager who has no manager of their own (top of chain)', () => {
    const info = resolveEmployeeWarehouseInfo(employees[0], usersById, warehousesById); // EMP-1 -> USR-2
    expect(info.managerId).toBe('USR-1');
    expect(info.managerName).toBe('Top Manager');
  });
});

describe('getWarehouseEmployeeCounts', () => {
  it('produces real, uneven counts per warehouse, excluding soft-deleted and unlinked employees', () => {
    const usersById = buildUserMap(users);
    const counts = getWarehouseEmployeeCounts(employees, usersById);
    expect(counts.get('WH-1')).toBe(2); // EMP-1 (USR-2), EMP-2 (USR-3) — EMP-5 excluded (deleted)
    expect(counts.get('WH-2')).toBe(1); // EMP-3 (USR-4)
    expect(counts.size).toBe(2);
  });
});

describe('getDirectReportEmployeeIds', () => {
  it('finds every Employee whose linked User reports to the given manager', () => {
    const usersById = buildUserMap(users);
    const reports = getDirectReportEmployeeIds('USR-2', employees, usersById);
    expect(reports.sort()).toEqual(['EMP-2', 'EMP-3']);
  });

  it('excludes soft-deleted employees from the team', () => {
    const usersById = buildUserMap(users);
    // USR-3 manages nobody in this fixture except via EMP-5, which is deleted
    const reports = getDirectReportEmployeeIds('USR-3', employees, usersById);
    expect(reports).toEqual([]);
  });

  it('returns an empty array for an empty managerId', () => {
    const usersById = buildUserMap(users);
    expect(getDirectReportEmployeeIds('', employees, usersById)).toEqual([]);
  });
});
