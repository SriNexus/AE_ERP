import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { COLLECTIONS, db } from './firebase';

export type AuthIdentityErrorCode = 'auth-mapping-missing' | 'erp-profile-missing' | 'ambiguous-identity' | 'inactive-user' | 'malformed-identity' | 'permission-denied' | 'mapping-conflict' | 'bootstrap-failed';

export class AuthIdentityError extends Error {
  constructor(public readonly code: AuthIdentityErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AuthIdentityError';
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export type ErpUserProfile = Record<string, unknown> & { id: string; companyId: string; email: string; status?: string };
export type AuthIdentityGateway = {
  readMapping(authUid: string): Promise<Record<string, unknown> | null>;
  readUser(userId: string): Promise<Record<string, unknown> | null>;
  findUsersByEmail(email: string): Promise<Array<Record<string, unknown> & { id: string }>>;
  createMapping(authUid: string, user: ErpUserProfile): Promise<void>;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const normalizeAuthEmail = (value: unknown) => text(value).toLowerCase();

function translateFirestoreError(error: unknown): never {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) {
    throw new AuthIdentityError('permission-denied', 'Authenticated, but ERP identity access was denied.', { cause: error });
  }
  throw new AuthIdentityError('bootstrap-failed', 'ERP identity bootstrap failed unexpectedly.', { cause: error });
}

function validateProfile(raw: Record<string, unknown>, expectedId: string, authenticatedEmail: string): ErpUserProfile {
  const id = text(raw.id) || expectedId;
  const companyId = text(raw.companyId);
  const email = normalizeAuthEmail(raw.email);
  if (!id || id !== expectedId || !companyId || !email) throw new AuthIdentityError('malformed-identity', 'The ERP user profile has invalid identity fields.');
  if (email !== authenticatedEmail) throw new AuthIdentityError('mapping-conflict', 'The authentication mapping does not match the signed-in email.');
  const status = text(raw.status).toLowerCase();
  if (['inactive', 'suspended', 'disabled'].includes(status) || raw.isDeleted === true) throw new AuthIdentityError('inactive-user', 'Your ERP account is inactive. Contact an administrator.');
  return { ...raw, id, companyId, email } as ErpUserProfile;
}

export async function resolveAuthenticatedErpUser(authUser: Pick<User, 'uid' | 'email'>, gateway: AuthIdentityGateway = firestoreAuthIdentityGateway): Promise<ErpUserProfile> {
  const authUid = text(authUser.uid);
  const email = normalizeAuthEmail(authUser.email);
  if (!authUid || !email) throw new AuthIdentityError('malformed-identity', 'The authenticated account has no usable UID or email.');
  try {
    const mapping = await gateway.readMapping(authUid);
    if (mapping) {
      if (text(mapping.authUid) !== authUid || !text(mapping.userId)) throw new AuthIdentityError('malformed-identity', 'The authentication mapping is malformed.');
      const profile = await gateway.readUser(text(mapping.userId));
      if (!profile) throw new AuthIdentityError('erp-profile-missing', 'The mapped ERP user profile no longer exists.');
      const validated = validateProfile(profile, text(mapping.userId), email);
      if (text(mapping.companyId) !== validated.companyId) throw new AuthIdentityError('mapping-conflict', 'The authentication mapping company does not match the ERP profile.');
      return validated;
    }
    // UID-keyed account doc first — the strongest identity key the architecture
    // supports. The user-creation flow (Users.tsx → createProjectionWithUserId)
    // writes the ERP account document keyed by the Firebase Auth UID
    // (users/{authUid}). Prefer that exact document over a broader email scan,
    // so a parallel MUSR-{companyId}-{phone} master record (same human, same
    // email, created by the entity-projection layer) can never manufacture a
    // false ambiguous-identity block.
    const uidKeyed = await gateway.readUser(authUid);
    if (uidKeyed) {
      const profile = validateProfile(uidKeyed, authUid, email);
      await gateway.createMapping(authUid, profile);
      return profile;
    }

    // Legacy fallback: no UID-keyed account doc (pre-mapping users migrated by
    // scripts/migrate-user-auth-maps.ts are keyed by MUSR master docs instead).
    // Soft-deleted records must never count as identity candidates — a deleted
    // master doc must not trigger ambiguity or hijack login.
    const matches = await gateway.findUsersByEmail(email);
    const liveMatches = matches.filter((item) => item.isDeleted !== true);
    if (liveMatches.length === 0) {
      if (matches.length > 0) throw new AuthIdentityError('inactive-user', 'Your ERP account is disabled. Contact an administrator.');
      throw new AuthIdentityError('auth-mapping-missing', 'No ERP user is linked to this authenticated account.');
    }
    if (liveMatches.length > 1) throw new AuthIdentityError('ambiguous-identity', 'Multiple ERP users match this authenticated email; an administrator must resolve the duplicate.');
    const profile = validateProfile(liveMatches[0], liveMatches[0].id, email);
    await gateway.createMapping(authUid, profile);
    return profile;
  } catch (error) {
    if (error instanceof AuthIdentityError) throw error;
    return translateFirestoreError(error);
  }
}

export const firestoreAuthIdentityGateway: AuthIdentityGateway = {
  async readMapping(authUid) { const snap = await getDoc(doc(db, COLLECTIONS.USER_AUTH_MAPS, authUid)); return snap.exists() ? snap.data() : null; },
  async readUser(userId) { const snap = await getDoc(doc(db, COLLECTIONS.USERS, userId)); return snap.exists() ? snap.data() : null; },
  async findUsersByEmail(email) { const snap = await getDocs(query(collection(db, COLLECTIONS.USERS), where('email', '==', email))); return snap.docs.map((item) => ({ id: item.id, ...item.data() })); },
  async createMapping(authUid, user) {
    const mapRef = doc(db, COLLECTIONS.USER_AUTH_MAPS, authUid);
    const userRef = doc(db, COLLECTIONS.USERS, user.id);
    await runTransaction(db, async (transaction) => {
      const mapping = await transaction.get(mapRef);
      const currentUser = await transaction.get(userRef);
      if (!currentUser.exists()) throw new AuthIdentityError('erp-profile-missing', 'The ERP user disappeared during identity bootstrap.');
      if (mapping.exists() && text(mapping.data().userId) !== user.id) throw new AuthIdentityError('mapping-conflict', 'This authenticated account is already linked to another ERP user.');
      // Phase 1 (Multi-Tenant): user_auth_maps mirrors users.groupId (Master
      // Plan §3.2) — stamp it from the validated ERP profile so the auth map
      // carries the same group association as the user doc. Optional field:
      // omitted when the profile has none (pre-backfill window).
      const groupId = typeof user.groupId === 'string' && user.groupId.trim() ? user.groupId.trim() : '';
      transaction.set(mapRef, {
        authUid, userId: user.id, companyId: user.companyId, email: user.email,
        ...(groupId ? { groupId } : {}),
        createdAt: mapping.exists() ? mapping.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  },
};
