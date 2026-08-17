import { describe, expect, it, vi } from 'vitest';
import { AuthResolutionError, resolveAuthenticatedUser, type AuthDependencies } from '../../../api/_lib/auth';

function makeDeps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    verifyIdToken: vi.fn().mockResolvedValue({ uid: 'auth-uid', email: 'USER@example.com' } as any),
    readMapping: vi.fn().mockResolvedValue(null),
    readUser: vi.fn().mockResolvedValue(null),
    findUsersByEmail: vi.fn().mockResolvedValue([]),
    createMapping: vi.fn().mockResolvedValue(undefined),
    getApiKeys: vi.fn().mockReturnValue(['api-key']),
    getApiCompanyId: vi.fn().mockReturnValue('default'),
    ...overrides,
  };
}

async function expectAuthError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: 'AuthResolutionError', code });
}

describe('api auth mapping', () => {
  it('authenticates the hidden owner from the verified Firebase token without an ERP user lookup', async () => {
    const deps = makeDeps({
      verifyIdToken: vi.fn().mockResolvedValue({ uid: 'owner-auth-uid', email: ' SHREENIWAS.TRIPATHI0@GMAIL.COM ' } as any),
    });
    await expect(resolveAuthenticatedUser('Bearer valid-token', null, deps)).resolves.toMatchObject({
      uid: 'owner-auth-uid', erpUserId: 'owner:owner-auth-uid', role: 'Owner', isSuperAdmin: true,
    });
    expect(deps.readMapping).not.toHaveBeenCalled();
    expect(deps.readUser).not.toHaveBeenCalled();
    expect(deps.findUsersByEmail).not.toHaveBeenCalled();
  });
  it('resolves a canonical auth map without falling back to legacy scans', async () => {
    const deps = makeDeps({
      readMapping: vi.fn().mockResolvedValue({ authUid: 'auth-uid', userId: 'MUSR-default-001', companyId: 'default', email: 'user@example.com' }),
      readUser: vi.fn().mockResolvedValue({ id: 'MUSR-default-001', companyId: 'default', email: 'user@example.com', name: 'User', role: 'Admin', status: 'Active' }),
    });

    await expect(resolveAuthenticatedUser('Bearer valid-token', null, deps)).resolves.toMatchObject({ uid: 'auth-uid', erpUserId: 'MUSR-default-001' });
    expect(deps.findUsersByEmail).not.toHaveBeenCalled();
  });

  it('bootstraps one legacy ERP user by normalized email and creates the mapping', async () => {
    const deps = makeDeps({
      findUsersByEmail: vi.fn().mockResolvedValue([{ id: 'MUSR-default-001', companyId: 'default', email: 'user@example.com', name: 'User', role: 'Admin', status: 'Active' }]),
    });

    await expect(resolveAuthenticatedUser('Bearer valid-token', null, deps)).resolves.toMatchObject({ erpUserId: 'MUSR-default-001' });
    expect(deps.createMapping).toHaveBeenCalledWith('auth-uid', 'MUSR-default-001', 'default', 'user@example.com');
  });

  it('rejects ambiguous legacy email matches', async () => {
    const deps = makeDeps({
      findUsersByEmail: vi.fn().mockResolvedValue([
        { id: 'MUSR-default-001', companyId: 'default', email: 'user@example.com', name: 'User', role: 'Admin', status: 'Active' },
        { id: 'MUSR-default-002', companyId: 'default', email: 'user@example.com', name: 'User 2', role: 'Admin', status: 'Active' },
      ]),
    });

    await expectAuthError(resolveAuthenticatedUser('Bearer valid-token', null, deps), 'AMBIGUOUS_IDENTITY');
  });

  it('rejects inactive users', async () => {
    const deps = makeDeps({
      findUsersByEmail: vi.fn().mockResolvedValue([{ id: 'MUSR-default-001', companyId: 'default', email: 'user@example.com', name: 'User', role: 'Admin', status: 'Inactive' }]),
    });

    await expectAuthError(resolveAuthenticatedUser('Bearer valid-token', null, deps), 'INACTIVE_USER');
  });

  it('distinguishes permission denied from missing identity', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
    const deps = makeDeps({ readMapping: vi.fn().mockRejectedValue(denied) });

    await expectAuthError(resolveAuthenticatedUser('Bearer valid-token', null, deps), 'PERMISSION_DENIED');
  });


  it('rejects an existing mapping that points to a different ERP identity', async () => {
    const deps = makeDeps({
      readMapping: vi.fn().mockResolvedValue({ authUid: 'auth-uid', userId: 'MUSR-default-999', companyId: 'other-company', email: 'user@example.com' }),
      readUser: vi.fn().mockResolvedValue({ id: 'MUSR-default-999', companyId: 'default', email: 'user@example.com', name: 'Other', role: 'Admin', status: 'Active' }),
    });

    await expectAuthError(resolveAuthenticatedUser('Bearer valid-token', null, deps), 'MAPPING_CONFLICT');
  });

  it('returns an API-key admin user when configured', async () => {
    const deps = makeDeps({ getApiKeys: vi.fn().mockReturnValue(['key-123']), getApiCompanyId: vi.fn().mockReturnValue('company-x') });

    await expect(resolveAuthenticatedUser(null, 'key-123', deps)).resolves.toMatchObject({ uid: 'api-user', role: 'Admin', companyId: 'company-x', isSuperAdmin: true });
  });
});
