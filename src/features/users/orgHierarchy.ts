/**
 * orgHierarchy — pure, data-driven organization-hierarchy helpers.
 *
 * The ERP's organization model (no universal "Manager" that owns everything):
 *
 *   Level 0  Super Admin              — highest authority, cross-section by policy
 *   Level 1  Management ('Management')— broad cross-section management layer
 *   Level 2  Admin                    — same-company administrative management
 *   Level 3  Section Manager          — manager WITHIN one department/section
 *   Level 4  Section Member           — role + department + team scope
 *   Level 5  Partner / external       — isolated by the partner model
 *
 * A user's DEPARTMENT is the `department` of their role document
 * (data-driven: a new section = a new role with a `department`). The users doc
 * carries a denormalized `department` + `isManager` (recomputed at every user
 * write by the canonical hook) so Firestore rules can enforce the manager↔
 * department coherence with a single cheap `get(users/{managerId})`.
 *
 * Manager eligibility: a valid reporting manager is either
 *   1. a super-admin (cross-section by policy), or
 *   2. a user whose role is a manager role (`isManager === true`) AND whose
 *      department matches the report's department, OR whose department is the
 *      cross-section 'Management' layer.
 * A same-department non-manager and a different-department manager are both
 * invalid unless the Management/super-admin exception applies.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Cross-section management layer: these departments may manage any section. */
export const MANAGEMENT_DEPARTMENT = 'Management';

export type OrgRoleLike = {
  name?: unknown;
  department?: unknown;
  isManager?: unknown;
  isSystem?: unknown;
};

export type OrgUserLike = {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  role?: unknown;
  department?: unknown;
  managerId?: unknown;
  isManager?: unknown;
  isSuperAdmin?: unknown;
  status?: unknown;
  isDeleted?: unknown;
};

export function roleDepartment(role: OrgRoleLike | null | undefined): string {
  return text(role?.department);
}

export function isManagerRole(role: OrgRoleLike | null | undefined): boolean {
  return role?.isManager === true;
}

export function isSystemRole(role: OrgRoleLike | null | undefined): boolean {
  return role?.isSystem === true;
}

/** Denormalized department for a user doc, derived from its role document. */
export function departmentForUser(role: OrgRoleLike | null | undefined, fallback = ''): string {
  return roleDepartment(role) || text(fallback);
}

/** Denormalized manager capability for a user doc, derived from its role. */
export function isManagerForUser(role: OrgRoleLike | null | undefined): boolean {
  return isManagerRole(role);
}

/**
 * Resolve the department of a user: prefers the denormalized doc field, falls
 * back to the role document's department (and finally the role name when the
 * role doc is missing but the role name is a recognizable section).
 */
export function resolveUserDepartment(
  user: OrgUserLike | null | undefined,
  role: OrgRoleLike | null | undefined,
): string {
  if (text(user?.department)) return text(user?.department);
  return roleDepartment(role);
}

/**
 * Manager eligibility — returns an error message, or null when valid.
 *
 * @param reportDepartment department of the user being created/edited
 * @param manager         the candidate manager's users doc (may be null)
 * @param managerRole     the candidate manager's role document (may be null)
 */
export function managerEligibilityError(
  reportDepartment: string,
  manager: OrgUserLike | null | undefined,
  managerRole: OrgRoleLike | null | undefined,
): string | null {
  const managerId = text(manager?.id);
  if (!managerId) return 'Reporting manager was not found.';

  if (manager?.isSuperAdmin === true) return null; // Level 0 exception

  const managerDept = resolveUserDepartment(manager, managerRole);
  const managerCapable = isManagerRole(managerRole) || manager?.isManager === true;
  if (!managerCapable) {
    return `Reporting manager must hold a manager role in ${reportDepartment || 'their section'}.`;
  }
  if (managerDept === reportDepartment) return null;
  if (managerDept === MANAGEMENT_DEPARTMENT) return null; // Level 1 exception

  return `Reporting manager belongs to ${managerDept || 'an unassigned section'}, not ${reportDepartment || 'this section'}.`;
}

/** Client-side filter predicate for the manager selector options. */
export function isEligibleManagerOption(
  candidate: OrgUserLike,
  reportDepartment: string,
  candidateRole: OrgRoleLike | null | undefined,
): boolean {
  if (candidate.isSuperAdmin === true) return true;
  if (candidate.status === 'Inactive' || candidate.status === 'Suspended') return false;
  if (candidate.isDeleted === true) return false;
  if (!isManagerRole(candidateRole) && candidate.isManager !== true) return false;
  const dept = resolveUserDepartment(candidate, candidateRole);
  return dept === reportDepartment || dept === MANAGEMENT_DEPARTMENT;
}

/**
 * Partner-manager eligibility — returns an error message, or null when valid.
 *
 * Phase 1 (Channel Partner identity): a partner's `managerId` is the TL/Manager
 * users doc id who supervises the partner. Partners are external and have no
 * department, so the employee department-coherence rules do not apply — the
 * requirement is simply: the manager must be a manager-capable user
 * (manager-role holder, `isManager` denormalized flag, or super-admin) in the
 * SAME company (company check is enforced by the caller/linkPartnerUser).
 * Reuses the orgHierarchy primitives (isManagerRole / isSystemRole) so there is
 * exactly ONE hierarchy architecture.
 */
export function partnerManagerEligibilityError(
  manager: OrgUserLike | null | undefined,
  managerRole: OrgRoleLike | null | undefined,
): string | null {
  const managerId = text(manager?.id);
  if (!managerId) return 'Reporting manager was not found.';
  if (manager?.isSuperAdmin === true) return null; // Level 0 exception
  if (manager?.status === 'Inactive' || manager?.status === 'Suspended') {
    return 'Reporting manager is not active.';
  }
  if (manager?.isDeleted === true) return 'Reporting manager account has been deleted.';
  if (!isManagerRole(managerRole) && manager?.isManager !== true) {
    return 'Reporting manager must hold a manager role.';
  }
  return null;
}
