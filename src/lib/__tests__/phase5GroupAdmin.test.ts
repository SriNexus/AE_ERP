import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  doc: vi.fn((...args: unknown[]) => ({ __doc: args })),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __ts: true })),
  logRoleChange: vi.fn(),
  logSecurityEvent: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  genId: vi.fn((prefix: string) => `${prefix}-TEST-1`),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: vi.fn(),
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock('../firebase', () => ({
  db: { __db: true },
  firebaseEnv: { isConfigured: true },
  COLLECTIONS: {
    GROUPS: 'groups', GROUP_MEMBERS: 'group_members', COMPANIES: 'companies',
    USERS: 'users',
  },
}));

vi.mock('../auditLogger', () => ({
  logRoleChange: (...a: unknown[]) => { mocks.logRoleChange(...a); return Promise.resolve(); },
  logSecurityEvent: (...a: unknown[]) => { mocks.logSecurityEvent(...a); return Promise.resolve(); },
  logCreate: (...a: unknown[]) => { mocks.logCreate(...a); return Promise.resolve(); },
  logUpdate: (...a: unknown[]) => { mocks.logUpdate(...a); return Promise.resolve(); },
}));

// Real genId (the generic prefix path is what createCompanyInGroup uses).
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

import {
  requireGroupAdminIdentity,
  grantGroupAdminForGroup,
  createCompanyInGroup,
  updateCompanyInGroup,
} from '../groupAdmin';

const GA_STATE = {
  user: { id: 'MUSR-GA-A', name: 'GA', email: 'ga.a@test.erp', role: 'GroupAdmin', companyId: 'CO-A', groupId: 'GROUP-A', status: 'Active' },
  activeCompanyId: 'CO-A',
};

function setUser(overrides: Record<string, unknown> = {}) {
  mocks.getState.mockReturnValue({
    user: { id: 'user-1', name: 'User', email: 'user@test.erp', role: 'Sales', companyId: 'CO-A', status: 'Active' },
    activeCompanyId: 'CO-A',
    ...overrides,
  });
}

describe('Phase 5 — requireGroupAdminIdentity is fail-closed', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects when no user is signed in', () => {
    mocks.getState.mockReturnValue({ user: null, activeCompanyId: 'CO-A' });
    expect(() => requireGroupAdminIdentity()).toThrow(/Group Admin operations require/);
  });

  it('rejects non-GroupAdmin roles', () => {
    setUser();
    expect(() => requireGroupAdminIdentity()).toThrow(/Group Admin operations require/);
  });

  it('rejects an INACTIVE GroupAdmin', () => {
    setUser({ user: { ...GA_STATE.user, status: 'Inactive' } });
    expect(() => requireGroupAdminIdentity()).toThrow(/Group Admin operations require/);
  });

  it('rejects a GroupAdmin with NO groupId (fail closed — no Group scope resolves)', () => {
    setUser({ user: { ...GA_STATE.user, groupId: '' } });
    expect(() => requireGroupAdminIdentity()).toThrow(/no Group assigned/);
  });

  it('returns the authoritative actor identity for a valid GroupAdmin', () => {
    mocks.getState.mockReturnValue(GA_STATE);
    const identity = requireGroupAdminIdentity();
    expect(identity).toEqual({ actorId: 'MUSR-GA-A', groupId: 'GROUP-A' });
  });
});

describe('Phase 5 — grantGroupAdminForGroup (§7.9 self-service second GroupAdmin)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getState.mockReturnValue(GA_STATE); });

  it('writes the member doc FIRST (deterministic id) then promotes the users role', async () => {
    await grantGroupAdminForGroup('GROUP-A', { userId: 'MUSR-USER-C', userEmail: 'user.c@test.erp', currentRole: 'Sales' });

    // 1) group_members/GROUP-A_MUSR-USER-C with the auditable anchor.
    const memberCall = mocks.setDoc.mock.calls[0];
    expect(memberCall[0]).toEqual({ __doc: [{ __db: true }, 'group_members', 'GROUP-A_MUSR-USER-C'] });
    expect(memberCall[1]).toMatchObject({
      id: 'GROUP-A_MUSR-USER-C', groupId: 'GROUP-A', userId: 'MUSR-USER-C',
      role: 'GroupAdmin', status: 'Active', grantedBy: 'MUSR-GA-A',
    });
    // 2) users role promotion (groupId unchanged, updatedBy = the actor).
    const userCall = mocks.updateDoc.mock.calls[0];
    expect(userCall[0]).toEqual({ __doc: [{ __db: true }, 'users', 'MUSR-USER-C'] });
    expect(userCall[1]).toMatchObject({ role: 'GroupAdmin', groupId: 'GROUP-A', updatedBy: 'MUSR-GA-A' });
    // Audit trail.
    expect(mocks.logRoleChange).toHaveBeenCalledWith('MUSR-USER-C', 'user.c@test.erp', 'Sales', 'GroupAdmin');
    expect(mocks.logSecurityEvent).toHaveBeenCalledWith('group_admin_grant', expect.stringContaining('user.c@test.erp'), { groupId: 'GROUP-A', userId: 'MUSR-USER-C' });
  });

  it('never grants the actor themself (identity gate + rules deny self-grant)', async () => {
    // The service passes the requested userId through; the rules' userId !=
    // currentUserId guard is the boundary. The service must still fail closed
    // on a self-target before any write.
    await expect(
      grantGroupAdminForGroup('GROUP-A', { userId: 'MUSR-GA-A', userEmail: 'ga.a@test.erp', currentRole: 'GroupAdmin' }),
    ).rejects.toThrow(/cannot grant themselves/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('rejects non-GroupAdmin actors before any write', async () => {
    setUser();
    await expect(
      grantGroupAdminForGroup('GROUP-A', { userId: 'MUSR-USER-C', userEmail: 'user.c@test.erp', currentRole: 'Sales' }),
    ).rejects.toThrow(/Group Admin operations require/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('uses the actor authoritative groupId, never a client-supplied one', async () => {
    // Caller passes a forged groupId — the service must use the actor's group.
    await grantGroupAdminForGroup('GROUP-B', { userId: 'MUSR-USER-C', userEmail: 'user.c@test.erp', currentRole: 'Sales' });
    const memberCall = mocks.setDoc.mock.calls[0];
    expect(memberCall[1]).toMatchObject({ groupId: 'GROUP-A', userId: 'MUSR-USER-C' });
  });
});

describe('Phase 5 — createCompanyInGroup / updateCompanyInGroup (§7.3)', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getState.mockReturnValue(GA_STATE); });

  it('creates a Company stamped with the actor authoritative Group', async () => {
    mocks.genId.mockReturnValueOnce('CO-NEW-1');
    const result = await createCompanyInGroup({ name: 'Company New', businessMode: 'solar' });

    expect(result).toEqual({ id: 'CO-NEW-1' });
    const call = mocks.setDoc.mock.calls[0];
    expect(call[0]).toEqual({ __doc: [{ __db: true }, 'companies', 'CO-NEW-1'] });
    expect(call[1]).toMatchObject({
      id: 'CO-NEW-1', companyId: 'CO-NEW-1', groupId: 'GROUP-A', name: 'Company New', status: 'Active',
      createdBy: 'MUSR-GA-A', updatedBy: 'MUSR-GA-A',
    });
    expect(mocks.logCreate).toHaveBeenCalledWith('company', 'CO-NEW-1', expect.objectContaining({ groupId: 'GROUP-A' }), 'companies');
  });

  it('updateCompanyInGroup re-stamps the authoritative groupId and strips a forged one', async () => {
    await updateCompanyInGroup('CO-NEW-1', { name: 'Renamed', groupId: 'GROUP-B', status: 'Active' });
    const call = mocks.updateDoc.mock.calls[0];
    expect(call[0]).toEqual({ __doc: [{ __db: true }, 'companies', 'CO-NEW-1'] });
    // The forged GROUP-B groupId must never reach Firestore; the actor's
    // authoritative GROUP-A is re-stamped (rules also enforce groupIdUnchanged).
    expect(call[1]).toMatchObject({ name: 'Renamed', status: 'Active', groupId: 'GROUP-A', updatedBy: 'MUSR-GA-A' });
    expect(call[1].groupId).not.toBe('GROUP-B');
  });

  it('rejects a non-GroupAdmin actor for company creation', async () => {
    setUser();
    await expect(createCompanyInGroup({ name: 'X' })).rejects.toThrow(/Group Admin operations require/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
