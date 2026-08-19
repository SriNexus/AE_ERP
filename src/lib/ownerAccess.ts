import type { User } from 'firebase/auth';

const OWNER_AUTH_EMAIL = 'shreeniwas.tripathi0@gmail.com';

export function normalizeIdentityEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isOwnerEmail(value: unknown): boolean {
  return normalizeIdentityEmail(value) === OWNER_AUTH_EMAIL;
}

export function isOwnerFirebaseUser(user: Pick<User, 'email'> | null | undefined): boolean {
  return isOwnerEmail(user?.email);
}

export function isHiddenOwnerRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  return isOwnerEmail((record as { email?: unknown }).email);
}

export function filterManageableUsers<T>(records: T[]): T[] {
  return records.filter((record) => !isHiddenOwnerRecord(record));
}

export function createOwnerAppIdentity(authUid: string, email: string, companyId = 'default') {
  return {
    id: `owner:${authUid}`,
    name: 'ERP Owner',
    displayName: 'ERP Owner',
    // The canonical profile contract (normalizeUserProfile) requires a
    // non-empty email — an empty string here previously made the Owner's own
    // ProfileSection throw UserProfileError('profile-missing', ...) on every
    // visit. This is the Owner's OWN self-service profile view, not a
    // records list — filterManageableUsers()/isHiddenOwnerRecord() (which
    // operate on real Firestore users/{id} documents, not this client-only
    // synthetic identity) remain the actual mechanism hiding the Owner's
    // email from OTHER users' admin screens; they are unaffected by this.
    email: normalizeIdentityEmail(email),
    role: 'Owner',
    companyId,
    status: 'Active',
    isSuperAdmin: true,
    isOwner: true,
  } as const;
}