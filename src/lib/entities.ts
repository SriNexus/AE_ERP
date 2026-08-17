import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { COLLECTIONS, db, firebaseEnv } from './firebase';
import { createDocWithId, genId, getAll, getOne, updateDocById } from './firestore';
import { sanitizeFirestoreData } from './sanitizer';
import type {
  EntityAddress,
  EntityContact,
  EntityCreateInput,
  EntityLegacyRefs,
  EntityRecord,
  EntityResolutionResult,
  EntityRole,
  EntitySearch,
  EntityUpdateInput,
} from './entityTypes';
import {
  logDuplicateDetection,
  logEntityCreationAttempt,
  logMissingCompany,
} from './entityDiagnostics';

const ALLOWED_ROLES: ReadonlySet<EntityRole> = new Set([
  'Lead',
  'Customer',
  'Employee',
  'User',
  'Vendor',
  'Driver',
  'Installer',
  'Transporter',
  'Contact',
]);

type NormalizedEntityInput = EntityCreateInput & {
  legalName: string;
  phones: EntityContact[];
  emails: EntityContact[];
  addresses: EntityAddress[];
  tags: string[];
  search: EntitySearch;
  legacyRefs: EntityLegacyRefs;
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown[] = []): string[] {
  return Array.from(new Set(values.map(stringValue).filter(Boolean))).sort();
}

function uniqueRoles(primaryRole: EntityRole, roles: EntityRole[]): EntityRole[] {
  return Array.from(new Set([primaryRole, ...roles])).filter((role): role is EntityRole =>
    ALLOWED_ROLES.has(role as EntityRole)
  );
}

function normalizeName(value: unknown): string {
  return stringValue(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function normalizePhone(value: unknown): string {
  return stringValue(value).replace(/\D/g, '');
}

function normalizeEmail(value: unknown): string {
  return stringValue(value).toLowerCase();
}

function contactTokens(contacts: EntityContact[] | undefined, normalize: (value: unknown) => string): string[] {
  return uniqueStrings((contacts || []).map((item) => normalize(item.value)));
}

function fromFirestore(id: string, data: DocumentData): EntityRecord {
  return { ...(data as EntityRecord), id };
}

function createPayload(refId: string, normalized: NormalizedEntityInput): EntityRecord {
  return {
    id: refId,
    companyId: normalized.companyId,
    primaryRole: normalized.primaryRole,
    roles: normalized.roles,
    displayName: normalized.displayName,
    legalName: normalized.legalName || normalized.displayName,
    phones: normalized.phones || [],
    emails: normalized.emails || [],
    addresses: normalized.addresses || [],
    ...(normalized.leadData ? { leadData: normalized.leadData } : {}),
    ...(normalized.customerData ? { customerData: normalized.customerData } : {}),
    ...(normalized.employeeData ? { employeeData: normalized.employeeData } : {}),
    ...(normalized.vendorData ? { vendorData: normalized.vendorData } : {}),
    ...(normalized.driverData ? { driverData: normalized.driverData } : {}),
    ...(normalized.installerData ? { installerData: normalized.installerData } : {}),
    ...(normalized.userData ? { userData: normalized.userData } : {}),
    tags: normalized.tags || [],
    search: normalized.search,
    legacyRefs: normalized.legacyRefs || {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: normalized.createdBy,
    updatedBy: normalized.createdBy,
    isDeleted: false,
  };
}

function ensureCompany(companyId: string, diagnostics: string[]): void {
  if (!companyId) {
    diagnostics.push('Missing companyId');
    logMissingCompany({ diagnostics });
    throw new Error('Entity companyId is required');
  }
}

export function buildEntitySearch(input: Pick<EntityCreateInput, 'displayName' | 'phones' | 'emails'>): EntitySearch {
  return {
    normalizedName: normalizeName(input.displayName),
    phoneTokens: contactTokens(input.phones, normalizePhone),
    emailTokens: contactTokens(input.emails, normalizeEmail),
  };
}

export function validateEntityInput(input: EntityCreateInput): void {
  const diagnostics: string[] = [];
  ensureCompany(stringValue(input.companyId), diagnostics);
  if (!input.primaryRole || !ALLOWED_ROLES.has(input.primaryRole)) {
    throw new Error('Entity primaryRole is required and must be supported');
  }
  if (!Array.isArray(input.roles) || input.roles.length === 0) {
    throw new Error('Entity roles[] is required');
  }
  const roles = uniqueRoles(input.primaryRole, input.roles);
  if (roles.length !== new Set(input.roles).size || !roles.includes(input.primaryRole)) {
    throw new Error('Entity roles[] must contain only supported roles and include primaryRole');
  }
  if (!stringValue(input.displayName)) {
    throw new Error('Entity displayName is required');
  }
  if (!stringValue(input.createdBy)) {
    throw new Error('Entity createdBy is required');
  }
}

export function normalizeEntity(input: EntityCreateInput): NormalizedEntityInput {
  const roles = uniqueRoles(input.primaryRole, input.roles);
  const phones = input.phones || [];
  const emails = input.emails || [];
  const search = buildEntitySearch({ displayName: input.displayName, phones, emails });

  return {
    ...input,
    companyId: stringValue(input.companyId),
    roles,
    displayName: stringValue(input.displayName),
    legalName: stringValue(input.legalName) || stringValue(input.displayName),
    phones,
    emails,
    addresses: input.addresses || [],
    tags: uniqueStrings(input.tags || []),
    search,
    legacyRefs: input.legacyRefs || {},
    createdBy: stringValue(input.createdBy),
  };
}

export async function detectEntityMatch(input: EntityCreateInput): Promise<{
  entity: EntityRecord | null;
  matchReason?: 'phone' | 'email';
  diagnostics: string[];
}> {
  const normalized = normalizeEntity(input);
  const diagnostics: string[] = [];
  ensureCompany(normalized.companyId, diagnostics);

  const phoneTokens = normalized.search?.phoneTokens || [];
  const emailTokens = normalized.search?.emailTokens || [];
  const matches = new Map<string, { entity: EntityRecord; reason: 'phone' | 'email' }>();

  if (!firebaseEnv.isConfigured) {
    const rows = await getAll<EntityRecord>(COLLECTIONS.ENTITIES);
    rows
      .filter((item) => item.companyId === normalized.companyId && item.isDeleted !== true)
      .forEach((item) => {
        if (phoneTokens.some((token) => item.search?.phoneTokens?.includes(token))) {
          matches.set(item.id, { entity: item, reason: 'phone' });
        } else if (emailTokens.some((token) => item.search?.emailTokens?.includes(token))) {
          matches.set(item.id, { entity: item, reason: 'email' });
        }
      });
  } else {
  for (const token of phoneTokens) {
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITIES),
      where('companyId', '==', normalized.companyId),
      where('isDeleted', '==', false),
      where('search.phoneTokens', 'array-contains', token)
    ));
    snap.docs.forEach((item) => matches.set(item.id, { entity: fromFirestore(item.id, item.data()), reason: 'phone' }));
  }

  for (const token of emailTokens) {
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.ENTITIES),
      where('companyId', '==', normalized.companyId),
      where('isDeleted', '==', false),
      where('search.emailTokens', 'array-contains', token)
    ));
    snap.docs.forEach((item) => {
      if (!matches.has(item.id)) {
        matches.set(item.id, { entity: fromFirestore(item.id, item.data()), reason: 'email' });
      }
    });
  }
  }

  if (matches.size > 1) {
    const ids = Array.from(matches.keys());
    diagnostics.push(`Multiple entity matches found: ${ids.join(', ')}`);
    logDuplicateDetection({ companyId: normalized.companyId, ids });
    throw new Error('Multiple matching entities found; manual review required');
  }

  const match = Array.from(matches.values())[0];
  return {
    entity: match?.entity || null,
    matchReason: match?.reason,
    diagnostics,
  };
}

export async function createOrResolveEntity(input: EntityCreateInput): Promise<EntityResolutionResult> {
  validateEntityInput(input);
  const normalized = normalizeEntity(input);
  const diagnostics: string[] = [];
  logEntityCreationAttempt({
    companyId: normalized.companyId,
    primaryRole: normalized.primaryRole,
    roles: normalized.roles,
    phoneKeyCount: normalized.search?.phoneTokens?.length || 0,
    emailKeyCount: normalized.search?.emailTokens?.length || 0,
  });

  const match = await detectEntityMatch(normalized);
  diagnostics.push(...match.diagnostics);
  if (match.entity) {
    diagnostics.push(`Resolved existing entity by ${match.matchReason}`);
    return {
      entity: match.entity,
      created: false,
      matched: true,
      matchReason: match.matchReason,
      diagnostics,
    };
  }

  const refId = genId.generic('ENT');
  const payload = sanitizeFirestoreData(createPayload(refId, normalized)) as EntityRecord;
  await createDocWithId(COLLECTIONS.ENTITIES, payload.id, payload);

  return {
    entity: payload,
    created: true,
    matched: false,
    diagnostics,
  };
}

export async function resolveEntity(entityId: string): Promise<EntityRecord | null> {
  const id = stringValue(entityId);
  if (!id) throw new Error('Entity id is required');

  if (!firebaseEnv.isConfigured) {
    const entity = await getOne<EntityRecord>(COLLECTIONS.ENTITIES, id);
    return entity?.isDeleted ? null : entity;
  }

  const snap = await getDoc(doc(db, COLLECTIONS.ENTITIES, id));
  if (!snap.exists()) return null;

  const entity = fromFirestore(snap.id, snap.data());
  return entity.isDeleted ? null : entity;
}

export async function updateEntity(entityId: string, input: EntityUpdateInput): Promise<void> {
  const id = stringValue(entityId);
  if (!id) throw new Error('Entity id is required');
  if (!stringValue(input.updatedBy)) throw new Error('Entity updatedBy is required');
  if ('companyId' in input) throw new Error('Entity companyId cannot be updated');
  if ('createdAt' in input || 'createdBy' in input || 'id' in input || 'search' in input) {
    throw new Error('Entity immutable fields cannot be updated directly');
  }

  const payload: Record<string, unknown> = {
    ...input,
    updatedBy: stringValue(input.updatedBy),
    updatedAt: serverTimestamp(),
  };

  if (input.displayName || input.phones || input.emails) {
    const existing = await resolveEntity(id);
    if (!existing) throw new Error(`Entity ${id} not found`);
    payload.search = buildEntitySearch({
      displayName: stringValue(input.displayName) || existing.displayName,
      phones: input.phones || existing.phones,
      emails: input.emails || existing.emails,
    });
  }

  await updateDocById(COLLECTIONS.ENTITIES, id, {
    ...payload,
    updatedAt: firebaseEnv.isConfigured ? undefined : new Date().toISOString(),
  });
}

export async function addEntityRole(entityId: string, role: EntityRole, updatedBy: string): Promise<void> {
  if (!ALLOWED_ROLES.has(role)) throw new Error('Unsupported entity role');
  const entity = await resolveEntity(entityId);
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  const roles = uniqueRoles(entity.primaryRole, [...entity.roles, role]);
  await updateDocById(COLLECTIONS.ENTITIES, entity.id, { roles, updatedBy: stringValue(updatedBy) });
}

export async function softDeleteEntity(entityId: string, deletedBy = 'system'): Promise<void> {
  const id = stringValue(entityId);
  if (!id) throw new Error('Entity id is required');

  await updateDocById(COLLECTIONS.ENTITIES, id, {
    isDeleted: true,
    deletedBy: stringValue(deletedBy) || 'system',
    deletedAt: firebaseEnv.isConfigured ? undefined : new Date().toISOString(),
    updatedBy: stringValue(deletedBy) || 'system',
  });
}
