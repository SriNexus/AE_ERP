/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — server-derived identity
 * and tenant-scope resolution for the biometric orchestration layer.
 *
 * Mirrors the exact authorization shape Phase 3's `firestore.rules`
 * (`biometricCreateAllowed`/`biometricReadAllowed`/`biometricUpdateAllowed`)
 * already enforces for the direct client-SDK path — this module is a
 * SEPARATE, ALSO-authoritative enforcement point for the Admin-SDK-backed
 * API path (Admin SDK bypasses Firestore rules entirely, exactly like every
 * existing `api/[entity].ts`-style route in this codebase already relies on
 * its own `requirePermission()` check rather than rules). Keeping this
 * module's decisions in lockstep with Phase 3's rules is deliberate, not
 * incidental — the scope boundary is: self + same-company Admin/HR/GroupAdmin,
 * PLUS GroupAdmin cross-company on-behalf-of enrollment for a SAME-GROUP
 * sibling company (the `sameGrp` branch `firestore.rules`' own
 * `biometricCreateAllowed`/`biometricReadAllowed`/`biometricUpdateAllowed`
 * already grant). That last case was previously deferred because
 * `AuthenticatedUser` carried no `groupId`; RBAC Phase 8 added it (see
 * api/_lib/auth.ts), so it is now implemented here — a foreign-group target
 * (or a GroupAdmin with no authoritative groupId) remains denied.
 *
 * RBAC Master Plan AUTH-D10: the on-behalf-of role gate below used to check
 * only `role !== 'Admin' && role !== 'HR'`, hardcoded without any GroupAdmin
 * case — since GroupAdmin is a canonical alias of Admin everywhere else in
 * this codebase (client `canDo()`, server `canDo()`, and this same rules
 * file's own biometric functions), that was a false DENY, not an
 * intentional restriction. Fixed by adding an explicit `role === 'GroupAdmin'`
 * branch, mirroring `firestore.rules`' own raw-role-name style for this
 * exact check (not a `canDo()`/permission-document lookup — see the
 * completion record for why this is classified Bucket A, not Bucket B).
 *
 * Every function derives identity from `AuthenticatedUser` (already
 * resolved server-side by `api/_lib/auth.ts`'s `resolveAuthenticatedUser`,
 * which itself already rejects an inactive/suspended/deleted actor via its
 * own `INACTIVE_USER` check) — never from a request body field.
 */

import type { AuthenticatedUser } from '../auth.js';
import { crossTenantDenied, notAuthorized } from '../../../src/lib/biometrics/pipeline/types.js';

export interface UserProfileReader {
  readUser(userId: string): Promise<Record<string, unknown> | null>;
}

export interface EnrollmentTarget {
  readonly targetUserId: string;
  readonly targetCompanyId: string;
}

/**
 * Resolves WHO a caller is enrolling a face reference for, and verifies the
 * caller is authorized to do so.
 *
 * `requestedTargetUserId` is client-supplied (a caller says "enroll this
 * employee") — per this phase's core instruction ("prevent caller-supplied
 * employeeId/userId/companyId/groupId from becoming trusted identity"), it
 * is NEVER trusted as the identity anchor by itself: it only selects WHICH
 * employee's record to enroll, and the actual authorization (may this
 * caller touch that employee's record at all) and the target's tenant
 * fields (companyId) are always re-derived from the target's OWN, real,
 * server-side `users/{targetUserId}` document — never from anything the
 * client claims about the target.
 */
export async function resolveEnrollmentTarget(
  auth: AuthenticatedUser,
  requestedTargetUserId: string | undefined,
  deps: UserProfileReader,
): Promise<EnrollmentTarget> {
  const requested = (requestedTargetUserId || '').trim();
  const targetUserId = requested || auth.erpUserId;

  if (targetUserId === auth.erpUserId) {
    // Self-enrollment — always authorized. The caller's own identity/company
    // already come from resolveAuthenticatedUser(), which independently
    // re-validated them server-side; actorIsActive-equivalent is already
    // enforced there (INACTIVE_USER rejection).
    return { targetUserId, targetCompanyId: auth.companyId };
  }

  // On-behalf-of enrollment (Master Plan §11): Admin/HR/GroupAdmin, same
  // company only, in this phase's scope. Owner/Super Admin bypass the role
  // check but are still subject to the same-company anchor below unless
  // explicitly platform-tier (isSuperAdmin already carries that intent
  // elsewhere in this codebase's api/_lib modules).
  //
  // AUTH-D10: GroupAdmin added — it is a scope-extension alias of Admin
  // everywhere else this codebase makes this exact distinction (client and
  // server canDo(), and firestore.rules' own biometricCreateAllowed/
  // biometricReadAllowed, which grant a same-company GroupAdmin actor via
  // their `sameCo` branch identically to Admin/HR — GroupAdmin is not
  // limited to the separate, ADDITIONAL `sameGrp` cross-company branch
  // there). Deliberately a raw role-name check, not a canDo('edit',
  // 'employees')-style permission lookup: firestore.rules enforces this
  // exact boundary the same hardcoded way, independent of any company's
  // customizable role-permission documents, because biometric embedding
  // data is a materially more sensitive category than an ordinary module
  // permission (see biometricReadAllowed's own comment) — routing it
  // through a customizable permission would let a company's unrelated
  // Employees-module role edit (e.g. granting Manager `employees:edit`)
  // silently also grant biometric-enrollment authority, which is a new
  // privilege escalation this fix must not introduce.
  if (auth.role !== 'Admin' && auth.role !== 'HR' && auth.role !== 'GroupAdmin' && !auth.isSuperAdmin) {
    throw notAuthorized('Only Admin, HR, or GroupAdmin may enroll another employee\'s face.');
  }

  const targetProfile = await deps.readUser(targetUserId);
  if (!targetProfile) {
    throw notAuthorized('The target employee could not be found.');
  }
  const targetCompanyId = typeof targetProfile.companyId === 'string' ? targetProfile.companyId : '';
  if (!targetCompanyId) {
    throw crossTenantDenied();
  }
  if (targetCompanyId !== auth.companyId && !auth.isSuperAdmin) {
    // RBAC Master Plan AUTH-D10 (completion): a GroupAdmin may enroll a face
    // for an employee in a SAME-GROUP sibling company — this mirrors
    // firestore.rules' biometricCreateAllowed/biometricReadAllowed `sameGrp`
    // branch (actor.role == 'GroupAdmin' && data.groupId == actorGroupId).
    // It was deferred ONLY because AuthenticatedUser carried no groupId; it
    // does now (RBAC Phase 8). A foreign-group target — or a GroupAdmin whose
    // own identity has no authoritative groupId — still falls through to
    // crossTenantDenied(). (Group-suspension parity with the rules'
    // groupIsActive() sub-check is not evaluated here: the API plane as a
    // whole does not gate on group status, so this stays consistent with its
    // existing same-company grant rather than adding a new dependency.)
    const actorGroupId = typeof auth.groupId === 'string' ? auth.groupId.trim() : '';
    const targetGroupId = typeof targetProfile.groupId === 'string' ? targetProfile.groupId.trim() : '';
    const sameGroupAdmin =
      auth.role === 'GroupAdmin' &&
      actorGroupId.length > 0 &&
      targetGroupId.length > 0 &&
      targetGroupId === actorGroupId;
    if (!sameGroupAdmin) {
      throw crossTenantDenied();
    }
  }
  const status = typeof targetProfile.status === 'string' ? targetProfile.status.toLowerCase() : '';
  if (['inactive', 'suspended', 'disabled'].includes(status) || targetProfile.isDeleted === true) {
    throw notAuthorized('The target employee is not active.');
  }

  return { targetUserId, targetCompanyId };
}

export interface VerificationTarget {
  readonly userId: string;
  readonly companyId: string;
}

/**
 * Verification is ALWAYS self-service (Master Plan §12: "the orchestration
 * layer resolves userId from the caller's own auth-mapped identity... and
 * looks up biometric_face_references/{that userId} ONLY") — there is no
 * "verify on behalf of" case, deliberately, matching §4's Option A decision
 * (an authenticated employee proves it is themselves; nobody else's
 * identity can ever be the subject of a verification attempt).
 */
export function resolveVerificationTarget(auth: AuthenticatedUser): VerificationTarget {
  return { userId: auth.erpUserId, companyId: auth.companyId };
}
