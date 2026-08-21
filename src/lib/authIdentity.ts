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
      // Self-heal a stale mapping — the root cause behind "Group Admin
      // permission-denied even after the write payload carries the correct
      // groupId": user_auth_maps/{authUid} is written ONCE (createMapping(),
      // below/at first login) and never touched again on ordinary logins,
      // but firestore.rules' actorGroupId() and every groupAdminCan*() check
      // read companyId/groupId straight from THIS cached document — not from
      // the live users/{id} profile a client re-syncs into its own store on
      // boot (useGlobalBoot.ts's profileSyncRef effect, 2026-08-19). A later
      // reassignment (promoting an Admin to GroupAdmin and stamping a new
      // groupId onto their profile; a GroupAdmin moving a user between
      // sibling Companies of their own Group, §4.4) left this mapping
      // permanently stale — previously that didn't just mis-scope writes, it
      // hard-locked the account out of login entirely (this branch used to
      // throw 'mapping-conflict' on every subsequent login instead of
      // healing). `validated` is read via the SAME anchored userId this
      // mapping already points at (never attacker-influenced: `userId` is
      // immutable once set, guarded by firestoreAuthIdentityGateway
      // .createMapping()'s own transaction below), so refreshing the
      // mapping's denormalized fields to match it can never grant an actor
      // access to an identity other than their own already-established one.
      //
      // The refresh write is itself best-effort: user_auth_maps' own update
      // rule makes groupId immutable-once-set and companyId always
      // immutable (Master Plan §3.2 — a client can never move its own
      // mapping into a different Company/Group after the fact). This
      // successfully heals the real, documented case — a mapping that never
      // had a groupId getting one stamped for the first time (a promotion
      // to Group Admin) — and is rejected by rules for any other mismatch,
      // which then requires direct database correction. Either way, login
      // itself must never fail merely because this best-effort refresh
      // couldn't complete — the caller still gets a working (if, in that
      // rarer case, mis-scoped-until-corrected) session, exactly like
      // useGlobalBoot.ts's equivalent client-side self-heal, which is
      // already best-effort/non-blocking for the identical reason.
      const staleCompanyId = text(mapping.companyId) !== validated.companyId;
      const staleGroupId = text(mapping.groupId) !== (validated.groupId || '');
      if (staleCompanyId || staleGroupId) {
        await gateway.createMapping(authUid, validated).catch(() => undefined);
      }
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

/**
 * Best-effort refresh of user_auth_maps/{authUid} against a freshly-loaded
 * ERP profile — the same self-heal resolveAuthenticatedErpUser() performs
 * inline at explicit login time, exposed standalone so an ALREADY-OPEN
 * session can close the identical staleness gap without requiring a
 * logout/login.
 *
 * Why this is needed in addition to the inline login-time heal:
 * resolveAuthenticatedErpUser() only runs from Login.tsx's explicit
 * sign-in submit. A resumed session (page reload with a still-valid
 * Firebase Auth session) never calls it — useGlobalBoot.ts's own profile
 * self-heal effect (2026-08-19) re-reads the live users/{id} profile via
 * loadCurrentUserProfile() instead, and until this function existed, never
 * touched user_auth_maps at all. Firestore rules' actorGroupId() /
 * groupAdminCanCreate()/Update() read groupId/companyId straight from that
 * mapping document, not from anything the client holds in memory — so a
 * mapping that predates a company/group reassignment stayed stale for the
 * lifetime of the browser tab even after the client-side identity had
 * already self-healed, and every groupAdminCan*() write kept failing
 * regardless of what correct groupId the write payload itself carried.
 *
 * Never throws — a failed read or a rejected write (e.g. rules'
 * groupId-immutable-once-set guard rejecting a genuine cross-Group
 * reassignment, which requires direct database correction) is swallowed;
 * this must never block boot or app usage.
 */
export async function refreshAuthMappingIfStale(
  authUid: string,
  profile: ErpUserProfile,
  gateway: AuthIdentityGateway = firestoreAuthIdentityGateway,
): Promise<void> {
  const uid = text(authUid);
  if (!uid) return;
  try {
    const mapping = await gateway.readMapping(uid);
    if (!mapping) return;
    if (text(mapping.userId) !== profile.id) return; // not our mapping to touch
    const staleCompanyId = text(mapping.companyId) !== profile.companyId;
    const staleGroupId = text(mapping.groupId) !== text(profile.groupId);
    if (staleCompanyId || staleGroupId) {
      await gateway.createMapping(uid, profile);
    }
  } catch {
    // Best-effort — never blocks the caller.
  }
}
