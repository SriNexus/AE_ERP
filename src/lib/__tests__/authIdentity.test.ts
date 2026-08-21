import { describe, expect, it, vi } from 'vitest';
import { AuthIdentityError, resolveAuthenticatedErpUser, type AuthIdentityGateway } from '../authIdentity';

const profile = { id: 'MUSR-company-0123456789', companyId: 'company', email: 'user@example.com', name: 'User', role: 'Admin', status: 'Active' };
function gateway(overrides: Partial<AuthIdentityGateway> = {}): AuthIdentityGateway {
  return {
    readMapping: vi.fn().mockResolvedValue(null),
    readUser: vi.fn().mockResolvedValue(null),
    findUsersByEmail: vi.fn().mockResolvedValue([]),
    createMapping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
const authUser = { uid: 'firebase-auth-uid', email: 'USER@example.com' };
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'AuthIdentityError', code });
}

describe('authenticated ERP identity resolution', () => {
  it('resolves an existing canonical mapping', async () => {
    const api = gateway({ readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: profile.companyId }), readUser: vi.fn().mockResolvedValue(profile) });
    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ id: profile.id });
    expect(api.findUsersByEmail).not.toHaveBeenCalled();
  });
  it('lazily maps one legacy user found by normalized email', async () => {
    const api = gateway({ findUsersByEmail: vi.fn().mockResolvedValue([profile]) });
    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ id: profile.id });
    expect(api.findUsersByEmail).toHaveBeenCalledWith('user@example.com');
    expect(api.createMapping).toHaveBeenCalledWith(authUser.uid, expect.objectContaining({ id: profile.id }));
  });
  it('reports a missing legacy profile', async () => { await expectCode(resolveAuthenticatedErpUser(authUser, gateway()), 'auth-mapping-missing'); });
  it('rejects ambiguous legacy identities', async () => { await expectCode(resolveAuthenticatedErpUser(authUser, gateway({ findUsersByEmail: vi.fn().mockResolvedValue([profile, { ...profile, id: 'MUSR-other' }]) })), 'ambiguous-identity'); });
  it('rejects inactive profiles', async () => { await expectCode(resolveAuthenticatedErpUser(authUser, gateway({ findUsersByEmail: vi.fn().mockResolvedValue([{ ...profile, status: 'Inactive' }]) })), 'inactive-user'); });
  it('does not mislabel permission denied as missing', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    const api = gateway({ readMapping: vi.fn().mockRejectedValue(denied) });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'permission-denied');
  });
  it('rejects a mapping whose ERP profile is gone', async () => {
    const api = gateway({ readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: profile.companyId }) });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'erp-profile-missing');
  });
  it('resolves the UID-keyed account doc before any email scan (duplicate-email incident)', async () => {
    // The user-creation flow writes users/{authUid}. Even when the email is
    // shared with a parallel MUSR master doc, the UID-keyed account doc is the
    // strongest identity key and must win deterministically.
    const accountDoc = { companyId: 'default', email: 'user@example.com', name: 'User', role: 'Sales Executive', status: 'Active' };
    const api = gateway({
      readMapping: vi.fn().mockResolvedValue(null),
      readUser: vi.fn().mockResolvedValue(accountDoc),
      findUsersByEmail: vi.fn().mockResolvedValue([
        accountDoc,
        { id: 'MUSR-default-5656565645', companyId: 'default', email: 'user@example.com', name: 'User', role: 'Sales Executive', status: 'Active' },
      ]),
    });
    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ id: authUser.uid });
    expect(api.findUsersByEmail).not.toHaveBeenCalled();
    expect(api.createMapping).toHaveBeenCalledWith(authUser.uid, expect.objectContaining({ id: authUser.uid, companyId: 'default' }));
  });
  it('rejects a UID-keyed doc whose email does not match the authenticated email', async () => {
    const api = gateway({ readUser: vi.fn().mockResolvedValue({ companyId: 'default', email: 'other@example.com', status: 'Active' }) });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'mapping-conflict');
  });
  it('excludes soft-deleted records from the email fallback', async () => {
    // Deleted master docs (isDeleted=true) must never count as identity
    // candidates or manufacture ambiguity.
    const api = gateway({
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 'MUSR-CO-1783978330465-3EV9-7275391229', companyId: 'CO-1', email: 'user@example.com', status: 'Active', isDeleted: true },
        { id: 'eevOBUvdqcdh3HE6pZZot1HZ6Yb2', companyId: 'CO-1', email: 'user@example.com', status: 'Active' },
      ]),
    });
    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ id: 'eevOBUvdqcdh3HE6pZZot1HZ6Yb2' });
  });
  it('still rejects genuinely ambiguous live email matches', async () => {
    // Two LIVE records with the same email and no UID-keyed doc remain an
    // unresolved ambiguity — the guard is preserved, not weakened.
    const api = gateway({
      readUser: vi.fn().mockResolvedValue(null),
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 'MUSR-company-0123456789', companyId: 'company', email: 'user@example.com', status: 'Active' },
        { id: 'MUSR-other-9876543210', companyId: 'company', email: 'user@example.com', status: 'Active' },
      ]),
    });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'ambiguous-identity');
  });
  it('rejects a soft-deleted UID-keyed account doc', async () => {
    // A deleted users/{authUid} doc must not log in — validateProfile treats
    // isDeleted as inactive.
    const api = gateway({ readUser: vi.fn().mockResolvedValue({ companyId: 'default', email: 'user@example.com', status: 'Active', isDeleted: true }) });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'inactive-user');
  });
  it('reports inactive-user when every email match is soft-deleted', async () => {
    const api = gateway({
      readUser: vi.fn().mockResolvedValue(null),
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 'MUSR-company-0123456789', companyId: 'company', email: 'user@example.com', status: 'Active', isDeleted: true },
        { id: 'MUSR-other-9876543210', companyId: 'company', email: 'user@example.com', status: 'Active', isDeleted: true },
      ]),
    });
    await expectCode(resolveAuthenticatedErpUser(authUser, api), 'inactive-user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stale-mapping self-heal — the actual root cause behind "Group Admin
// permission-denied even after the write payload carries the correct
// groupId": user_auth_maps/{authUid} is written once at first login and
// never refreshed on ordinary logins, but firestore.rules' actorGroupId()
// (every groupAdminCan*() check) reads groupId/companyId straight from that
// cached document — not the live users/{id} profile a client re-syncs into
// its own store on boot. A later promotion to Group Admin (a fresh groupId
// stamped onto the profile) previously left the mapping permanently
// groupId-less, so every groupAdminCanCreate()/Update() check failed no
// matter what the client correctly stamped onto its own writes.
// ═══════════════════════════════════════════════════════════════════════════
describe('stale user_auth_maps self-heal', () => {
  it('refreshes a mapping that never had a groupId when the live profile now has one', async () => {
    const promotedProfile = { ...profile, role: 'GroupAdmin', groupId: 'group-csgpl' };
    const createMapping = vi.fn().mockResolvedValue(undefined);
    const api = gateway({
      readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: profile.companyId }), // no groupId
      readUser: vi.fn().mockResolvedValue(promotedProfile),
      createMapping,
    });

    const resolved = await resolveAuthenticatedErpUser(authUser, api);

    expect(resolved).toMatchObject({ id: profile.id, groupId: 'group-csgpl' });
    expect(createMapping).toHaveBeenCalledWith(authUser.uid, expect.objectContaining({ groupId: 'group-csgpl' }));
  });

  it('does not attempt a refresh write when the mapping already matches the live profile', async () => {
    const inSyncProfile = { ...profile, groupId: 'group-csgpl' };
    const createMapping = vi.fn().mockResolvedValue(undefined);
    const api = gateway({
      readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: profile.companyId, groupId: 'group-csgpl' }),
      readUser: vi.fn().mockResolvedValue(inSyncProfile),
      createMapping,
    });

    await resolveAuthenticatedErpUser(authUser, api);

    expect(createMapping).not.toHaveBeenCalled();
  });

  it('still resolves successfully even when the mapping refresh write is rejected (best-effort, never blocks login)', async () => {
    const promotedProfile = { ...profile, role: 'GroupAdmin', groupId: 'group-csgpl' };
    const createMapping = vi.fn().mockRejectedValue(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    const api = gateway({
      readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: profile.companyId }),
      readUser: vi.fn().mockResolvedValue(promotedProfile),
      createMapping,
    });

    // Must resolve (not reject) — a failed best-effort refresh must never
    // turn into a login failure.
    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ groupId: 'group-csgpl' });
  });

  it('a stale companyId no longer hard-locks the account out of login (previously threw mapping-conflict on every login)', async () => {
    const reassignedProfile = { ...profile, companyId: 'company-new' };
    const createMapping = vi.fn().mockResolvedValue(undefined);
    const api = gateway({
      readMapping: vi.fn().mockResolvedValue({ authUid: authUser.uid, userId: profile.id, companyId: 'company' }), // old company
      readUser: vi.fn().mockResolvedValue(reassignedProfile),
      createMapping,
    });

    await expect(resolveAuthenticatedErpUser(authUser, api)).resolves.toMatchObject({ companyId: 'company-new' });
    expect(createMapping).toHaveBeenCalledWith(authUser.uid, expect.objectContaining({ companyId: 'company-new' }));
  });
});
