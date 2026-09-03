/**
 * partnerLeadSalesAssignment.test.ts — Channel Partner "Add Lead" Sales Person
 * selection contract.
 *
 * Covers:
 *   - fetchAssignableSalesUsers(): company-scoped raw read + the canonical
 *     filterEligibleSalesUsers() predicate (role / active / not-deleted /
 *     not-owner). This is the read that replaced getAll(COLLECTIONS.USERS) in
 *     PartnerCreateLeadModal — getAll()'s applyAccessFilters() `self` visibility
 *     for the Partner role stripped every Sales-rep record out of the dropdown.
 *   - partnerCreateLead(): the partner-chosen assignedToId is re-validated
 *     against that same company-scoped eligible set — an arbitrary / deactivated
 *     / cross-tenant id is rejected before the lead is written; the stored
 *     assignedToName always comes from the resolved user doc, never the payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDocs = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })));
const mockCollection = vi.hoisted(() => vi.fn((_db: unknown, name: string) => ({ name })));
const mockQuery = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ args })));

vi.mock('firebase/firestore', () => ({
  getDocs: mockGetDocs,
  where: mockWhere,
  collection: mockCollection,
  query: mockQuery,
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: { USERS: 'users', LEADS: 'leads', CUSTOMERS: 'customers', PROJECTS: 'projects' },
  db: {},
  firebaseEnv: { isConfigured: false },
}));

const mockCreateDocWithId = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(undefined)));
const mockGetOne = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(null)));
const mockGetAll = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve([] as any[])));

vi.mock('../firestore', () => ({
  updateDocById: vi.fn(() => Promise.resolve()),
  genId: { lead: (prefix = 'LD') => `${prefix}-test-1`, generic: () => 'GEN-1' },
  createDocWithId: mockCreateDocWithId,
  getOne: mockGetOne,
  getAll: mockGetAll,
  resolveWriteCompanyId: vi.fn(() => 'company-1'),
  resolveWriteGroupId: vi.fn(() => 'group-1'),
}));

vi.mock('../partnerOwnership', () => ({
  resolveCurrentPartnerDocId: vi.fn(() => Promise.resolve('partner-1')),
  partnerDisplayName: (p: any, fb = 'Partner') =>
    (p?.firmName || p?.contactPerson || p?.name || fb),
}));

vi.mock('../workflow', () => ({ logActivity: vi.fn(() => Promise.resolve()) }));
vi.mock('../notifications', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyRoleUsers: vi.fn(() => Promise.resolve()),
}));
vi.mock('../channelPartnerCommissionEngine', () => ({
  resolveCommissionRule: vi.fn(),
  calculateCommission: vi.fn(),
  getCommissionBreakdown: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      activeCompanyId: 'company-1',
      company: { id: 'company-1' },
      user: { id: 'user-partner-1', name: 'Priya Menon' },
    })),
  },
}));

const snap = (rows: Array<Record<string, unknown>>) => ({
  docs: rows.map((r) => ({ id: r.id, data: () => r })),
});

import { fetchAssignableSalesUsers } from '../salesTeam';
import { partnerCreateLead } from '../partnerLeadIntegration';

const COMPANY_USERS = [
  { id: 'sales-1', name: 'Arjun Rao', role: 'Sales', status: 'Active', companyId: 'company-1' },
  { id: 'sales-2', name: 'Deepa Nair', role: 'Sales Executive', status: 'Active', companyId: 'company-1' },
  { id: 'sales-inactive', name: 'Old Rep', role: 'Sales', status: 'Inactive', companyId: 'company-1' },
  { id: 'sales-deleted', name: 'Gone Rep', role: 'Sales', isDeleted: true, companyId: 'company-1' },
  { id: 'admin-1', name: 'Admin Boss', role: 'Admin', status: 'Active', companyId: 'company-1' },
  { id: 'owner-1', name: 'Owner', role: 'Admin', email: 'shreeniwas.tripathi0@gmail.com', companyId: 'company-1' },
];

describe('fetchAssignableSalesUsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the users collection scoped by companyId and returns only eligible, active Sales Persons', async () => {
    mockGetDocs.mockResolvedValue(snap(COMPANY_USERS));

    const result = await fetchAssignableSalesUsers('company-1');

    expect(mockWhere).toHaveBeenCalledWith('companyId', '==', 'company-1');
    expect(result.map((u) => u.id)).toEqual(['sales-1', 'sales-2']);
  });

  it('returns an empty list when no companyId is provided (never an unscoped read)', async () => {
    const result = await fetchAssignableSalesUsers('');
    expect(result).toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

describe('partnerCreateLead — Sales Person assignment validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the partner-chosen Sales Person, taking the name from the resolved user doc (not the payload)', async () => {
    mockGetDocs.mockResolvedValue(snap(COMPANY_USERS));

    await partnerCreateLead({
      name: 'Rohit Shah',
      phone: '9812345678',
      partnerId: 'partner-1',
      partnerName: 'SunPeak Energy',
      assignedToId: 'sales-2',
      assignedToName: 'FORGED NAME',
    });

    expect(mockCreateDocWithId).toHaveBeenCalledWith(
      'leads',
      'PLD-test-1',
      expect.objectContaining({ assignedToId: 'sales-2', assignedToName: 'Deepa Nair' }),
    );
  });

  it('rejects an assignedToId that is not an eligible Sales Person of the company (arbitrary / cross-tenant / deactivated)', async () => {
    mockGetDocs.mockResolvedValue(snap(COMPANY_USERS));

    await expect(
      partnerCreateLead({
        name: 'X',
        phone: '1',
        partnerId: 'partner-1',
        partnerName: 'SunPeak Energy',
        assignedToId: 'sales-inactive',
      }),
    ).rejects.toThrow(/not a valid, active member/);
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('creates the lead unassigned when no Sales Person id is supplied (zero-eligible fallback)', async () => {
    mockGetDocs.mockResolvedValue(snap([]));

    await partnerCreateLead({
      name: 'Walk-in',
      phone: '9800000000',
      partnerId: 'partner-1',
      partnerName: 'SunPeak Energy',
    });

    const doc = mockCreateDocWithId.mock.calls[0][2] as Record<string, unknown>;
    expect(doc.assignedToId).toBeUndefined();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});
