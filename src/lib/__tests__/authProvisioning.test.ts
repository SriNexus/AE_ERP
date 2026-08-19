/**
 * authProvisioning.test.ts — the shared Auth+Firestore-profile provisioning
 * primitive (src/lib/authProvisioning.ts).
 *
 * Covers the root-cause defect this closes: previously every admin-user-
 * creation call site independently duplicated "create the Firebase Auth
 * account, then write the Firestore profile" with NO compensation if the
 * profile write failed — leaving an orphaned Auth-only account that could
 * never log in and permanently blocked that email from being retried.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDeleteUser = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockSignOut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockCreateUserWithEmailAndPassword = vi.hoisted(() => vi.fn());
const mockGetAuth = vi.hoisted(() => vi.fn(() => ({ signOut: mockSignOut })));
const mockInitializeApp = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
  createUserWithEmailAndPassword: mockCreateUserWithEmailAndPassword,
}));

vi.mock('../firebase', () => ({
  firebaseConfig: { projectId: 'test-project' },
}));

import { provisionAuthenticatedUser, AuthProvisioningError } from '../authProvisioning';

function authResultFor(uid: string) {
  return { user: { uid, delete: mockDeleteUser } };
}

describe('provisionAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the Auth account, persists the profile, and signs out on success', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue(authResultFor('uid-1'));
    const createProfile = vi.fn(async (authId: string) => `profile-for-${authId}`);

    const result = await provisionAuthenticatedUser({
      email: 'new.user@example.com',
      password: 'TempPass123!',
      createProfile,
    });

    expect(result).toBe('profile-for-uid-1');
    expect(createProfile).toHaveBeenCalledWith('uid-1');
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('rolls back (deletes) the Auth account when profile creation fails, and never leaves it silently orphaned', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue(authResultFor('uid-2'));
    const profileError = new Error('permission-denied: cannot write users/uid-2');
    const createProfile = vi.fn(async () => { throw profileError; });

    await expect(
      provisionAuthenticatedUser({ email: 'x@example.com', password: 'TempPass123!', createProfile })
    ).rejects.toMatchObject({
      name: 'AuthProvisioningError',
      code: 'profile-failed',
      message: profileError.message,
    });

    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clear, actionable error (naming the orphaned uid) when the rollback delete itself fails', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue(authResultFor('uid-3'));
    mockDeleteUser.mockRejectedValueOnce(new Error('requires-recent-login'));
    const createProfile = vi.fn(async () => { throw new Error('profile write failed'); });

    await expect(
      provisionAuthenticatedUser({ email: 'x@example.com', password: 'TempPass123!', createProfile })
    ).rejects.toMatchObject({
      code: 'profile-failed',
      message: expect.stringContaining('uid-3'),
    });
  });

  it('translates auth/email-already-in-use into a clear, typed error', async () => {
    mockCreateUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/email-already-in-use', message: 'raw firebase message' });
    const createProfile = vi.fn();

    await expect(
      provisionAuthenticatedUser({ email: 'dup@example.com', password: 'TempPass123!', createProfile })
    ).rejects.toMatchObject({ code: 'email-in-use' });
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('translates auth/weak-password and auth/invalid-email into clear, typed errors', async () => {
    mockCreateUserWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/weak-password' });
    await expect(
      provisionAuthenticatedUser({ email: 'a@example.com', password: '1', createProfile: vi.fn() })
    ).rejects.toMatchObject({ code: 'weak-password' });

    mockCreateUserWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/invalid-email' });
    await expect(
      provisionAuthenticatedUser({ email: 'not-an-email', password: 'TempPass123!', createProfile: vi.fn() })
    ).rejects.toMatchObject({ code: 'invalid-email' });
  });

  it('exports AuthProvisioningError as a real Error subclass', () => {
    const error = new AuthProvisioningError('profile-failed', 'test message');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthProvisioningError');
  });
});
