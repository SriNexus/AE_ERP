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
 * incidental — see this phase's completion record for the specific scope
 * boundary (self + same-company Admin/HR only; GroupAdmin cross-company
 * on-behalf-of enrollment is explicitly deferred, matching this phase's own
 * "avoid broad refactors" instruction — Phase 3's rules already support it
 * for a future extension of this module, nothing here forecloses it).
 *
 * Every function derives identity from `AuthenticatedUser` (already
 * resolved server-side by `api/_lib/auth.ts`'s `resolveAuthenticatedUser`,
 * which itself already rejects an inactive/suspended/deleted actor via its
 * own `INACTIVE_USER` check) — never from a request body field.
 */

import type { AuthenticatedUser } from '../auth';
import { crossTenantDenied, notAuthorized } from '../../../src/lib/biometrics/pipeline/types';

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

  // On-behalf-of enrollment (Master Plan §11): Admin/HR, same company only,
  // in this phase's scope. Owner/Super Admin bypass the role check but are
  // still subject to the same-company anchor below unless explicitly
  // platform-tier (isSuperAdmin already carries that intent elsewhere in
  // this codebase's api/_lib modules).
  if (auth.role !== 'Admin' && auth.role !== 'HR' && !auth.isSuperAdmin) {
    throw notAuthorized('Only Admin or HR may enroll another employee\'s face.');
  }

  const targetProfile = await deps.readUser(targetUserId);
  if (!targetProfile) {
    throw notAuthorized('The target employee could not be found.');
  }
  const targetCompanyId = typeof targetProfile.companyId === 'string' ? targetProfile.companyId : '';
  if (!targetCompanyId || (targetCompanyId !== auth.companyId && !auth.isSuperAdmin)) {
    throw crossTenantDenied();
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
