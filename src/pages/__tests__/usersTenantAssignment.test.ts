/**
 * usersTenantAssignment.test.ts — Super Admin explicit Group+Company
 * selection requirement (tenant-assignment reliability).
 *
 * Source-text analysis, matching this repo's established convention (no
 * @testing-library/react in this repository).
 *
 * Requirement: when a Super Admin creates a user through Users.tsx, the
 * target Group and Company must be explicitly selected and cross-validated
 * before provisioning — never an inferred default. Group Admin/Company
 * Admin creations are unaffected: they always resolve to their own company
 * automatically (resolveWriteCompanyId()'s existing fallback chain), and
 * never see this picker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const usersPage = readFileSync(resolve(__dirname, '../Users.tsx'), 'utf-8');

describe('Users.tsx — Super Admin Group+Company picker', () => {
  it('is gated to create-only, platform-actor-only (never shown to Group/Company Admin, never on edit)', () => {
    expect(usersPage).toContain('!editId && isPlatformActor');
    expect(usersPage).toContain('const isPlatformActor = !!(currentUser?.isOwner || currentUser?.isSuperAdmin);');
  });

  it('reads Groups/Companies platform-wide (every Group/Company, not just the actor\'s own)', () => {
    expect(usersPage).toContain("getAllPlatform<any>(COLLECTIONS.GROUPS)");
    expect(usersPage).toContain("getAllPlatform<any>(COLLECTIONS.COMPANIES)");
  });

  it('the Company options are filtered to the selected Group (cannot pick a mismatched pair in the UI)', () => {
    expect(usersPage).toContain("platformCompanies.filter((c: any) => c.groupId === form.groupId)");
  });

  it('selecting a new Group resets the Company selection (never leaves a stale cross-group companyId selected)', () => {
    expect(usersPage).toContain("onChange={e => setForm({ ...form, groupId: e.target.value, companyId: '' })}");
  });

  it('handleSubmit requires both fields and cross-validates the company actually belongs to the selected group', () => {
    expect(usersPage).toMatch(/if \(!editId && isPlatformActor\) \{[\s\S]*?if \(!form\.groupId\)[\s\S]*?if \(!form\.companyId\)[\s\S]*?selectedCompany\.groupId !== form\.groupId/);
  });

  it('the edit branch always strips groupId/companyId — an edit can never overwrite an existing user\'s tenant assignment', () => {
    expect(usersPage).toContain('const { password: _, groupId: _groupId, companyId: _companyId, ...rest } = d;');
  });
});

describe('Users.tsx — Group Admin single-vs-multiple Company/Warehouse auto-assign', () => {
  it('a Group Admin with exactly one Company in their Group gets it assigned automatically, never asked to pick', () => {
    expect(usersPage).toContain("const isGroupAdminActor = !isPlatformActor && currentUser?.role === 'GroupAdmin';");
    expect(usersPage).toMatch(/if \(isGroupAdminActor && !form\.companyId && groupCompanies\.length === 1\) \{/);
  });

  // Regression (2026-08-19): the Company field used to be hidden entirely
  // for a single-Company Group (`groupCompanies.length > 1`), relying solely
  // on the silent auto-select effect. Per explicit requirement, the field
  // must always be VISIBLE for transparency once resolved — shown read-only/
  // disabled when there is exactly one Company, and as a real picker when
  // there is more than one. A `length > 1` condition here (the old, hidden-
  // for-one-company behavior) must fail this test.
  it('the Company field is always shown once the Group has at least one Company (never hidden for the single-Company case)', () => {
    expect(usersPage).toContain('!editId && isGroupAdminActor && groupCompanies.length > 0');
    expect(usersPage).not.toMatch(/!editId && isGroupAdminActor && groupCompanies\.length > 1/);
  });

  it('the Company field is disabled (read-only) precisely when there is exactly one resolved Company', () => {
    expect(usersPage).toContain('disabled={groupCompanies.length === 1}');
  });

  it('handleSubmit still requires and cross-validates the Company for a Group Admin (covers the multi-Company case)', () => {
    expect(usersPage).toMatch(/if \(!editId && isGroupAdminActor\) \{[\s\S]*?if \(!form\.companyId\)[\s\S]*?groupCompanies\.find/);
  });

  it('the Warehouse picker is scoped to the resolved Company and auto-assigns when exactly one exists', () => {
    expect(usersPage).toContain('.filter((w: any) => w.companyId === newUserEffectiveCompanyId)');
    expect(usersPage).toMatch(/if \(!form\.warehouseId && companyWarehouses\.length === 1\) \{/);
  });

  // Regression: changing the Company in the multi-Company case must clear a
  // previously selected Warehouse that no longer applies — otherwise a
  // Warehouse from the OLD Company could be silently submitted against the
  // NEW Company. The single/multi warehouse auto-assign effect above then
  // re-derives the right state from the cleared value.
  it('changing the Company clears the previously selected Warehouse', () => {
    expect(usersPage).toContain("onChange={e => setForm({ ...form, companyId: e.target.value, warehouseId: '' })}");
  });
});

describe('useGlobalBoot.ts — persisted identity self-heal (root cause of the "Select Company" bug)', () => {
  const globalBoot = readFileSync(resolve(__dirname, '../../lib/useGlobalBoot.ts'), 'utf-8');

  // Root cause (live-verified against production, 2026-08-19): `user` is
  // persisted to localStorage (zustand persist) and NOTHING previously
  // re-fetched it against the live users/{id} Firestore doc for an
  // already-authenticated session. A profile change made server-side (e.g.
  // stamping groupId on a promoted Group Admin) was invisible to an
  // already-open browser tab — Users.tsx's useGroupCompanies(currentUser?.
  // groupId) never fired (enabled: !!groupId), so the Company field could
  // never resolve or even render, regardless of how correct Users.tsx's own
  // single-company logic was. This is the actual defect the previous
  // "auto-assign" implementation missed — fixing only Users.tsx without this
  // would leave any already-open session broken.
  it('re-fetches the current user\'s canonical profile once per session and reconciles it via syncCurrentUserProfile', () => {
    expect(globalBoot).toContain("import { loadCurrentUserProfile, syncCurrentUserProfile } from './userProfile';");
    expect(globalBoot).toContain('const profile = await loadCurrentUserProfile(user.id);');
    expect(globalBoot).toContain('syncCurrentUserProfile(profile);');
  });

  it('is ref-guarded to run once per user.id (never refetches on every render/navigation)', () => {
    expect(globalBoot).toContain('const profileSyncRef = useRef<string | null>(null);');
    expect(globalBoot).toMatch(/if \(profileSyncRef\.current === user\.id\) return;/);
  });

  it('skips the Owner synthetic identity and demo sessions (neither has a real users\/\{id\} Firestore doc to refresh from)', () => {
    expect(globalBoot).toMatch(/if \(!user\?\.id \|\| user\.isOwner \|\| isDemo\) return;/);
  });
});
