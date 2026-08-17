import { where, type QueryConstraint } from 'firebase/firestore';
import type { FirestoreRoleDocument, Visibility } from './permissions';

export const PROJECT_SCOPED_COLLECTIONS = new Set([
  'projects',
  'surveys',
  'engineering_designs',
  'installations',
  'qc_checks',
  'commissioning_records',
  'net_metering_applications',
  'subsidy_applications',
  // Phase 6: Channel Partner Vendor Lock / Scheme Registration — project-
  // scoped so a Partner-role user's reads resolve to their own partnerId
  // (self scope) per the Phase 2 visibility contract. Full rules-level
  // partner isolation is Phase 13; this entry only wires the data layer.
  'scheme_registrations',
  'project_handovers',
  'amc_contracts',
  'service_tickets',
  'generation_readings',
]);

// Phase 3 (§8.3 IMPLEMENTATION DECISION): `partnerId` is added so a
// Partner-role user's projects resolve to `self` — a project created for a
// partner-owned customer carries partnerId = the partner DOC id (never the
// user id), which only matches when the authenticated partner doc id is part
// of the allowed set (see the optional partnerDocId argument threaded through
// resolveAssignedIds/canAccessProjectRecord/buildProjectVisibilityQueryPlan).
export const PROJECT_ASSIGNMENT_FIELDS = ['assignedSurveyor', 'assignedInstaller', 'salesOwner', 'designerId', 'partnerId'] as const;

/**
 * VL-9/VL-10 (TL/Manager team Registration view): PER-COLLECTION extra
 * assignment fields.
 *
 * scheme_registrations records carry the canonical team-visibility keys
 *   - managerId — the owning partner's TL/Manager USER id (resolved from the
 *     channel_partners document at creation, never client-supplied), and
 *   - userId — the owning partner's linked users doc id (notification +
 *     team-hierarchy recipient).
 * The base PROJECT_ASSIGNMENT_FIELDS only matches `partnerId` against the
 * authenticated partner DOC id, so a Manager/TL (team scope — the allowed-id
 * set is USER ids) currently sees ZERO registrations at the data layer even
 * though the Phase 2 permission contract grants them team visibility. Adding
 * these fields lets the existing managerId/teamMemberIds machinery resolve
 * the team scope for registrations without a second team model, without
 * URL/UI-derived authorization, and without changing any other
 * project-scoped collection.
 */
export const PROJECT_EXTRA_ASSIGNMENT_FIELDS: Record<string, readonly string[]> = {
  scheme_registrations: ['managerId', 'userId'],
};

/** Effective assignment fields for a collection: the canonical project set
 * plus any VL-9/VL-10 collection-specific extras. Omitting the collection
 * (or an unknown collection) yields exactly PROJECT_ASSIGNMENT_FIELDS, so
 * existing callers/tests keep the historical behavior. */
export function projectAssignmentFields(collectionName?: string | null): readonly string[] {
  if (!collectionName) return PROJECT_ASSIGNMENT_FIELDS;
  const extra = PROJECT_EXTRA_ASSIGNMENT_FIELDS[collectionName];
  return extra ? [...PROJECT_ASSIGNMENT_FIELDS, ...extra] : PROJECT_ASSIGNMENT_FIELDS;
}

export type ProjectVisibilityMode = 'all' | 'assigned';

export type ProjectVisibilityRecord = Record<string, unknown> & {
  companyId?: string;
  assignedSurveyor?: string | null;
  assignedInstaller?: string | null;
  salesOwner?: string | null;
  designerId?: string | null;
  partnerId?: string | null;
};

export type ProjectVisibilityQueryPlan = {
  mode: ProjectVisibilityMode;
  queries: QueryConstraint[][];
};

const PROJECT_SCOPED_ROLE_NAMES = new Set([
  'surveyor',
  'engineer',
  'installationlead',
  'servicetechnician',
  'complianceofficer',
]);

// Firestore's `in` operator accepts at most 30 comparison values per clause
// (current JS SDK limit) — a 'team' visibility query must chunk the
// [self, ...teamMemberIds] id set rather than assume it always fits in one
// query. Resolves the Blueprint Phase 13 [UNKNOWN] flag on this point.
const FIRESTORE_IN_CHUNK_SIZE = 30;

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizedKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function visibilityFromRoleDoc(roleData?: FirestoreRoleDocument | null): Visibility | undefined {
  const visibility = roleData?.permissions?.projects?.visibility;
  return visibility === 'all' || visibility === 'team' || visibility === 'self' ? visibility : undefined;
}

/**
 * Resolves the effective visibility kind for the `projects` module,
 * falling back to a role-name heuristic only when the role document
 * doesn't declare an explicit `projects.visibility` value.
 */
function resolveVisibilityKind(roleName?: string | null, roleData?: FirestoreRoleDocument | null): Visibility {
  const visibility = visibilityFromRoleDoc(roleData);
  if (visibility) return visibility;
  return PROJECT_SCOPED_ROLE_NAMES.has(normalizedKey(roleName)) ? 'self' : 'all';
}

/**
 * Builds the deduplicated id set a 'self' or 'team' visibility check/query
 * should match against. `normalize:true` lower-cases every id for in-memory
 * comparison against already-normalized record field values; `false`
 * preserves original casing/whitespace so the ids can be sent verbatim as
 * Firestore query values (record field values are stored as-typed, not
 * lower-cased).
 */
function resolveAssignedIds(
  userId: string,
  kind: Visibility,
  teamMemberIds: (string | null | undefined)[],
  normalize: boolean,
  /** Phase 3: authenticated partner's channel_partners DOC id (partnerId matching). */
  partnerDocId?: string | null,
): string[] {
  const self = normalize ? normalizedKey(userId) : String(userId).trim();
  const partnerId = partnerDocId ? (normalize ? normalizedKey(partnerDocId) : String(partnerDocId).trim()) : '';
  const ids = [self, ...(partnerId ? [partnerId] : [])];
  if (kind !== 'team') return Array.from(new Set(ids));
  const toId = (value: unknown) => (normalize ? normalizedKey(value) : String(value ?? '').trim());
  const teamIds = teamMemberIds.map(toId).filter(Boolean);
  return Array.from(new Set([...ids, ...teamIds]));
}

export function isProjectScopedCollection(collectionName: string) {
  return PROJECT_SCOPED_COLLECTIONS.has(collectionName);
}

export function isProjectScopedRole(roleName?: string | null, roleData?: FirestoreRoleDocument | null) {
  const kind = resolveVisibilityKind(roleName, roleData);
  return kind === 'self' || kind === 'team';
}

export function getProjectVisibilityMode(roleName?: string | null, roleData?: FirestoreRoleDocument | null): ProjectVisibilityMode {
  return isProjectScopedRole(roleName, roleData) ? 'assigned' : 'all';
}

export function canAccessProjectRecord(
  record: ProjectVisibilityRecord | null | undefined,
  userId?: string | null,
  roleName?: string | null,
  roleData?: FirestoreRoleDocument | null,
  teamMemberIds: (string | null | undefined)[] = [],
  partnerDocId?: string | null,
  /** VL-9/VL-10: collection-specific extra assignment fields (e.g.
   * scheme_registrations → managerId/userId). Defaults to the canonical
   * project fields when omitted. */
  extraFields?: readonly string[],
) {
  if (!record) return false;
  const kind = resolveVisibilityKind(roleName, roleData);
  if (kind === 'all') return true;

  const resolvedUserId = normalizedKey(userId);
  if (!resolvedUserId) return false;

  const allowedIds = new Set(resolveAssignedIds(resolvedUserId, kind, teamMemberIds, true, partnerDocId));
  const fields = extraFields ?? PROJECT_ASSIGNMENT_FIELDS;
  return fields.some((field) => allowedIds.has(normalizedKey(record[field])));
}

export function filterVisibleProjectRecords<T extends ProjectVisibilityRecord>(
  records: T[],
  userId?: string | null,
  roleName?: string | null,
  roleData?: FirestoreRoleDocument | null,
  teamMemberIds: (string | null | undefined)[] = [],
  partnerDocId?: string | null,
  /** VL-9/VL-10: collection name → extra assignment fields applied (see
   * projectAssignmentFields). */
  collectionName?: string | null,
) {
  const kind = resolveVisibilityKind(roleName, roleData);
  if (kind === 'all') {
    return records;
  }

  const resolvedUserId = normalizedKey(userId);
  if (!resolvedUserId) return [];

  const fields = projectAssignmentFields(collectionName);
  return records.filter((record) => canAccessProjectRecord(record, resolvedUserId, roleName, roleData, teamMemberIds, partnerDocId, fields));
}

export function buildProjectVisibilityQueryPlan(
  companyId?: string,
  userId?: string | null,
  roleName?: string | null,
  roleData?: FirestoreRoleDocument | null,
  teamMemberIds: (string | null | undefined)[] = [],
  partnerDocId?: string | null,
  /** VL-9/VL-10: collection name → extra assignment fields applied (see
   * projectAssignmentFields). */
  collectionName?: string | null,
): ProjectVisibilityQueryPlan {
  const kind = resolveVisibilityKind(roleName, roleData);
  const companyConstraint = normalizedKey(companyId) && normalizedKey(companyId) !== 'all'
    ? [where('companyId', '==', companyId)]
    : [];
  if (kind === 'all' || !normalizedKey(userId)) {
    return {
      mode: 'all',
      queries: [companyConstraint],
    };
  }

  const resolvedUserId = String(userId).trim();
  const ids = resolveAssignedIds(resolvedUserId, kind, teamMemberIds, false, partnerDocId);
  const idChunks = chunk(ids, FIRESTORE_IN_CHUNK_SIZE);
  const fields = projectAssignmentFields(collectionName);

  return {
    mode: 'assigned',
    queries: fields.flatMap((field) =>
      idChunks.map((idChunk) => [
        ...companyConstraint,
        idChunk.length === 1 ? where(field, '==', idChunk[0]) : where(field, 'in', idChunk),
      ])
    ),
  };
}
