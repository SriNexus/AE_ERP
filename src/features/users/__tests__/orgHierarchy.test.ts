/**
 * orgHierarchy.test.ts — data-driven organization-hierarchy business rules.
 *
 * Guards the ERP's section/manager model (no universal "Manager" that owns
 * everything): a user's department comes from their role document; a valid
 * reporting manager must be a manager-role holder in the SAME department,
 * the cross-section 'Management' layer, or a super-admin. Same-department
 * non-managers and cross-department managers are both invalid.
 *
 * Pure-logic unit tests (no Firebase). Firestore rules enforce the same
 * relationship server-side (scripts/uat-rules-tests.cjs H5-H8 probes).
 */
import { describe, it, expect } from 'vitest';
import {
  MANAGEMENT_DEPARTMENT,
  departmentForUser,
  isManagerForUser,
  isEligibleManagerOption,
  managerEligibilityError,
  resolveUserDepartment,
  roleDepartment,
} from '../orgHierarchy';
import type { OrgRoleLike, OrgUserLike } from '../orgHierarchy';

const salesRole: OrgRoleLike = { name: 'Sales Manager', department: 'Sales', isManager: true };
const salesExecRole: OrgRoleLike = { name: 'Sales Executive', department: 'Sales', isManager: false };
const whRole: OrgRoleLike = { name: 'Warehouse Manager', department: 'Warehouse', isManager: true };
const mgmtRole: OrgRoleLike = { name: 'Director', department: MANAGEMENT_DEPARTMENT, isManager: true };

function user(over: Partial<OrgUserLike> & { id: string }): OrgUserLike {
  return { name: over.name || over.id, role: over.role || '', department: over.department, isManager: over.isManager, isSuperAdmin: over.isSuperAdmin, status: over.status || 'Active', ...over };
}

describe('roleDepartment / departmentForUser / isManagerForUser', () => {
  it('derives the department and manager flag from the role document', () => {
    expect(roleDepartment(salesRole)).toBe('Sales');
    expect(departmentForUser(salesRole, 'fallback')).toBe('Sales');
    expect(departmentForUser(null, 'fallback')).toBe('fallback');
    expect(isManagerForUser(salesRole)).toBe(true);
    expect(isManagerForUser(salesExecRole)).toBe(false);
  });
});

describe('resolveUserDepartment', () => {
  it('prefers the denormalized doc field, then the role document', () => {
    const u = user({ id: 'u1', role: 'Sales Manager' });
    expect(resolveUserDepartment(u, salesRole)).toBe('Sales');
    const uWithDept = user({ id: 'u2', role: 'Sales Manager', department: 'Direct Sales' });
    expect(resolveUserDepartment(uWithDept, salesRole)).toBe('Direct Sales');
  });
});

describe('managerEligibilityError — manager↔department coherence', () => {
  it('accepts a same-department manager-role holder', () => {
    const mgr = user({ id: 'm1', role: 'Sales Manager', isManager: true, department: 'Sales' });
    expect(managerEligibilityError('Sales', mgr, salesRole)).toBeNull();
  });

  it('rejects a same-department NON-manager', () => {
    const exec = user({ id: 'm2', role: 'Sales Executive', isManager: false, department: 'Sales' });
    expect(managerEligibilityError('Sales', exec, salesExecRole)).toMatch(/manager role in Sales/);
  });

  it('rejects a cross-department manager (Warehouse manager for a Sales report)', () => {
    const whMgr = user({ id: 'm3', role: 'Warehouse Manager', isManager: true, department: 'Warehouse' });
    expect(managerEligibilityError('Sales', whMgr, whRole)).toMatch(/Warehouse/);
    expect(managerEligibilityError('Sales', whMgr, whRole)).toMatch(/not Sales/);
  });

  it('accepts the cross-section Management layer', () => {
    const director = user({ id: 'm4', role: 'Director', isManager: true, department: MANAGEMENT_DEPARTMENT });
    expect(managerEligibilityError('Sales', director, mgmtRole)).toBeNull();
  });

  it('accepts a super-admin manager regardless of department', () => {
    const superAdmin = user({ id: 'm5', role: 'Admin', isSuperAdmin: true, department: 'Accounts' });
    expect(managerEligibilityError('Sales', superAdmin, null)).toBeNull();
  });

  it('rejects a missing manager document', () => {
    expect(managerEligibilityError('Sales', null, null)).toMatch(/was not found/);
  });

  it('accepts a manager whose users-doc flag says isManager even without a role doc', () => {
    const mgr = user({ id: 'm6', role: 'Sales Manager', isManager: true, department: 'Sales' });
    expect(managerEligibilityError('Sales', mgr, null)).toBeNull();
  });
});

describe('isEligibleManagerOption — client-side manager selector filter', () => {
  it('includes same-department managers and super-admins', () => {
    const salesMgr = user({ id: 'm1', role: 'Sales Manager', isManager: true, department: 'Sales' });
    const superAdmin = user({ id: 'm2', role: 'Admin', isSuperAdmin: true });
    expect(isEligibleManagerOption(salesMgr, 'Sales', salesRole)).toBe(true);
    expect(isEligibleManagerOption(superAdmin, 'Sales', null)).toBe(true);
  });

  it('excludes non-managers, inactive, deleted, and cross-department candidates', () => {
    const exec = user({ id: 'm3', role: 'Sales Executive', isManager: false, department: 'Sales' });
    const inactiveMgr = user({ id: 'm4', role: 'Sales Manager', isManager: true, department: 'Sales', status: 'Inactive' });
    const deletedMgr = user({ id: 'm5', role: 'Sales Manager', isManager: true, department: 'Sales', isDeleted: true });
    const whMgr = user({ id: 'm6', role: 'Warehouse Manager', isManager: true, department: 'Warehouse' });
    expect(isEligibleManagerOption(exec, 'Sales', salesExecRole)).toBe(false);
    expect(isEligibleManagerOption(inactiveMgr, 'Sales', salesRole)).toBe(false);
    expect(isEligibleManagerOption(deletedMgr, 'Sales', salesRole)).toBe(false);
    expect(isEligibleManagerOption(whMgr, 'Sales', whRole)).toBe(false);
  });

  it('includes Management-layer candidates for any section', () => {
    const director = user({ id: 'm7', role: 'Director', isManager: true, department: MANAGEMENT_DEPARTMENT });
    expect(isEligibleManagerOption(director, 'Sales', mgmtRole)).toBe(true);
    expect(isEligibleManagerOption(director, 'Warehouse', mgmtRole)).toBe(true);
  });
});
