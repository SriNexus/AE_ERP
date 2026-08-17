/**
 * useUsersEmailNormalization.test.ts — "Authenticated, but ERP identity
 * access was denied" root-cause regression guard.
 *
 * Live-proven root cause: Firebase Auth stores account emails LOWERCASED (the
 * ID-token email claim is always lowercase), while the user-creation flow
 * stored the RAW form email on the ERP users doc. Firestore rules compare the
 * users doc email to the token email with a case-SENSITIVE `==`, so a
 * mixed-case doc email made the unmapped first-login read of users/{authUid}
 * fail the email-self read clause (no mapping exists yet -> no other clause
 * applies) and return permission-denied, surfacing as the login error above.
 *
 * The fix applies ownerAccess.normalizeIdentityEmail (trim + lowercase) to
 * payload.email at the single canonical write boundary in the useUsers hook —
 * every user creation/update path (desktop Users.tsx, mobile
 * MobileUsersWorkspace) flows through it. The existing helper is REUSED, not
 * duplicated.
 *
 * Source-text analysis, matching this repo's established convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hook = readFileSync(resolve(__dirname, '../hooks/useUsers.ts'), 'utf-8');
const ownerAccess = readFileSync(resolve(__dirname, '../../../lib/ownerAccess.ts'), 'utf-8');
const usersPage = readFileSync(resolve(__dirname, '../../../pages/Users.tsx'), 'utf-8');
const mobileWorkspace = readFileSync(resolve(__dirname, '../../../components/mobile/users/MobileUsersWorkspace.tsx'), 'utf-8');

describe('useUsers hook — Firebase-normalized ERP identity email', () => {
  it('reuses the canonical normalizeIdentityEmail helper (trim + lowercase), no duplicate', () => {
    // The canonical helper must exist in ownerAccess with the Firebase-canonical
    // trim + lowercase semantics...
    expect(ownerAccess).toMatch(/export function normalizeIdentityEmail/);
    expect(ownerAccess).toContain('value.trim().toLowerCase()');
    // ...and the hook must REUSE it rather than re-implementing it.
    expect(hook).toContain("normalizeIdentityEmail } from '../../../lib/ownerAccess'");
    expect(hook).toContain('normalizeIdentityEmail(payload.email)');
    expect(hook).not.toMatch(/export function normalize\w*Email\(/);
  });

  it('createUserProjection normalizes payload.email before writing the ERP doc', () => {
    // The normalization must happen BEFORE the owner guard and BEFORE the
    // projection write (users/{authUid} doc, MUSR master doc, and entity all
    // receive the Firebase-canonical lowercase email). Org-field enrichment
    // is derived FROM the normalized payload, so it cannot re-introduce a
    // raw-form email.
    expect(hook).toMatch(
      /createUserProjection\(id: string, payload: Record<string, unknown>\)[\s\S]*?withNormalizedEmail\(payload\)[\s\S]*?isOwnerEmail\(normalized\.email\)[\s\S]*?enrichOrgFields\(normalized\)[\s\S]*?createProjectionWithUserId\(COLLECTIONS\.USERS, id, orgFields\)/
    );
  });

  it('updateUserProjection normalizes payload.email too (admin email edits)', () => {
    expect(hook).toMatch(
      /updateUserProjection\(id: string, payload: Record<string, unknown>\)[\s\S]*?withNormalizedEmail\(payload\)[\s\S]*?isOwnerEmail\(normalized\.email\)[\s\S]*?enrichOrgFields\(normalized, existing\)[\s\S]*?updateProjectionWithEntity\(COLLECTIONS\.USERS, id, orgFields\)/
    );
  });

  it('runs the owner-record guard on the normalized email (case-insensitive either way)', () => {
    expect(hook).toContain('isOwnerEmail(normalized.email)');
  });

  it('desktop Users.tsx routes user creation through the canonical hook', () => {
    expect(usersPage).toContain("import { createUserProjection, updateUserProjection, deleteUserProjection } from '../features/users/hooks/useUsers'");
    expect(usersPage).toMatch(/createUserProjection\(authId, \{ \.\.\.rest, id: authId/);
  });

  it('mobile MobileUsersWorkspace routes user creation through the same hook', () => {
    expect(mobileWorkspace).toMatch(/createUserProjection,\s*\n\s*updateUserProjection,\s*\n\s*deleteUserProjection/);
    expect(mobileWorkspace).toMatch(/createUserProjection\(authId, \{ \.\.\.rest, id: authId/);
  });
});
