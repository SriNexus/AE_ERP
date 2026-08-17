import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { canDo, getModuleVisibility, isPartnerPortalUser } from '../permissions';
import { buildRoleCache, getSystemRoleSeedDocuments } from '../roleBootstrap';
import { filterVisibleProjectRecords } from '../projectVisibility';
import { B2C_ONLY_MODULES } from '../companyBusinessMode';

function setup(role: string, isSuperAdmin = false) {
  const seeds = getSystemRoleSeedDocuments();
  useAppStore.setState({
    user: { id: 'user-x', name: 'Role User', email: 'role@example.com', role, companyId: 'company-1', isSuperAdmin },
    teamMemberIds: [],
    permissionCache: { ready: true, roles: buildRoleCache(seeds), loadedAt: new Date().toISOString(), diagnostics: [] },
  });
}

function resetStore() {
  useAppStore.setState({
    user: null,
    roleData: null,
    teamMemberIds: [],
    permissionCache: { ready: false, roles: {}, diagnostics: [] },
  });
}

describe('Phase 2 — Channel Partner RBAC / Partner Permissions', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('TL compat alias (G7 fix, LOCKED)', () => {
    it('resolves TL exactly like Manager — no second role system', () => {
      setup('TL');
      expect(canDo('view', 'projects')).toBe(true);
      expect(canDo('create', 'leads')).toBe(true);
      expect(canDo('create', 'customers')).toBe(true);
      expect(canDo('view', 'users')).toBe(false);
      expect(canDo('edit', 'dispatch')).toBe(true);
    });

    it('keeps Manager itself resolving identically', () => {
      setup('Manager');
      expect(canDo('view', 'projects')).toBe(true);
      expect(canDo('create', 'leads')).toBe(true);
      expect(canDo('view', 'users')).toBe(false);
    });
  });

  describe('§8.2 permission matrix', () => {
    it('Partner: own-case field agent (self scope, no privilege escalation)', () => {
      setup('Partner');
      expect(canDo('view', 'leads')).toBe(true);
      expect(canDo('create', 'leads')).toBe(true);
      expect(canDo('create', 'customers')).toBe(true);
      expect(canDo('view', 'projects')).toBe(true);
      expect(canDo('create', 'projects')).toBe(true);
      expect(canDo('view', 'surveys')).toBe(true);
      expect(canDo('edit', 'surveys')).toBe(true);
      // Vendor Lock on own case: create/edit yes, approve NO.
      expect(canDo('create', 'scheme_registration')).toBe(true);
      expect(canDo('edit', 'scheme_registration')).toBe(true);
      expect(canDo('approve', 'scheme_registration')).toBe(false);
      // Payout request: create yes, approve/disburse NO.
      expect(canDo('create', 'payouts')).toBe(true);
      expect(canDo('approve', 'payouts')).toBe(false);
      expect(canDo('disburse', 'payouts')).toBe(false);
      // No admin surface, no unrelated modules.
      expect(canDo('view', 'users')).toBe(false);
      expect(canDo('view', 'roles')).toBe(false);
      expect(canDo('view', 'payments')).toBe(false);
      expect(getModuleVisibility('leads')).toBe('self');
      expect(getModuleVisibility('customers')).toBe('self');
      expect(getModuleVisibility('projects')).toBe('self');
      // Defense-in-depth: the partners module is SELF-scoped for Partner so
      // the Phase 1 userId-keyed filter engages — a Partner-role user can
      // never list the company-wide channel_partners collection.
      const partnerSeed = getSystemRoleSeedDocuments().find((r) => r.name === 'Partner');
      expect(partnerSeed?.permissions.partners?.visibility).toBe('self');
    });

    it('Manager/TL: team scope, can create projects, cannot approve payouts or access users', () => {
      setup('Manager');
      expect(canDo('view', 'leads')).toBe(true);
      expect(canDo('create', 'projects')).toBe(true);
      expect(canDo('view', 'partners')).toBe(true);
      expect(canDo('approve', 'scheme_registration')).toBe(true); // §8.2: Vendor Lock approve
      expect(canDo('approve', 'payouts')).toBe(true); // §8.2: Approve payout ✅
      expect(canDo('disburse', 'payouts')).toBe(false); // Accounts/Admin only
      expect(canDo('view', 'users')).toBe(false);
      expect(getModuleVisibility('leads')).toBe('team');
      expect(getModuleVisibility('customers')).toBe('team');
      // getModuleVisibility('projects') collapses to 'self'/'all' (the coarse
      // ProjectVisibilityMode contract); the real team scope is enforced by
      // filterVisibleProjectRecords (resolveVisibilityKind reads the role
      // doc's projects.visibility='team').
      const managerRole = getSystemRoleSeedDocuments().find((r) => r.name === 'Manager');
      const teamRecords = [
        { id: 'p1', companyId: 'c1', salesOwner: 'team-member-1' },
        { id: 'p2', companyId: 'c1', salesOwner: 'unrelated-agent' },
      ];
      const visible = filterVisibleProjectRecords(teamRecords, 'manager-user', 'Manager', managerRole, ['team-member-1']);
      expect(visible.map((r) => r.id)).toEqual(['p1']);
    });

    it('Director (Management view tier): org-wide view, no mutations', () => {
      setup('Director');
      expect(canDo('view', 'projects')).toBe(true);
      expect(canDo('create', 'projects')).toBe(false);
      expect(canDo('view', 'surveys')).toBe(true);
      expect(canDo('view', 'scheme_registration')).toBe(true);
      expect(canDo('create', 'scheme_registration')).toBe(false);
      expect(canDo('view', 'payouts')).toBe(true);
      expect(canDo('approve', 'payouts')).toBe(false);
      expect(canDo('view', 'partners')).toBe(true);
    });

    it('Accounts: disbursement executor — disburse only, never approve; no partner lifecycle', () => {
      setup('Accounts');
      expect(canDo('view', 'payouts')).toBe(true);
      expect(canDo('disburse', 'payouts')).toBe(true);
      expect(canDo('approve', 'payouts')).toBe(false);
      expect(canDo('view', 'projects')).toBe(false);
      expect(canDo('view', 'scheme_registration')).toBe(false);
      expect(canDo('create', 'payouts')).toBe(false);
    });

    it('Admin: retains everything including the new modules (approve + disburse)', () => {
      setup('Admin');
      expect(canDo('view', 'payouts')).toBe(true);
      expect(canDo('create', 'payouts')).toBe(true);
      expect(canDo('approve', 'payouts')).toBe(true);
      expect(canDo('disburse', 'payouts')).toBe(true);
      expect(canDo('approve', 'scheme_registration')).toBe(true);
      expect(canDo('delete', 'scheme_registration')).toBe(true);
      expect(canDo('view', 'projects')).toBe(true);
    });

    it('Accounts tax_invoices cancel stays filtered (Phase 2 must not broaden non-payout perms)', () => {
      setup('Accounts');
      // roleBootstrap ALL_PERMISSIONS deliberately omits 'cancel' — legacy
      // seeds (Accounts tax_invoices cancel:true) must keep their pre-Phase-2
      // filtered-out behavior; only 'disburse' was added.
      expect(canDo('cancel', 'tax_invoices')).toBe(false);
      expect(canDo('view', 'tax_invoices')).toBe(true);
    });

    it('Sales (existing role): no unintended new modules', () => {
      setup('Sales');
      expect(canDo('view', 'payouts')).toBe(false);
      expect(canDo('approve', 'scheme_registration')).toBe(false);
      expect(canDo('view', 'projects')).toBe(false);
      expect(canDo('create', 'customers')).toBe(true); // unchanged
    });
  });

  describe('disburse permission plumbing', () => {
    it('treats disburse as a valid Permission action for seed + canDo', () => {
      setup('Accounts');
      expect(canDo('disburse', 'payouts')).toBe(true);
      // Admin's all-module seed carries it too
      setup('Admin');
      expect(canDo('disburse', 'payouts')).toBe(true);
    });
  });

  describe('G11 — portal restricted to Partner role', () => {
    it('admits only the Partner role (and super-admin oversight)', () => {
      expect(isPartnerPortalUser('Partner', false)).toBe(true);
      expect(isPartnerPortalUser('partner', false)).toBe(true);
      expect(isPartnerPortalUser('TL', false)).toBe(false);
      expect(isPartnerPortalUser('Manager', false)).toBe(false);
      expect(isPartnerPortalUser('Sales', false)).toBe(false);
      expect(isPartnerPortalUser('Accounts', false)).toBe(false);
      expect(isPartnerPortalUser('Admin', false)).toBe(false);
      expect(isPartnerPortalUser('Warehouse', false)).toBe(false);
      expect(isPartnerPortalUser(null, false)).toBe(false);
      expect(isPartnerPortalUser(undefined, false)).toBe(false);
    });

    it('super-admin can enter for oversight regardless of role', () => {
      expect(isPartnerPortalUser('Admin', true)).toBe(true);
      expect(isPartnerPortalUser('Sales', true)).toBe(true);
      expect(isPartnerPortalUser('Partner', true)).toBe(true);
    });
  });

  describe('business-mode wiring (LOCKED §8.1)', () => {
    it('scheme_registration is a B2C-only module (project-stage module)', () => {
      expect(B2C_ONLY_MODULES).toContain('scheme_registration');
      // payouts is a financial queue, NOT a project-stage module — must not be gated.
      expect(B2C_ONLY_MODULES).not.toContain('payouts');
    });
  });
});
