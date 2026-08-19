import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Transaction,
} from 'firebase/firestore';
import { COLLECTIONS, db, firebaseEnv } from './firebase';
import { createDocWithId, genId, getAll, getOne, updateDocById } from './firestore';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import type { MasterUser } from '../types';
import type { ProjectionRoleRegistration, ProjectionSafePayload, UserIdentityRecord, UserIdentityRole } from './userIdentity.types';
import {
  normalizeIdentityPhone,
  phoneFromPayload,
  getRoleLinkedModule,
  uniqueIdentityValues,
  validateProjectionRegistration,
  validateRoleAssignment,
} from './userIdentity.validators';

export type { ProjectionRoleRegistration, UserIdentityRole } from './userIdentity.types';
export { normalizeIdentityPhone } from './userIdentity.validators';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.slice(-10);
}

function phoneFromProjection(payload: ProjectionSafePayload, fallbackPhone = ''): string {
  return normalizePhone(phoneFromPayload(payload) || fallbackPhone);
}

function requireIdentityInput(payload: ProjectionSafePayload, fallbackPhone = ''): {
  companyId: string;
  phone: string;
  createdBy: string;
} {
  const companyId = systemCompanyId(payload);
  const phone = phoneFromProjection(payload, fallbackPhone);
  if (!companyId) throw new Error('companyId is required for user identity');
  if (!phone) throw new Error('phone is required for user identity');
  return {
    companyId,
    phone,
    createdBy: systemCreatedBy(payload),
  };
}

function systemCompanyId(payload: ProjectionSafePayload): string {
  const state = useAppStore.getState();
  // Neutral 'all'/'default'/'group' placeholders are NOT real companies. A
  // user identity must resolve to an actual company (explicit payload,
  // active selection, loaded company config, or canonical ERP profile) —
  // otherwise the final fallback is '' and requireIdentityInput() throws, so
  // user creation FAILS CLOSED instead of silently creating users under
  // companyId 'default' (the Admin companyId='default' 403-storm root cause)
  // or the literal string 'group' (the Group Admin Group-view sentinel,
  // Master Plan §7.2 — a Group Admin creating a user while viewing "All
  // Companies (Group view)" previously had that sentinel stamped straight
  // onto the new user's companyId, since Users.tsx's create-user form has no
  // company field of its own).
  const real = (id?: string) => (id && id !== 'all' && id !== 'default' && id !== 'group' ? id : '');
  return real(stringValue(payload.companyId))
    || real(state.activeCompanyId)
    || real(state.company?.id)
    || real(state.user?.companyId)
    || '';
}

function systemCreatedBy(payload: ProjectionSafePayload): string {
  return stringValue(payload.createdBy) || useAppStore.getState().user?.id || 'system';
}

function numericFallback(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }
  return String(hash).padStart(10, '0').slice(-10);
}

function masterUserId(companyId: string, phone: string): string {
  return `MUSR-${encodeURIComponent(companyId)}-${phone}`;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return undefined;
}

function toMasterUser(id: string, data: Record<string, unknown>): MasterUser {
  return {
    id,
    phone: stringValue(data.phone),
    companyId: stringValue(data.companyId),
    name: stringValue(data.name),
    email: stringValue(data.email),
    role: stringValue(data.role) || 'Sales',
    linkedModules: Array.isArray(data.linkedModules) ? data.linkedModules.map(String) : [],
    createdAt: timestampValue(data.createdAt),
    updatedAt: timestampValue(data.updatedAt),
    isDeleted: data.isDeleted === true,
  };
}

export async function resolveOrCreateMasterUser(
  phone: string,
  companyId: string,
  seedData: Partial<MasterUser> & Record<string, unknown> = {}
): Promise<MasterUser> {
  if (!firebaseEnv.isConfigured) {
    const normalizedPhone = normalizePhone(phone);
    const resolvedCompanyId = stringValue(companyId) || systemCompanyId(seedData);
    const id = masterUserId(resolvedCompanyId, normalizedPhone);
    const existing = await getOne<Record<string, unknown>>(COLLECTIONS.USERS, id);
    if (existing) return toMasterUser(id, existing);
    await createDocWithId(COLLECTIONS.USERS, id, sanitizeFirestoreData({
      ...seedData,
      id,
      userId: id,
      phone: normalizedPhone,
      companyId: resolvedCompanyId,
      name: stringValue(seedData.name) || normalizedPhone,
      email: stringValue(seedData.email),
      role: stringValue(seedData.role) || 'Sales',
      linkedModules: Array.isArray(seedData.linkedModules) ? seedData.linkedModules : [],
      isDeleted: false,
    }));
    return toMasterUser(id, {
      ...seedData,
      id,
      phone: normalizedPhone,
      companyId: resolvedCompanyId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return runTransaction(db, (transaction) => (
    resolveOrCreateMasterUserInTransaction(transaction, phone, companyId, seedData)
  ));
}

// Master identity uses deterministic document IDs instead of query-based
// uniqueness: users/MUSR-{companyId}-{normalizedPhone}.
export async function resolveOrCreateMasterUserInTransaction(
  transaction: Transaction,
  phone: string,
  companyId: string,
  seedData: Partial<MasterUser> & Record<string, unknown> = {}
): Promise<MasterUser> {
  const normalizedPhone = normalizePhone(phone);
  const resolvedCompanyId = stringValue(companyId) || systemCompanyId(seedData);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    throw new Error('A valid 10 digit phone is required for master identity');
  }
  if (!resolvedCompanyId) {
    throw new Error('companyId is required for master identity');
  }

  const id = masterUserId(resolvedCompanyId, normalizedPhone);
  const ref = doc(db, COLLECTIONS.USERS, id);
  const byId = await transaction.get(ref);
  if (byId.exists() && byId.data().isDeleted !== true) {
    return toMasterUser(byId.id, byId.data());
  }

  const payload = {
    ...seedData,
    id,
    userId: id,
    phone: normalizedPhone,
    companyId: resolvedCompanyId,
    name: stringValue(seedData.name) || normalizedPhone,
    email: stringValue(seedData.email),
    role: stringValue(seedData.role) || 'Sales',
    linkedModules: Array.isArray(seedData.linkedModules) ? seedData.linkedModules : [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
  };

  transaction.set(ref, sanitizeFirestoreData(payload));
  return toMasterUser(id, {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function identityPayload(payload: ProjectionSafePayload, fallbackPhone = ''): ProjectionSafePayload {
  return {
    ...payload,
    companyId: systemCompanyId(payload),
    createdBy: systemCreatedBy(payload),
    phone: phoneFromProjection(payload, fallbackPhone),
  };
}

export const PROJECTION_ROLE_MAP = Object.freeze({
  Lead: Object.freeze({ collection: COLLECTIONS.LEADS, role: 'Lead', ownerField: 'userId' }),
  Customer: Object.freeze({ collection: COLLECTIONS.CUSTOMERS, role: 'Customer', ownerField: 'userId' }),
  Employee: Object.freeze({ collection: COLLECTIONS.EMPLOYEES, role: 'Employee', ownerField: 'userId' }),
  User: Object.freeze({ collection: COLLECTIONS.USERS, role: 'User', ownerField: 'userId' }),
  Driver: Object.freeze({ collection: 'drivers', role: 'Driver', ownerField: 'userId' }),
  Vendor: Object.freeze({ collection: 'vendors', role: 'Vendor', ownerField: 'userId' }),
  InstallationPartner: Object.freeze({ collection: 'installationPartners', role: 'InstallationPartner', ownerField: 'userId' }),
  FieldAgent: Object.freeze({ collection: 'fieldAgents', role: 'FieldAgent', ownerField: 'userId' }),
} satisfies Readonly<Record<UserIdentityRole, ProjectionRoleRegistration>>);

export function getProjectionRole(collectionName: string): ProjectionRoleRegistration {
  const config = Object.values(PROJECTION_ROLE_MAP).find((item) => item.collection === collectionName);
  if (!config) throw new Error(`Projection role is not registered for ${collectionName}`);
  return config;
}

Object.values(PROJECTION_ROLE_MAP).forEach(validateProjectionRegistration);

async function findUserByPhone(companyId: string, phone: string): Promise<UserIdentityRecord | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!firebaseEnv.isConfigured) {
    const matches = (await getAll<Record<string, unknown>>(COLLECTIONS.USERS))
      .filter((row): row is UserIdentityRecord => (
        stringValue(row.companyId) === companyId
        && normalizePhone(String(row.phone || '')) === normalizedPhone
        && row.isDeleted !== true
      ));
    if (matches.length > 1) throw new Error(`Multiple users found for phone ${normalizedPhone}`);
    return matches[0] || null;
  }

  // Tenant safety: the companyId constraint MUST be server-side, not just a
  // client-side filter after fetching. A query scoped only by `phone` cannot
  // be proven safe by the sameCompany() rule for every possible match across
  // ALL companies, so Firestore denies the entire query with
  // "Missing or insufficient permissions" (Admin create-user runtime-failure
  // root cause #2, found via live browser verification — the companyId
  // parameter was already accepted by this function but never applied to the
  // actual query, only to an in-memory filter after the (denied) fetch).
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.USERS),
    where('phone', '==', normalizedPhone),
    where('companyId', '==', companyId)
  ));
  const matches = snap.docs
    .map((docSnap): Record<string, unknown> & { id: string } => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((row): row is UserIdentityRecord => row.isDeleted !== true);

  if (matches.length > 1) throw new Error(`Multiple users found for phone ${normalizedPhone}`);
  return matches[0] || null;
}

export async function attachUserRole(userId: string, role: UserIdentityRole, updatedBy = 'system') {
  validateRoleAssignment(role);
  const current = await getOne<Record<string, unknown>>(COLLECTIONS.USERS, userId);
  if (!current) throw new Error(`User identity ${userId} not found`);
  const linkedModule = getRoleLinkedModule(PROJECTION_ROLE_MAP[role]);

  await updateDocById(COLLECTIONS.USERS, userId, {
    roles: uniqueIdentityValues([...(Array.isArray(current.roles) ? current.roles : []), role]),
    linkedModules: uniqueIdentityValues([...(Array.isArray(current.linkedModules) ? current.linkedModules : []), linkedModule]),
    updatedBy,
  });
}

export async function createUserIdentity(
  id: string,
  payload: ProjectionSafePayload,
  role: UserIdentityRole,
  phone: string
) {
  validateRoleAssignment(role);
  const normalizedPayload = identityPayload(payload, phone);
  const identity = requireIdentityInput(normalizedPayload);
  const linkedModule = getRoleLinkedModule(PROJECTION_ROLE_MAP[role]);

  return createDocWithId(COLLECTIONS.USERS, id, {
    id,
    userId: id,
    companyId: identity.companyId,
    name: stringValue(payload.name || payload.displayName || payload.company) || identity.phone,
    phone: identity.phone,
    email: stringValue(payload.email || payload.businessEmail),
    roles: [role],
    linkedModules: [linkedModule],
    profile: { sourceRole: role },
    filters: {},
    status: role === 'User' ? stringValue(payload.status) || 'Active' : 'Identity',
    createdBy: identity.createdBy,
  });
}

export async function createOrResolveUserByPhone(
  payload: ProjectionSafePayload,
  role: UserIdentityRole,
  preferredId?: string
): Promise<string> {
  validateRoleAssignment(role);
  const existingUserId = stringValue(payload.userId || preferredId);
  const fallbackPhone = role === 'User' && existingUserId ? numericFallback(existingUserId) : '';
  const normalizedPayload = identityPayload(payload, fallbackPhone);
  const identity = requireIdentityInput(normalizedPayload);
  const companyId = identity.companyId;
  const phone = identity.phone;
  const createdBy = identity.createdBy;

  if (existingUserId) {
    const existingById = await getOne<Record<string, unknown>>(COLLECTIONS.USERS, existingUserId);
    if (existingById) {
      if (stringValue(existingById.companyId) !== companyId) {
        throw new Error('userId company does not match identity company');
      }
      if (normalizePhone(String(existingById.phone || '')) !== phone) {
        throw new Error('userId phone does not match identity phone');
      }
      await attachUserRole(existingUserId, role, createdBy);
      return existingUserId;
    }
  }

  const existing = await findUserByPhone(companyId, phone);
  if (existing) {
    await attachUserRole(existing.id, role, createdBy);
    return existing.id;
  }

  const masterUser = await resolveOrCreateMasterUser(phone, companyId, {
    ...normalizedPayload,
    role: stringValue(normalizedPayload.role) || role,
    linkedModules: [getRoleLinkedModule(PROJECTION_ROLE_MAP[role])],
    createdBy,
  });
  await attachUserRole(masterUser.id, role, createdBy);
  return masterUser.id;
}

export async function createUserProjection(id: string, payload: Record<string, unknown>) {
  const userId = await createOrResolveUserByPhone(payload, 'User', id);
  if (userId !== id) throw new Error('Phone already belongs to another user identity');
  const current = await getOne<Record<string, unknown>>(COLLECTIONS.USERS, userId);
  return updateDocById(COLLECTIONS.USERS, id, {
    ...userProjectionUpdatePayload(payload),
    companyId: current?.companyId || systemCompanyId(payload),
    userId,
    roles: current?.roles,
    linkedModules: current?.linkedModules,
    profile: current?.profile,
    filters: current?.filters,
  });
}

function userProjectionUpdatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set([
    'id',
    'userId',
    'companyId',
    'roles',
    'linkedModules',
    'profile',
    'filters',
    'createdAt',
    'createdBy',
    'password',
  ]);

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => !blocked.has(key) && value !== undefined)
  );
}

export async function updateUserProjection(id: string, payload: Record<string, unknown>) {
  return updateDocById(COLLECTIONS.USERS, id, userProjectionUpdatePayload(payload));
}
