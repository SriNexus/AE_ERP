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
 * same-company on-behalf-of enrollment exactly like Admin/HR, AND (AUTH-D10
 * completion, RBAC Phase 8) for a SAME-GROUP sibling company's employee —
 * mirroring firestore.rules' biometricCreateAllowed `sameGrp` branch — while
 * every other boundary this function enforces (foreign-group denial,
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

  // 7. Cross-company access is denied for a GroupAdmin when the target is NOT
  //    in the GroupAdmin's own group (no groupId on the target, or a
  //    different groupId) — the foreign-group boundary is intact.
  it('NEGATIVE: GroupAdmin is denied a different-company target that carries no groupId (cannot be proven same-group)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1', groupId: 'group-A' });
    const reader = new FakeUserProfileReader(TARGET_OTHER_COMPANY);
    await expect(resolveEnrollmentTarget(auth, 'target-2', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  it('NEGATIVE: GroupAdmin is denied a sibling-company target that belongs to a DIFFERENT group (foreign-group boundary)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1', groupId: 'group-A' });
    const reader = new FakeUserProfileReader({ 'target-fg': { companyId: 'company-B1', groupId: 'group-B', status: 'active' } });
    await expect(resolveEnrollmentTarget(auth, 'target-fg', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  it('NEGATIVE: a GroupAdmin whose OWN identity has no authoritative groupId cannot reach any other company (fail closed)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1' }); // no groupId
    const reader = new FakeUserProfileReader({ 'target-4': { companyId: 'company-2', groupId: 'group-A', status: 'active' } });
    await expect(resolveEnrollmentTarget(auth, 'target-4', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  // 8. AUTH-D10 completion (RBAC Phase 8): a GroupAdmin MAY enroll a face for
  //    an employee in a SAME-GROUP sibling company — mirrors firestore.rules'
  //    biometricCreateAllowed `sameGrp` branch. The target's real companyId
  //    is returned (never the actor's home company).
  it('POSITIVE: GroupAdmin enrolls an employee in a SAME-GROUP sibling company — allowed, target companyId preserved', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1', groupId: 'group-A' });
    const reader = new FakeUserProfileReader({ 'target-sib': { companyId: 'company-2', groupId: 'group-A', status: 'active' } });
    const target = await resolveEnrollmentTarget(auth, 'target-sib', reader);
    expect(target).toEqual({ targetUserId: 'target-sib', targetCompanyId: 'company-2' });
  });

  it('REGRESSION: an ordinary Admin (no groupId) still cannot reach a same-group sibling company — the sibling path is GroupAdmin-only', async () => {
    const auth = buildAuth({ role: 'Admin', companyId: 'company-1', groupId: 'group-A' });
    const reader = new FakeUserProfileReader({ 'target-sib': { companyId: 'company-2', groupId: 'group-A', status: 'active' } });
    await expect(resolveEnrollmentTarget(auth, 'target-sib', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  it('REGRESSION: a same-group sibling target that is inactive is still denied (target-status boundary unchanged)', async () => {
    const auth = buildAuth({ role: 'GroupAdmin', companyId: 'company-1', groupId: 'group-A' });
    const reader = new FakeUserProfileReader({ 'target-sib': { companyId: 'company-2', groupId: 'group-A', status: 'inactive' } });
    await expect(resolveEnrollmentTarget(auth, 'target-sib', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
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
