/**
 * channelPartnerPhase3Ownership.test.ts — Phase 3 (Ownership Propagation) tests
 *
 * Covers the ownership-chain contracts:
 *   - OWNERSHIP_FIELDS / PROJECT_ASSIGNMENT_FIELDS include the partnerId field
 *   - buildOwnershipVisibilityQueryPlan threads partnerDocId into the allowed
 *     id set (self + team), so partner-owned records resolve for their owner
 *   - buildProjectVisibilityQueryPlan does the same for project-scoped reads
 *   - partnerCreateLead: §9.3 validation (a partner cannot attribute a lead to
 *     another partner), createdBy/userId stamped with the authenticated USER id
 *     (audit G5 fix), and partnerId persisted on the lead
 *   - resolvePartnerFromCustomer / resolvePartnerFromProject: attribution
 *     helpers used to keep ownership alive across conversion/creation
 *   - buildPartnerOwnershipBackfillPlan: safe dry-run planning (propagation,
 *     already-owned detection, conflict classification, skip unresolvable)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────

const { mockGetState } = vi.hoisted(() => {
  const mockGetState = vi.fn(() => ({
    activeCompanyId: 'company-1',
    company: { id: 'company-1' },
    user: { id: 'user-1', name: 'Alok Bansal' },
  }));
  return { mockGetState };
});

const mockWhere = vi.hoisted(() => vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })));
const mockGetOne = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(null as any)));
const mockGetAll = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve([] as any)));
const mockUpdateDocById = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(undefined as any)));
const mockCreateDocWithId = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(undefined as any)));
const mockResolveWriteCompanyId = vi.hoisted(() => vi.fn(() => 'company-1'));
const mockResolveCurrentPartnerDocId = vi.hoisted(() => vi.fn(() => Promise.resolve('partner-1' as string | null)));
const mockLogActivity = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockSendNotification = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockNotifyRoleUsers = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('firebase/firestore', () => ({
  where: mockWhere,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mockGetState },
}));

vi.mock('../firestore', () => ({
  getOne: mockGetOne,
  getAll: mockGetAll,
  updateDocById: mockUpdateDocById,
  createDocWithId: mockCreateDocWithId,
  resolveWriteCompanyId: mockResolveWriteCompanyId,
  genId: { lead: (prefix = 'LD') => `${prefix}-test-1` },
}));

vi.mock('../partnerOwnership', () => ({
  resolveCurrentPartnerDocId: mockResolveCurrentPartnerDocId,
  getCachedPartnerDocId: () => mockResolveCurrentPartnerDocId(),
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: {
    LEADS: 'leads',
    CUSTOMERS: 'customers',
    PROJECTS: 'projects',
    USERS: 'users',
  },
  firebaseEnv: { isConfigured: false },
}));

vi.mock('../workflow', () => ({
  logActivity: mockLogActivity,
}));

vi.mock('../notifications', () => ({
  sendNotification: mockSendNotification,
  notifyRoleUsers: mockNotifyRoleUsers,
}));

import { OWNERSHIP_FIELDS, buildOwnershipVisibilityQueryPlan } from '../ownershipVisibility';
import { PROJECT_ASSIGNMENT_FIELDS, buildProjectVisibilityQueryPlan } from '../projectVisibility';
import {
  partnerCreateLead,
  resolvePartnerFromCustomer,
  resolvePartnerFromProject,
} from '../partnerLeadIntegration';
import { buildPartnerOwnershipBackfillPlan } from '../partnerOwnershipBackfill';

// ── Field contracts ──────────────────────────────────────────

describe('Phase 3 ownership field contracts', () => {
  it('OWNERSHIP_FIELDS includes partnerId (with existing fields preserved)', () => {
    expect(OWNERSHIP_FIELDS).toContain('partnerId');
    // The partnerId field is the channel_partners DOC id; partnerDocId is a
    // query-time allowed-id, never a stored field name.
    expect(OWNERSHIP_FIELDS).not.toContain('partnerDocId');
    expect(OWNERSHIP_FIELDS).toEqual(expect.arrayContaining(['assignedToId', 'createdBy']));
  });

  it('PROJECT_ASSIGNMENT_FIELDS includes partnerId (with existing fields preserved)', () => {
    expect(PROJECT_ASSIGNMENT_FIELDS).toContain('partnerId');
    expect(PROJECT_ASSIGNMENT_FIELDS).not.toContain('partnerDocId');
    expect(PROJECT_ASSIGNMENT_FIELDS).toEqual(expect.arrayContaining(['salesOwner', 'assignedSurveyor']));
  });
});

// ── Ownership visibility plan ────────────────────────────────

describe('buildOwnershipVisibilityQueryPlan — partnerDocId threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the authenticated partner doc id to match partner-owned records (self scope)', () => {
    const plan = buildOwnershipVisibilityQueryPlan('company-1', 'user-1', 'self', [], 'partner-1');
    expect(plan.mode).toBe('owned');
    // One id chunk (2 ids) → each OWNERSHIP_FIELDS field gets an `in` constraint.
    expect(mockWhere).toHaveBeenCalledWith('companyId', '==', 'company-1');
    expect(mockWhere).toHaveBeenCalledWith('partnerId', 'in', ['user-1', 'partner-1']);
  });

  it('appends partnerDocId to the team id set', () => {
    const plan = buildOwnershipVisibilityQueryPlan(
      'company-1', 'user-1', 'team', ['user-manager'], 'partner-1',
    );
    expect(plan.mode).toBe('owned');
    expect(mockWhere).toHaveBeenCalledWith('partnerId', 'in', expect.arrayContaining(['partner-1']));
    const partnerCalls = mockWhere.mock.calls.filter((c: any[]) => c[0] === 'partnerId');
    expect(partnerCalls.length).toBeGreaterThan(0);
  });

  it('keeps `all` visibility company-only (no partner restrictions)', () => {
    const plan = buildOwnershipVisibilityQueryPlan('company-1', 'user-1', 'all', [], 'partner-1');
    expect(plan.mode).toBe('all');
    expect(mockWhere).not.toHaveBeenCalledWith('partnerId', expect.anything(), expect.anything());
  });

  it('treats a missing partnerDocId as no partner filter', () => {
    const plan = buildOwnershipVisibilityQueryPlan('company-1', 'user-1', 'self', [], null);
    expect(plan.mode).toBe('owned');
    const partnerCalls = mockWhere.mock.calls.filter((c: any[]) => c[0] === 'partnerId');
    // One id chunk (single user id) → the partnerId field gets a single `==`.
    expect(partnerCalls).toHaveLength(1);
    expect(partnerCalls[0]).toEqual(['partnerId', '==', 'user-1']);
  });
});

// ── Project visibility plan ──────────────────────────────────

describe('buildProjectVisibilityQueryPlan — partnerDocId threading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows the partner doc id to match partner-owned projects (self-scope role doc)', () => {
    const roleData = {
      name: 'Partner',
      schemaVersion: 1 as const,
      permissions: { projects: { view: true, visibility: 'self' as const } },
    };
    const plan = buildProjectVisibilityQueryPlan('company-1', 'user-1', 'Partner', roleData, [], 'partner-1');
    expect(plan.mode).toBe('assigned');
    expect(mockWhere).toHaveBeenCalledWith('partnerId', 'in', ['user-1', 'partner-1']);
  });

  it('keeps `all` project visibility company-only', () => {
    const plan = buildProjectVisibilityQueryPlan('company-1', 'user-1', 'Sales', null, [], 'partner-1');
    expect(plan.mode).toBe('all');
    expect(mockWhere).not.toHaveBeenCalledWith('partnerId', expect.anything(), expect.anything());
  });
});

// ── Partner creates lead ─────────────────────────────────────

describe('partnerCreateLead — §9.3 validation + ownership stamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1' },
      user: { id: 'user-1', name: 'Alok Bansal' },
    });
    mockResolveCurrentPartnerDocId.mockResolvedValue('partner-1');
  });

  it('persists partnerId + createdBy/userId (authenticated USER id) on the lead', async () => {
    const leadId = await partnerCreateLead({
      name: 'Rajesh Deshmukh',
      phone: '9876543210',
      partnerId: 'partner-1',
      partnerName: 'GreenLeaf Solar',
    });
    expect(leadId).toBe('PLD-test-1');
    expect(mockCreateDocWithId).toHaveBeenCalledWith(
      'leads', 'PLD-test-1',
      expect.objectContaining({
        partnerId: 'partner-1',
        partnerName: 'GreenLeaf Solar',
        source: 'Channel Partner',
        status: 'New',
        // Audit G5 fix: createdBy is the authenticated USER id, never the
        // partner doc id.
        createdBy: 'user-1',
        createdByName: 'Alok Bansal',
        userId: 'user-1',
        updatedBy: 'user-1',
        commissionStatus: 'eligible',
        installationStatus: 'pending',
      }),
    );
  });

  it('rejects a partner attributing a lead to a DIFFERENT partner (§9.3)', async () => {
    mockResolveCurrentPartnerDocId.mockResolvedValue('partner-1');
    await expect(partnerCreateLead({
      name: 'X', phone: '1', partnerId: 'partner-2', partnerName: 'Other',
    })).rejects.toThrow(/does not match the authenticated partner/);
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('rejects when no partner profile can be resolved', async () => {
    mockResolveCurrentPartnerDocId.mockResolvedValue(null);
    await expect(partnerCreateLead({
      name: 'X', phone: '1', partnerId: '', partnerName: '',
    })).rejects.toThrow(/Partner profile not found/);
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('allows a non-partner actor (no resolved link) to supply a partner id', async () => {
    // Admin creating on behalf of a partner — no authenticated partner link.
    mockResolveCurrentPartnerDocId.mockResolvedValue(null);
    await partnerCreateLead({
      name: 'X', phone: '1', partnerId: 'partner-9', partnerName: 'Vendor Co',
    });
    expect(mockCreateDocWithId).toHaveBeenCalledWith(
      'leads', 'PLD-test-1',
      expect.objectContaining({ partnerId: 'partner-9', partnerName: 'Vendor Co' }),
    );
  });
});

// ── Attribution helpers ──────────────────────────────────────

describe('resolvePartnerFromCustomer / resolvePartnerFromProject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the customer document and returns its partner attribution', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'customers' && id === 'cust-1') return { id: 'cust-1', partnerId: 'partner-1', partnerName: 'GreenLeaf Solar' };
      return null;
    });
    const attribution = await resolvePartnerFromCustomer('cust-1');
    expect(mockGetOne).toHaveBeenCalledWith('customers', 'cust-1');
    expect(attribution).toEqual({ partnerId: 'partner-1', partnerName: 'GreenLeaf Solar' });
  });

  it('reads the project document and returns its partner attribution', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'projects' && id === 'prj-1') return { id: 'prj-1', partnerId: 'partner-1', partnerName: 'GreenLeaf Solar' };
      return null;
    });
    const attribution = await resolvePartnerFromProject('prj-1');
    expect(mockGetOne).toHaveBeenCalledWith('projects', 'prj-1');
    expect(attribution).toEqual({ partnerId: 'partner-1', partnerName: 'GreenLeaf Solar' });
  });

  it('returns null when the record does not exist', async () => {
    expect(await resolvePartnerFromCustomer('ghost')).toBeNull();
    expect(await resolvePartnerFromProject('ghost')).toBeNull();
  });
});

// ── Backfill plan (dry-run) ──────────────────────────────────

describe('buildPartnerOwnershipBackfillPlan — safe dry-run planning', () => {
  const lead = (overrides: Record<string, unknown> = {}) => ({
    id: 'lead-1', companyId: 'company-1', partnerId: 'partner-1', partnerName: 'GreenLeaf Solar', isDeleted: false, ...overrides,
  });
  const customer = (overrides: Record<string, unknown> = {}) => ({
    id: 'cust-1', companyId: 'company-1', sourceLeadId: 'lead-1', isDeleted: false, ...overrides,
  });
  const project = (overrides: Record<string, unknown> = {}) => ({
    id: 'prj-1', companyId: 'company-1', customerId: 'cust-1', isDeleted: false, ...overrides,
  });

  it('plans customer propagation from the source lead (not already owned)', () => {
    const plan = buildPartnerOwnershipBackfillPlan({ leads: [lead()], customers: [customer()], projects: [] });
    expect(plan.summary.customersToBackfill).toBe(1);
    expect(plan.customers[0]).toMatchObject({ customerId: 'cust-1', partnerId: 'partner-1', alreadyOwned: false });
    expect(plan.summary.conflicts).toBe(0);
  });

  it('flags customers that already carry the source partner as alreadyOwned', () => {
    const plan = buildPartnerOwnershipBackfillPlan({
      leads: [lead()],
      customers: [customer({ partnerId: 'partner-1' })],
      projects: [],
    });
    expect(plan.summary.customersAlreadyOwned).toBe(1);
    expect(plan.customers[0].alreadyOwned).toBe(true);
  });

  it('plans project propagation from the parent customer', () => {
    const plan = buildPartnerOwnershipBackfillPlan({
      leads: [lead()],
      customers: [customer({ partnerId: 'partner-1' })],
      projects: [project()],
    });
    expect(plan.summary.projectsToBackfill).toBe(1);
    expect(plan.projects[0]).toMatchObject({ projectId: 'prj-1', partnerId: 'partner-1', alreadyOwned: false });
  });

  it('records a partner-mismatch conflict instead of overwriting existing ownership', () => {
    const plan = buildPartnerOwnershipBackfillPlan({
      leads: [lead()],
      customers: [customer({ partnerId: 'partner-other' })],
      projects: [],
    });
    expect(plan.summary.conflicts).toBe(1);
    expect(plan.conflicts[0]).toMatchObject({
      entity: 'customers', entityId: 'cust-1',
      existingPartnerId: 'partner-other', sourcePartnerId: 'partner-1',
      reason: 'customer_partner_mismatch',
    });
    expect(plan.summary.customersToBackfill).toBe(0);
  });

  it('records a cross-company conflict', () => {
    const plan = buildPartnerOwnershipBackfillPlan({
      leads: [lead({ companyId: 'company-1' })],
      customers: [customer({ companyId: 'company-2' })],
      projects: [],
    });
    expect(plan.summary.conflicts).toBe(1);
    expect(plan.conflicts[0].reason).toBe('cross_company');
    expect(plan.summary.customersToBackfill).toBe(0);
  });

  it('skips unresolvable references (missing source lead / no partner attribution)', () => {
    const plan = buildPartnerOwnershipBackfillPlan({
      leads: [lead()],
      customers: [customer({ sourceLeadId: 'lead-ghost' }), customer({ id: 'cust-2', sourceLeadId: 'lead-2' })],
      projects: [project({ customerId: 'cust-ghost' })],
    });
    expect(plan.summary.skipped).toBe(3);
    expect(plan.summary.customersToBackfill).toBe(0);
    expect(plan.summary.projectsToBackfill).toBe(0);
  });

  it('respects the company filter and ignores deleted records', () => {
    const plan = buildPartnerOwnershipBackfillPlan(
      {
        leads: [lead({ id: 'lead-c1', companyId: 'company-1' }), lead({ id: 'lead-c2', companyId: 'company-2', partnerId: 'partner-2' })],
        customers: [
          customer({ id: 'cust-c1', companyId: 'company-1' }),
          customer({ id: 'cust-c2', companyId: 'company-2', sourceLeadId: 'lead-c2' }),
          customer({ id: 'cust-deleted', companyId: 'company-1', sourceLeadId: 'lead-c1', isDeleted: true }),
        ],
        projects: [],
      },
      { companyId: 'company-1' },
    );
    expect(plan.summary.customersScanned).toBe(1);
    expect(plan.customers.some((c) => c.customerId === 'cust-c2')).toBe(false);
    expect(plan.customers.some((c) => c.customerId === 'cust-deleted')).toBe(false);
  });

  it('is idempotent — planning twice does not double-count candidates', () => {
    const input = { leads: [lead()], customers: [customer()], projects: [] };
    const first = buildPartnerOwnershipBackfillPlan(input);
    const second = buildPartnerOwnershipBackfillPlan(input);
    expect(second.summary.customersToBackfill).toBe(first.summary.customersToBackfill);
    expect(second.summary.customersToBackfill).toBe(1);
    expect(second.customers).toHaveLength(first.customers.length);
  });
});
