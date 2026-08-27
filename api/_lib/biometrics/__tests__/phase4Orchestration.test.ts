/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — orchestration boundary
 * tests. Covers the full Node/TypeScript biometric pipeline (authorization,
 * Detect → Quality → Liveness → Verify, policy, persistence, audit) using
 * `MockProvider` (Phase 2) plus in-memory fakes for the Admin-SDK-backed
 * dependencies (`BiometricReferenceStore`, `BiometricAuditWriter`,
 * `UserProfileReader`) — no Firestore emulator required, since none of this
 * layer's own logic depends on `firestore.rules` (Admin SDK bypasses rules
 * entirely; Phase 3's rules are a separate, already-tested enforcement
 * point for the direct client-SDK path).
 *
 * Uses real fakes with real state (a `Map`-backed store, a call-recording
 * audit writer) — assertions check actual resulting state/values, not just
 * "was called".
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedUser } from '../../auth';
import {
  BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
  type BiometricFaceReference,
} from '../../../../src/lib/biometrics/biometricFaceReference';
import { MockProvider } from '../../../../src/lib/biometrics/providers/MockProvider';
import { BiometricProviderError } from '../../../../src/lib/biometrics/providers/BiometricProvider';
import { BiometricPipelineError } from '../../../../src/lib/biometrics/pipeline/types';
import { runVerifyStage } from '../../../../src/lib/biometrics/pipeline/verify';
import { decideVerification, assertReferenceActive } from '../../../../src/lib/biometrics/pipeline/policy';
import { enrollBiometricFace, type EnrollmentDependencies } from '../enrollment';
import { verifyBiometricFace, type VerificationDependencies } from '../verification';
import { resolveEnrollmentTarget, resolveVerificationTarget, type UserProfileReader } from '../authorization';
import type { BiometricReferenceStore } from '../referenceStore';
import type { BiometricAuditWriter } from '../audit';
import { decodeBase64Image } from '../../../biometrics/enroll';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Test fixtures / fakes ─────────────────────────────────────────────

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
  failCreate = false;
  failUpdate = false;

  constructor(seed: BiometricFaceReference[] = []) {
    for (const doc of seed) this.docs.set(doc.userId, doc);
  }

  async getReference(userId: string) {
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
  async listActiveReferencesInCompany(companyId: string, excludeUserId: string) {
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
  constructor(private readonly users: Record<string, Record<string, unknown> | null>) {}
  async readUser(userId: string) {
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

// ── 1. Authenticated self-service enrollment ────────────────────────────

describe('Phase 4 — enrollment orchestration', () => {
  it('authenticated self-service enrollment succeeds and is audited as success', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore();
    const deps = buildEnrollmentDeps({ audit, store });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result).toEqual({ enrolled: true, userId: 'user-1', reEnrolled: false, reEnrollmentCount: 0 });
    expect(store.get('user-1')?.companyId).toBe('company-1');
    expect(store.get('user-1')?.status).toBe('active');
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({ kind: 'enrollment', input: { outcome: 'success', targetUserId: 'user-1' } });
  });

  // ── 2. Unauthorized on-behalf-of enrollment ─────────────────────────
  it('rejects on-behalf-of enrollment from a non-Admin/HR actor as not_authorized', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit, userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } }) });

    await expect(enrollBiometricFace(buildAuth({ role: 'Employee' }), FRAME, 'user-2', deps))
      .rejects.toMatchObject({ reason: 'not_authorized' });
    expect(audit.calls).toEqual([{ kind: 'enrollment', input: expect.objectContaining({ outcome: 'failure', reason: 'not_authorized', targetUserId: 'user-2' }) }]);
  });

  // ── 3. Admin enrolling an inactive target ───────────────────────────
  it('rejects on-behalf-of enrollment when the target profile is inactive', async () => {
    const deps = buildEnrollmentDeps({
      userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'inactive' } }),
    });

    await expect(enrollBiometricFace(buildAuth({ role: 'Admin' }), FRAME, 'user-2', deps))
      .rejects.toMatchObject({ reason: 'not_authorized' });
  });

  // ── 4. Cross-tenant on-behalf-of enrollment denied ──────────────────
  it('denies on-behalf-of enrollment across companies even though the request never carries companyId (server derives it from the target\'s own profile)', async () => {
    const deps = buildEnrollmentDeps({
      userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-OTHER', status: 'active' } }),
    });

    await expect(enrollBiometricFace(buildAuth({ role: 'Admin', companyId: 'company-1' }), FRAME, 'user-2', deps))
      .rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });

  // ── 5. Admin/HR same-company on-behalf-of enrollment succeeds ───────
  it('allows Admin to enroll a same-company employee on their behalf, and target identity comes from the real profile, not the request', async () => {
    const store = new FakeReferenceStore();
    const deps = buildEnrollmentDeps({
      store,
      userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } }),
    });

    const result = await enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-1' }), FRAME, 'user-2', deps);

    expect(result.userId).toBe('user-2');
    expect(store.get('user-2')?.enrolledBy).toBe('admin-1');
    expect(store.get('user-2')?.companyId).toBe('company-1');
  });

  // ── 6. No face detected ──────────────────────────────────────────────
  it('fails closed with no_face when zero faces are detected, and writes no reference', async () => {
    const store = new FakeReferenceStore();
    const provider = new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } });
    const deps = buildEnrollmentDeps({ provider, store });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'no_face' });
    expect(store.get('user-1')).toBeUndefined();
  });

  // ── 7. Multiple faces detected ───────────────────────────────────────
  it('fails closed with multiple_faces when more than one face is detected', async () => {
    const provider = new MockProvider({
      results: {
        detectFace: {
          faceCount: 2,
          faces: [
            { x: 0, y: 0, width: 10, height: 10, confidence: 0.9 },
            { x: 50, y: 50, width: 10, height: 10, confidence: 0.9 },
          ],
        },
      },
    });
    const deps = buildEnrollmentDeps({ provider });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'multiple_faces' });
  });

  // ── 8. Poor quality ───────────────────────────────────────────────────
  it('fails closed with poor_quality and surfaces the specific reasons', async () => {
    const provider = new MockProvider({ results: { assessQuality: { passed: false, reasons: ['too_dark', 'blurry'] } } });
    const deps = buildEnrollmentDeps({ provider });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps))
      .rejects.toMatchObject({ reason: 'poor_quality', message: expect.stringContaining('too_dark') });
  });

  // ── 9. Failed liveness ────────────────────────────────────────────────
  it('fails closed with liveness_failed on a spoof/non-live result and audits it as critical-eligible', async () => {
    const audit = new FakeAuditWriter();
    const provider = new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.1 } } });
    const deps = buildEnrollmentDeps({ provider, audit });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'liveness_failed' });
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'liveness_failed' });
  });

  // ── 10. Provider unavailable ─────────────────────────────────────────
  it('translates a provider_unavailable failure into the pipeline error, never a false success', async () => {
    const provider = new MockProvider({ failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') } });
    const deps = buildEnrollmentDeps({ provider });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  // ── 11. Provider timeout ─────────────────────────────────────────────
  it('translates a timeout failure distinctly from provider_unavailable', async () => {
    const provider = new MockProvider({ failures: { assessQuality: new BiometricProviderError('timeout', 'slow') } });
    const deps = buildEnrollmentDeps({ provider });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'timeout' });
  });

  // ── 12. Malformed input (base64 decode boundary) ─────────────────────
  it('rejects malformed/empty base64 image input before any provider call, at the HTTP boundary', () => {
    expect(() => decodeBase64Image('')).toThrow(BiometricPipelineError);
    expect(() => decodeBase64Image(undefined)).toThrow(BiometricPipelineError);
    try {
      decodeBase64Image('');
    } catch (error) {
      expect((error as BiometricPipelineError).reason).toBe('malformed_image');
    }
  });

  // ── 13. Persistence failure is distinct from a validation rejection ──
  it('reports persistence_failed (not a validation reason) when the store write itself throws, after full pipeline success', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore();
    store.failCreate = true;
    const deps = buildEnrollmentDeps({ store, audit });

    await expect(enrollBiometricFace(buildAuth(), FRAME, undefined, deps)).rejects.toMatchObject({ reason: 'persistence_failed' });
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0].input).toMatchObject({ outcome: 'failure', reason: 'persistence_failed' });
  });

  // ── 14. Re-enrollment fully replaces the embedding and appends history ─
  it('re-enrollment replaces the stored embedding, increments reEnrollmentCount, and appends prior metadata to history', async () => {
    const existing = buildReference({ embedding: [9, 9, 9], reEnrollmentCount: 0, history: [] });
    const store = new FakeReferenceStore([existing]);
    const deps = buildEnrollmentDeps({ store });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result.reEnrolled).toBe(true);
    expect(result.reEnrollmentCount).toBe(1);
    const stored = store.get('user-1')!;
    expect(stored.embedding).not.toEqual([9, 9, 9]);
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].embeddingModel).toBe(existing.embeddingModel);
    // Immutable anchor fields must never change on re-enrollment.
    expect(stored.enrolledAt).toBe(existing.enrolledAt);
    expect(stored.enrolledBy).toBe(existing.enrolledBy);
    expect(stored.userId).toBe(existing.userId);
  });

  // ── 15. Embeddings never appear in the response or audit payload ─────
  it('never includes the raw embedding vector in the enrollment result or any audit call', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(JSON.stringify(result)).not.toContain('0.1');
    expect('embedding' in result).toBe(false);
    for (const call of audit.calls) {
      expect('embedding' in call.input).toBe(false);
      expect(JSON.stringify(call.input)).not.toContain('0.1,0.2,0.3');
    }
  });

  // ── 16. Audit identity always the authenticated actor ────────────────
  it('audit entries always carry the authenticated actor identity, never a caller-forged value', async () => {
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ audit });
    const auth = buildAuth({ erpUserId: 'user-1', email: 'real@example.com', role: 'Employee', companyId: 'company-1' });

    await enrollBiometricFace(auth, FRAME, undefined, deps);

    const enrollmentAuditWriter: BiometricAuditWriter = {
      writeEnrollmentEvent: async (input) => {
        expect(input.actor).toBe(auth);
        expect(input.actor.erpUserId).toBe('user-1');
      },
      writeVerificationEvent: async () => {},
    };
    // Re-run against a writer that asserts identity shape directly, proving
    // the orchestrator passes the real AuthenticatedUser object through
    // untouched (not a request-supplied substitute).
    await enrollBiometricFace(auth, FRAME, undefined, buildEnrollmentDeps({ audit: enrollmentAuditWriter }));
  });
});

// ── Verification orchestration ──────────────────────────────────────────

describe('Phase 4 — verification orchestration', () => {
  it('authenticated self-service verification succeeds end-to-end (Detect→Quality→Liveness→Verify→Policy)', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference()]);
    const deps = buildVerificationDeps({ store, audit });

    const result = await verifyBiometricFace(buildAuth(), FRAME, deps);

    // Phase 8 addition: verifiedAt is the exact lastVerifiedAt this call
    // just stamped — asserted for real equality against the stored value,
    // not just presence, since AttendanceService's own anti-replay check
    // (Phase 8) depends on these two being identical.
    expect(result).toEqual({ verified: true, userId: 'user-1', verifiedAt: expect.any(String) });
    expect(store.get('user-1')?.lastVerifiedAt).toBeDefined();
    expect(result.verifiedAt).toBe(store.get('user-1')?.lastVerifiedAt);
    expect(audit.calls[0]).toMatchObject({ kind: 'verification', input: { outcome: 'success' } });
  });

  // ── 17. Verification is always self — there is no on-behalf-of case ──
  it('always resolves the verification target from the authenticated session, ignoring any notion of an on-behalf-of target', () => {
    const target = resolveVerificationTarget(buildAuth({ erpUserId: 'user-7', companyId: 'company-9' }));
    expect(target).toEqual({ userId: 'user-7', companyId: 'company-9' });
  });

  // ── 18. Missing biometric reference ──────────────────────────────────
  it('fails closed with no_enrollment when the caller has never enrolled', async () => {
    const deps = buildVerificationDeps({ store: new FakeReferenceStore([]) });
    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'no_enrollment' });
  });

  // ── 19. Revoked biometric reference ──────────────────────────────────
  it('fails closed with enrollment_revoked before any provider call is made', async () => {
    let providerCalled = false;
    const provider = new MockProvider();
    const originalDetect = provider.detectFace.bind(provider);
    provider.detectFace = async (frame) => {
      providerCalled = true;
      return originalDetect(frame);
    };
    const deps = buildVerificationDeps({ provider, store: new FakeReferenceStore([buildReference({ status: 'revoked' })]) });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'enrollment_revoked' });
    expect(providerCalled).toBe(false);
  });

  // ── 20. Verification mismatch (genuine biometric negative) ───────────
  it('fails closed with verification_failed when the candidate embedding does not match the stored reference', async () => {
    const store = new FakeReferenceStore([buildReference({ embedding: [0, 0, 0, 0, 0, 0, 0, 0] })]);
    // MockProvider's default embedding is far from an all-zero reference.
    const deps = buildVerificationDeps({ store, provider: new MockProvider({ verifyThreshold: 0.01 }) });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'verification_failed' });
  });

  // ── 21. Ambiguous match is rejected, not treated as a borderline pass ─
  it('rejects a distance within the ambiguous band around the threshold rather than passing it', async () => {
    const provider = new MockProvider({ results: { verify: { distance: 0.5, threshold: 0.5, verified: true, distanceMetric: 'euclidean' } } });
    await expect(runVerifyStage(provider, [1], [1])).rejects.toMatchObject({ reason: 'ambiguous_match' });
  });

  // ── 22. Provider never has the final say — independent re-derivation ─
  it('never trusts the provider\'s own verified=true when the independently-recomputed distance actually fails Neozy\'s threshold', async () => {
    // Provider claims verified even though distance (0.9) exceeds threshold (0.5) — pipeline must not trust it.
    const provider = new MockProvider({ results: { verify: { distance: 0.9, threshold: 0.5, verified: true, distanceMetric: 'euclidean' } } });
    await expect(runVerifyStage(provider, [1], [1])).rejects.toMatchObject({ reason: 'verification_failed' });
  });

  // ── 23. Provider failure during verification cannot produce success ──
  it('a provider failure during verification propagates as an error, never a verified result', async () => {
    const provider = new MockProvider({ failures: { checkLiveness: new BiometricProviderError('provider_unavailable', 'down') } });
    const deps = buildVerificationDeps({ provider });

    await expect(verifyBiometricFace(buildAuth(), FRAME, deps)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  // ── 24. Deterministic / fail-closed: same inputs, same outcome ───────
  it('produces the same verification outcome for the same inputs across repeated runs (deterministic)', async () => {
    const store1 = new FakeReferenceStore([buildReference()]);
    const store2 = new FakeReferenceStore([buildReference()]);
    const result1 = await verifyBiometricFace(buildAuth(), FRAME, buildVerificationDeps({ store: store1 }));
    const result2 = await verifyBiometricFace(buildAuth(), FRAME, buildVerificationDeps({ store: store2 }));
    // verifiedAt is a fresh wall-clock timestamp per call (Phase 8) — not
    // itself part of the "same decision" determinism claim being tested
    // here, so it's excluded from the equality check rather than making
    // this test flakily depend on two calls landing in the same millisecond.
    expect(result1.verified).toBe(result2.verified);
    expect(result1.userId).toBe(result2.userId);
  });

  // ── 25. Successful verification never touches attendance ─────────────
  it('never imports or calls AttendanceService — the verification verdict stops at the pipeline boundary (Phase 8 wires attendance)', () => {
    const fullSource = readFileSync(join(__dirname, '..', 'verification.ts'), 'utf-8');
    // Strip EVERY /** ... */ or /* ... */ block comment (the file-level doc
    // comment AND any inline field-level ones, e.g. the Phase 8
    // `verifiedAt` field doc, both legitimately discuss the
    // AttendanceService boundary in prose) — only the actual executable
    // code must be checked here.
    const code = fullSource.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/AttendanceService/);
    expect(code).not.toMatch(/attendance_records/);
    expect(code).not.toMatch(/collection\(['"]attendance/);
  });

  // ── 26. Embeddings/raw frames never leak into the result or audit ────
  it('never includes the stored or candidate embedding vector in the verification result or audit payload', async () => {
    const audit = new FakeAuditWriter();
    const store = new FakeReferenceStore([buildReference()]);
    const result = await verifyBiometricFace(buildAuth(), FRAME, buildVerificationDeps({ store, audit }));

    expect('embedding' in result).toBe(false);
    expect('distance' in result).toBe(false);
    for (const call of audit.calls) {
      expect('embedding' in call.input).toBe(false);
      expect(JSON.stringify(call.input)).not.toContain('0.1,0.2,0.3');
    }
  });

  // ── 27. Audit identity is the authenticated actor, not a request field ─
  it('verification audit entries always carry the authenticated actor, keyed to their own erpUserId only', async () => {
    const audit = new FakeAuditWriter();
    const auth = buildAuth({ erpUserId: 'user-42', companyId: 'company-42' });
    const store = new FakeReferenceStore([buildReference({ id: 'user-42', userId: 'user-42', companyId: 'company-42' })]);

    await verifyBiometricFace(auth, FRAME, buildVerificationDeps({ store, audit }));

    expect(audit.calls[0].input).toMatchObject({ actor: auth });
  });
});

// ── Authorization boundary — identity/tenant forgery resistance ────────

describe('Phase 4 — authorization boundary (identity/tenant forgery resistance)', () => {
  it('self-enrollment target always resolves to the authenticated actor\'s own identity, regardless of no request-supplied override existing at all', async () => {
    const auth = buildAuth({ erpUserId: 'user-9', companyId: 'company-9' });
    const target = await resolveEnrollmentTarget(auth, undefined, new FakeUserProfileReader({}));
    expect(target).toEqual({ targetUserId: 'user-9', targetCompanyId: 'company-9' });
  });

  it('a requested target userId only selects WHICH profile to check — the actual companyId always comes from that profile\'s own server-side document, never trusted from the caller', async () => {
    const auth = buildAuth({ erpUserId: 'admin-1', role: 'Admin', companyId: 'company-1' });
    const reader = new FakeUserProfileReader({ 'user-5': { companyId: 'company-1', status: 'active' } });

    const target = await resolveEnrollmentTarget(auth, 'user-5', reader);

    expect(target).toEqual({ targetUserId: 'user-5', targetCompanyId: 'company-1' });
  });

  it('rejects an on-behalf-of target that does not exist server-side, rather than trusting a fabricated identity', async () => {
    const auth = buildAuth({ role: 'Admin' });
    const reader = new FakeUserProfileReader({});
    await expect(resolveEnrollmentTarget(auth, 'ghost-user', reader)).rejects.toMatchObject({ reason: 'not_authorized' });
  });

  it('SuperAdmin bypasses the same-company restriction but every other role remains bound to it', async () => {
    const reader = new FakeUserProfileReader({ 'user-8': { companyId: 'company-OTHER', status: 'active' } });
    const superAdminAuth = buildAuth({ role: 'Admin', isSuperAdmin: true, companyId: 'company-1' });

    const target = await resolveEnrollmentTarget(superAdminAuth, 'user-8', reader);
    expect(target.targetCompanyId).toBe('company-OTHER');

    const regularAdminAuth = buildAuth({ role: 'Admin', isSuperAdmin: false, companyId: 'company-1' });
    await expect(resolveEnrollmentTarget(regularAdminAuth, 'user-8', reader)).rejects.toMatchObject({ reason: 'cross_tenant_denied' });
  });
});

// ── Pure policy-layer determinism ───────────────────────────────────────

describe('Phase 4 — policy layer (pure, deterministic, fail-closed)', () => {
  it('assertReferenceActive is a pure function: throws for revoked, passes silently for active', () => {
    expect(() => assertReferenceActive('active')).not.toThrow();
    expect(() => assertReferenceActive('revoked')).toThrow(BiometricPipelineError);
  });

  it('decideVerification re-asserts revocation defensively even after a successful Verify stage result', () => {
    const verifyOutcome = { distance: 0.1, threshold: 0.5, distanceMetric: 'euclidean', passed: true as const };
    expect(() => decideVerification('revoked', verifyOutcome)).toThrow(BiometricPipelineError);
    expect(decideVerification('active', verifyOutcome)).toEqual({ verified: true, distance: 0.1, threshold: 0.5 });
  });
});
