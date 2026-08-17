import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { canDo } from '../permissions';
import { buildRoleCache, getMissingSystemRoleSeeds, getSystemRoleSeedDocuments } from '../roleBootstrap';

function resetStore() {
  useAppStore.setState({
    user: null,
    roleData: null,
    teamMemberIds: [],
    permissionCache: { ready: false, roles: {}, diagnostics: [] },
  });
}

describe('role bootstrap and permission compatibility', () => {
  beforeEach(() => {
    resetStore();
  });

  it('seeds the new field roles with explicit permission maps', () => {
    const seeds = getSystemRoleSeedDocuments();
    const names = seeds.map((role) => role.name);

    expect(names).toEqual(expect.arrayContaining([
      'Surveyor',
      'Engineer',
      'InstallationLead',
      'ServiceTechnician',
      'ComplianceOfficer',
      'Procurement',
    ]));

    expect(seeds.find((role) => role.name === 'Surveyor')?.permissions.surveys?.view).toBe(true);
    expect(seeds.find((role) => role.name === 'Surveyor')?.permissions.projects?.view).toBe(true);
    expect(seeds.find((role) => role.name === 'Surveyor')?.permissions.projects?.visibility).toBe('self');
    expect(seeds.find((role) => role.name === 'Engineer')?.permissions.engineering?.approve).toBe(true);
    expect(seeds.find((role) => role.name === 'InstallationLead')?.permissions.qc?.create).toBe(true);
    expect(seeds.find((role) => role.name === 'ServiceTechnician')?.permissions.service_tickets?.edit).toBe(true);
    expect(seeds.find((role) => role.name === 'ComplianceOfficer')?.permissions.net_metering?.edit).toBe(true);
    expect(seeds.find((role) => role.name === 'Procurement')?.permissions.vendors?.delete).toBe(true);
    expect(seeds.find((role) => role.name === 'Procurement')?.permissions.purchase_orders?.approve).toBe(true);
    expect(seeds.find((role) => role.name === 'Procurement')?.permissions.stock?.create).toBe(true);
  });

  it('resolves new roles directly from the cached Firestore documents', () => {
    const seeds = getSystemRoleSeedDocuments();
    useAppStore.setState({
      user: { id: 'user-1', name: 'Surveyor User', email: 'surveyor@example.com', role: 'Surveyor', companyId: 'company-1' },
      permissionCache: {
        ready: true,
        roles: buildRoleCache(seeds),
        loadedAt: new Date().toISOString(),
        diagnostics: [],
      },
    });

    expect(canDo('view', 'surveys')).toBe(true);
    expect(canDo('create', 'surveys')).toBe(true);
    expect(canDo('view', 'projects')).toBe(true);
    expect(canDo('edit', 'orders')).toBe(false);
  });

  it('keeps legacy aliases working while new roles are added', () => {
    const seeds = getSystemRoleSeedDocuments();
    useAppStore.setState({
      user: { id: 'user-2', name: 'Manager User', email: 'manager@example.com', role: 'Management', companyId: 'company-1' },
      permissionCache: {
        ready: true,
        roles: buildRoleCache(seeds),
        loadedAt: new Date().toISOString(),
        diagnostics: [],
      },
    });

    expect(canDo('view', 'dashboard')).toBe(true);
    expect(canDo('create', 'leads')).toBe(true);
    expect(canDo('edit', 'orders')).toBe(true);
  });

  it('Phase 9: Warehouse (the role that physically verifies/loads a dispatch) can view Dispatch but never its pricing; Accounts/Sales/Director/Manager/Operations can', () => {
    const seeds = getSystemRoleSeedDocuments();
    expect(seeds.find((role) => role.name === 'Warehouse')?.permissions.dispatch?.view).toBe(true);
    expect(seeds.find((role) => role.name === 'Warehouse')?.permissions.dispatch?.view_pricing).toBe(false);
    for (const roleName of ['Accounts', 'Sales', 'Director', 'Manager', 'Operations']) {
      expect(seeds.find((role) => role.name === roleName)?.permissions.dispatch?.view_pricing).toBe(true);
    }

    useAppStore.setState({
      user: { id: 'user-3', name: 'Warehouse User', email: 'warehouse@example.com', role: 'Warehouse', companyId: 'company-1' },
      permissionCache: { ready: true, roles: buildRoleCache(seeds), loadedAt: new Date().toISOString(), diagnostics: [] },
    });
    expect(canDo('view', 'dispatch')).toBe(true);
    expect(canDo('view_pricing', 'dispatch')).toBe(false);
  });

  it('Phase 16: Loan Applications and Banks — real modules with real pages — are no longer Admin-only by omission; Director/Sales/Accounts/Manager each get the same tier they already hold for the adjacent customer-lifecycle modules', () => {
    const seeds = getSystemRoleSeedDocuments();
    expect(seeds.find((role) => role.name === 'Director')?.permissions.loan_applications?.view).toBe(true);
    expect(seeds.find((role) => role.name === 'Director')?.permissions.banks?.view).toBe(true);
    expect(seeds.find((role) => role.name === 'Sales')?.permissions.loan_applications?.create).toBe(true);
    expect(seeds.find((role) => role.name === 'Accounts')?.permissions.loan_applications?.approve).toBe(true);
    expect(seeds.find((role) => role.name === 'Manager')?.permissions.loan_applications?.edit).toBe(true);

    useAppStore.setState({
      user: { id: 'user-4', name: 'Accounts User', email: 'accounts@example.com', role: 'Accounts', companyId: 'company-1' },
      permissionCache: { ready: true, roles: buildRoleCache(seeds), loadedAt: new Date().toISOString(), diagnostics: [] },
    });
    expect(canDo('view', 'loan_applications')).toBe(true);
    expect(canDo('approve', 'loan_applications')).toBe(true);
  });

  it('Phase 2: Channel Partner RBAC seed matrix (§8.2) — Partner self-scope field agent', () => {
    const seeds = getSystemRoleSeedDocuments();
    const partner = seeds.find((role) => role.name === 'Partner');
    expect(partner).toBeDefined();
    // Field-agent self scope: own leads/customers/projects/surveys.
    expect(partner?.permissions.leads?.create).toBe(true);
    expect(partner?.permissions.leads?.visibility).toBe('self');
    expect(partner?.permissions.customers?.create).toBe(true);
    expect(partner?.permissions.customers?.visibility).toBe('self');
    expect(partner?.permissions.projects?.view).toBe(true);
    expect(partner?.permissions.projects?.create).toBe(true);
    expect(partner?.permissions.projects?.visibility).toBe('self');
    expect(partner?.permissions.surveys?.view).toBe(true);
    expect(partner?.permissions.surveys?.edit).toBe(true);
    // Vendor Lock (scheme_registration): own case view/create/edit — NOT approve.
    expect(partner?.permissions.scheme_registration?.view).toBe(true);
    expect(partner?.permissions.scheme_registration?.create).toBe(true);
    expect(partner?.permissions.scheme_registration?.edit).toBe(true);
    expect(partner?.permissions.scheme_registration?.approve).toBeFalsy();
    // Payouts: own commission view + own request creation — NOT approve/disburse.
    expect(partner?.permissions.payouts?.view).toBe(true);
    expect(partner?.permissions.payouts?.create).toBe(true);
    expect(partner?.permissions.payouts?.approve).toBeFalsy();
    expect(partner?.permissions.payouts?.disburse).toBeFalsy();
  });

  it('Phase 2: Manager gains projects at TEAM scope (G7 + §8.2); Director and Accounts get their Management/executor modules', () => {
    const seeds = getSystemRoleSeedDocuments();
    const manager = seeds.find((role) => role.name === 'Manager');
    expect(manager?.permissions.projects?.view).toBe(true);
    expect(manager?.permissions.projects?.create).toBe(true);
    expect(manager?.permissions.projects?.edit).toBe(true);
    expect(manager?.permissions.projects?.visibility).toBe('team');
    expect(manager?.permissions.leads?.visibility).toBe('team');
    expect(manager?.permissions.customers?.visibility).toBe('team');

    const director = seeds.find((role) => role.name === 'Director');
    expect(director?.permissions.projects?.view).toBe(true);
    expect(director?.permissions.projects?.create).toBeFalsy();
    expect(director?.permissions.surveys?.view).toBe(true);
    expect(director?.permissions.scheme_registration?.view).toBe(true);
    expect(director?.permissions.payouts?.view).toBe(true);
    expect(director?.permissions.partners?.view).toBe(true);

    const accounts = seeds.find((role) => role.name === 'Accounts');
    expect(accounts?.permissions.payouts?.view).toBe(true);
    expect(accounts?.permissions.payouts?.disburse).toBe(true);
    expect(accounts?.permissions.payouts?.approve).toBeFalsy();
    expect(accounts?.permissions.projects?.view).toBeFalsy();
  });

  it('detects missing system roles when the database is only partially seeded', () => {
    const missing = getMissingSystemRoleSeeds([{ name: 'Acc' }]);
    const missingNames = missing.map((role) => role.name);

    expect(missingNames).toEqual(expect.arrayContaining([
      'Admin',
      'Director',
      'Sales',
      'Accounts',
      'Warehouse',
      'HR',
      'Operations',
      'Partner',
      'Manager',
      'Surveyor',
      'Engineer',
      'InstallationLead',
      'ServiceTechnician',
      'ComplianceOfficer',
      'Procurement',
    ]));
    expect(missingNames).not.toContain('Acc');
  });
});
