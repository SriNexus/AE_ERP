/**
 * authProvisioning — the ONE shared primitive for creating a new Firebase
 * Auth identity + its canonical ERP profile as a single logical operation.
 *
 * Root cause this closes: every admin-user-creation call site (Users.tsx,
 * MobileUsersWorkspace.tsx, channelPartnerWorkflow.ts's provisionPartnerUser)
 * independently duplicated the same "secondary Firebase app ->
 * createUserWithEmailAndPassword -> sign out -> write the Firestore profile"
 * sequence with NO compensation if the Firestore write failed after the Auth
 * account was already created. That produced a real, silent orphan: a
 * Firebase Auth user with no matching users/{id} document, which can never
 * subsequently log in (resolveAuthenticatedErpUser finds no profile) and
 * permanently blocks that same email from ever being retried
 * (auth/email-already-in-use on every future attempt) — with no visible
 * explanation to the admin who created it.
 *
 * This function creates the Auth identity via an isolated secondary app
 * instance (the caller's own admin session is never replaced — the standard
 * Firebase client-side admin-provisioning pattern, unchanged from what every
 * call site already did), then invokes the caller-supplied `createProfile`.
 * If `createProfile` throws, the just-created Auth account is deleted before
 * the error is re-thrown, so a failed attempt never leaves an orphan behind
 * and the same email can be retried immediately.
 */
import { initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, type User } from 'firebase/auth';
import { firebaseConfig } from './firebase';

export class AuthProvisioningError extends Error {
  constructor(
    public readonly code: 'email-in-use' | 'weak-password' | 'invalid-email' | 'auth-failed' | 'profile-failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'AuthProvisioningError';
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

function translateAuthError(error: unknown): never {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'auth/email-already-in-use') {
    throw new AuthProvisioningError('email-in-use', 'An account with this email already exists.', { cause: error });
  }
  if (code === 'auth/weak-password') {
    throw new AuthProvisioningError('weak-password', 'Password is too weak — use at least 6 characters.', { cause: error });
  }
  if (code === 'auth/invalid-email') {
    throw new AuthProvisioningError('invalid-email', 'Enter a valid email address.', { cause: error });
  }
  throw new AuthProvisioningError('auth-failed', error instanceof Error ? error.message : 'Failed to create the authentication account.', { cause: error });
}

let secondaryAppCounter = 0;

/**
 * Creates a Firebase Auth identity, then calls `createProfile(authId)` to
 * persist the canonical ERP profile under that same id (every provisioning
 * path in this codebase keys users/{id} by the Auth uid). Returns whatever
 * `createProfile` resolves to.
 *
 * On profile-creation failure, rolls back the just-created Auth account
 * (best-effort self-delete, since the account's own fresh sign-in makes this
 * possible without a separate re-authentication step) and throws an
 * AuthProvisioningError describing exactly what happened. If the rollback
 * itself fails, the error message says so explicitly rather than pretending
 * cleanup succeeded — an admin must never be told creation failed when an
 * orphan Auth account is actually still there.
 */
export async function provisionAuthenticatedUser<T>(input: {
  email: string;
  password: string;
  createProfile: (authId: string) => Promise<T>;
}): Promise<T> {
  secondaryAppCounter += 1;
  const secondaryApp = initializeApp(firebaseConfig, `Provision-${Date.now()}-${secondaryAppCounter}`);
  const secondaryAuth = getAuth(secondaryApp);

  let authId: string;
  let authUser: User;
  try {
    const authResult = await createUserWithEmailAndPassword(secondaryAuth, input.email, input.password);
    authId = authResult.user.uid;
    authUser = authResult.user;
  } catch (error) {
    translateAuthError(error);
  }

  try {
    return await input.createProfile(authId);
  } catch (profileError) {
    try {
      await authUser.delete();
    } catch (cleanupError) {
      throw new AuthProvisioningError(
        'profile-failed',
        `User creation failed and the authentication account could not be automatically removed (uid: ${authId}). ` +
          'An administrator must delete this orphaned Firebase Authentication account manually before this email can be used again.',
        { cause: profileError },
      );
    }
    throw new AuthProvisioningError(
      'profile-failed',
      profileError instanceof Error ? profileError.message : 'Failed to create the ERP user profile.',
      { cause: profileError },
    );
  } finally {
    await secondaryAuth.signOut().catch(() => undefined);
  }
}
