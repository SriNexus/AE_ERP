/**
 * RBAC Master Implementation Plan — AUTH-D10 (Biometrics API authorization).
 *
 * `api/_lib/biometrics/authorization.ts`'s on-behalf-of enrollment gate used
 * to check only `role !== 'Admin' && role !== 'HR' && !isSuperAdmin` — since
 * GroupAdmin is a canonical role/alias everywhere else this exact
 * distinction is made (client and server `canDo()`, and `firestore.rules`'
 * own `biometricCreateAllowed`/`biometricReadAllowed`), that was a false
 * DENY for GroupAdmin, not an intentional restriction.
 *
 * This file pins the fixed behavior: GroupAdmin is now authorized for
 * same-company on-behalf-of enrollment exactly like Admin/HR, while every
 * pre-existing boundary this function enforces (cross-tenant denial,
 * inactive-target denial, missing-target denial, unrelated-role denial,
 * self-enrollment always allowed) remains completely unchanged.
 *
 * Kept in its own file (rather than folded into
 * `phase4Orchestration.test.ts`, which already covers this function's
 * pre-existing Admin/SuperAdmin/cross-tenant behavior) so the AUTH-D10 fix
 * has an isolated, easy-to-find regression proof of its own.
 */
import { describe, it, expect } from 'vitest';
import type { AuthenticatedUser } from '../../auth';
import { resolveEnrollmentTarget, type UserProfileReader } from '../authorization';

function buildAuth(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    uid: 'uid-actor-1',
    erpUserId: 'actor-1',
    email: 'actor1@example.com',
    name: 'Actor One',
    role: 'Employee',
    companyId: 'company-1',
    isSuperAdmin: false,
    ...overrides,
  };
}

class FakeUserProfileReader implements UserProfileReader {
  constructor(private readonly users: Record<string, Record<string, unknown> | null>) {}
  async readUser(userId: string) {
    return this.users[userId] ?? null;
  }
}

const TARGET_SAME_COMPANY = { 'target-1': { companyId: 'company-1', status: 'active' } };
const TARGET_OTHER_COMPANY = { 'target-2': { companyId: 'company-OTHER', status: 'active' } };
const TARGET_INACTIVE = { 'target-3': { companyId: 'company-1', status: 'inactive' } };

describe('AUTH-D10 — GroupAdmin false-deny fix on biometric on-behalf-of enrollment', () => {
  // 1. GroupAdmin is authorized when it should be (same company).
  it('POSITIVE: GroupAdmin can enroll another employee in their own company (the exact false-deny this fixes)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    const target = await resolveEnrollmentTarget(auth, 'target-1', reader);
    expect(target).toEqual({ targetUserId: 'target-1', targetCompanyId: 'company-1' });
  });

  // 2. Admin remains authorized (unchanged, regression guard).
  it('REGRESSION: Admin remains authorized for same-company on-behalf-of enrollment', async () => {
    const auth = buildAuth({ role: 'Admin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    const target = await resolveEnrollmentTarget(auth, 'target-1', reader);
    expect(target).toEqual({ targetUserId: 'target-1', targetCompanyId: 'company-1' });
  });

  // 3. HR remains authorized (unchanged, regression guard).
  it('REGRESSION: HR remains authorized for same-company on-behalf-of enrollment', async () => {
    const auth = buildAuth({ role: 'HR', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    const target = await resolveEnrollmentTarget(auth, 'target-1', reader);
    expect(target).toEqual({ targetUserId: 'target-1', targetCompanyId: 'company-1' });
  });

  // 4. SuperAdmin remains authorized (unchanged, including its cross-tenant bypass).
  it('REGRESSION: SuperAdmin remains authorized, including across companies', async () => {
    const auth = buildAuth({ role: 'Employee', isSuperAdmin: true, companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_OTHER_COMPANY);
    const target = await resolveEnrollmentTarget(auth, 'target-2', reader);
    expect(target).toEqual({ targetUserId: 'target-2', targetCompanyId: 'company-OTHER' });
  });

  // 5. Unauthorized roles remain denied (not opened by the GroupAdmin fix).
  it('NEGATIVE: an unrelated role (Sales) remains denied — the fix does not widen the gate beyond Admin/HR/GroupAdmin', async () => {
    const auth = buildAuth({ role: 'Sales', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-1', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  it('NEGATIVE: a plain Employee remains denied', async () => {
    const auth = buildAuth({ role: 'Employee', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-1', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  // 6. Unknown/missing authorization data fails closed.
  it('NEGATIVE: an unknown/malformed role string fails closed, not opened by the new GroupAdmin case', async () => {
    const auth = buildAuth({ role: 'TotallyMadeUpRole123', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-1', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  it('NEGATIVE: an empty role string fails closed', async () => {
    const auth = buildAuth({ role: '', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_SAME_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-1', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  // 7. Cross-company access remains denied for GroupAdmin (this fix is
  //    scoped to same-company only — the separate cross-company/same-group
  //    capability firestore.rules already supports is explicitly deferred,
  //    see authorization.ts's header comment).
  it('NEGATIVE: GroupAdmin remains denied across companies — cross-company/same-group support is explicitly deferred, not silently added', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_OTHER_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-2', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  // 8. Cross-group access remains denied — AuthenticatedUser carries no
  //    groupId at all, so there is no group concept this function could
  //    even evaluate; it correctly falls back to the company boundary above,
  //    which still denies the cross-company actor.
  it('NEGATIVE: a GroupAdmin cannot use a same-group, different-company target to bypass the company boundary (no group-matching path exists in this module)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' });
    // Even if the target happens to belong to the same logical group in a
    // different company, this module has no groupId to compare against —
    // the company check alone governs, and denies it.
    const reader = new FakeUserProfileReader({ 'target-4': { companyId: 'company-2', groupId: 'group-shared', status: 'active' } });
    await expect(resolveEnrollmentTarget(auth, 'target-4', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  // 9. Existing self/employee authorization boundaries remain intact.
  it('REGRESSION: self-enrollment remains always authorized for GroupAdmin, unaffected by the on-behalf-of role-gate change', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', erpUserId: 'actor-1', companyId: 'company-1' });
    const reader = new FakeUserProfileReader({});
    const target = await resolveEnrollmentTarget(auth, undefined, reader);
    expect(target).toEqual({ targetUserId: 'actor-1', targetCompanyId: 'company-1' });
  });

  it('REGRESSION: a GroupAdmin on-behalf-of target that does not exist server-side is still rejected (identity forgery resistance unchanged)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader({});
    await expect(resolveEnrollmentTarget(auth, 'ghost-user', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  it('REGRESSION: a GroupAdmin cannot enroll an inactive/suspended/deleted target — that boundary is untouched by this fix', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader(TARGET_INACTIVE);
    await expect(resolveEnrollmentTarget(auth, 'target-3', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });
});
