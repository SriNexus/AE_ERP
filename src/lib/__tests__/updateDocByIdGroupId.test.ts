/**
 * updateDocByIdGroupId.test.ts — Group Admin "missing or insufficient
 * permissions" creating a user, root-cause regression guard.
 *
 * Root cause: updateDocById() unconditionally stripped ANY incoming
 * `groupId` for GROUP_ID_EXCLUDED_COLLECTIONS (users/roles/companies/...)
 * and only re-added one it computed itself — which it deliberately never
 * does for these collections (their groupId must be derived from the
 * TARGET document's own company, not the actor's current session company —
 * see entityProjection.ts). The result: users/{authId} was ALWAYS written
 * with no groupId at all, even though entityProjection.ts's
 * createProjectionWithUserId had already correctly computed one and passed
 * it through. firestore.rules' GroupAdmin user-create branch requires
 * `hasGroupId(request.resource.data) && request.resource.data.groupId ==
 * actorGroupId()` — with no groupId field present that branch can never
 * match, and the write falls through to the isAdmin() branch (false for a
 * GroupAdmin actor — rules check role=='Admin' literally) — denied.
 *
 * Fix: updateDocById now trusts an explicitly-supplied groupId in `data`
 * for excluded collections instead of discarding it, while still never
 * auto-computing one for them (a raw call that doesn't supply groupId
 * behaves exactly as before).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn((..._args: unknown[]) => Promise.resolve()),
  updateDoc: vi.fn((..._args: unknown[]) => Promise.resolve()),
  doc: vi.fn((...args: unknown[]) => ({ __doc: args })),
  serverTimestamp: vi.fn(() => ({ __ts: true })),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: mocks.doc,
    getDoc: mocks.getDoc,
    setDoc: mocks.setDoc,
    updateDoc: mocks.updateDoc,
    serverTimestamp: mocks.serverTimestamp,
  };
});

import { updateDocById } from '../firestore';
import { useAppStore } from '../../store/useAppStore';
import { COLLECTIONS } from '../firebase';

function docSnap(exists: boolean, data: Record<string, unknown> = {}) {
  return { exists: () => exists, data: () => data };
}

describe('updateDocById — groupId pass-through for GROUP_ID_EXCLUDED_COLLECTIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      user: { id: 'ga-1', name: 'GA', email: 'ga@test.erp', role: 'GroupAdmin', companyId: 'CO-A', groupId: 'GROUP-A', status: 'Active' },
      activeCompanyId: 'CO-A',
      company: { ...useAppStore.getState().company, id: 'CO-A' },
    });
  });

  it('creates users/{authId} WITH the explicitly-supplied groupId (the actual Group Admin user-creation path)', async () => {
    mocks.getDoc.mockResolvedValue(docSnap(false));
    await updateDocById(COLLECTIONS.USERS, 'new-user-id', {
      name: 'New Hire', email: 'new@test.erp', role: 'Sales', companyId: 'CO-A',
      groupId: 'GROUP-A', // computed by entityProjection.ts's hydrateCreatePayload()
    });
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.setDoc.mock.calls[0] as [unknown, any];
    expect(payload.groupId).toBe('GROUP-A');
  });

  it('does NOT invent a groupId out of thin air when none is supplied (raw callers unaffected)', async () => {
    mocks.getDoc.mockResolvedValue(docSnap(false));
    await updateDocById(COLLECTIONS.USERS, 'new-user-id', { name: 'New Hire', email: 'new@test.erp', companyId: 'CO-A' });
    const [, payload] = mocks.setDoc.mock.calls[0] as [unknown, any];
    expect(payload.groupId).toBeUndefined();
  });

  it('ignores the neutral "all"/"default" sentinels even if a caller mistakenly supplies one', async () => {
    mocks.getDoc.mockResolvedValue(docSnap(false));
    await updateDocById(COLLECTIONS.USERS, 'new-user-id', { name: 'X', groupId: 'default' });
    const [, payload] = mocks.setDoc.mock.calls[0] as [unknown, any];
    expect(payload.groupId).toBeUndefined();
  });

  it('also passes a supplied groupId through on the update-existing-doc path (updateDoc, not setDoc)', async () => {
    mocks.getDoc.mockResolvedValue(docSnap(true, { companyId: 'CO-A' }));
    await updateDocById(COLLECTIONS.USERS, 'existing-user-id', { role: 'Manager', groupId: 'GROUP-A' });
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.updateDoc.mock.calls[0] as [unknown, any];
    expect(payload.groupId).toBe('GROUP-A');
  });

  it('a non-excluded collection still gets its OWN auto-computed groupId, unaffected by this fix', async () => {
    mocks.getDoc.mockResolvedValue(docSnap(false));
    useAppStore.setState({
      companyGroupIds: { 'CO-A': 'GROUP-A' },
    } as any);
    await updateDocById(COLLECTIONS.LEADS, 'lead-1', { name: 'Lead X', companyId: 'CO-A' });
    const [, payload] = mocks.setDoc.mock.calls[0] as [unknown, any];
    expect(payload.groupId).toBe('GROUP-A');
  });
});
