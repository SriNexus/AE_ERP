import { beforeEach, describe, expect, it } from 'vitest';
import { applyAccessFilters, companyScopedQuery, resolveReadCompanyId } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

// Phase 2 (Master Plan §9.4): a Group Admin in Group-view mode.
function setGroupAdminState() {
  useAppStore.setState({
    user: {
      id: 'ga-1',
      name: 'Group Admin',
      email: 'ga@test.erp',
      role: 'GroupAdmin',
      companyId: 'company-alpha',
      groupId: 'GROUP-A',
    },
    activeCompanyId: 'group',
    isAuthenticated: true,
  });
}

describe('Phase 2 — Group-view mode (\'group\' sentinel, Master Plan §9.4)', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      activeCompanyId: 'default',
      isAuthenticated: false,
      permissionCache: { ready: false, roles: {}, permissions: {} } as never,
      roleData: null,
      companyGroupIds: {},
    });
  });

  it('companyScopedQuery returns a groupId constraint in Group-view mode', () => {
    setGroupAdminState();
    const constraints = companyScopedQuery(COLLECTIONS.LEADS);
    expect(constraints).toHaveLength(1);
    // The constraint must be a groupId equality, never a companyId filter.
    expect(JSON.stringify(constraints[0])).toContain('groupId');
    expect(JSON.stringify(constraints[0])).not.toContain('companyId');
  });

  it('companies collection also resolves to the groupId constraint in Group-view mode', () => {
    setGroupAdminState();
    const constraints = companyScopedQuery(COLLECTIONS.COMPANIES);
    expect(JSON.stringify(constraints[0])).toContain('groupId');
  });

  // Phase 6 (§6): GroupTeams screen calls getAll(TEAMS) in group mode —
  // must resolve to a groupId constraint, never companyId, never unscoped.
  it('teams collection resolves to groupId constraint in Group-view mode', () => {
    setGroupAdminState();
    const constraints = companyScopedQuery(COLLECTIONS.TEAMS);
    expect(constraints).toHaveLength(1);
    expect(JSON.stringify(constraints[0])).toContain('groupId');
    expect(JSON.stringify(constraints[0])).not.toContain('companyId');
  });

  it('resolveReadCompanyId passes the \'group\' sentinel through', () => {
    setGroupAdminState();
    expect(resolveReadCompanyId()).toBe('group');
  });

  it('a GroupAdmin with no authoritative groupId fails closed (throws, never unscoped)', () => {
    useAppStore.setState({
      user: { id: 'ga-2', name: 'GA2', email: 'ga2@test.erp', role: 'GroupAdmin', companyId: 'company-alpha' },
      activeCompanyId: 'group',
      isAuthenticated: true,
    });
    expect(() => companyScopedQuery(COLLECTIONS.LEADS)).toThrow();
  });

  it('applyAccessFilters in Group-view mode filters by groupId, keeping sibling-Company docs', () => {
    setGroupAdminState();
    useAppStore.setState({
      roleData: { name: 'Admin', permissions: {} } as never,
    });
    const docs = [
      { id: 'L1', companyId: 'company-alpha', groupId: 'GROUP-A', isDeleted: false, createdBy: 'u1' },
      { id: 'L2', companyId: 'company-omega', groupId: 'GROUP-A', isDeleted: false, createdBy: 'u2' },
      { id: 'L3', companyId: 'company-beta', groupId: 'GROUP-B', isDeleted: false, createdBy: 'u3' },
    ];
    const kept = applyAccessFilters(COLLECTIONS.LEADS, docs as never);
    expect(kept.map((d) => d.id)).toEqual(['L1', 'L2']);
  });
});

describe('Phase 3 (F-07, §8.3) — warehouse-scoped query narrowing', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      activeCompanyId: 'default',
      isAuthenticated: false,
      permissionCache: { ready: false, roles: {}, permissions: {} } as never,
      roleData: null,
      companyGroupIds: {},
    });
  });

  function setWarehouseUserState() {
    useAppStore.setState({
      user: {
        id: 'wh-1',
        name: 'Warehouse User',
        email: 'wh@test.erp',
        role: 'Warehouse',
        companyId: 'company-alpha',
        warehouseId: 'WH-A1',
      },
      activeCompanyId: 'company-alpha',
      isAuthenticated: true,
      companyGroupIds: { 'company-alpha': 'GROUP-A' },
    });
  }

  it('companyScopedQuery adds the warehouseId equality for warehouse-scoped collections (stock)', () => {
    setWarehouseUserState();
    const constraints = companyScopedQuery(COLLECTIONS.STOCK);
    const joined = JSON.stringify(constraints);
    expect(joined).toContain('companyId');
    expect(joined).toContain('warehouseId');
    expect(joined).toContain('WH-A1');
  });

  it('dispatch and goods_receipts also receive the warehouseId constraint', () => {
    setWarehouseUserState();
    for (const col of [COLLECTIONS.DISPATCH, COLLECTIONS.GOODS_RECEIPTS, COLLECTIONS.STOCK_LEDGER]) {
      const joined = JSON.stringify(companyScopedQuery(col));
      expect(joined).toContain('warehouseId');
    }
  });

  it('non-warehouse-scoped collections keep only the company constraint for a Warehouse-role user', () => {
    setWarehouseUserState();
    const joined = JSON.stringify(companyScopedQuery(COLLECTIONS.LEADS));
    expect(joined).toContain('companyId');
    expect(joined).not.toContain('warehouseId');
  });

  it('non-restricted roles (Admin) get NO warehouseId constraint — company-wide scope preserved (§8.2)', () => {
    useAppStore.setState({
      user: {
        id: 'adm-1',
        name: 'Admin',
        email: 'adm@test.erp',
        role: 'Admin',
        companyId: 'company-alpha',
      },
      activeCompanyId: 'company-alpha',
      isAuthenticated: true,
      companyGroupIds: { 'company-alpha': 'GROUP-A' },
    });
    const joined = JSON.stringify(companyScopedQuery(COLLECTIONS.STOCK));
    expect(joined).toContain('companyId');
    expect(joined).not.toContain('warehouseId');
  });

  it('a warehouse-restricted user with NO warehouseId fails closed (throws, never an unscoped/broad query)', () => {
    useAppStore.setState({
      user: {
        id: 'wh-nowh',
        name: 'WH NoWH',
        email: 'whnowh@test.erp',
        role: 'Warehouse',
        companyId: 'company-alpha',
      },
      activeCompanyId: 'company-alpha',
      isAuthenticated: true,
      companyGroupIds: { 'company-alpha': 'GROUP-A' },
    });
    expect(() => companyScopedQuery(COLLECTIONS.STOCK)).toThrow();
  });

  it('applyAccessFilters drops other-warehouse docs for a warehouse-restricted user (defense-in-depth)', () => {
    setWarehouseUserState();
    // Real Warehouse role seed: stock module with company-wide visibility
    // (roleBootstrap.ts createModulePermissions defaults to 'all'), so the
    // ownership filter cannot mask the warehouse scoping under test.
    useAppStore.setState({
      roleData: {
        name: 'Warehouse',
        permissions: {
          stock: { view: true, create: true, edit: true, visibility: 'all' },
        },
      } as never,
    });
    const docs = [
      { id: 'STK-A1', companyId: 'company-alpha', warehouseId: 'WH-A1', isDeleted: false, createdBy: 'u1' },
      { id: 'STK-A2', companyId: 'company-alpha', warehouseId: 'WH-A2', isDeleted: false, createdBy: 'u2' },
      { id: 'STK-B1', companyId: 'company-beta', warehouseId: 'WH-B1', isDeleted: false, createdBy: 'u3' },
    ];
    const kept = applyAccessFilters(COLLECTIONS.STOCK, docs as never);
    expect(kept.map((d) => d.id)).toEqual(['STK-A1']);
  });
});

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

  // F-01 (Phase 0): companies read is now company-scoped for ordinary users
  // (firestore.rules + this query). The pre-fix contract asserted "no
  // constraints" because companies was a global collection — that open read
  // was the audit's CRITICAL cross-tenant disclosure (F-01). A non-owner
  // Admin now gets a companyId filter so list queries stay provable.
  it('adds a tenant constraint to the companies collection for non-owner users', () => {
    const constraints = companyScopedQuery(COLLECTIONS.COMPANIES);
    expect(constraints).toHaveLength(1);
  });

  it('still adds tenant constraints to business collections like leads', () => {
    expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.CUSTOMERS)).toHaveLength(1);
    expect(companyScopedQuery(COLLECTIONS.ORDERS)).toHaveLength(1);
  });

  // F-03 closure (Phase 1): roles is now company-scoped — role documents are
  // per-company keyed (`${companyId}_${roleName}`) with companyId stamped, so
  // the permission bootstrap resolves the user's role against THEIR company's
  // role documents (Master Plan §5.6). The Phase 0 "global, no constraints"
  // contract was the F-03 blocker, resolved by the Phase 1 data model.
  it('company-scopes the roles collection for ordinary users (F-03 closure)', () => {
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(1);
  });

  // F-01 (Phase 0): a standard Admin (not owner, not super-admin) IS now
  // company-scoped on the companies collection — this is the intended fix,
  // not a regression. The prior unscoped read leaked every tenant's legal
  // name, GST/PAN/CIN and bank details to any Admin of any company.
  it('restricts companies to own company for non-owner/non-super-admin users', () => {
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
    expect(constraints).toHaveLength(1);
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

  // F-03 closure (Phase 1): the owner/super-admin exemption applies to roles
  // exactly like companies — the platform tier keeps the unscoped read.
  it('returns no constraints for roles (owner sees all)', () => {
    expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(0);
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
