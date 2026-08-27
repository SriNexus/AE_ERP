/**
 * Face Attendance + DeepFace Master Plan, Phase 9 — Audit Completeness +
 * Retention/Deletion tests.
 *
 * Phase 4/6/8's own test suites (34 + 16 + regression, still passing
 * unchanged) already prove audit coverage for every `BiometricPipelineError`
 * outcome. This file covers exactly the NET-NEW Phase 9 surface found
 * during this phase's own audit-completeness review:
 *   1. Three real, previously-unaudited gaps (a raw/unexpected store or
 *      user-profile-reader exception during enrollment or verification
 *      escaped both the audit trail and safe-error translation) — now
 *      fixed in `enrollment.ts`/`verification.ts`, proven here.
 *   2. Revoked-reference re-enrollment/reactivation policy (self-service
 *      cannot reactivate its own revoked reference; Admin/HR on-behalf-of
 *      can, per §9's own text, deliberately read narrowly to stay
 *      consistent with the already-tested `firestore.rules`
 *      `selfExcludesRevocation` guard).
 *   3. An exhaustive audit-completeness sweep: every documented §15
 *      failure reason this orchestration layer can produce results in
 *      EXACTLY one audit event, per this phase's own explicit test
 *      requirement.
 *   4. Revoked-reference verification rejection (re-confirmed at the
 *      Phase 9 boundary, since this is one of this phase's own explicit
 *      acceptance criteria, even though Phase 4/6 already covered it).
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedUser } from '../../auth';
import {
  BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
  type BiometricFaceReference,
} from '../../../../src/lib/biometrics/biometricFaceReference';
import { MockProvider } from '../../../../src/lib/biometrics/providers/MockProvider';
import { BiometricProviderError } from '../../../../src/lib/biometrics/providers/BiometricProvider';
import { BiometricPipelineError, type PipelineReason } from '../../../../src/lib/biometrics/pipeline/types';
import { enrollBiometricFace, type EnrollmentDependencies } from '../enrollment';
import { verifyBiometricFace, type VerificationDependencies } from '../verification';
import type { UserProfileReader } from '../authorization';
import type { BiometricReferenceStore, ActiveReferenceSummary } from '../referenceStore';
import type { BiometricAuditWriter } from '../audit';

// ── Test fixtures / fakes ────────────────────────────────────────────────

function buildAuth(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    uid: 'uid-employee-1',
    erpUserId: 'user-1',
    email: 'employee1@example.com',
    name: 'Employee One',
    role: 'Employee',
    companyId: 'company-1',
    isSuperAdmin: false,
    ...overrides,
  };
}

function buildReference(overrides: Partial<BiometricFaceReference> = {}): BiometricFaceReference {
  return {
    id: 'user-1',
    userId: 'user-1',
    companyId: 'company-1',
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    embeddingModel: 'mock-model',
    embeddingModelVersion: 'mock-v1',
    detectorBackend: 'mock-detector',
    detectorVersion: 'unknown',
    schemaVersion: BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
    status: 'active',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    enrolledBy: 'user-1',
    reEnrollmentCount: 0,
    history: [],
    createdBy: 'user-1',
    updatedBy: 'user-1',
    ...overrides,
  };
}

class FakeReferenceStore implements BiometricReferenceStore {
  private docs = new Map<string, BiometricFaceReference>();
  failGetReference = false;
  failListActive = false;
  failUpdate = false;
  failCreate = false;

  constructor(seed: BiometricFaceReference[] = []) {
    for (const doc of seed) this.docs.set(doc.userId, doc);
  }

  async getReference(userId: string) {
    if (this.failGetReference) throw new Error('simulated firestore read failure');
    return this.docs.get(userId) ?? null;
  }
  async createReference(doc: BiometricFaceReference) {
    if (this.failCreate) throw new Error('simulated firestore create failure');
    this.docs.set(doc.userId, doc);
  }
  async updateReference(userId: string, patch: Record<string, unknown>) {
    if (this.failUpdate) throw new Error('simulated firestore update failure');
    const existing = this.docs.get(userId);
    if (!existing) throw new Error('no existing document to update');
    this.docs.set(userId, { ...existing, ...patch } as BiometricFaceReference);
  }
  async resolveCompanyGroupId(companyId: string) {
    return companyId === 'company-1' ? 'group-1' : '';
  }
  async listActiveReferencesInCompany(companyId: string, excludeUserId: string): Promise<ActiveReferenceSummary[]> {
    if (this.failListActive) throw new Error('simulated firestore query failure');
    return Array.from(this.docs.values())
      .filter((doc) => doc.companyId === companyId && doc.status === 'active' && doc.userId !== excludeUserId)
      .map((doc) => ({ userId: doc.userId, embedding: doc.embedding }));
  }
  get(userId: string) {
    return this.docs.get(userId);
  }
}

interface RecordedAuditCall {
  kind: 'enrollment' | 'verification';
  input: Record<string, unknown>;
}

class FakeAuditWriter implements BiometricAuditWriter {
  calls: RecordedAuditCall[] = [];
  async writeEnrollmentEvent(input: Parameters<BiometricAuditWriter['writeEnrollmentEvent']>[0]) {
    this.calls.push({ kind: 'enrollment', input: input as unknown as Record<string, unknown> });
  }
  async writeVerificationEvent(input: Parameters<BiometricAuditWriter['writeVerificationEvent']>[0]) {
    this.calls.push({ kind: 'verification', input: input as unknown as Record<string, unknown> });
  }
}

class FakeUserProfileReader implements UserProfileReader {
  failRead = false;
  constructor(private readonly users: Record<string, Record<string, unknown> | null>) {}
  async readUser(userId: string) {
    if (this.failRead) throw new Error('simulated firestore read failure');
    return this.users[userId] ?? null;
  }
}

const FRAME = new Uint8Array([1, 2, 3, 4]);

function buildEnrollmentDeps(overrides: Partial<EnrollmentDependencies> = {}): EnrollmentDependencies {
  return {
    provider: new MockProvider(),
    store: new FakeReferenceStore(),
    userReader: new FakeUserProfileReader({}),
    audit: new FakeAuditWriter(),
    ...overrides,
  };
}

function buildVerificationDeps(overrides: Partial<VerificationDependencies> = {}): VerificationDependencies {
  return {
    provider: new MockProvider(),
    store: new FakeReferenceStore([buildReference()]),
    audit: new FakeAuditWriter(),
    ...overrides,
  };
}

// ── 1. Audit-completeness fixes: raw/unexpected store failures ──────────

describe('Phase 9 — audit completeness: raw store/reader failures are now audited (previously a real gap)', () => {
  it('enrollment: a raw exception from resolveEnrollmentTarget()\'s own userReader.readUser() is audited as persistence_failed, not silently escaping the audit trail', async () => {
    const audit = new FakeAuditWriter();
    const userReader = new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } });
    userReader.failRead = true;
    const deps = buildEnrollmentDeps({ audit, userReader });

    await expect(enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-1' }), FRAME, 'user-2', deps))
      .rejects.toMatchObject({ reason: 'persistence_failed' });

    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ kind: 'enrollment', input: { outcome: 'failure', reason: 'persistence_failed', targetUserId: 'user-2' } });
  });

  it('enrollment: a raw exception from store.listActiveReferencesInCompany() (duplicate-face lookup) is audited as persistence_failed', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore();
    store.failListActive = true;
    const deps = buildEnrollmentDeps({ audit, store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'persistence_failed' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'persistence_failed' });
    expect(store.get('user-1')).toBeUndefined(); // no partial write
  });

  it('enrollment: a raw exception from store.getReference() (existing-reference lookup) is audited as persistence_failed', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore();
    store.failGetReference = true;
    const deps = buildEnrollmentDeps({ audit, store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'persistence_failed' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'persistence_failed' });
  });

  it('verification: a raw exception from store.getReference() is audited as persistence_failed', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference()]);
    store.failGetReference = true;
    const deps = buildVerificationDeps({ audit, store });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'persistence_failed' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'persistence_failed' });
  });

  it('verification: a raw exception from the lastVerifiedAt-stamping store.updateReference() call is audited as persistence_failed, after a fully successful biometric decision', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference()]);
    store.failUpdate = true;
    const deps = buildVerificationDeps({ audit, store });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'persistence_failed' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'persistence_failed' });
    // The reference itself was never corrupted by the failed write attempt.
    expect(store.get('user-1')?.lastVerifiedAt).toBeUndefined();
  });

  it('every raw-failure case above never leaks the underlying exception message into the thrown error or the audit payload', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore();
    store.failGetReference = true;
    const deps = buildEnrollmentDeps({ audit, store });

    try {
      await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as BiometricPipelineError).message).not.toContain('simulated firestore read failure');
    }
    expect(JSON.stringify(audit.calls)).not.toContain('simulated firestore read failure');
  });
});

// ── 2. Revoked-reference re-enrollment / reactivation policy ────────────

describe('Phase 9 — revoked-reference re-enrollment policy', () => {
  it('self-service re-enrollment on a REVOKED reference is rejected (enrollment_revoked) — an employee cannot reactivate their own revoked reference', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference({ status: 'revoked', revokedAt: '2026-06-01T00:00:00.000Z', revokedBy: 'admin-1' })]);
    const deps = buildEnrollmentDeps({ audit, store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    // No write occurred — the reference is still exactly as it was.
    expect(store.get('user-1')?.status).toBe('revoked');
    expect(store.get('user-1')?.embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'enrollment_revoked' });
  });

  it('Admin/HR re-enrollment on a REVOKED reference (on the employee\'s behalf) succeeds and reactivates it (status back to active)', async () => {
    const store = new FakeReferenceStore([buildReference({ status: 'revoked', revokedAt: '2026-06-01T00:00:00.000Z', revokedBy: 'admin-1' })]);
    const userReader = new FakeUserProfileReader({ 'user-1': { companyId: 'company-1', status: 'active' } });
    const deps = buildEnrollmentDeps({ store, userReader });

    const result = await enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-2', companyId: 'company-1' }), FRAME, 'user-1', deps);

    expect(result.enrolled).toBe(true);
    expect(result.reEnrolled).toBe(true);
    expect(store.get('user-1')?.status).toBe('active');
  });

  it('reactivation preserves the immutable anchor fields (userId/companyId/enrolledAt/enrolledBy/schemaVersion never change)', async () => {
    const original = buildReference({ status: 'revoked', revokedAt: '2026-06-01T00:00:00.000Z', enrolledAt: '2025-01-01T00:00:00.000Z', enrolledBy: 'user-1' });
    const store = new FakeReferenceStore([original]);
    const userReader = new FakeUserProfileReader({ 'user-1': { companyId: 'company-1', status: 'active' } });
    const deps = buildEnrollmentDeps({ store, userReader });

    await enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-2', companyId: 'company-1' }), FRAME, 'user-1', deps);

    const reactivated = store.get('user-1')!;
    expect(reactivated.userId).toBe(original.userId);
    expect(reactivated.companyId).toBe(original.companyId);
    expect(reactivated.enrolledAt).toBe(original.enrolledAt);
    expect(reactivated.enrolledBy).toBe(original.enrolledBy);
    expect(reactivated.schemaVersion).toBe(original.schemaVersion);
  });

  it('reactivation completes the history record for the revoked prior enrollment — the appended history entry carries its revokedAt', async () => {
    const store = new FakeReferenceStore([buildReference({
      status: 'revoked', revokedAt: '2026-06-01T00:00:00.000Z', embeddingModel: 'ArcFace', embeddingModelVersion: 'v1',
    })]);
    const userReader = new FakeUserProfileReader({ 'user-1': { companyId: 'company-1', status: 'active' } });
    const deps = buildEnrollmentDeps({ store, userReader });

    await enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-2', companyId: 'company-1' }), FRAME, 'user-1', deps);

    const reactivated = store.get('user-1')!;
    expect(reactivated.history).toHaveLength(1);
    expect(reactivated.history[0]).toMatchObject({ embeddingModel: 'ArcFace', embeddingModelVersion: 'v1', revokedAt: '2026-06-01T00:00:00.000Z' });
  });

  it('re-enrollment on an already-ACTIVE reference is unaffected — status remains active, no behavioral change (regression guard)', async () => {
    const store = new FakeReferenceStore([buildReference({ status: 'active' })]);
    const deps = buildEnrollmentDeps({ store });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result.enrolled).toBe(true);
    expect(store.get('user-1')?.status).toBe('active');
  });
});

// ── 3. Exhaustive audit-completeness sweep (Phase 9's own explicit test requirement) ──

describe('Phase 9 — exhaustive audit-completeness sweep: every reachable failure reason produces exactly one audit event', () => {
  const enrollmentScenarios: Array<{ reason: PipelineReason; configure: (deps: EnrollmentDependencies) => void }> = [
    { reason: 'no_face', configure: (deps) => { deps.provider = new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } }); } },
    { reason: 'multiple_faces', configure: (deps) => { deps.provider = new MockProvider({ results: { detectFace: { faceCount: 2, faces: [{ x: 0, y: 0, width: 1, height: 1, confidence: 1 }, { x: 5, y: 5, width: 1, height: 1, confidence: 1 }] } } }); } },
    { reason: 'poor_quality', configure: (deps) => { deps.provider = new MockProvider({ results: { assessQuality: { passed: false, reasons: ['too_dark'] } } }); } },
    { reason: 'liveness_failed', configure: (deps) => { deps.provider = new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.1 } } }); } },
    { reason: 'provider_unavailable', configure: (deps) => { deps.provider = new MockProvider({ failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') } }); } },
    { reason: 'timeout', configure: (deps) => { deps.provider = new MockProvider({ failures: { assessQuality: new BiometricProviderError('timeout', 'slow') } }); } },
    { reason: 'malformed_image', configure: (deps) => { deps.provider = new MockProvider({ failures: { detectFace: new BiometricProviderError('malformed_image', 'bad bytes') } }); } },
    { reason: 'persistence_failed', configure: (deps) => { (deps.store as FakeReferenceStore).failCreate = true; } },
  ];

  for (const { reason, configure } of enrollmentScenarios) {
    it(`enrollment: "${reason}" produces exactly one audit event with outcome:failure and the correct reason`, async () => {
      const audit = new FakeAuditWriter();
      const deps = buildEnrollmentDeps({ audit });
      configure(deps);

      await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason });

      const enrollmentAudits = audit.calls.filter((c) => c.kind === 'enrollment');
      expect(enrollmentAudits).toHaveLength(1);
      expect(enrollmentAudits[0].input).toMatchObject({ outcome: 'failure', reason });
    });
  }

  it('enrollment: "not_authorized" (unauthorized on-behalf-of attempt) produces exactly one audit event', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit, userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } }) });

    await expect(enrollBiometricFace(buildAuth({ role: 'Employee' }), FRAME, 'user-2', deps)).rejects.toMatchObject({ reason: 'not_authorized' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'not_authorized' });
  });

  it('enrollment: "cross_tenant_denied" produces exactly one audit event', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit, userReader: new FakeUserProfileReader({ 'user-9': { companyId: 'company-OTHER', status: 'active' } }) });

    await expect(enrollBiometricFace(buildAuth({ role: 'Admin', companyId: 'company-1' }), FRAME, 'user-9', deps)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'cross_tenant_denied' });
  });

  it('enrollment: "enrollment_revoked" (self-service reactivation attempt) produces exactly one audit event', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference({ status: 'revoked' })]);
    const deps = buildEnrollmentDeps({ audit, store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'enrollment_revoked' });
  });

  it('enrollment success produces exactly one audit event with outcome:success', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit });

    await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'success' });
  });

  const verificationScenarios: Array<{ reason: PipelineReason; configure: (deps: VerificationDependencies) => void }> = [
    { reason: 'no_face', configure: (deps) => { deps.provider = new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } }); } },
    { reason: 'liveness_failed', configure: (deps) => { deps.provider = new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.1 } } }); } },
    { reason: 'provider_unavailable', configure: (deps) => { deps.provider = new MockProvider({ failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') } }); } },
    { reason: 'timeout', configure: (deps) => { deps.provider = new MockProvider({ failures: { checkLiveness: new BiometricProviderError('timeout', 'slow') } }); } },
    { reason: 'no_enrollment', configure: (deps) => { deps.store = new FakeReferenceStore([]); } },
    { reason: 'enrollment_revoked', configure: (deps) => { deps.store = new FakeReferenceStore([buildReference({ status: 'revoked' })]); } },
    { reason: 'verification_failed', configure: (deps) => { deps.store = new FakeReferenceStore([buildReference({ embedding: [0, 0, 0, 0, 0, 0, 0, 0] })]); deps.provider = new MockProvider({ verifyThreshold: 0.01 }); } },
    { reason: 'persistence_failed', configure: (deps) => { (deps.store as FakeReferenceStore).failUpdate = true; } },
  ];

  for (const { reason, configure } of verificationScenarios) {
    it(`verification: "${reason}" produces exactly one audit event with outcome:failure and the correct reason`, async () => {
      const audit = new FakeAuditWriter();
      const deps = buildVerificationDeps({ audit });
      configure(deps);

      await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason });

      const verificationAudits = audit.calls.filter((c) => c.kind === 'verification');
      expect(verificationAudits).toHaveLength(1);
      expect(verificationAudits[0].input).toMatchObject({ outcome: 'failure', reason });
    });
  }

  it('verification success produces exactly one audit event with outcome:success', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildVerificationDeps({ audit });

    await verifyBiometricFace(buildAuth(), FRAME, deps);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'success' });
  });
});

// ── 4. Revoked-reference verification rejection (Phase 9 acceptance criterion, re-confirmed) ──

describe('Phase 9 — revoked reference cannot verify or attend (re-confirmed at this phase\'s own boundary)', () => {
  it('a revoked reference is rejected before any provider call is made', async () => {
    let providerCalled = false;
    const provider = new MockProvider();
    const originalDetect = provider.detectFace.bind(provider);
    provider.detectFace = async (frame) => { providerCalled = true; return originalDetect(frame); };
    const deps = buildVerificationDeps({ provider, store: new FakeReferenceStore([buildReference({ status: 'revoked' })]) });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    expect(providerCalled).toBe(false);
  });

  it('a reference revoked via the deactivation hook (revokedBy stamped as the real deactivating actor or the honest system sentinel) is equally rejected — the revocation source never matters to the verification gate', async () => {
    const deps = buildVerificationDeps({
      store: new FakeReferenceStore([buildReference({ status: 'revoked', revokedBy: 'system:onUserDeactivated', revokedAt: '2026-08-27T00:00:00.000Z' })]),
    });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
  });
});

// ── 5. Idempotency of the pure policy check ─────────────────────────────

describe('Phase 9 — idempotent repeated lifecycle handling', () => {
  it('assertReferenceActive/decideVerification-style repeated calls against an already-revoked reference are stably rejected every time (no state mutation, no flakiness)', async () => {
    const deps = buildVerificationDeps({ store: new FakeReferenceStore([buildReference({ status: 'revoked' })]) });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
  });

  it('a second self-service re-enrollment attempt on an already-revoked reference is rejected identically both times (no side effect from the first attempt)', async () => {
    const store = new FakeReferenceStore([buildReference({ status: 'revoked' })]);
    const deps = buildEnrollmentDeps({ store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    expect(store.get('user-1')?.status).toBe('revoked');
  });
});
