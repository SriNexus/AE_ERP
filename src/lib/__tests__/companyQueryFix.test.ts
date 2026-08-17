import { beforeEach, describe, expect, it } from 'vitest';
import { companyScopedQuery } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

describe('Company query fix — newly created companies appear in UI', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: {
        id: 'test-admin',
        name: 'Test Admin',
        email: 'admin@test.erp',
        role: 'Admin',
        companyId: 'company-alpha',
      },
      activeCompanyId: 'company-alpha',
      isAuthenticated: true,
    });
  });

  it('returns no Firestore constraints for the companies collection', () => {
    const constraints = companyScopedQuery(COLLECTIONS.COMPANIES);
    expect(constraints).toHaveLength(0);
  });

  it('still adds tenant constraints to business collections like leads', () => {
    expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.CUSTOMERS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.ORDERS)).toHaveLength(1);
  });

  it('keeps roles collection global with no constraints', () => {
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(0);
  });

  it('does not restrict companies for non-owner/non-super-admin users', () => {
    // Explicitly verify that a standard Admin user (not owner, not super-admin)
    // gets no constraints on the companies collection
    useAppStore.setState({
      user: {
        id: 'regular-admin',
        name: 'Regular Admin',
        email: 'regular@test.erp',
        role: 'Admin',
        companyId: 'company-beta',
      },
      activeCompanyId: 'company-beta',
    });

    const constraints = companyScopedQuery(COLLECTIONS.COMPANIES);
    expect(constraints).toHaveLength(0);
  });

  it('applies tenant constraint for settings collection', () => {
    expect(companyScopedQuery(COLLECTIONS.SETTINGS)).toHaveLength(1);
  });

  it('applies tenant constraint for warehouses collection', () => {
    expect(companyScopedQuery(COLLECTIONS.WAREHOUSES)).toHaveLength(1);
  });
});

describe('Owner / super-admin company visibility', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: {
        id: 'owner-uid',
        name: 'ERP Owner',
        email: 'shreeniwas.tripathi0@gmail.com',
        role: 'Owner',
        companyId: 'company-owner',
        isOwner: true,
        isSuperAdmin: true,
      },
      activeCompanyId: 'company-owner',
      isAuthenticated: true,
    });
  });

  it('returns no constraints for companies (owner sees all)', () => {
    expect(companyScopedQuery(COLLECTIONS.COMPANIES)).toHaveLength(0);
  });

  it('returns no constraints for companies (super-admin sees all)', () => {
    useAppStore.setState({
      user: {
        id: 'super-admin-uid',
        name: 'Super Admin',
        email: 'super@test.erp',
        role: 'Admin',
        companyId: 'company-gamma',
        isSuperAdmin: true,
      },
      activeCompanyId: 'company-gamma',
    });

    expect(companyScopedQuery(COLLECTIONS.COMPANIES)).toHaveLength(0);
  });
});

describe('Company create → appear lifecycle', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: {
        id: 'admin-user',
        name: 'Admin User',
        email: 'admin@test.erp',
        role: 'Admin',
        companyId: 'company-current',
      },
      activeCompanyId: 'company-current',
      isAuthenticated: true,
    });
  });

  it('getAll for companies does not filter by documentId', async () => {
    // Validate that companyScopedQuery produces the correct constraints
    // that getAll will use. Since companies is global, no documentId
    // filter should be applied, allowing ALL companies to be returned.
    const constraints = companyScopedQuery(COLLECTIONS.COMPANIES);
    const hasDocumentIdFilter = constraints.some((c: any) => {
      const str = String(c);
      return str.includes('documentId') || str.includes('__name__');
    });
    expect(hasDocumentIdFilter).toBe(false);
  });
});
