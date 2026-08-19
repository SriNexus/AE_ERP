import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockTimestamp {
    seconds: number;
    nanoseconds: number;
    constructor(seconds: number, nanoseconds: number) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    toDate() { return new Date(this.seconds * 1000); }
    toMillis() { return this.seconds * 1000; }
  }
  return {
    getState: vi.fn(),
    doc: vi.fn((...args: unknown[]) => ({ __doc: args })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __ts: true })),
    getDocs: vi.fn(),
    query: vi.fn((...args: unknown[]) => ({ __query: args })),
    collection: vi.fn((...args: unknown[]) => ({ __collection: args })),
    where: vi.fn(),
    logRoleChange: vi.fn(),
    logSecurityEvent: vi.fn(),
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    genId: vi.fn((prefix: string) => `${prefix}-TEST-1`),
    Timestamp: MockTimestamp,
  };
});

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: vi.fn(),
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  serverTimestamp: mocks.serverTimestamp,
  getDocs: mocks.getDocs,
  query: mocks.query,
  collection: mocks.collection,
  where: mocks.where,
  Timestamp: mocks.Timestamp,
}));

vi.mock('../firebase', () => ({
  db: { __db: true },
  firebaseEnv: { isConfigured: true },
  COLLECTIONS: {
    GROUPS: 'groups', GROUP_MEMBERS: 'group_members', COMPANIES: 'companies',
    USERS: 'users', PLATFORM_SETTINGS: 'platform_settings', WAREHOUSES: 'warehouses',
    SECURITY_LOGS: 'security_logs', AUDIT_LOGS: 'audit_logs',
  },
}));

vi.mock('../auditLogger', () => ({
  logRoleChange: (...a: unknown[]) => { mocks.logRoleChange(...a); return Promise.resolve(); },
  logSecurityEvent: (...a: unknown[]) => { mocks.logSecurityEvent(...a); return Promise.resolve(); },
  logCreate: (...a: unknown[]) => { mocks.logCreate(...a); return Promise.resolve(); },
  logUpdate: (...a: unknown[]) => { mocks.logUpdate(...a); return Promise.resolve(); },
}));

// Keep the REAL firestore module (getAllPlatform must exercise the actual
// query-narrowing code) but replace the id generator with a deterministic one.
vi.mock('../firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../firestore')>();
  return {
    ...actual,
    genId: {
      generic: mocks.genId, lead: vi.fn(), customer: vi.fn(), project: vi.fn(), order: vi.fn(),
      invoice: vi.fn(), dispatch: vi.fn(), quotation: vi.fn(), payment: vi.fn(), employee: vi.fn(),
      registration: vi.fn(), schemeRegistration: vi.fn(),
    },
  };
});

import { createGroup, grantGroupAdmin, revokeGroupAdmin, bootstrapCompany, setGroupStatus, setPlatformSettings } from '../platformAdmin';
import { getAllPlatform } from '../firestore';

const OWNER_STATE = {
  user: { id: 'owner-1', name: 'Owner', email: 'shreeniwas.tripathi0@gmail.com', role: 'Owner', companyId: 'default', isOwner: true, isSuperAdmin: true },
  activeCompanyId: 'default',
};

function setUser(overrides: Record<string, unknown> = {}) {
  mocks.getState.mockReturnValue({
    user: { id: 'admin-1', name: 'Admin', email: 'admin@test.erp', role: 'Admin', companyId: 'CO-A' },
    activeCompanyId: 'CO-A',
    ...overrides,
  });
}

describe('Phase 4 — platform read path (getAllPlatform) is platform-identity-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-platform identities (fail closed, even before Firestore)', async () => {
    setUser({ user: { id: 'admin-1', name: 'Admin', email: 'admin@test.erp', role: 'Admin', companyId: 'CO-A' } });
    await expect(getAllPlatform('groups')).rejects.toThrow(/Super Admin identity/);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('owner identity reads platform collections with NO company constraint', async () => {
    mocks.getState.mockReturnValue(OWNER_STATE);
    mocks.getDocs.mockResolvedValue({ docs: [{ id: 'GROUP-A', data: () => ({ id: 'GROUP-A', name: 'Group A' }) }] });
    const result = await getAllPlatform('groups');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('GROUP-A');
    // The query must NOT carry a companyId equality — the platform collections
    // have no companyId at all (a constraint would silently return nothing).
    const queryArgs = mocks.query.mock.calls[0];
    const extraConstraints = queryArgs.slice(2);
    const constraintStrings = JSON.stringify(extraConstraints);
    expect(constraintStrings).not.toContain('companyId');
  });
});

describe('Phase 4 — platform mutations are owner/Super Admin gated and raw-written', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue(OWNER_STATE);
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Group A', status: 'Active' }) });
  });

  it('createGroup generates the id and writes groups/{id} with the id anchor (rules require id == path segment)', async () => {
    await createGroup({ name: 'CSGPL Group', shortName: 'CSGPL' });
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mocks.setDoc.mock.calls[0];
    expect(ref.__doc[1]).toBe('groups');
    expect(payload.id).toBe('GRP-TEST-1');
    expect(payload.name).toBe('CSGPL Group');
    expect(payload.status).toBe('Active');
    expect(mocks.logCreate).toHaveBeenCalled();
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('group_create', expect.stringContaining('CSGPL Group'), { groupId: 'GRP-TEST-1' });
  });

  it('grantGroupAdmin writes group_members/{groupId}_{userId} with the deterministic id AND updates users.groupId', async () => {
    await grantGroupAdmin({ groupId: 'GROUP-A', userId: 'MUSR-X', userEmail: 'x@test.erp', currentRole: 'Admin' });
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [memberRef, member] = mocks.setDoc.mock.calls[0];
    expect(memberRef.__doc[1]).toBe('group_members');
    expect(member.id).toBe('GROUP-A_MUSR-X');
    expect(member.groupId).toBe('GROUP-A');
    expect(member.userId).toBe('MUSR-X');
    expect(member.role).toBe('GroupAdmin');
    expect(member.status).toBe('Active');

    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const [userRef, userPatch] = mocks.updateDoc.mock.calls[0];
    expect(userRef.__doc[1]).toBe('users');
    expect(userPatch.role).toBe('GroupAdmin');
    expect(userPatch.groupId).toBe('GROUP-A');
    // companyId is never part of the grant write — it is immutable at the
    // rules layer (the home Company is the user's existing one).
    expect('companyId' in userPatch).toBe(false);

    expect(mocks.logRoleChange).toHaveBeenCalledWith('MUSR-X', 'x@test.erp', 'Admin', 'GroupAdmin');
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('group_admin_grant', expect.stringContaining('x@test.erp'), { groupId: 'GROUP-A', userId: 'MUSR-X' });
  });

  it('revokeGroupAdmin flips group_members to Revoked and reverts users.role to Admin', async () => {
    await revokeGroupAdmin('GROUP-A', 'MUSR-X', 'x@test.erp');
    expect(mocks.updateDoc).toHaveBeenCalledTimes(2);
    const [memberRef, memberPatch] = mocks.updateDoc.mock.calls[0];
    expect(memberRef.__doc[1]).toBe('group_members');
    expect(memberPatch.status).toBe('Revoked');
    const [userRef, userPatch] = mocks.updateDoc.mock.calls[1];
    expect(userRef.__doc[1]).toBe('users');
    expect(userPatch.role).toBe('Admin');
    expect(mocks.logRoleChange).toHaveBeenCalledWith('MUSR-X', 'x@test.erp', 'Admin', 'Admin');
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('group_admin_revoke', expect.stringContaining('x@test.erp'), { groupId: 'GROUP-A', userId: 'MUSR-X' });
  });

  it('bootstrapCompany stamps the explicit groupId on the new company (never derived)', async () => {
    await bootstrapCompany({ groupId: 'GROUP-A', name: 'ChaitanyaSri Greentech Pvt Ltd' });
    const [ref, payload] = mocks.setDoc.mock.calls[0];
    expect(ref.__doc[1]).toBe('companies');
    expect(payload.id).toBe('CO-TEST-1');
    expect(payload.companyId).toBe('CO-TEST-1');
    expect(payload.groupId).toBe('GROUP-A');
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('company_bootstrap', expect.stringContaining('ChaitanyaSri'), { companyId: 'CO-TEST-1', groupId: 'GROUP-A' });
  });

  it('setGroupStatus requires the id anchor on the group update (rules)', async () => {
    await setGroupStatus('GROUP-A', 'Suspended');
    const [ref, patch] = mocks.updateDoc.mock.calls[0];
    expect(ref.__doc[1]).toBe('groups');
    expect(patch.id).toBe('GROUP-A');
    expect(patch.status).toBe('Suspended');
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('group_suspend', expect.stringContaining('Group A'), { groupId: 'GROUP-A', status: 'Suspended' });
  });

  it('setPlatformSettings writes platform_settings/global (singleton id)', async () => {
    await setPlatformSettings({ maintenanceMode: true, maintenanceMessage: 'Scheduled' });
    const calls = mocks.updateDoc.mock.calls.length + mocks.setDoc.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    const allRefs = [...mocks.updateDoc.mock.calls, ...mocks.setDoc.mock.calls].map((c) => c[0].__doc[1]);
    expect(allRefs).toContain('platform_settings');
    const payload = [...mocks.updateDoc.mock.calls, ...mocks.setDoc.mock.calls].find((c) => c[0].__doc[1] === 'platform_settings')![1];
    expect(payload.id).toBe('global');
    expect(payload.maintenanceMode).toBe(true);
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('maintenance_mode', expect.stringContaining('ENABLED'), { maintenanceMode: true });
  });

  it('rejects non-platform identities (fail closed)', async () => {
    setUser({ user: { id: 'admin-1', name: 'Admin', email: 'admin@test.erp', role: 'Admin', companyId: 'CO-A' } });
    await expect(createGroup({ name: 'X', shortName: 'X' })).rejects.toThrow(/Super Admin identity/);
    await expect(grantGroupAdmin({ groupId: 'G', userId: 'U', userEmail: 'e@x.erp', currentRole: 'Admin' })).rejects.toThrow(/Super Admin identity/);
    await expect(bootstrapCompany({ groupId: 'G', name: 'X' })).rejects.toThrow(/Super Admin identity/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
