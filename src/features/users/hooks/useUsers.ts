import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, getOne } from '../../../lib/firestore';
import {
  createProjectionWithUserId,
  deleteProjectionWithEntity,
  updateProjectionWithEntity,
} from '../../../lib/entityProjection';
import { isOwnerEmail, normalizeIdentityEmail } from '../../../lib/ownerAccess';
import {
  departmentForUser,
  isManagerForUser,
  managerEligibilityError,
  type OrgRoleLike,
  type OrgUserLike,
} from '../orgHierarchy';

/**
 * Firebase-normalized ERP identity email (trim + lowercase) — reuses
 * ownerAccess.normalizeIdentityEmail.
 *
 * Firebase Authentication ALWAYS stores account emails lowercased, so the
 * ID-token `email` claim is lowercase. Firestore rules compare the users doc
 * `email` field to that token email with a CASE-SENSITIVE `==`. The Users
 * workspace used to store the raw form email on the ERP doc — a mixed-case
 * email therefore made the unmapped first-login read of users/{authUid} fail
 * the email-self read clause and return permission-denied, surfacing as
 * "Authenticated, but ERP identity access was denied". Normalizing at this
 * single canonical write boundary (used by desktop Users.tsx AND mobile
 * MobileUsersWorkspace) keeps Auth account == ERP doc always.
 */
function withNormalizedEmail(payload: Record<string, unknown>): Record<string, unknown> {
  const email = normalizeIdentityEmail(payload.email);
  return email ? { ...payload, email } : payload;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Resolve a role document by name — system roles are keyed by name, custom roles by ROL-* id. */
async function findRoleByName(roleName: string): Promise<OrgRoleLike & { id: string } | null> {
  const name = text(roleName);
  if (!name) return null;
  const byId = await getOne<OrgRoleLike & { id: string }>(COLLECTIONS.ROLES, name);
  if (byId) return byId;
  const all = await getAll<OrgRoleLike & { id: string }>(COLLECTIONS.ROLES);
  return all.find((role) => text(role.name).toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Enrich a user payload with the data-driven organization fields and enforce
 * the manager↔department coherence (business layer; Firestore rules enforce
 * the same relationship server-side).
 *
 * - `department`  ← the role document's department (denormalized for rules),
 *   only when `role` is present in the payload (partial updates must not zero
 *   the denormalized org fields)
 * - `isManager`   ← whether the role is a manager role (denormalized for rules)
 * - `managerName` ← display name of the reporting manager
 * - throws when a CHANGED reporting-manager assignment is not an eligible
 *   manager for the report's department (cross-section only via
 *   Management/super-admin). Unchanged assignments (legacy edits of name/
 *   status/phone) are not re-validated — mirroring the rules' escape hatch so
 *   a stale manager reference cannot hard-lock user management.
 *
 * @param existing the current users doc (update only); null/undefined on create
 *   or when the pre-read failed.
 */
async function enrichOrgFields(
  payload: Record<string, unknown>,
  existing: OrgUserLike | null | undefined = null,
): Promise<Record<string, unknown>> {
  const roleName = text(payload.role);
  const role = roleName ? await findRoleByName(roleName) : null;
  // Only derive from the role when it was actually provided; otherwise keep
  // the existing denormalized values (partial-update protection).
  const department = roleName
    ? departmentForUser(role, text(payload.department))
    : text(existing?.department) || text(payload.department);
  const isManager = roleName ? isManagerForUser(role) : existing?.isManager === true;
  const managerId = text(payload.managerId);
  let managerName = text(payload.managerName);

  // Validate only when the assignment actually changed: managerId differs from
  // the existing doc, or the department changed (role switch). Unchanged
  // legacy assignments pass through (matching managerAssignmentUnchanged()).
  const assignmentChanged = managerId !== text(existing?.managerId)
    || department !== text(existing?.department);
  if (managerId && assignmentChanged) {
    const manager = await getOne<OrgUserLike & { id: string }>(COLLECTIONS.USERS, managerId);
    const managerRole = manager ? await findRoleByName(text(manager.role)) : null;
    const error = managerEligibilityError(department, manager, managerRole);
    if (error) throw new Error(error);
    managerName = text(manager?.name || manager?.displayName) || managerName;
  }

  return {
    ...payload,
    department,
    isManager,
    ...(managerName ? { managerName } : {}),
  };
}

export async function createUserProjection(id: string, payload: Record<string, unknown>) {
  const normalized = withNormalizedEmail(payload);
  if (isOwnerEmail(normalized.email)) throw new Error('This Firebase owner identity is not a manageable ERP user.');
  const orgFields = await enrichOrgFields(normalized);
  return createProjectionWithUserId(COLLECTIONS.USERS, id, orgFields);
}

export async function updateUserProjection(id: string, payload: Record<string, unknown>) {
  const normalized = withNormalizedEmail(payload);
  if (isOwnerEmail(normalized.email)) throw new Error('This Firebase owner identity is not a manageable ERP user.');
  const existing = await getOne<OrgUserLike & { id: string }>(COLLECTIONS.USERS, id).catch(() => null);
  const orgFields = await enrichOrgFields(normalized, existing);
  return updateProjectionWithEntity(COLLECTIONS.USERS, id, orgFields);
}

export function deleteUserProjection(id: string) {
  return deleteProjectionWithEntity(COLLECTIONS.USERS, id);
}
