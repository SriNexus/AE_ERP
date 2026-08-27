/**
 * Face Attendance + DeepFace Master Plan, Phase 9 — `biometricRevocation.js`
 * unit tests.
 *
 * `functions/` has no test runner of its own installed, and neither
 * `firebase-functions` nor `firebase-admin` is installed anywhere in this
 * repository (confirmed absent from both the root `node_modules` and a
 * never-`npm install`ed `functions/node_modules`) — `functions/index.js`
 * itself cannot be `require()`d/tested in this environment. This file tests
 * ONLY the pure, dependency-free decision logic `biometricRevocation.js`
 * exports (deliberately extracted for exactly this reason — see that
 * module's own doc comment), run directly against the main Neozy Vitest
 * suite by passing this file's explicit path (it is intentionally outside
 * `vitest.config.ts`'s default `src/**\/*.test.ts` discovery glob, matching
 * `functions/`'s own separateness from the main `src/`/`api/` trees).
 *
 * What this DOES prove: the exact revocation-transition detection and patch
 * construction logic is correct, with real test-driven evidence.
 * What this does NOT and cannot prove in this environment: that
 * `onUserDeactivated`'s actual Firestore Admin SDK read/write glue around
 * this logic works end-to-end against a real trigger — recorded honestly as
 * a limitation in the Phase 9 completion record, not silently assumed.
 */

import { describe, it, expect } from 'vitest';
const {
  isDeactivated,
  isDeactivationTransition,
  resolveRevocationActor,
  buildBiometricRevocationPatch,
} = require('../biometricRevocation');

describe('isDeactivated', () => {
  it('recognizes every documented inactive status (both case conventions)', () => {
    for (const status of ['inactive', 'suspended', 'disabled', 'Inactive', 'Suspended', 'Disabled']) {
      expect(isDeactivated({ status })).toBe(true);
    }
  });

  it('recognizes isDeleted:true regardless of status', () => {
    expect(isDeactivated({ status: 'Active', isDeleted: true })).toBe(true);
  });

  it('returns false for an active user', () => {
    expect(isDeactivated({ status: 'Active' })).toBe(false);
  });

  it('returns false for null/undefined data', () => {
    expect(isDeactivated(null)).toBe(false);
    expect(isDeactivated(undefined)).toBe(false);
  });

  it('returns false for a non-string status (defensive)', () => {
    expect(isDeactivated({ status: 123 })).toBe(false);
  });
});

describe('isDeactivationTransition', () => {
  it('true only on a genuine active→deactivated transition', () => {
    expect(isDeactivationTransition({ status: 'Active' }, { status: 'Inactive' })).toBe(true);
  });

  it('false when already deactivated before the edit (no re-trigger on a subsequent edit)', () => {
    expect(isDeactivationTransition({ status: 'Inactive' }, { status: 'Inactive' })).toBe(false);
    expect(isDeactivationTransition({ status: 'Suspended' }, { status: 'Disabled' })).toBe(false);
  });

  it('false on re-activation (deactivated → active)', () => {
    expect(isDeactivationTransition({ status: 'Inactive' }, { status: 'Active' })).toBe(false);
  });

  it('false when the user stays active across the edit', () => {
    expect(isDeactivationTransition({ status: 'Active', name: 'A' }, { status: 'Active', name: 'B' })).toBe(false);
  });

  it('true for an isDeleted transition even if status text is unchanged', () => {
    expect(isDeactivationTransition({ status: 'Active', isDeleted: false }, { status: 'Active', isDeleted: true })).toBe(true);
  });
});

describe('resolveRevocationActor', () => {
  it('uses the real updatedBy stamp when present (the standard updateDocById() convention)', () => {
    expect(resolveRevocationActor({ updatedBy: 'admin-42' })).toBe('admin-42');
  });

  it('trims whitespace', () => {
    expect(resolveRevocationActor({ updatedBy: '  admin-42  ' })).toBe('admin-42');
  });

  it('falls back to an honest system sentinel when updatedBy is missing/empty — never undefined, never fabricated', () => {
    expect(resolveRevocationActor({})).toBe('system:onUserDeactivated');
    expect(resolveRevocationActor({ updatedBy: '' })).toBe('system:onUserDeactivated');
    expect(resolveRevocationActor(null)).toBe('system:onUserDeactivated');
    expect(resolveRevocationActor({ updatedBy: 123 })).toBe('system:onUserDeactivated');
  });
});

describe('buildBiometricRevocationPatch', () => {
  it('produces exactly the three §9-specified fields — status, revokedAt, revokedBy — nothing else', () => {
    const patch = buildBiometricRevocationPatch({ updatedBy: 'admin-1' }, '2026-08-27T10:00:00.000Z');
    expect(patch).toEqual({ status: 'revoked', revokedAt: '2026-08-27T10:00:00.000Z', revokedBy: 'admin-1' });
    expect(Object.keys(patch).sort()).toEqual(['revokedAt', 'revokedBy', 'status']);
  });

  it('never touches embedding/enrolledAt/enrolledBy/history/lastVerifiedAt or any other field', () => {
    const patch = buildBiometricRevocationPatch({ updatedBy: 'admin-1' }, '2026-08-27T10:00:00.000Z');
    for (const forbidden of ['embedding', 'enrolledAt', 'enrolledBy', 'history', 'lastVerifiedAt', 'userId', 'companyId', 'groupId', 'schemaVersion']) {
      expect(patch).not.toHaveProperty(forbidden);
    }
  });

  it('revokedBy falls back to the system sentinel when the after-snapshot has no real actor', () => {
    const patch = buildBiometricRevocationPatch({}, '2026-08-27T10:00:00.000Z');
    expect(patch.revokedBy).toBe('system:onUserDeactivated');
  });
});
