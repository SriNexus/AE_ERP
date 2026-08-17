import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { COLLECTIONS, db, firebaseEnv } from './firebase';
import { getOne, updateDocById } from './firestore';
import { uploadFile } from './storage';
import { normalizeAuthEmail } from './authIdentity';
import { useAppStore, type AppUser } from '../store/useAppStore';

const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export type CanonicalUserProfile = {
  id: string;
  companyId: string;
  email: string;
  name: string;
  displayName: string;
  phone: string;
  avatarUrl?: string;
  signatureUrl?: string;
  role?: string;
  department?: string;
  managerId?: string;
  managerName?: string;
  warehouseId?: string;
  isManager?: boolean;
  status?: string;
  isSuperAdmin?: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type UserProfileDraft = {
  displayName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  signatureUrl?: string;
};

export type UserProfileSaveInput = UserProfileDraft & {
  currentPassword?: string;
  avatarFile?: File | null;
  signatureFile?: File | null;
};

export class UserProfileError extends Error {
  constructor(
    public readonly code:
      | 'permission-denied'
      | 'profile-missing'
      | 'profile-validation'
      | 'email-reauth-required'
      | 'email-update-failed'
      | 'mapping-missing'
      | 'rollback-failed'
      | 'asset-upload-failed'
      | 'bootstrap-failed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'UserProfileError';
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function toISO(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function translateError(error: unknown, fallbackCode: UserProfileError['code'] = 'bootstrap-failed'): never {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code.includes('permission-denied')) {
    throw new UserProfileError('permission-denied', 'Authenticated, but your profile could not be read or saved.', { cause: error });
  }
  throw new UserProfileError(fallbackCode, 'Your profile operation failed unexpectedly.', { cause: error });
}

export function normalizeUserProfile(raw: Record<string, unknown> & { id: string }): CanonicalUserProfile {
  const id = text(raw.id);
  const companyId = text(raw.companyId);
  const name = text(raw.name) || text(raw.displayName) || text(raw.fullName) || text(raw.email) || 'User';
  const displayName = text(raw.displayName) || text(raw.name) || name;
  const email = normalizeAuthEmail(raw.email);
  const phone = text(raw.phone);
  if (!id || !companyId || !email) {
    throw new UserProfileError('profile-missing', 'The canonical ERP profile is missing required identity fields.');
  }
  return {
    ...raw,
    id,
    companyId,
    email,
    name,
    displayName,
    phone,
    avatarUrl: text(raw.avatarUrl) || text(raw.avatar) || text(raw.photoURL) || undefined,
    signatureUrl: text(raw.signatureUrl) || text(raw.signature) || undefined,
    role: text(raw.role) || undefined,
    // Organization hierarchy fields (data-driven section model) — carried into
    // the session so sidebar/navigation and workspace scoping can use them.
    department: text(raw.department) || undefined,
    managerId: text(raw.managerId) || undefined,
    managerName: text(raw.managerName) || undefined,
    warehouseId: text(raw.warehouseId) || undefined,
    isManager: raw.isManager === true,
    status: text(raw.status) || undefined,
    isSuperAdmin: raw.isSuperAdmin === true,
    updatedAt: toISO(raw.updatedAt),
    updatedBy: text(raw.updatedBy) || undefined,
  };
}

export function profileToAppUser(profile: CanonicalUserProfile): AppUser {
  return {
    id: profile.id,
    name: profile.displayName || profile.name || profile.email || 'User',
    displayName: profile.displayName || profile.name || profile.email || 'User',
    email: profile.email,
    phone: profile.phone,
    role: profile.role || 'Employee',
    companyId: profile.companyId,
    avatar: profile.avatarUrl,
    avatarUrl: profile.avatarUrl,
    signatureUrl: profile.signatureUrl,
    department: profile.department,
    managerId: profile.managerId,
    warehouseId: profile.warehouseId,
    status: profile.status,
    isSuperAdmin: profile.isSuperAdmin === true,
  };
}

function validateDraft(input: UserProfileSaveInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!text(input.displayName)) errors.displayName = 'Display name is required';
  if (!normalizeAuthEmail(input.email)) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAuthEmail(input.email))) errors.email = 'Enter a valid email address';
  if (!text(input.phone)) errors.phone = 'Phone number is required';
  else if (!/^[0-9+()\-.\s]{6,20}$/.test(text(input.phone))) errors.phone = 'Enter a valid phone number';
  return errors;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function validateAsset(file: File | null | undefined, label: string) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    throw new UserProfileError('profile-validation', `${label} must be an image file.`);
  }
  if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    throw new UserProfileError('profile-validation', `${label} must be smaller than 2 MB.`);
  }
}

async function uploadProfileAsset(userId: string, kind: 'avatar' | 'signature', file: File): Promise<string> {
  validateAsset(file, kind === 'avatar' ? 'Avatar' : 'Signature');
  if (!firebaseEnv.isConfigured) {
    return fileToDataUrl(file);
  }
  try {
    return await uploadFile(`users/${userId}/profile/${kind}`, file, true);
  } catch (error) {
    throw new UserProfileError('asset-upload-failed', `Failed to upload ${kind}.`, { cause: error });
  }
}

function buildUserUpdatePayload(profile: CanonicalUserProfile, input: UserProfileDraft & { avatarUrl?: string; signatureUrl?: string }) {
  const payload: Record<string, unknown> = {
    name: input.displayName.trim(),
    displayName: input.displayName.trim(),
    email: normalizeAuthEmail(input.email),
    phone: input.phone.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
  };
  if (input.avatarUrl !== undefined) payload.avatarUrl = input.avatarUrl;
  if (input.signatureUrl !== undefined) payload.signatureUrl = input.signatureUrl;
  return payload;
}

async function getAuthMap(authUid: string): Promise<Record<string, unknown> | null> {
  try {
    return await getOne<Record<string, unknown>>(COLLECTIONS.USER_AUTH_MAPS, authUid);
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && String((error as { code?: unknown }).code).includes('permission-denied')) {
      return null;
    }
    throw error;
  }
}

async function commitProfilePatch(
  profile: CanonicalUserProfile,
  patch: UserProfileDraft & { avatarUrl?: string; signatureUrl?: string },
  authUser?: User,
): Promise<CanonicalUserProfile> {
  const userRef = doc(db, COLLECTIONS.USERS, profile.id);
  const batch = writeBatch(db);
  batch.update(userRef, buildUserUpdatePayload(profile, patch));

  if (authUser?.uid && normalizeAuthEmail(patch.email) !== profile.email) {
    const mapRef = doc(db, COLLECTIONS.USER_AUTH_MAPS, authUser.uid);
    const mapping = await getAuthMap(authUser.uid);
    if (!mapping || text(mapping.userId) !== profile.id) {
      throw new UserProfileError('mapping-missing', 'Your authentication mapping is missing or mismatched.');
    }
    batch.set(mapRef, {
      authUid: authUser.uid,
      userId: profile.id,
      companyId: profile.companyId,
      email: normalizeAuthEmail(patch.email),
      createdAt: mapping.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    translateError(error);
  }

  return normalizeUserProfile({
    ...profile,
    name: patch.displayName.trim(),
    displayName: patch.displayName.trim(),
    email: normalizeAuthEmail(patch.email),
    phone: patch.phone.trim(),
    avatarUrl: patch.avatarUrl,
    signatureUrl: patch.signatureUrl,
    updatedAt: new Date().toISOString(),
    updatedBy: profile.id,
  });
}

export async function loadCurrentUserProfile(userId: string): Promise<CanonicalUserProfile> {
  if (!text(userId)) throw new UserProfileError('profile-missing', 'Your ERP user profile could not be resolved.');
  try {
    // Canonical identity reads must not pass through the generic entity visibility
    // filter in firestore.getOne(). Firestore rules already authorize this exact
    // document, while the client filter can incorrectly remove user records that
    // do not carry entity ownership fields such as createdBy/assignedToId.
    const snapshot = await getDoc(doc(db, COLLECTIONS.USERS, userId));
    if (!snapshot.exists()) {
      throw new UserProfileError(
        'profile-missing',
        `The authentication mapping points to ERP user “${userId}”, but that user record does not exist.`,
      );
    }
    return normalizeUserProfile({ ...snapshot.data(), id: snapshot.id });
  } catch (error) {
    if (error instanceof UserProfileError) throw error;
    translateError(error, 'profile-missing');
  }
}

export async function updateCurrentUserProfile(input: {
  userId: string;
  authUser?: User | null;
  profile: UserProfileSaveInput;
}): Promise<CanonicalUserProfile> {
  const currentProfile = await loadCurrentUserProfile(input.userId);
  const validationErrors = validateDraft(input.profile);
  if (Object.keys(validationErrors).length > 0) {
    throw new UserProfileError('profile-validation', Object.values(validationErrors).join('; '));
  }

  const nextDisplayName = input.profile.displayName.trim();
  const nextEmail = normalizeAuthEmail(input.profile.email);
  const nextPhone = input.profile.phone.trim();

  let nextAvatarUrl = currentProfile.avatarUrl;
  let nextSignatureUrl = currentProfile.signatureUrl;
  if (input.profile.avatarFile) nextAvatarUrl = await uploadProfileAsset(input.userId, 'avatar', input.profile.avatarFile);
  if (input.profile.signatureFile) nextSignatureUrl = await uploadProfileAsset(input.userId, 'signature', input.profile.signatureFile);

  const emailChanged = nextEmail !== currentProfile.email;
  const authUser = input.authUser ?? undefined;

  if (emailChanged) {
    if (!authUser?.email) throw new UserProfileError('email-reauth-required', 'Changing your email requires you to sign in again with your current password.');
    if (!text(input.profile.currentPassword)) throw new UserProfileError('email-reauth-required', 'Changing your email requires your current password.');
    try {
      const credential = EmailAuthProvider.credential(authUser.email, input.profile.currentPassword!.trim());
      await reauthenticateWithCredential(authUser, credential);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && String((error as { code?: unknown }).code).includes('permission-denied')) {
        throw new UserProfileError('permission-denied', 'Authenticated, but reauthentication was denied.', { cause: error });
      }
      throw new UserProfileError('email-reauth-required', 'Your current password is incorrect or the session is too old.', { cause: error });
    }

    let authEmailUpdated = false;
    try {
      await updateEmail(authUser, nextEmail);
      authEmailUpdated = true;
      await authUser.getIdToken(true);
      return await commitProfilePatch(currentProfile, {
        displayName: nextDisplayName,
        email: nextEmail,
        phone: nextPhone,
        avatarUrl: nextAvatarUrl,
        signatureUrl: nextSignatureUrl,
      }, authUser);
    } catch (error) {
      try {
        if (authEmailUpdated) {
          await updateEmail(authUser, currentProfile.email);
          await authUser.getIdToken(true);
        }
      } catch (rollbackError) {
        throw new UserProfileError('rollback-failed', 'Your email change could not be rolled back cleanly.', { cause: rollbackError });
      }
      translateError(error, 'email-update-failed');
    }
  }

  if (authUser?.uid) {
    return await commitProfilePatch(currentProfile, {
      displayName: nextDisplayName,
      email: nextEmail,
      phone: nextPhone,
      avatarUrl: nextAvatarUrl,
      signatureUrl: nextSignatureUrl,
    }, authUser);
  }

  if (firebaseEnv.isConfigured) {
    throw new UserProfileError('bootstrap-failed', 'Your authenticated session is missing.');
  }

  await updateDocById(COLLECTIONS.USERS, currentProfile.id, {
    name: nextDisplayName,
    displayName: nextDisplayName,
    email: nextEmail,
    phone: nextPhone,
    avatarUrl: nextAvatarUrl,
    signatureUrl: nextSignatureUrl,
  } as DocumentData);

  return normalizeUserProfile({
    ...currentProfile,
    name: nextDisplayName,
    displayName: nextDisplayName,
    email: nextEmail,
    phone: nextPhone,
    avatarUrl: nextAvatarUrl,
    signatureUrl: nextSignatureUrl,
  });
}

export function syncCurrentUserProfile(profile: CanonicalUserProfile): void {
  const current = useAppStore.getState().user;
  if (!current || current.id !== profile.id) return;
  useAppStore.getState().setUser(profileToAppUser(profile));
}
