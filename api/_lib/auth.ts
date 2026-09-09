/**
 * Auth middleware � Firebase ID token + API key verification
 *
 * Supports two authentication methods:
 * 1. Bearer token: Firebase ID token in Authorization header
 * 2. X-API-Key header: Static API key for machine-to-machine access
 */

import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getAdminDb } from './firebase.js';
import { isOwnerEmail } from '../../src/lib/ownerAccess.js';

export interface AuthenticatedUser {
  uid: string;
  erpUserId: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
  /**
   * RBAC Master Plan Phase 8 — the actor's authoritative Group id, read from
   * the same trusted `users/{id}` document every other identity field comes
   * from (never client-supplied). Empty string when the profile has no
   * group. For a GroupAdmin this is the group whose companies they may
   * legitimately reach over the REST API (mirrors the client's
   * `user.groupId` and `firestore.rules`' `actorGroupId()`); for every other
   * role it is inert — a non-GroupAdmin's API tenant scope stays their own
   * `companyId` exactly as before. Optional on the type (backward-compatible
   * with existing inline test fixtures); every path that builds a real
   * `AuthenticatedUser` sets it, and every consumer reads it defensively.
   */
  groupId?: string;
  /**
   * RBAC Master Plan Phase 10 (N1 / AUTH-C1) — the actor's `channel_partners`
   * document id, read from the same trusted `users/{id}` document as every
   * other identity field (never client-supplied). Present only for a
   * partner-linked account (`linkPartnerUser` sets `users.channelPartnerId`);
   * empty string otherwise. Used by the REST API's self/team ownership filter
   * for `leads`/`customers` so a `partnerId`-owned record still resolves to
   * its partner — mirrors `src/lib/ownershipVisibility.ts`'s `partnerDocId`
   * and `firestore.rules`' `actor.channelPartnerId == data.partnerId`.
   * Optional on the type (backward-compatible with inline test fixtures).
   */
  channelPartnerId?: string;
  isSuperAdmin: boolean;
}

export class AuthResolutionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'AuthResolutionError';
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export interface AuthDependencies {
  verifyIdToken(token: string): Promise<DecodedIdToken>;
  readMapping(authUid: string): Promise<Record<string, unknown> | null>;
  readUser(userId: string): Promise<Record<string, unknown> | null>;
  findUsersByEmail(email: string): Promise<Array<Record<string, unknown> & { id: string }>>;
  createMapping(authUid: string, userId: string, companyId: string, email: string): Promise<void>;
  getApiKeys(): string[];
  getApiCompanyId(): string;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const normalizeAuthEmail = (value: unknown) => text(value).toLowerCase();

function buildAuthenticatedUser(authUid: string, userId: string, raw: Record<string, unknown>): AuthenticatedUser {
  return {
    uid: authUid,
    erpUserId: userId,
    email: normalizeAuthEmail(raw.email),
    name: text(raw.name) || text(raw.displayName) || normalizeAuthEmail(raw.email) || 'User',
    role: text(raw.role) || 'Employee',
    companyId: text(raw.companyId),
    groupId: text(raw.groupId),
    channelPartnerId: text(raw.channelPartnerId),
    isSuperAdmin: raw.isSuperAdmin === true,
  };
}

function validateProfile(raw: Record<string, unknown>, expectedUserId: string, authenticatedEmail: string): Record<string, unknown> {
  const id = text(raw.id) || expectedUserId;
  const companyId = text(raw.companyId);
  const email = normalizeAuthEmail(raw.email);
  if (!id || id !== expectedUserId || !companyId || !email) {
    throw new AuthResolutionError(422, 'MALFORMED_IDENTITY', 'The ERP user profile has invalid identity fields.');
  }
  if (email !== authenticatedEmail) {
    throw new AuthResolutionError(409, 'MAPPING_CONFLICT', 'The authentication mapping does not match the signed-in email.');
  }
  const status = text(raw.status).toLowerCase();
  if (['inactive', 'suspended', 'disabled'].includes(status) || raw.isDeleted === true) {
    throw new AuthResolutionError(403, 'INACTIVE_USER', 'Your ERP account is inactive. Contact an administrator.');
  }
  return { ...raw, id, companyId, email };
}

function translateFirestoreError(error: unknown): never {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code.includes('permission-denied')) {
    throw new AuthResolutionError(403, 'PERMISSION_DENIED', 'Authenticated, but ERP identity access was denied.', { cause: error });
  }
  throw new AuthResolutionError(500, 'BOOTSTRAP_FAILED', 'ERP identity bootstrap failed unexpectedly.', { cause: error });
}

function createDefaultDependencies(): AuthDependencies {
  let db: ReturnType<typeof getAdminDb> | null = null;
  const getDb = () => db || (db = getAdminDb());
  return {
    // `getAuth()` (no-arg) resolves the Admin SDK's DEFAULT app via
    // `getApp()`, which throws "The default Firebase app does not exist" if
    // `initializeApp()` was never called for this module instance — and the
    // ONLY place that happens in this codebase is inside `getAdminDb()`
    // (api/_lib/firebase.ts). `getDb()` is called first here, purely for
    // its `initializeApp()` side effect (idempotent — a no-op once the app
    // exists), to guarantee that ordering regardless of call order
    // elsewhere. Without this, the very first Admin SDK call on a fresh
    // serverless instance throws here, is silently swallowed by
    // `verifyAuthToken()`'s catch-all below, and every Bearer-token-
    // authenticated route (not just biometrics) returns a bare 401 — this
    // was the actual runtime cause of a real "Could not confirm your face
    // registration status" report that turned out to have nothing to do
    // with the network.
    verifyIdToken: (token) => { getDb(); return getAuth().verifyIdToken(token); },
    readMapping: async (authUid) => {
      const snap = await getDb().collection('user_auth_maps').doc(authUid).get();
      return (snap.exists ? snap.data() : null) as Record<string, unknown> | null;
    },
    readUser: async (userId) => {
      const snap = await getDb().collection('users').doc(userId).get();
      return (snap.exists ? snap.data() : null) as Record<string, unknown> | null;
    },
    findUsersByEmail: async (email) => {
      const normalized = normalizeAuthEmail(email);
      if (!normalized) return [];
      const exact = await getDb().collection('users').where('email', '==', normalized).get();
      if (!exact.empty) return exact.docs.map((item) => ({ id: item.id, ...item.data() }));
      const all = await getDb().collection('users').get();
      return all.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Record<string, unknown> & { id: string })
        .filter((item) => normalizeAuthEmail(item.email) === normalized);
    },
    createMapping: async (authUid, userId, companyId, email) => {
      const db = getDb();
      const mapRef = db.collection('user_auth_maps').doc(authUid);
      const userRef = db.collection('users').doc(userId);
      await db.runTransaction(async (transaction) => {
        const [mappingSnap, userSnap] = await Promise.all([transaction.get(mapRef), transaction.get(userRef)]);
        if (!userSnap.exists) {
          throw new AuthResolutionError(404, 'ERP_PROFILE_MISSING', 'The ERP user disappeared during identity bootstrap.');
        }
        if (mappingSnap.exists) {
          const existing = (mappingSnap.data() || {}) as Record<string, unknown>;
          if (text(existing.userId) !== userId || text(existing.companyId) !== companyId || normalizeAuthEmail(existing.email) !== email) {
            throw new AuthResolutionError(409, 'MAPPING_CONFLICT', 'This authenticated account is already linked to a different ERP identity.');
          }
        }
        const now = new Date().toISOString();
        transaction.set(mapRef, {
          authUid,
          userId,
          companyId,
          email,
          createdAt: text((mappingSnap.data() || {}).createdAt) || now,
          updatedAt: now,
        }, { merge: true });
      });
    },
    getApiKeys: () => (process.env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean),
    getApiCompanyId: () => process.env.API_COMPANY_ID || 'default',
  };
}

export const defaultAuthDependencies = createDefaultDependencies();

async function authenticateWithApiKey(apiKey: string, deps: AuthDependencies = defaultAuthDependencies): Promise<AuthenticatedUser> {
  const validKeys = deps.getApiKeys();
  if (validKeys.length === 0) {
    throw new AuthResolutionError(503, 'API_KEY_AUTH_DISABLED', 'API key authentication is not configured.');
  }
  if (!validKeys.includes(apiKey)) {
    throw new AuthResolutionError(403, 'FORBIDDEN', 'Invalid API key provided.');
  }
  const companyId = deps.getApiCompanyId();
  if (!companyId) {
    throw new AuthResolutionError(503, 'API_KEY_COMPANY_MISSING', 'API key authentication is missing a company scope.');
  }
  return {
    uid: 'api-user',
    erpUserId: 'api-user',
    email: 'api@erp.local',
    name: 'API User',
    role: 'Admin',
    companyId,
    groupId: '',
    channelPartnerId: '',
    isSuperAdmin: true,
  };
}

async function authenticateWithBearerToken(authHeader: string, deps: AuthDependencies = defaultAuthDependencies): Promise<AuthenticatedUser> {
  const token = authHeader.slice(7);
  const decoded = await deps.verifyIdToken(token);
  const authUid = text(decoded.uid);
  const authenticatedEmail = normalizeAuthEmail(decoded.email);
  if (!authUid || !authenticatedEmail) {
    throw new AuthResolutionError(422, 'MALFORMED_IDENTITY', 'The authenticated account has no usable UID or email.');
  }
  // Firebase Authentication is sufficient for the hidden owner identity. It is
  // intentionally not resolved through the manageable ERP users collection.
  if (isOwnerEmail(authenticatedEmail)) {
    return {
      uid: authUid,
      erpUserId: `owner:${authUid}`,
      email: authenticatedEmail,
      name: 'ERP Owner',
      role: 'Owner',
      companyId: process.env.OWNER_DEFAULT_COMPANY_ID || 'default',
      groupId: '',
      channelPartnerId: '',
      isSuperAdmin: true,
    };
  }

  try {
    const mapping = await deps.readMapping(authUid);
    if (mapping) {
      if (text(mapping.authUid) !== authUid || !text(mapping.userId) || normalizeAuthEmail(mapping.email) !== authenticatedEmail) {
        throw new AuthResolutionError(422, 'MALFORMED_IDENTITY', 'The authentication mapping is malformed.');
      }
      const profile = await deps.readUser(text(mapping.userId));
      if (!profile) {
        throw new AuthResolutionError(404, 'ERP_PROFILE_MISSING', 'The mapped ERP user profile no longer exists.');
      }
      const validated = validateProfile(profile, text(mapping.userId), authenticatedEmail);
      if (text(mapping.companyId) !== text(validated.companyId)) {
        throw new AuthResolutionError(409, 'MAPPING_CONFLICT', 'The authentication mapping company does not match the ERP profile.');
      }
      return buildAuthenticatedUser(authUid, text(mapping.userId), validated);
    }

    const matches = await deps.findUsersByEmail(authenticatedEmail);
    if (matches.length === 0) {
      throw new AuthResolutionError(409, 'AUTH_MAPPING_MISSING', 'No ERP user is linked to this authenticated account.');
    }
    if (matches.length > 1) {
      throw new AuthResolutionError(409, 'AMBIGUOUS_IDENTITY', 'Multiple ERP users match this authenticated email; an administrator must resolve the duplicate.');
    }
    const validated = validateProfile(matches[0], matches[0].id, authenticatedEmail);
    await deps.createMapping(authUid, matches[0].id, text(validated.companyId), authenticatedEmail);
    return buildAuthenticatedUser(authUid, matches[0].id, validated);
  } catch (error) {
    if (error instanceof AuthResolutionError) throw error;
    return translateFirestoreError(error);
  }
}

/**
 * Resolve an authenticated user for API use.
 * Throws AuthResolutionError on failures so callers can return precise responses.
 */
export async function resolveAuthenticatedUser(
  authHeader?: string | null,
  apiKeyHeader?: string | null,
  deps: AuthDependencies = defaultAuthDependencies,
): Promise<AuthenticatedUser> {
  if (apiKeyHeader) {
    return authenticateWithApiKey(apiKeyHeader, deps);
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthResolutionError(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  return authenticateWithBearerToken(authHeader, deps);
}

/**
 * Verify the Firebase ID token from the Authorization header.
 * Falls back to API key check if configured.
 */
export async function verifyAuthToken(authHeader?: string | null, apiKeyHeader?: string | null): Promise<AuthenticatedUser | null> {
  try {
    return await resolveAuthenticatedUser(authHeader, apiKeyHeader);
  } catch (error) {
    // Server-side-only diagnostic (never sent to the client — the caller
    // only ever sees a generic 401 from this function returning null, by
    // design, so an unauthenticated request can't learn WHY auth failed).
    // Logs only the error's own name/message/code — never a token, never
    // request headers, never credential contents. Without this, a genuine
    // server-side misconfiguration (e.g. a missing Admin SDK credential, or
    // the app-initialization-ordering bug this same file fixes above) was
    // completely invisible — every failure looked identical from outside.
    const code = error instanceof AuthResolutionError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth] verifyAuthToken failed${code ? ` (${code})` : ''}: ${message}`);
    return null;
  }
}

/**
 * Extract authentication error response.
 */
export function authError() {
  return {
    status: 401,
    body: {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a Firebase ID token (Bearer) or API key (X-API-Key header).',
      },
    },
  };
}

/**
 * Extract forbidden response.
 */
export function forbiddenError() {
  return {
    status: 403,
    body: {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
      },
    },
  };
}

export function requireOwnerIdentity(user: Pick<AuthenticatedUser, 'email'>): void {
  if (!isOwnerEmail(user.email)) {
    throw new AuthResolutionError(403, 'OWNER_ONLY', 'This operation is restricted to the ERP owner.');
  }
}