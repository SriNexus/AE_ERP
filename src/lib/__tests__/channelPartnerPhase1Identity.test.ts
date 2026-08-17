/**
 * channelPartnerPhase1Identity.test.ts — Phase 1 (Identity & Provisioning) tests
 *
 * Covers the canonical partner↔user identity contracts:
 *   - linkPartnerUser: idempotent dual-write, conflict rejection, tenant boundary
 *   - assignPartnerManager: orgHierarchy validation, cross-company rejection
 *   - provisionPartnerUser: canonical Users.tsx provisioning path
 *   - resolvePartnerSelf: users.channelPartnerId → channel_partners (with the
 *     legacy partner-side userId fallback)
 *   - buildPartnerUserLinkBackfillPlan: safe/ambiguous/conflict classification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────

const { mockGetState } = vi.hoisted(() => {
  const mockGetState = vi.fn(() => ({
    activeCompanyId: 'company-1',
    company: { id: 'company-1' },
    user: { id: 'user-admin', name: 'Admin' },
  }));
  return { mockGetState };
});

const mockGetOne = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(null as any)));
const mockGetAll = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve([] as any)));
const mockUpdateDocById = vi.hoisted(() => vi.fn((..._args: any[]) => Promise.resolve(undefined as any)));
const mockDoc = vi.hoisted(() => vi.fn(() => ({ path: 'doc' })));
const mockBatchUpdate = vi.hoisted(() => vi.fn());
const mockBatchCommit = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockLogActivity = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockCreateUserProjection = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockCreateUserWithEmailAndPassword = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockGetAuth = vi.hoisted(() => vi.fn(() => ({ signOut: mockSignOut })));
const mockInitializeApp = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('../store/useAppStore', () => ({
  useAppStore: { getState: mockGetState },
}));

vi.mock('../firestore', () => ({
  getOne: mockGetOne,
  getAll: mockGetAll,
  updateDocById: mockUpdateDocById,
  doc: mockDoc,
  writeBatch: vi.fn(() => ({ update: mockBatchUpdate, commit: mockBatchCommit })),
  createDocWithId: vi.fn(() => Promise.resolve()),
  softDelete: vi.fn(() => Promise.resolve()),
  resolveWriteCompanyId: () => {
    const s = mockGetState() as any;
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
}));

vi.mock('../firebase', () => ({
  db: {},
  firebaseConfig: { projectId: 'test-project' },
  firebaseEnv: { isConfigured: false },
  COLLECTIONS: {
    USERS: 'users',
    CHANNEL_PARTNERS: 'channel_partners',
    PARTNER_WALLET_TXNS: 'partner_wallet_transactions',
    COMMISSION_RECORDS: 'commission_records',
    // Used by the real userIdentity.ts PROJECTION_ROLE_MAP at module load.
    LEADS: 'leads',
    CUSTOMERS: 'customers',
    EMPLOYEES: 'employees',
  },
}));

vi.mock('../workflow', () => ({
  logActivity: mockLogActivity,
}));

vi.mock('../notifications', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyRoleUsers: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../features/users/hooks/useUsers', () => ({
  createUserProjection: mockCreateUserProjection,
}));

vi.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
  createUserWithEmailAndPassword: mockCreateUserWithEmailAndPassword,
}));

import {
  linkPartnerUser,
  assignPartnerManager,
  provisionPartnerUser,
} from '../channelPartnerWorkflow';
import { resolvePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import {
  buildPartnerUserLinkBackfillPlan,
} from '../partnerUserLinkBackfill';

function partnerDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'partner-1',
    companyId: 'company-1',
    firmName: 'GreenLeaf Solar',
    contactPerson: 'Alok Bansal',
    status: 'active',
    kycStatus: 'verified',
    userId: undefined,
    managerId: undefined,
    ...overrides,
  };
}

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    companyId: 'company-1',
    name: 'Alok Bansal',
    email: 'alok@greenleaf.example',
    role: 'Partner',
    status: 'Active',
    channelPartnerId: undefined,
    ...overrides,
  };
}

describe('linkPartnerUser — canonical partner↔user linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1' },
      user: { id: 'user-admin', name: 'Admin' },
    });
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      if (col === 'users' && id === 'user-1') return userDoc();
      return null;
    });
    mockGetAll.mockResolvedValue([partnerDoc()]);
  });

  it('persists BOTH sides of the link atomically', async () => {
    await linkPartnerUser('partner-1', 'user-1');
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'channel_partners', 'partner-1');
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'users', 'user-1');
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), { userId: 'user-1' });
    expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), { channelPartnerId: 'partner-1' });
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalled();
  });

  it('is idempotent for the SAME pair (no write, no error)', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc({ userId: 'user-1' });
      if (col === 'users' && id === 'user-1') return userDoc({ channelPartnerId: 'partner-1' });
      return null;
    });
    await linkPartnerUser('partner-1', 'user-1');
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects when the partner is already linked to a DIFFERENT user', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc({ userId: 'user-other' });
      if (col === 'users' && id === 'user-1') return userDoc();
      return null;
    });
    await expect(linkPartnerUser('partner-1', 'user-1')).rejects.toThrow(/already linked to a different user/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects when the user is already linked to a DIFFERENT partner', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      if (col === 'users' && id === 'user-1') return userDoc({ channelPartnerId: 'partner-other' });
      return null;
    });
    await expect(linkPartnerUser('partner-1', 'user-1')).rejects.toThrow(/already linked to a different partner/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects when another partner already claims this user', async () => {
    mockGetAll.mockResolvedValue([
      partnerDoc({ id: 'partner-2', userId: 'user-1' }),
      partnerDoc({ id: 'partner-1' }),
    ]);
    await expect(linkPartnerUser('partner-1', 'user-1')).rejects.toThrow(/already linked to partner/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects a cross-company link (tenant boundary)', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc({ companyId: 'company-1' });
      if (col === 'users' && id === 'user-1') return userDoc({ companyId: 'company-2' });
      return null;
    });
    await expect(linkPartnerUser('partner-1', 'user-1')).rejects.toThrow(/different company/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects when the partner or user does not exist', async () => {
    await expect(linkPartnerUser('partner-missing', 'user-1')).rejects.toThrow(/Channel partner not found/);
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      return null;
    });
    await expect(linkPartnerUser('partner-1', 'user-missing')).rejects.toThrow(/User not found/);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('rejects empty ids', async () => {
    await expect(linkPartnerUser('', 'user-1')).rejects.toThrow(/Both partner ID and user ID/);
    await expect(linkPartnerUser('partner-1', '')).rejects.toThrow(/Both partner ID and user ID/);
  });
});

describe('assignPartnerManager — orgHierarchy-validated manager assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1' },
      user: { id: 'user-admin', name: 'Admin' },
    });
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      if (col === 'users' && id === 'user-manager') {
        return { id: 'user-manager', companyId: 'company-1', name: 'Ritu Chawla', role: 'Manager', status: 'Active', isManager: true };
      }
      return null;
    });
  });

  it('assigns a manager-capable user in the same company', async () => {
    await assignPartnerManager('partner-1', 'user-manager');
    expect(mockUpdateDocById).toHaveBeenCalledWith(
      'channel_partners', 'partner-1',
      expect.objectContaining({ managerId: 'user-manager', managerName: 'Ritu Chawla' }),
    );
  });

  it('rejects a cross-company manager', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      if (col === 'users' && id === 'user-manager') {
        return { id: 'user-manager', companyId: 'company-2', name: 'Other Co', role: 'Manager', status: 'Active', isManager: true };
      }
      return null;
    });
    await expect(assignPartnerManager('partner-1', 'user-manager')).rejects.toThrow(/different company/);
  });

  it('rejects a non-manager user', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      if (col === 'users' && id === 'user-sales') {
        return { id: 'user-sales', companyId: 'company-1', name: 'Sales', role: 'Sales', status: 'Active', isManager: false };
      }
      return null;
    });
    await expect(assignPartnerManager('partner-1', 'user-sales')).rejects.toThrow(/manager role|not found|not active/);
    expect(mockUpdateDocById).not.toHaveBeenCalled();
  });

  it('rejects when the manager user does not exist', async () => {
    await expect(assignPartnerManager('partner-1', 'user-missing')).rejects.toThrow(/Manager user not found/);
  });

  it('clears the manager when an empty managerId is passed', async () => {
    await assignPartnerManager('partner-1', '');
    expect(mockUpdateDocById).toHaveBeenCalledWith(
      'channel_partners', 'partner-1',
      expect.objectContaining({ managerId: '', managerName: '' }),
    );
  });
});

describe('provisionPartnerUser — canonical provisioning path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      activeCompanyId: 'company-1',
      company: { id: 'company-1' },
      user: { id: 'user-admin', name: 'Admin' },
    });
    mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'user-provisioned' } });
  });

  it('creates the Firebase Auth account and the ERP user projection', async () => {
    const userId = await provisionPartnerUser({
      name: 'Alok Bansal',
      email: 'alok@greenleaf.example',
      password: 'SecurePass123!',
      companyId: 'company-1',
    });
    expect(userId).toBe('user-provisioned');
    expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalled();
    expect(mockCreateUserProjection).toHaveBeenCalledWith(
      'user-provisioned',
      expect.objectContaining({ role: 'Partner', companyId: 'company-1', email: 'alok@greenleaf.example' }),
    );
  });

  it('rejects missing email, password, or company', async () => {
    await expect(provisionPartnerUser({ name: 'X', email: '', password: 'p', companyId: 'c' })).rejects.toThrow(/Email is required/);
    await expect(provisionPartnerUser({ name: 'X', email: 'x@y.z', password: '', companyId: 'c' })).rejects.toThrow(/Password is required/);
    await expect(provisionPartnerUser({ name: 'X', email: 'x@y.z', password: 'p', companyId: '' })).rejects.toThrow(/Company is required/);
  });
});

describe('resolvePartnerSelf — canonical self-resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves via users.channelPartnerId → channel_partners/{id}', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'users' && id === 'user-1') return userDoc({ channelPartnerId: 'partner-1' });
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      return null;
    });
    const result = await resolvePartnerSelf('user-1');
    expect(result.state).toBe('linked');
    expect(result.partner?.id).toBe('partner-1');
    expect(mockGetOne).not.toHaveBeenCalledWith('channel_partners', 'partner-2');
  });

  it('falls back to the legacy partner-side userId link', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'users' && id === 'user-1') return userDoc(); // no channelPartnerId
      return null;
    });
    mockGetAll.mockResolvedValue([partnerDoc({ userId: 'user-1' })]);
    const result = await resolvePartnerSelf('user-1');
    expect(result.state).toBe('linked');
    expect(result.partner?.id).toBe('partner-1');
  });

  it('returns not-found when the user link points at a missing partner', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'users' && id === 'user-1') return userDoc({ channelPartnerId: 'partner-ghost' });
      return null;
    });
    const result = await resolvePartnerSelf('user-1');
    expect(result.state).toBe('not-found');
    expect(result.partner).toBeNull();
  });

  it('returns unlinked when no link exists on either side', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'users' && id === 'user-1') return userDoc();
      return null;
    });
    mockGetAll.mockResolvedValue([partnerDoc()]); // userId undefined
    const result = await resolvePartnerSelf('user-1');
    expect(result.state).toBe('unlinked');
    expect(result.partner).toBeNull();
  });

  it('does NOT resolve a different partner as self', async () => {
    mockGetOne.mockImplementation(async (col: string, id: string) => {
      if (col === 'users' && id === 'user-1') return userDoc({ channelPartnerId: 'partner-1' });
      if (col === 'channel_partners' && id === 'partner-1') return partnerDoc();
      return null;
    });
    const result = await resolvePartnerSelf('user-other');
    expect(result.state).toBe('unlinked');
  });
});

describe('buildPartnerUserLinkBackfillPlan — safe dry-run planning', () => {
  const partner = (overrides: Record<string, unknown> = {}) => ({
    id: 'partner-1', companyId: 'company-1', email: 'alok@greenleaf.example', isDeleted: false, ...overrides,
  });
  const user = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1', companyId: 'company-1', email: 'alok@greenleaf.example', isDeleted: false, ...overrides,
  });

  it('finds a safe email-match candidate', () => {
    const plan = buildPartnerUserLinkBackfillPlan({ partners: [partner()], users: [user()] });
    expect(plan.summary.candidates).toBe(1);
    expect(plan.links[0]).toMatchObject({ partnerId: 'partner-1', userId: 'user-1', matchedBy: 'email' });
    expect(plan.summary.conflicts).toBe(0);
  });

  it('flags an already-linked pair without planning a write', () => {
    const plan = buildPartnerUserLinkBackfillPlan({
      partners: [partner()],
      users: [user({ channelPartnerId: 'partner-1' })],
    });
    expect(plan.summary.alreadyLinked).toBe(1);
    expect(plan.links[0].alreadyLinked).toBe(true);
  });

  it('flags a cross-company match as a conflict', () => {
    const plan = buildPartnerUserLinkBackfillPlan({
      partners: [partner()],
      users: [user({ companyId: 'company-2' })],
    });
    expect(plan.summary.conflicts).toBe(1);
    expect(plan.summary.byReason.cross_company).toBe(1);
    expect(plan.links.filter((l) => !l.alreadyLinked)).toHaveLength(0);
  });

  it('flags a user already linked to a different partner as a conflict', () => {
    const plan = buildPartnerUserLinkBackfillPlan({
      partners: [partner()],
      users: [user({ channelPartnerId: 'partner-other' })],
    });
    expect(plan.summary.byReason.user_linked_to_other_partner).toBe(1);
  });

  it('flags ambiguous matches (partner email on two users) as conflicts', () => {
    const plan = buildPartnerUserLinkBackfillPlan({
      partners: [partner()],
      users: [user({ id: 'user-1' }), user({ id: 'user-2' })],
    });
    expect(plan.summary.byReason.ambiguous_partner_email).toBe(1);
    expect(plan.summary.conflicts).toBe(1);
  });

  it('respects the company filter', () => {
    const plan = buildPartnerUserLinkBackfillPlan(
      {
        partners: [partner({ id: 'p-c1', companyId: 'company-1' }), partner({ id: 'p-c2', companyId: 'company-2' })],
        users: [user({ id: 'u-c1', companyId: 'company-1' }), user({ id: 'u-c2', companyId: 'company-2' })],
      },
      { companyId: 'company-1' },
    );
    expect(plan.summary.partnersScanned).toBe(1);
    expect(plan.links.some((l) => l.partnerId === 'p-c2')).toBe(false);
  });
});
