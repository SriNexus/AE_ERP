/**
 * Auth middleware � Firebase ID token + API key verification
 *
 * Supports two authentication methods:
 * 1. Bearer token: Firebase ID token in Authorization header
 * 2. X-API-Key header: Static API key for machine-to-machine access
 */

import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getAdminDb } from './firebase';
import { isOwnerEmail } from '../../src/lib/ownerAccess';

export interface AuthenticatedUser {
  uid: string;
  erpUserId: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
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
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
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
  } catch {
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