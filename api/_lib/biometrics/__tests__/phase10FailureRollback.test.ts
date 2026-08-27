/**
 * Face Attendance + DeepFace Master Plan, Phase 10 — §20 item 10:
 * "Every row of §15's table gets at least one test proving no Firestore
 * write occurs on that failure path (enrollment and verification
 * separately)."
 *
 * Phase 4/6/9's own suites already prove the correct, distinct reason code
 * for every §15 row (172+ tests total), and several individual tests
 * already assert "no write" for specific rows (no_face, multiple_faces,
 * persistence_failed, enrollment_revoked). This file is the explicit,
 * single, table-driven completeness pass §20 item 10 literally asks for —
 * covering EVERY row in one place, for BOTH enrollment and verification,
 * rather than a rewrite of the already-passing reason-code tests
 * elsewhere (avoiding duplication, per this phase's own scope discipline).
 *
 * "No Firestore write occurs" is checked two ways per case: (1) the
 * in-memory FakeReferenceStore's own document map is unchanged before vs.
 * after the failed call, and (2) for enrollment specifically, no NEW
 * document was created for a user who had none before.
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedUser } from '../../auth';
import {
  BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
  type BiometricFaceReference,
} from '../../../../src/lib/biometrics/biometricFaceReference';
import { MockProvider } from '../../../../src/lib/biometrics/providers/MockProvider';
import { BiometricProviderError } from '../../../../src/lib/biometrics/providers/BiometricProvider';
import type { PipelineReason } from '../../../../src/lib/biometrics/pipeline/types';
import { enrollBiometricFace, type EnrollmentDependencies } from '../enrollment';
import { verifyBiometricFace, type VerificationDependencies } from '../verification';
import type { UserProfileReader } from '../authorization';
import type { BiometricReferenceStore, ActiveReferenceSummary } from '../referenceStore';
import type { BiometricAuditWriter } from '../audit';

function buildAuth(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    uid: 'uid-1', erpUserId: 'user-1', email: 'a@b.com', name: 'A',
    role: 'Employee', companyId: 'company-1', isSuperAdmin: false,
    ...overrides,
  };
}

function buildReference(overrides: Partial<BiometricFaceReference> = {}): BiometricFaceReference {
  return {
    id: 'user-1', userId: 'user-1', companyId: 'company-1',
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    embeddingModel: 'mock-model', embeddingModelVersion: 'mock-v1',
    detectorBackend: 'mock-detector', detectorVersion: 'unknown',
    schemaVersion: BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION, status: 'active',
    enrolledAt: '2026-01-01T00:00:00.000Z', enrolledBy: 'user-1',
    reEnrollmentCount: 0, history: [], createdBy: 'user-1', updatedBy: 'user-1',
    ...overrides,
  };
}

class FakeReferenceStore implements BiometricReferenceStore {
  docs = new Map<string, BiometricFaceReference>();
  failCreate = false;
  failUpdate = false;

  constructor(seed: BiometricFaceReference[] = []) {
    for (const doc of seed) this.docs.set(doc.userId, doc);
  }
  snapshot() {
    return new Map(this.docs);
  }
  async getReference(userId: string) {
    return this.docs.get(userId) ?? null;
  }
  async createReference(doc: BiometricFaceReference) {
    if (this.failCreate) throw new Error('simulated create failure');
    this.docs.set(doc.userId, doc);
  }
  async updateReference(userId: string, patch: Record<string, unknown>) {
    if (this.failUpdate) throw new Error('simulated update failure');
    const existing = this.docs.get(userId);
    if (!existing) throw new Error('no existing document');
    this.docs.set(userId, { ...existing, ...patch } as BiometricFaceReference);
  }
  async resolveCompanyGroupId() {
    return 'group-1';
  }
  async listActiveReferencesInCompany(companyId: string, excludeUserId: string): Promise<ActiveReferenceSummary[]> {
    return Array.from(this.docs.values())
      .filter((d) => d.companyId === companyId && d.status === 'active' && d.userId !== excludeUserId)
      .map((d) => ({ userId: d.userId, embedding: d.embedding }));
  }
}

class FakeAuditWriter implements BiometricAuditWriter {
  async writeEnrollmentEvent() {}
  async writeVerificationEvent() {}
}

class FakeUserProfileReader implements UserProfileReader {
  constructor(private users: Record<string, Record<string, unknown> | null> = {}) {}
  async readUser(userId: string) {
    return this.users[userId] ?? null;
  }
}

const FRAME = new Uint8Array([1, 2, 3, 4]);

describe('Phase 10 — §20 item 10: every §15 enrollment failure row produces NO Firestore write', () => {
  const cases: Array<{ reason: PipelineReason; setup: () => { deps: EnrollmentDependencies; target?: string } }> = [
    { reason: 'no_face', setup: () => ({ deps: { provider: new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'multiple_faces', setup: () => ({ deps: { provider: new MockProvider({ results: { detectFace: { faceCount: 2, faces: [{ x: 0, y: 0, width: 1, height: 1, confidence: 1 }, { x: 5, y: 5, width: 1, height: 1, confidence: 1 }] } } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'poor_quality', setup: () => ({ deps: { provider: new MockProvider({ results: { assessQuality: { passed: false, reasons: ['too_dark'] } } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'liveness_failed', setup: () => ({ deps: { provider: new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.1 } } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'provider_unavailable', setup: () => ({ deps: { provider: new MockProvider({ failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'timeout', setup: () => ({ deps: { provider: new MockProvider({ failures: { assessQuality: new BiometricProviderError('timeout', 'slow') } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'malformed_image', setup: () => ({ deps: { provider: new MockProvider({ failures: { detectFace: new BiometricProviderError('malformed_image', 'bad') } }), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'not_authorized', setup: () => ({ deps: { provider: new MockProvider(), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } }), audit: new FakeAuditWriter() }, target: 'user-2' }) },
    { reason: 'cross_tenant_denied', setup: () => ({ deps: { provider: new MockProvider(), store: new FakeReferenceStore(), userReader: new FakeUserProfileReader({ 'user-9': { companyId: 'company-OTHER', status: 'active' } }), audit: new FakeAuditWriter() }, target: 'user-9' }) },
    { reason: 'enrollment_revoked', setup: () => ({ deps: { provider: new MockProvider(), store: new FakeReferenceStore([buildReference({ status: 'revoked' })]), userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }) },
    { reason: 'persistence_failed', setup: () => { const store = new FakeReferenceStore(); store.failCreate = true; return { deps: { provider: new MockProvider(), store, userReader: new FakeUserProfileReader(), audit: new FakeAuditWriter() } }; } },
  ];

  for (const { reason, setup } of cases) {
    it(`enrollment "${reason}": the reference-store document map is byte-identical before and after the failed call`, async () => {
      const { deps, target } = setup();
      const store = deps.store as FakeReferenceStore;
      const before = store.snapshot();

      const auth = target === 'user-2'
        ? buildAuth({ role: 'Employee' }) // unauthorized: non-Admin/HR attempting on-behalf-of
        : target === 'user-9'
          ? buildAuth({ role: 'Admin', companyId: 'company-1' })
          : buildAuth();

      await expect(enrollBiometricFace(auth, FRAME, target, deps)).rejects.toMatchObject({ reason });

      expect(store.snapshot()).toEqual(before);
    });
  }
});

describe('Phase 10 — §20 item 10: every §15 verification failure row produces NO Firestore write (beyond the pre-existing reference itself)', () => {
  const cases: Array<{ reason: PipelineReason; setup: () => VerificationDependencies }> = [
    { reason: 'no_face', setup: () => ({ provider: new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } }), store: new FakeReferenceStore([buildReference()]), audit: new FakeAuditWriter() }) },
    { reason: 'liveness_failed', setup: () => ({ provider: new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.1 } } }), store: new FakeReferenceStore([buildReference()]), audit: new FakeAuditWriter() }) },
    { reason: 'provider_unavailable', setup: () => ({ provider: new MockProvider({ failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') } }), store: new FakeReferenceStore([buildReference()]), audit: new FakeAuditWriter() }) },
    { reason: 'timeout', setup: () => ({ provider: new MockProvider({ failures: { checkLiveness: new BiometricProviderError('timeout', 'slow') } }), store: new FakeReferenceStore([buildReference()]), audit: new FakeAuditWriter() }) },
    { reason: 'no_enrollment', setup: () => ({ provider: new MockProvider(), store: new FakeReferenceStore([]), audit: new FakeAuditWriter() }) },
    { reason: 'enrollment_revoked', setup: () => ({ provider: new MockProvider(), store: new FakeReferenceStore([buildReference({ status: 'revoked' })]), audit: new FakeAuditWriter() }) },
    { reason: 'verification_failed', setup: () => ({ provider: new MockProvider({ verifyThreshold: 0.01 }), store: new FakeReferenceStore([buildReference({ embedding: [0, 0, 0, 0, 0, 0, 0, 0] })]), audit: new FakeAuditWriter() }) },
    { reason: 'persistence_failed', setup: () => { const store = new FakeReferenceStore([buildReference()]); store.failUpdate = true; return { provider: new MockProvider(), store, audit: new FakeAuditWriter() }; } },
  ];

  for (const { reason, setup } of cases) {
    it(`verification "${reason}": the reference document (including lastVerifiedAt) is byte-identical before and after the failed call`, async () => {
      const deps = setup();
      const store = deps.store as FakeReferenceStore;
      const before = store.snapshot();

      await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason });

      expect(store.snapshot()).toEqual(before);
    });
  }
});
