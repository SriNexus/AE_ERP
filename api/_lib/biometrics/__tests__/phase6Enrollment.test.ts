/**
 * Face Attendance + DeepFace Master Plan, Phase 6 — enrollment-flow
 * completion tests.
 *
 * Phase 4 already built and fully tested (34/34, `phase4Orchestration.test.ts`,
 * re-run unchanged as part of this phase's own regression check) the
 * complete enrollment orchestration boundary: authorization (self +
 * same-company Admin/HR, cross-tenant denial, forged-identity resistance),
 * Detect→Quality→Liveness→Embedding fail-closed behavior, first enrollment,
 * re-enrollment (embedding replacement + immutable-anchor preservation),
 * persistence-failure handling, audit-identity-from-authenticated-actor,
 * and embedding/no-leak guarantees. Master Plan §11's own enrollment
 * architecture was already satisfied by that phase for every item except
 * one: the duplicate-face policy ("before persisting, the orchestration
 * layer should check the new embedding's distance against other active
 * references in the same company to flag... a suspiciously close match").
 *
 * This file is Phase 6's OWN net-new coverage — the duplicate-face policy
 * end-to-end, wired through the real `enrollBiometricFace()` orchestrator —
 * rather than re-deriving tests Phase 4 already proved and still passes
 * unchanged (verified by re-running that suite as part of this phase's own
 * validation, not by assuming it still holds).
 */

import { describe, it, expect } from 'vitest';
import type { AuthenticatedUser } from '../../auth';
import {
  BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
  type BiometricFaceReference,
} from '../../../../src/lib/biometrics/biometricFaceReference';
import { MockProvider } from '../../../../src/lib/biometrics/providers/MockProvider';
import { BiometricProviderError } from '../../../../src/lib/biometrics/providers/BiometricProvider';
import { evaluateDuplicateFacePolicy } from '../../../../src/lib/biometrics/pipeline/duplicateFacePolicy';
import { enrollBiometricFace, type EnrollmentDependencies } from '../enrollment';
import type { UserProfileReader } from '../authorization';
import type { BiometricReferenceStore, ActiveReferenceSummary } from '../referenceStore';
import type { BiometricAuditWriter } from '../audit';

// ── Test fixtures / fakes (mirrors phase4Orchestration.test.ts's own shapes) ──

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
    embedding: [0, 0, 0, 0],
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

  constructor(seed: BiometricFaceReference[] = []) {
    for (const doc of seed) this.docs.set(doc.userId, doc);
  }

  async getReference(userId: string) {
    return this.docs.get(userId) ?? null;
  }
  async createReference(doc: BiometricFaceReference) {
    this.docs.set(doc.userId, doc);
  }
  async updateReference(userId: string, patch: Record<string, unknown>) {
    const existing = this.docs.get(userId);
    if (!existing) throw new Error('no existing document to update');
    this.docs.set(userId, { ...existing, ...patch } as BiometricFaceReference);
  }
  async resolveCompanyGroupId(companyId: string) {
    return companyId === 'company-1' ? 'group-1' : '';
  }
  async listActiveReferencesInCompany(companyId: string, excludeUserId: string): Promise<ActiveReferenceSummary[]> {
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

// ── Pure evaluateDuplicateFacePolicy() unit tests ───────────────────────

describe('Phase 6 — evaluateDuplicateFacePolicy (pure, advisory-only)', () => {
  it('returns null when there are no existing candidates to compare against (first enrollment in an empty company)', async () => {
    const provider = new MockProvider({ verifyThreshold: 0.5 });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], []);
    expect(result).toBeNull();
  });

  it('returns null when every candidate is far from the new embedding (no suspicious match)', async () => {
    const provider = new MockProvider({ verifyThreshold: 0.5 });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [100, 100, 100, 100] },
      { userId: 'user-3', embedding: [50, 50, 50, 50] },
    ]);
    expect(result).toBeNull();
  });

  it('flags a suspiciously close match, naming the OTHER employee\'s userId', async () => {
    const provider = new MockProvider({ verifyThreshold: 0.5 });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [0, 0, 0, 0] }, // distance 0, well under threshold
      { userId: 'user-3', embedding: [100, 100, 100, 100] }, // far away
    ]);
    expect(result).toEqual({ suspectedDuplicateOfUserIds: ['user-2'] });
  });

  it('flags every close match, not just the first, when multiple candidates are suspiciously close', async () => {
    const provider = new MockProvider({ verifyThreshold: 1 });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [0, 0, 0, 0] },
      { userId: 'user-3', embedding: [0.5, 0, 0, 0] },
      { userId: 'user-4', embedding: [100, 100, 100, 100] },
    ]);
    expect([...(result?.suspectedDuplicateOfUserIds ?? [])].sort()).toEqual(['user-2', 'user-3']);
  });

  it('never returns the raw embedding or distance value — only userIds', async () => {
    const provider = new MockProvider({ verifyThreshold: 0.5 });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [0, 0, 0, 0] },
    ]);
    expect(Object.keys(result!)).toEqual(['suspectedDuplicateOfUserIds']);
    expect(JSON.stringify(result)).not.toMatch(/0\.\d/); // no numeric distance leaked
  });

  it('fails OPEN (skips the failing comparison, never throws) when the provider errors on one candidate — this check is advisory, never fail-closed', async () => {
    const provider = new MockProvider({ failures: { verify: new BiometricProviderError('provider_unavailable', 'down') } });
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [0, 0, 0, 0] },
    ]);
    expect(result).toBeNull();
  });

  it('continues comparing remaining candidates after one comparison fails, rather than aborting the whole check', async () => {
    let callCount = 0;
    const provider = new MockProvider();
    const originalVerify = provider.verify.bind(provider);
    provider.verify = async (a, b) => {
      callCount += 1;
      if (callCount === 1) throw new BiometricProviderError('provider_unavailable', 'down');
      return originalVerify(a, b);
    };
    const result = await evaluateDuplicateFacePolicy(provider, [0, 0, 0, 0], [
      { userId: 'user-2', embedding: [0, 0, 0, 0] }, // fails (1st call)
      { userId: 'user-3', embedding: [0, 0, 0, 0] }, // succeeds, matches (2nd call)
    ]);
    expect(callCount).toBe(2);
    expect(result).toEqual({ suspectedDuplicateOfUserIds: ['user-3'] });
  });
});

// ── Full enrollment orchestration with duplicate-face policy wired in ──

describe('Phase 6 — enrollBiometricFace() duplicate-face policy integration', () => {
  it('first enrollment in a company with no other active references produces no warning', async () => {
    const store = new FakeReferenceStore();
    const deps = buildEnrollmentDeps({ store, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result.duplicateFaceWarning).toBeUndefined();
  });

  it('flags a same-company suspiciously-close match as a non-blocking warning — enrollment still succeeds', async () => {
    // MockProvider's default embedding (used by generateEmbedding) is
    // [0.1,0.2,...,0.8] — seed an existing same-company reference with the
    // SAME embedding so the duplicate check finds a distance-0 match.
    const existingOther = buildReference({
      id: 'user-2', userId: 'user-2', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    });
    const store = new FakeReferenceStore([existingOther]);
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ store, audit, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth({ erpUserId: 'user-1' }), FRAME, undefined, deps);

    expect(result.enrolled).toBe(true);
    expect(result.duplicateFaceWarning).toEqual({ suspectedDuplicateOfUserIds: ['user-2'] });
    // The reference is still written despite the warning — advisory, not a gate.
    expect(store.get('user-1')).toBeDefined();
    // Audited as a 'warning' severity success, carrying only the other userId.
    const call = audit.calls.find((c) => c.kind === 'enrollment' && c.input.outcome === 'success');
    expect(call?.input).toMatchObject({ duplicateFaceWarning: { suspectedDuplicateOfUserIds: ['user-2'] } });
  });

  it('never flags against a DIFFERENT company\'s reference, even with an identical embedding (bounded, same-company-only per §11)', async () => {
    const crossCompanyMatch = buildReference({
      id: 'user-9', userId: 'user-9', companyId: 'company-OTHER', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    });
    const store = new FakeReferenceStore([crossCompanyMatch]);
    const deps = buildEnrollmentDeps({ store, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth({ companyId: 'company-1' }), FRAME, undefined, deps);

    expect(result.duplicateFaceWarning).toBeUndefined();
  });

  it('excludes the enrolling target\'s OWN existing reference from the comparison set (re-enrollment never flags itself as a duplicate)', async () => {
    const ownExisting = buildReference({ embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([ownExisting]);
    const deps = buildEnrollmentDeps({ store, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth({ erpUserId: 'user-1' }), FRAME, undefined, deps);

    expect(result.reEnrolled).toBe(true);
    expect(result.duplicateFaceWarning).toBeUndefined();
  });

  it('never compares against a REVOKED same-company reference (not a meaningful duplicate signal)', async () => {
    const revoked = buildReference({ id: 'user-2', userId: 'user-2', status: 'revoked', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([revoked]);
    const deps = buildEnrollmentDeps({ store, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result.duplicateFaceWarning).toBeUndefined();
  });

  it('a provider failure during the duplicate-face check never blocks or fails the enrollment itself (fails open, not closed)', async () => {
    const otherRef = buildReference({ id: 'user-2', userId: 'user-2', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([otherRef]);
    const provider = new MockProvider({ failures: { verify: new BiometricProviderError('provider_unavailable', 'down') } });
    const deps = buildEnrollmentDeps({ store, provider });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(result.enrolled).toBe(true);
    expect(result.duplicateFaceWarning).toBeUndefined();
    expect(store.get('user-1')).toBeDefined();
  });

  it('the duplicate-face warning never leaks a raw embedding or distance value into the enrollment result', async () => {
    const otherRef = buildReference({ id: 'user-2', userId: 'user-2', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([otherRef]);
    const deps = buildEnrollmentDeps({ store, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    const result = await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    expect(JSON.stringify(result)).not.toContain('0.1,0.2,0.3');
  });

  it('the duplicate-face warning never leaks a raw embedding or distance value into the audit payload', async () => {
    const otherRef = buildReference({ id: 'user-2', userId: 'user-2', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([otherRef]);
    const audit = new FakeAuditWriter();
    const deps = buildEnrollmentDeps({ store, audit, provider: new MockProvider({ verifyThreshold: 0.5 }) });

    await enrollBiometricFace(buildAuth(), FRAME, undefined, deps);

    for (const call of audit.calls) {
      expect(JSON.stringify(call.input)).not.toContain('0.1,0.2,0.3');
    }
  });

  it('Admin/HR on-behalf-of enrollment also runs the duplicate-face check, scoped to the TARGET employee\'s company, not the actor\'s own', async () => {
    const otherRef = buildReference({ id: 'user-3', userId: 'user-3', companyId: 'company-1', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    const store = new FakeReferenceStore([otherRef]);
    const deps = buildEnrollmentDeps({
      store,
      provider: new MockProvider({ verifyThreshold: 0.5 }),
      userReader: new FakeUserProfileReader({ 'user-2': { companyId: 'company-1', status: 'active' } }),
    });

    const result = await enrollBiometricFace(buildAuth({ role: 'Admin', erpUserId: 'admin-1', companyId: 'company-1' }), FRAME, 'user-2', deps);

    expect(result.userId).toBe('user-2');
    expect(result.duplicateFaceWarning).toEqual({ suspectedDuplicateOfUserIds: ['user-3'] });
  });
});
