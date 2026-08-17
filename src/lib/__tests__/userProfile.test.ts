import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';

const mocks = vi.hoisted(() => {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  return {
    getOne: vi.fn(),
    updateDocById: vi.fn(),
    writeBatch: vi.fn(() => batch),
    doc: vi.fn((_db, collection, id) => `${collection}/${id}`),
    serverTimestamp: vi.fn(() => 'server-timestamp'),
    getDoc: vi.fn(async (reference: string) => {
      const data = await mocks.getOne('users', reference.split('/').pop());
      return { id: reference.split('/').pop(), exists: () => Boolean(data), data: () => data };
    }),
    uploadFile: vi.fn(),
    reauthenticateWithCredential: vi.fn().mockResolvedValue(undefined),
    updateEmail: vi.fn().mockResolvedValue(undefined),
    credential: vi.fn((_email, _password) => ({ token: 'credential' })),
    batch,
  };
});

vi.mock('../firebase', () => ({
  COLLECTIONS: {
    USERS: 'users',
    USER_AUTH_MAPS: 'user_auth_maps',
  },
  db: {},
  firebaseEnv: { isConfigured: true },
}));

vi.mock('../firestore', () => ({
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
}));

vi.mock('../storage', () => ({
  uploadFile: mocks.uploadFile,
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  serverTimestamp: mocks.serverTimestamp,
  writeBatch: mocks.writeBatch,
}));

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: mocks.credential },
  reauthenticateWithCredential: mocks.reauthenticateWithCredential,
  updateEmail: mocks.updateEmail,
}));

import {
  loadCurrentUserProfile,
  normalizeUserProfile,
  profileToAppUser,
  syncCurrentUserProfile,
  updateCurrentUserProfile,
  UserProfileError,
} from '../userProfile';

describe('canonical user profile consolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().logout();
    useAppStore.setState({ user: null, isAuthenticated: false });
    mocks.batch.update.mockClear();
    mocks.batch.set.mockClear();
    mocks.batch.commit.mockResolvedValue(undefined);
  });

  it('normalizes legacy identity aliases into the canonical profile', () => {
    const profile = normalizeUserProfile({
      id: 'MUSR-default-0234824979',
      companyId: 'default',
      email: 'Admin@Neozy.in',
      name: 'Super Admin',
      avatar: 'https://cdn.example/avatar.png',
      signature: 'data:image/png;base64,abc123',
      phone: '0234824979',
      displayName: '',
      role: 'Admin',
    });

    expect(profile).toMatchObject({
      id: 'MUSR-default-0234824979',
      companyId: 'default',
      email: 'admin@neozy.in',
      name: 'Super Admin',
      displayName: 'Super Admin',
      avatarUrl: 'https://cdn.example/avatar.png',
      signatureUrl: 'data:image/png;base64,abc123',
    });
  });

  it('keeps the profile section on the canonical user-profile hook instead of settings storage', () => {
    const source = readFileSync('src/components/settings/sections/ProfileSection.tsx', 'utf8');
    expect(source).toContain('useMyProfile()');
    expect(source).not.toContain("useSettingsSection('my-profile')");
    expect(source).not.toContain('useSaveSettings()');
  });
  it('syncs the canonical profile into the app store for header/sidebar consumers', () => {
    useAppStore.setState({
      user: {
        id: 'MUSR-default-0234824979',
        name: 'Old Name',
        displayName: 'Old Name',
        email: 'admin@neozy.in',
        role: 'Admin',
        companyId: 'default',
      },
      isAuthenticated: true,
    });

    syncCurrentUserProfile({
      id: 'MUSR-default-0234824979',
      companyId: 'default',
      email: 'admin@neozy.in',
      name: 'Super Admin',
      displayName: 'Super Admin',
      phone: '0234824979',
      avatarUrl: 'https://cdn.example/avatar.png',
      signatureUrl: 'https://cdn.example/signature.png',
      role: 'Admin',
      status: 'Active',
    });

    expect(useAppStore.getState().user).toMatchObject({
      name: 'Super Admin',
      displayName: 'Super Admin',
      avatarUrl: 'https://cdn.example/avatar.png',
      avatar: 'https://cdn.example/avatar.png',
      signatureUrl: 'https://cdn.example/signature.png',
    });
  });

  it('distinguishes permission denied from missing profile on load', async () => {
    mocks.getOne.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' }));
    await expect(loadCurrentUserProfile('MUSR-default-0234824979')).rejects.toMatchObject({ name: 'UserProfileError', code: 'permission-denied' });
  });
  it('reports a missing canonical profile explicitly', async () => {
    mocks.getOne.mockResolvedValueOnce(null);
    await expect(loadCurrentUserProfile('missing-user')).rejects.toMatchObject({ name: 'UserProfileError', code: 'profile-missing' });
  });
  it('loads the canonical ERP profile document directly', async () => {
    mocks.getOne.mockResolvedValueOnce({
      id: 'MUSR-default-0234824979',
      companyId: 'default',
      email: 'admin@neozy.in',
      name: 'Super Admin',
      phone: '0234824979',
      role: 'Admin',
      status: 'Active',
    });

    await expect(loadCurrentUserProfile('MUSR-default-0234824979')).resolves.toMatchObject({
      id: 'MUSR-default-0234824979',
      displayName: 'Super Admin',
      email: 'admin@neozy.in',
    });
  });

  it('updates the canonical user document without touching Auth when email is unchanged', async () => {
    mocks.getOne.mockResolvedValueOnce({
      id: 'MUSR-default-0234824979',
      companyId: 'default',
      email: 'admin@neozy.in',
      name: 'Super Admin',
      phone: '0234824979',
      role: 'Admin',
      status: 'Active',
      avatarUrl: 'https://cdn.example/avatar.png',
    });

    const result = await updateCurrentUserProfile({
      userId: 'MUSR-default-0234824979',
      authUser: {
        uid: 'firebase-auth-uid',
        email: 'admin@neozy.in',
        getIdToken: vi.fn().mockResolvedValue('token'),
      } as any,
      profile: {
        displayName: 'Super Admin Prime',
        email: 'admin@neozy.in',
        phone: '0234824979',
      },
    });

    expect(result).toMatchObject({
      displayName: 'Super Admin Prime',
      email: 'admin@neozy.in',
    });
    expect(mocks.updateEmail).not.toHaveBeenCalled();
    expect(mocks.batch.update).toHaveBeenCalledWith('users/MUSR-default-0234824979', expect.objectContaining({
      name: 'Super Admin Prime',
      displayName: 'Super Admin Prime',
      email: 'admin@neozy.in',
      phone: '0234824979',
      avatarUrl: 'https://cdn.example/avatar.png',
    }));
    expect(mocks.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('updates Auth email and the mapping atomically, then rolls Auth back if Firestore commit fails', async () => {
    mocks.getOne
      .mockResolvedValueOnce({
        id: 'MUSR-default-0234824979',
        companyId: 'default',
        email: 'admin@neozy.in',
        name: 'Super Admin',
        phone: '0234824979',
        role: 'Admin',
        status: 'Active',
      })
      .mockResolvedValueOnce({
        authUid: 'firebase-auth-uid',
        userId: 'MUSR-default-0234824979',
        companyId: 'default',
        email: 'admin@neozy.in',
        createdAt: '2026-07-12T00:00:00.000Z',
      });
    mocks.batch.commit.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' }));

    await expect(updateCurrentUserProfile({
      userId: 'MUSR-default-0234824979',
      authUser: {
        uid: 'firebase-auth-uid',
        email: 'admin@neozy.in',
        getIdToken: vi.fn().mockResolvedValue('token'),
      } as any,
      profile: {
        displayName: 'Super Admin',
        email: 'owner@neozy.in',
        phone: '0234824979',
        currentPassword: 'admin123',
      },
    })).rejects.toBeInstanceOf(UserProfileError);

    expect(mocks.credential).toHaveBeenCalledWith('admin@neozy.in', expect.any(String));
    expect(mocks.reauthenticateWithCredential).toHaveBeenCalledTimes(1);
    expect(mocks.updateEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ email: 'admin@neozy.in' }), 'owner@neozy.in');
    expect(mocks.updateEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ email: 'admin@neozy.in' }), 'admin@neozy.in');
  });

  it('reads the canonical user directly without the generic entity visibility filter', async () => {
    mocks.getOne.mockResolvedValueOnce({
      id: 'MUSR-default-0234824979', companyId: 'default', email: 'admin@neozy.in',
      name: 'Super Admin', role: 'Super Admin', status: 'Active',
    });
    await expect(loadCurrentUserProfile('MUSR-default-0234824979')).resolves.toMatchObject({
      id: 'MUSR-default-0234824979', displayName: 'Super Admin',
    });
    expect(mocks.getDoc).toHaveBeenCalledWith('users/MUSR-default-0234824979');
    const source = readFileSync('src/lib/userProfile.ts', 'utf8');
    expect(source).not.toContain('getOne<Record<string, unknown>>(COLLECTIONS.USERS, userId)');
  });
  it('renders from canonical store profile and avoids duplicate resolved-user reads', () => {
    const hook = readFileSync('src/features/settings/hooks/useMyProfile.ts', 'utf8');
    expect(hook).toContain('initialData: storedUser');
    expect(hook).toContain('storeIdentityIsCanonical');
    expect(hook).toContain('normalizeUserProfile({ ...resolved, id: resolved.id })');
    expect(hook).not.toContain('loadCurrentUserProfile(resolved.id)');
  });
  it('resolves My Profile through the live Auth mapping before loading the canonical ERP user', () => {
    const source = readFileSync('src/features/settings/hooks/useMyProfile.ts', 'utf8');
    expect(source).toContain('resolveAuthenticatedErpUser(authUser)');
    expect(source).toContain('normalizeUserProfile({ ...resolved, id: resolved.id })');
    expect(source).not.toContain('loadCurrentUserProfile(resolved.id)');
    expect(source).not.toContain('queryFn: () => loadCurrentUserProfile(userId)');
  });

  it('uses one visibility flag for desktop and mobile Settings navigation', () => {
    const config = readFileSync('src/features/settings/config.ts', 'utf8');
    const desktop = readFileSync('src/components/settings/SettingsSidebar.tsx', 'utf8');
    const mobile = readFileSync('src/components/mobile/settings/MobileSettingsWorkspace.tsx', 'utf8');
    const permissions = readFileSync('src/features/settings/permissions.ts', 'utf8');
    for (const id of ['security', 'whatsapp', 'sms', 'integrations', 'backup-restore', 'audit-logs', 'developer']) {
      expect(config).toMatch(new RegExp(`id: '${id}'.*visible: false`));
    }
    expect(config).toContain("id: 'about-erp'");
    expect(permissions).toContain('config?.visible === false');
    expect(desktop).toContain('canViewSection(section.id)');
    expect(mobile).toContain('canViewSection(section.id)');
  });});
