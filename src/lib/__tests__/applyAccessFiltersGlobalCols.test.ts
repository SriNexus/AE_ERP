/**
 * Phase 5.2 runtime validation — regression test for a confirmed, severe
 * permission-bootstrap bug found via genuine browser + emulated-Firestore
 * testing (RoleRoute redirected any non-'Admin'-named role to /dashboard on
 * every single first-ever session, since applyAccessFilters() applied its
 * ownership-based ('self'/'team') visibility filter to the 'roles'
 * collection itself — role documents never carry assignedToId/createdBy, so
 * every role doc (including the signed-in user's own) was silently dropped,
 * permanently emptying permissionCache.roles for any non-Admin user).
 *
 * Not Customer-Workspace-specific — applyAccessFilters() is shared by every
 * collection's getAll() call — but it directly blocked this mission's
 * required Permission Audit and was fixed at the smallest correct location:
 * globalCols (companies/roles) must be exempt from ownership filtering, not
 * just company-scoping, mirroring the existing SETTINGS exemption.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAccessFilters } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

describe('applyAccessFilters — globalCols (companies/roles) are exempt from ownership filtering', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: { id: 'user-1', name: 'Test User', email: 'user@test.erp', role: 'Sales', companyId: 'company-1' },
      roleData: null, // unresolved — the exact first-load state that triggered the bug
      teamMemberIds: [],
      activeCompanyId: 'company-1',
      isAuthenticated: true,
    });
  });

  it('does not drop a role document that has no assignedToId/createdBy, even with roleData unresolved', () => {
    const roles = [
      { id: 'ROLE-1', name: 'Sales', schemaVersion: 1, permissions: { customers: { view: true } } },
    ];
    expect(applyAccessFilters(COLLECTIONS.ROLES, roles as any)).toHaveLength(1);
  });

  it('does not drop a company document with no assignedToId/createdBy', () => {
    const companies = [{ id: 'COMP-1', name: 'Test Co' }];
    expect(applyAccessFilters(COLLECTIONS.COMPANIES, companies as any)).toHaveLength(1);
  });

  it('still applies ownership filtering to a real per-user-owned collection (regression safety — the fix must not become a blanket bypass)', () => {
    const customers = [
      { id: 'C-1', companyId: 'company-1', assignedToId: 'someone-else' },
      { id: 'C-2', companyId: 'company-1', assignedToId: 'user-1' },
    ];
    const result = applyAccessFilters(COLLECTIONS.CUSTOMERS, customers as any);
    expect(result.map((c: any) => c.id)).toEqual(['C-2']);
  });

  it('still excludes soft-deleted role/company documents', () => {
    const roles = [{ id: 'ROLE-1', name: 'Sales', isDeleted: true }];
    expect(applyAccessFilters(COLLECTIONS.ROLES, roles as any)).toHaveLength(0);
  });
});
