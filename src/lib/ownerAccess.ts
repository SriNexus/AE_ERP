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

export function createOwnerAppIdentity(authUid: string, companyId = 'default') {
  return {
    id: `owner:${authUid}`,
    name: 'ERP Owner',
    displayName: 'ERP Owner',
    email: '',
    role: 'Owner',
    companyId,
    status: 'Active',
    isSuperAdmin: true,
    isOwner: true,
  } as const;
}