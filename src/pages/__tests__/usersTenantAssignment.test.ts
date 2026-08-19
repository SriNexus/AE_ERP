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
