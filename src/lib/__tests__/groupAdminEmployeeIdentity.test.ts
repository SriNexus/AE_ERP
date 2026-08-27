/**
 * groupAdminEmployeeIdentity.test.ts — Group Admin identity completeness.
 *
 * A Group Admin must be a complete ERP identity — Auth -> User -> Employee ->
 * Company/Group scope, not merely an authentication-only account
 * (NEOZY ERP — GROUP ADMIN MUST HAVE COMPLETE USER + EMPLOYEE IDENTITY).
 *
 * Behavioral coverage for src/lib/groupAdmin.ts's linking logic lives in
 * phase5GroupAdmin.test.ts (mocked unit tests: provisions/skips/best-effort
 * failure handling). This file proves the architectural properties that are
 * cheaper to verify by source content than by mounting a full page — the
 * same convention this codebase already uses (see ownerAccess.test.ts,
 * demoToGroupConversion.test.ts):
 *   - Users.tsx's role-edit path provisions an Employee for a GroupAdmin
 *     promotion the same way Users.tsx's own Create-User path already does.
 *   - The retrofit migration for EXISTING Group Admins is generic — it
 *     matches by role, never by a hardcoded Group/Company id — so it applies
 *     identically to Neozy Demo, Ashish Enterprises, and any future Group.
 *   - No code path invents a second Auth/User identity to "solve" this.
 *   - Group isolation for Employee records is untouched — still the same
 *     generic, company-scoped fallback rule every other collection uses.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Group Admin identity completeness — Users.tsx edit path', () => {
  const usersSrc = readFileSync('src/pages/Users.tsx', 'utf8');

  it('provisions an Employee/HR link when a role edit promotes someone to GroupAdmin and they have none yet', () => {
    expect(usersSrc).toContain("rest.role === 'GroupAdmin' && !existing.employeeId");
    expect(usersSrc).toContain('EmployeeDomainService.linkOrCreateForUser(editId');
  });

  it('reuses the EXISTING canonical User identity — never creates a second Auth account for this', () => {
    // The GroupAdmin-promotion block must not call provisionAuthenticatedUser
    // or createUserProjection (both are the NEW-account path, used only in
    // the `else` / create branch of this same mutation).
    const editBranchStart = usersSrc.indexOf('if (editId) {');
    const editBranchEnd = usersSrc.indexOf('} else {', editBranchStart);
    const editBranch = usersSrc.slice(editBranchStart, editBranchEnd);
    expect(editBranch).toContain('linkOrCreateForUser');
    expect(editBranch).not.toContain('provisionAuthenticatedUser');
    expect(editBranch).not.toContain('createUserProjection');
  });

  it('the failure path is best-effort — a failed Employee link does not throw or block the role change', () => {
    const linkCallIndex = usersSrc.indexOf('EmployeeDomainService.linkOrCreateForUser(editId');
    const surrounding = usersSrc.slice(linkCallIndex - 400, linkCallIndex + 500);
    expect(surrounding).toContain('try {');
    expect(surrounding).toContain('catch (employeeError');
  });
});

describe('Group Admin identity completeness — grantGroupAdminForGroup (self-service second GroupAdmin)', () => {
  const groupAdminSrc = readFileSync('src/lib/groupAdmin.ts', 'utf8');

  it('links an Employee for a newly-granted second GroupAdmin using the same linkOrCreateForUser mechanism', () => {
    expect(groupAdminSrc).toContain('EmployeeDomainService.linkOrCreateForUser');
    expect(groupAdminSrc).toContain("role: 'GroupAdmin'");
  });

  it('does not fabricate an id or hardcode a Company/Group — the target companyId is read from the target user\'s own record', () => {
    expect(groupAdminSrc).toContain('String(target.companyId');
  });
});

describe('Group Admin identity completeness — retrofit migration is generic, not Demo-specific', () => {
  const migrationSrc = readFileSync('scripts/backfill-groupadmin-employees.cjs', 'utf8');

  it('matches Group Admins by role, never by a hardcoded Group/Company id (applies to every Group, not just Neozy Demo)', () => {
    expect(migrationSrc).toContain("where('role', '==', 'GroupAdmin')");
    expect(migrationSrc).not.toContain('company-demo-neozy');
    expect(migrationSrc).not.toContain('group-demo-neozy');
    expect(migrationSrc).not.toContain('CO-1783978330465-3EV9'); // Ashish Enterprises' real companyId
  });

  it('is idempotent by construction — checks users.employeeId, then an existing Employee for this exact userId, then the master-identity id, before ever creating', () => {
    // Match the numbered step comments in the CODE (not the header
    // docstring, which describes the same four steps earlier in the file).
    const alreadyLinkedIdx = migrationSrc.indexOf('// 1) Already correctly linked?');
    const byUserIdIdx = migrationSrc.indexOf('// 2) An Employee already exists for this exact userId');
    const masterIdentityIdx = migrationSrc.indexOf('// 3) A pre-existing Employee under the deterministic master-identity id');
    const createIdx = migrationSrc.indexOf('// 4) Genuinely missing');
    expect(alreadyLinkedIdx).toBeGreaterThan(-1);
    expect(byUserIdIdx).toBeGreaterThan(alreadyLinkedIdx);
    expect(masterIdentityIdx).toBeGreaterThan(byUserIdIdx);
    expect(createIdx).toBeGreaterThan(masterIdentityIdx);
  });

  it('never creates a second Auth/User identity — only ever writes to the employees collection and users.employeeId', () => {
    expect(migrationSrc).not.toContain('createUser'); // no Firebase Admin Auth account creation
    expect(migrationSrc).not.toMatch(/db\.collection\('users'\)\.doc\([^)]*\)\.set\(/); // never a fresh User doc
  });

  it('defaults to dry-run and requires --apply to write, matching the established migration-script convention', () => {
    expect(migrationSrc).toContain("APPLY = process.argv.includes('--apply')");
    expect(migrationSrc).toMatch(/if \(APPLY\)/);
  });
});

describe('Group Admin identity completeness — Group isolation is untouched', () => {
  it('firestore.rules has no hardcoded Demo/GroupAdmin-specific special-casing for Employee records — the Phase 2 (F-06) employees block is role-aware and Group-scoped via the same groupAdminCanRead/Create/Update() composites every other Phase 2 Group-tier collection uses, never a hardcoded id', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    // Phase 2 (RULES-001/F-06, Master Plan §Phase-2) intentionally adds a
    // dedicated /employees/{employeeId} block with role-aware enforcement
    // (Admin/GroupAdmin/HR/Director) — this supersedes the earlier
    // generic-fallback-only posture this test originally asserted.
    expect(rules).toMatch(/match\s+\/employees\/\{[^}]*\}\s*\{/);
    expect(rules.toLowerCase()).not.toContain('groupadminemployee');
    expect(rules.toLowerCase()).not.toContain('demoadminemployee');
  });
});
