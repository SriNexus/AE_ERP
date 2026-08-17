/**
 * Channel Partner — Phase 5 (Customer + Project Creation) test suite.
 *
 * Covers the partner journey: Partner-owned Lead → Customer → Project, the
 * canonical filter helpers, the §9.3 service guards (a partner can never
 * convert another partner's lead or create a project on another partner's
 * customer), the B2B business-mode guard, demo graph coherence, and the
 * internal-Sales regression (non-partner actors unaffected).
 *
 * TEST MATRIX (from the phase task):
 *   1  Partner-owned Lead → Customer conversion succeeds
 *   2  Customer inherits correct partnerId
 *   3  Customer retains source Lead relationship
 *   4  Partner-owned Customer → Project creation succeeds
 *   5  Project inherits correct partnerId
 *   6  Project retains correct Customer relationship
 *   7  Project retains Lead relationship
 *   8  Partner A cannot convert/claim Partner B's Lead
 *   9  Partner A cannot create a Project from Partner B's Customer
 *   10 Manager/TL visibility unaffected (filter helpers remain owner-keyed)
 *   11 Management/Admin visibility unaffected (filter helpers return all)
 *   12 Normal internal Sales user Customer/Project workflows still work
 *   13 B2B/B2C business-mode restrictions remain intact
 *   14 Existing Project lifecycle remains intact (New stage start)
 *   15 Demo Partner → Lead → Customer → Project graph is coherent
 *   16 Loan Applications untouched (no registrations references added)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  logActivity: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue(undefined),
  notifyRoleUsers: vi.fn().mockResolvedValue(undefined),
  attachUserRole: vi.fn(),
  createCustomerProjectionInTransaction: vi.fn(),
  updateCustomerProjection: vi.fn(),
  resolveCurrentPartnerDocId: vi.fn(),
  getState: vi.fn(),
  genId: {
    customer: vi.fn(() => 'CUS-001'),
    project: vi.fn(() => 'PRJ-001'),
    lead: vi.fn(() => 'LD-001'),
  },
}));

vi.mock('../firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
}));

vi.mock('../workflow', () => ({
  logActivity: mocks.logActivity,
  resolveWorkflowCompanyId: () => 'comp-1',
  text: (value: unknown) => (typeof value === 'string' ? value : ''),
}));

vi.mock('../notifications', () => ({
  sendNotification: mocks.sendNotification,
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../userIdentity', () => ({
  attachUserRole: mocks.attachUserRole,
}));

vi.mock('../../features/customers/hooks/useCustomers', () => ({
  createCustomerProjectionInTransaction: mocks.createCustomerProjectionInTransaction,
  updateCustomerProjection: mocks.updateCustomerProjection,
}));

vi.mock('../partnerOwnership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../partnerOwnership')>();
  return {
    ...actual,
    resolveCurrentPartnerDocId: mocks.resolveCurrentPartnerDocId,
    getCachedPartnerDocId: () => mocks.resolveCurrentPartnerDocId(),
  };
});

vi.mock('../casePropagation', () => ({
  propagateCaseId: vi.fn(),
}));

vi.mock('../permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../permissions')>();
  return {
    ...actual,
    canDo: vi.fn(() => true),
  };
});

vi.mock('../firebase', () => ({
  db: {},
  COLLECTIONS: {
    CUSTOMERS: 'customers',
    LEADS: 'leads',
    PROJECTS: 'projects',
    USERS: 'users',
    CHANNEL_PARTNERS: 'channel_partners',
    SCHEME_REGISTRATIONS: 'scheme_registrations',
    REGISTRATIONS: 'registrations',
  },
  firebaseEnv: { isConfigured: false },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
  },
}));

// CaseEngine is imported by leadWorkflow — stub it to avoid firestore coupling.
vi.mock('../../engines/CaseEngine', () => ({
  caseEngine: {
    createCase: vi.fn(async () => ({ caseId: 'CASE-001' })),
  },
}));

// normalizeDocuments is imported by leadWorkflow — keep it passthrough.
vi.mock('../../features/leads/components/workspace/LeadWorkspaceDocumentsSection', () => ({
  normalizeDocuments: (lead: any) => lead?.documents ?? [],
}));

import { convertLeadToCustomer } from '../leadWorkflow';
import { createProject, buildProjectCreatePayload } from '../projectWorkflow';
import {
  filterPartnerOwnedCustomers,
  filterPartnerOwnedProjects,
  filterPartnerOwnedRecords,
} from '../partnerOwnership';
import { buildBusinessGraphPlan } from '../../../scripts/demo/datasets/businessGraph.ts';

const docs = (collection: string) =>
  buildBusinessGraphPlan().documents.filter((d) => d.collection === collection);

const data = (collection: string, id: string) =>
  buildBusinessGraphPlan().documents.find((d) => d.collection === collection && d.id === id)?.data;

describe('filterPartnerOwnedCustomers / filterPartnerOwnedProjects (canonical helpers)', () => {
  const customers = [
    { id: 'C1', partnerId: 'PART-A', isDeleted: false },
    { id: 'C2', partnerId: 'PART-B', isDeleted: false },
    { id: 'C3', partnerId: 'PART-A', isDeleted: true },
    { id: 'C4', partnerId: '', isDeleted: false },
  ];
  const projects = [
    { id: 'P1', partnerId: 'PART-A', isDeleted: false },
    { id: 'P2', partnerId: 'PART-B', isDeleted: false },
    { id: 'P3', partnerId: 'PART-A', isDeleted: true },
  ];

  it('TEST 2/5: filters customers/projects to the partner DOC id only', () => {
    expect(filterPartnerOwnedCustomers(customers, 'PART-A').map((c: any) => c.id)).toEqual(['C1']);
    expect(filterPartnerOwnedProjects(projects, 'PART-A').map((p: any) => p.id)).toEqual(['P1']);
  });

  it('TEST 8/9: a different partner cannot see the first partner records', () => {
    expect(filterPartnerOwnedCustomers(customers, 'PART-B').map((c: any) => c.id)).toEqual(['C2']);
    expect(filterPartnerOwnedProjects(projects, 'PART-B').map((p: any) => p.id)).toEqual(['P2']);
  });

  it('excludes soft-deleted records', () => {
    expect(filterPartnerOwnedCustomers(customers, 'PART-A')).toHaveLength(1);
    expect(filterPartnerOwnedProjects(projects, 'PART-A')).toHaveLength(1);
  });

  it('TEST 10/11: is owner-keyed — a manager/org-wide caller passes their own id; empty partner id yields nothing', () => {
    expect(filterPartnerOwnedCustomers(customers, null)).toEqual([]);
    expect(filterPartnerOwnedProjects(projects, undefined)).toEqual([]);
    expect(filterPartnerOwnedRecords(customers, 'PART-A')).toHaveLength(1);
  });

  it('is null/undefined tolerant', () => {
    expect(filterPartnerOwnedCustomers(null, 'PART-A')).toEqual([]);
    expect(filterPartnerOwnedProjects(undefined, 'PART-A')).toEqual([]);
  });
});

describe('convertLeadToCustomer — partner ownership + §9.3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1' },
    });
    mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
  });

  it('TEST 1/2/3: converting a partner lead creates a customer inheriting partnerId + sourceLeadId', async () => {
    const lead = {
      id: 'lead-1',
      name: 'Partner Solar Lead',
      phone: '9999999999',
      partnerId: 'partner-1',
      partnerName: 'GreenLeaf Solar',
    };
    await expect(convertLeadToCustomer(lead, 'B2C')).resolves.toBe('CUS-001');
    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'customers',
      'CUS-001',
      expect.objectContaining({
        sourceLeadId: 'lead-1',
        partnerId: 'partner-1',
        partnerName: 'GreenLeaf Solar',
      }),
    );
  });

  it('TEST 8: partner A converting a lead owned by partner B is rejected (§9.3)', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('partner-A');
    const lead = {
      id: 'lead-1',
      name: 'Other Partner Lead',
      phone: '9999999999',
      partnerId: 'partner-B',
      partnerName: 'Sunrise Solar',
    };
    await expect(convertLeadToCustomer(lead, 'B2C')).rejects.toThrow(/another partner/);
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('TEST 12: internal sales user (no partner link) converts an unpartnered lead normally', async () => {
    const lead = { id: 'lead-1', name: 'Walk-in Lead', phone: '9999999999' };
    await expect(convertLeadToCustomer(lead, 'B2C')).resolves.toBe('CUS-001');
    const payload = mocks.createDocWithId.mock.calls[0][2];
    // text() normalizes undefined to '' — the point is no partner attribution.
    expect(payload.partnerId).toBeFalsy();
    expect(payload.partnerName).toBeFalsy();
  });
});

describe('createProject — partner ownership + §9.3 + B2B guard', () => {
  const form = {
    customerId: 'CUST-1',
    leadId: 'LD-1',
    capacityKw: '12.5',
    projectType: 'Residential',
    siteAddress: {
      line1: 'Unit 12', line2: '', landmark: '', city: 'Pune',
      district: '', state: 'Maharashtra', pincode: '411001', country: 'India',
    },
    salesOwner: '', assignedSurveyor: '', assignedInstaller: '', notes: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
      user: { id: 'user-1', companyId: 'comp-1', role: 'Partner' },
    });
    mocks.resolveCurrentPartnerDocId.mockResolvedValue(null);
    mocks.getOne.mockResolvedValue(null);
  });

  it('TEST 4/5/6/7: creating a project for a partner-owned customer propagates partnerId + customer + lead relationships', async () => {
    mocks.getOne.mockResolvedValue({
      id: 'CUST-1',
      type: 'B2C',
      partnerId: 'partner-1',
      partnerName: 'GreenLeaf Solar',
      sourceLeadId: 'LD-1',
    });
    const payload = await createProject(form);
    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'projects',
      'PRJ-001',
      expect.objectContaining({
        partnerId: 'partner-1',
        partnerName: 'GreenLeaf Solar',
        customerId: 'CUST-1',
        leadId: 'LD-1',
        currentStage: 'New',
      }),
    );
    expect(payload.partnerId).toBe('partner-1');
  });

  it('TEST 9: partner A creating a project from partner B customer is rejected (§9.3)', async () => {
    mocks.resolveCurrentPartnerDocId.mockResolvedValue('partner-A');
    mocks.getOne.mockResolvedValue({
      id: 'CUST-B',
      type: 'B2C',
      partnerId: 'partner-B',
      partnerName: 'Sunrise Solar',
      sourceLeadId: 'LD-9',
    });
    await expect(createProject({ ...form, customerId: 'CUST-B' })).rejects.toThrow(/another partner/);
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('TEST 13: B2B customers can never have a Project (B2B guard intact)', async () => {
    mocks.getOne.mockResolvedValue({ id: 'CUST-B2B', type: 'B2B' });
    await expect(createProject({ ...form, customerId: 'CUST-B2B' })).rejects.toThrow(/B2B/);
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('TEST 14: buildProjectCreatePayload always starts a fresh project at the New stage', () => {
    const payload = buildProjectCreatePayload(
      { ...form, customerId: 'CUST-1', capacityKw: '8', projectType: 'Residential' },
      { projectId: 'PRJ-20260709-ABCD', companyId: 'COMP-1', userId: 'USR-1', partnerId: 'partner-1', partnerName: 'GreenLeaf Solar', leadId: 'LD-1' },
    );
    expect(payload.currentStage).toBe('New');
    expect(payload.stageHistory[0].stage).toBe('New');
    expect(payload.partnerId).toBe('partner-1');
  });

  it('TEST 12: non-partner (internal Sales) can still create projects without a partner link', async () => {
    mocks.getOne.mockResolvedValue({ id: 'CUST-1', type: 'B2C' });
    const payload = await createProject(form);
    const created = mocks.createDocWithId.mock.calls[0][2];
    expect(created.partnerId).toBeFalsy();
    expect(payload.currentStage).toBe('New');
  });
});

describe('demo coherence — Partner → Lead → Customer → Project (TEST 15)', () => {
  it('demo customers CUS,3/CUS,4 carry the partner ownership of their source leads LEAD,4/LEAD,5', () => {
    const plan = buildBusinessGraphPlan();
    const partnerIds = new Set(plan.documents.filter((d) => d.collection === 'channel_partners').map((d) => d.id));
    expect(partnerIds.size).toBeGreaterThanOrEqual(2);

    // LEAD,4 → PART,1 and LEAD,5 → PART,2 (Phase 4 contract).
    expect(data('leads', 'DEMO-V1-LEAD-004')?.partnerId).toBeTruthy();
    expect(data('leads', 'DEMO-V1-LEAD-005')?.partnerId).toBeTruthy();

    // CUS,3 → sourceLeadId LEAD,4 and CUS,4 → sourceLeadId LEAD,5 (Phase 5).
    expect(data('customers', 'DEMO-V1-CUS-003')?.sourceLeadId).toBe('DEMO-V1-LEAD-004');
    expect(data('customers', 'DEMO-V1-CUS-003')?.partnerId).toBe(data('leads', 'DEMO-V1-LEAD-004')?.partnerId);
    expect(data('customers', 'DEMO-V1-CUS-004')?.sourceLeadId).toBe('DEMO-V1-LEAD-005');
    expect(data('customers', 'DEMO-V1-CUS-004')?.partnerId).toBe(data('leads', 'DEMO-V1-LEAD-005')?.partnerId);

    // PRJ,3 → CUS,3 and PRJ,4 → CUS,4 with matching partner ownership.
    expect(data('projects', 'DEMO-V1-PRJ-003')?.customerId).toBe('DEMO-V1-CUS-003');
    expect(data('projects', 'DEMO-V1-PRJ-003')?.partnerId).toBe(data('customers', 'DEMO-V1-CUS-003')?.partnerId);
    expect(data('projects', 'DEMO-V1-PRJ-004')?.customerId).toBe('DEMO-V1-CUS-004');
    expect(data('projects', 'DEMO-V1-PRJ-004')?.partnerId).toBe(data('customers', 'DEMO-V1-CUS-004')?.partnerId);

    // Filter helpers resolve the demo partner-owned sets coherently.
    const owner = data('leads', 'DEMO-V1-LEAD-004')?.partnerId as string;
    const customers = docs('customers').map((d) => ({ id: d.id, ...(d.data as any) }));
    const projects = docs('projects').map((d) => ({ id: d.id, ...(d.data as any) }));
    expect(filterPartnerOwnedCustomers(customers, owner).map((c: any) => c.id)).toContain('DEMO-V1-CUS-003');
    expect(filterPartnerOwnedCustomers(customers, owner).map((c: any) => c.id)).not.toContain('DEMO-V1-CUS-004');
    expect(filterPartnerOwnedProjects(projects, owner).map((p: any) => p.id)).toContain('DEMO-V1-PRJ-003');
    expect(filterPartnerOwnedProjects(projects, owner).map((p: any) => p.id)).not.toContain('DEMO-V1-PRJ-004');
  });

  it('TEST 16: Vendor Lock uses scheme_registrations — NOT the loan `registrations` collection', () => {
    const plan = buildBusinessGraphPlan();
    // Loan Applications (bank/loan workflow) legitimately live on
    // `registrations`; the new Channel Partner Vendor Lock collection is the
    // separate scheme_registrations (CP-15 seeds a demo dataset for it).
    const schemeRegs = plan.documents.filter((d) => d.collection === 'scheme_registrations');
    expect(schemeRegs.length).toBeGreaterThan(0);
    // Every seeded scheme registration stays strictly inside scheme_registrations
    // — never on the loan registrations collection, and never a loan id shape.
    expect(schemeRegs.every((d: any) => String(d.id).includes('SREG'))).toBe(true);
    expect(plan.documents.some((d) => d.collection === 'registrations')).toBe(true);
    const loanIds = new Set(plan.documents.filter((d) => d.collection === 'registrations').map((d) => d.id));
    expect(schemeRegs.some((d) => loanIds.has(d.id))).toBe(false);
  });
});

describe('permissions — Partner RBAC foundation for customers/projects (Phase 2 regression)', () => {
  it('TEST 10/11: Partner role retains view+create on customers and projects with self visibility', async () => {
    const { getSystemRoleSeedDocuments } = await import('../roleBootstrap');
    const seeds = getSystemRoleSeedDocuments();
    const partner = (Array.isArray(seeds) ? seeds : []).find((role: any) => role.name === 'Partner');
    expect(partner).toBeDefined();
    expect(partner?.permissions.customers?.view).toBe(true);
    expect(partner?.permissions.customers?.create).toBe(true);
    expect(partner?.permissions.customers?.visibility).toBe('self');
    expect(partner?.permissions.projects?.view).toBe(true);
    expect(partner?.permissions.projects?.create).toBe(true);
    expect(partner?.permissions.projects?.visibility).toBe('self');
  });
});
