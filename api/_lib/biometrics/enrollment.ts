/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — enrollment orchestrator.
 *
 * Flow (Master Plan §11, adapted to this phase's scope — see the phase
 * completion record for the self/Admin-HR-only boundary decision):
 *   authorization → Detect → Quality → Liveness → Embedding →
 *   persist (create or re-enrollment update) → audit → result.
 *
 * Every stage before persistence can fail closed with NO Firestore write
 * (Master Plan §11: "If any pipeline stage before persistence fails...
 * nothing is written"). Every outcome (pass and fail) is audited.
 */

import type { AuthenticatedUser } from '../auth.js';
import type { BiometricFrame, BiometricProvider } from '../../../src/lib/biometrics/providers/BiometricProvider.js';
import { BiometricPipelineError, enrollmentRevoked, persistenceFailed } from '../../../src/lib/biometrics/pipeline/types.js';
import { runDetectStage } from '../../../src/lib/biometrics/pipeline/detect.js';
import { runQualityStage } from '../../../src/lib/biometrics/pipeline/quality.js';
import { runLivenessStage } from '../../../src/lib/biometrics/pipeline/liveness.js';
import { runEmbeddingStage } from '../../../src/lib/biometrics/pipeline/embedding.js';
import { evaluateDuplicateFacePolicy, type DuplicateFaceWarning } from '../../../src/lib/biometrics/pipeline/duplicateFacePolicy.js';
import { resolveEnrollmentTarget, type UserProfileReader } from './authorization.js';
import { buildNewReference, buildReEnrollmentPatch, type BiometricReferenceStore } from './referenceStore.js';
import type { BiometricAuditWriter } from './audit.js';

export interface EnrollmentDependencies {
  provider: BiometricProvider;
  store: BiometricReferenceStore;
  userReader: UserProfileReader;
  audit: BiometricAuditWriter;
}

export interface EnrollmentResult {
  readonly enrolled: true;
  readonly userId: string;
  readonly reEnrolled: boolean;
  readonly reEnrollmentCount: number;
  /** Master Plan §11's duplicate-face policy (Phase 6): a non-blocking,
   * same-company-only advisory signal. `undefined`/absent when no
   * suspiciously-close match was found — never a hard rejection, never
   * itself a reason the pipeline fails closed. */
  readonly duplicateFaceWarning?: DuplicateFaceWarning;
}

/**
 * `detectorVersion` limitation, recorded honestly (Phase 4 finding, not
 * silently papered over): neither Phase 1's actual `/readiness` response
 * nor Phase 2's `HealthResult`/`EmbeddingResult` types expose a distinct
 * "detector version" signal separate from the detector's NAME
 * (`detectorBackend`) and the overall package version — Phase 1's real
 * implementation only ever reported `deepface_version` (the package), not
 * a per-detector version string. Rather than inventing a Phase-2-type
 * change in Phase 4 (out of this phase's scope, and Phase 2 is COMPLETE/
 * immutable per this phase's own instruction), this falls back to the
 * provider's own `health().detail` when present, else a literal 'unknown'
 * — schema-valid, honest, and easily replaced once a future phase's real
 * provider exposes a genuine version signal.
 */
async function resolveDetectorMetadata(provider: BiometricProvider): Promise<{ detectorBackend: string; detectorVersion: string }> {
  const health = await provider.health();
  return {
    detectorBackend: health.detectorBackend || 'unknown',
    detectorVersion: health.detail || 'unknown',
  };
}

export async function enrollBiometricFace(
  auth: AuthenticatedUser,
  frame: BiometricFrame,
  requestedTargetUserId: string | undefined,
  deps: EnrollmentDependencies,
): Promise<EnrollmentResult> {
  const attemptedTargetUserId = (requestedTargetUserId || '').trim() || auth.erpUserId;
  let targetUserId = attemptedTargetUserId;

  try {
    const target = await resolveEnrollmentTarget(auth, requestedTargetUserId, deps.userReader);
    targetUserId = target.targetUserId;

    const detection = await runDetectStage(deps.provider, frame);
    await runQualityStage(deps.provider, frame, detection);
    await runLivenessStage(deps.provider, frame, detection);
    const embeddingResult = await runEmbeddingStage(deps.provider, frame, detection);
    const { detectorBackend, detectorVersion } = await resolveDetectorMetadata(deps.provider);

    // Master Plan §11 duplicate-face policy (Phase 6): a non-blocking,
    // same-company-only advisory check — never allowed to fail the
    // enrollment itself (see evaluateDuplicateFacePolicy's own doc comment
    // for why it fails OPEN, not closed, unlike every security-relevant
    // stage above it).
    const duplicateCandidates = await deps.store.listActiveReferencesInCompany(target.targetCompanyId, target.targetUserId);
    const duplicateFaceWarning = await evaluateDuplicateFacePolicy(deps.provider, embeddingResult.embedding, duplicateCandidates);

    const existing = await deps.store.getReference(target.targetUserId);
    let reEnrollmentCount = 0;

    if (existing) {
      // Phase 9 — Master Plan §9's "Revocation policy": reactivating a
      // revoked reference is authorized the SAME way `firestore.rules`
      // already restricts direct writes to this collection's revocation
      // state (Phase 3's `biometricUpdateAllowed()` `selfExcludesRevocation`
      // guard, still enforced/still tested — "An employee re-enrolling
      // their own face cannot use the same write to un-revoke themselves or
      // hide a revocation"): self-service can never reactivate its OWN
      // revoked reference; only an Admin/HR actor enrolling on the
      // employee's behalf can. This is a deliberate, narrower reading of
      // §9's "re-activation... treated identically to re-enrollment
      // authorization-wise" than a literal "self is always allowed" would
      // give — chosen specifically to stay consistent with, rather than
      // contradict, the already-tested rules-layer security decision. See
      // the Phase 9 completion record for the full reasoning.
      const isSelfService = target.targetUserId === auth.erpUserId;
      if (existing.status === 'revoked' && isSelfService) {
        throw enrollmentRevoked();
      }

      const patch = buildReEnrollmentPatch(existing, {
        embedding: embeddingResult.embedding,
        embeddingModel: embeddingResult.modelName,
        embeddingModelVersion: embeddingResult.modelVersion,
        detectorBackend,
        detectorVersion,
        actorUserId: auth.erpUserId,
      });
      await deps.store.updateReference(target.targetUserId, patch);
      reEnrollmentCount = patch.reEnrollmentCount as number;
    } else {
      const groupId = await deps.store.resolveCompanyGroupId(target.targetCompanyId);
      const doc = buildNewReference({
        userId: target.targetUserId,
        companyId: target.targetCompanyId,
        groupId,
        embedding: embeddingResult.embedding,
        embeddingModel: embeddingResult.modelName,
        embeddingModelVersion: embeddingResult.modelVersion,
        detectorBackend,
        detectorVersion,
        enrolledBy: auth.erpUserId,
        enrolledAt: new Date().toISOString(),
      });
      await deps.store.createReference(doc);
    }

    await deps.audit.writeEnrollmentEvent({
      actor: auth,
      targetUserId: target.targetUserId,
      outcome: 'success',
      embeddingModel: embeddingResult.modelName,
      embeddingModelVersion: embeddingResult.modelVersion,
      detectorBackend,
      duplicateFaceWarning: duplicateFaceWarning ?? undefined,
    });

    return {
      enrolled: true,
      userId: target.targetUserId,
      reEnrolled: !!existing,
      reEnrollmentCount,
      ...(duplicateFaceWarning ? { duplicateFaceWarning } : {}),
    };
  } catch (error) {
    // Phase 9 audit-completeness fix: every failure path is now audited
    // exactly once, not only `BiometricPipelineError` instances. Before this
    // fix, a raw/unexpected exception from a store or user-profile read
    // (Firestore unavailable, a network blip, etc. — e.g. from
    // `resolveEnrollmentTarget()`'s own `readUser()` call, or
    // `getReference()`/`listActiveReferencesInCompany()` above, none of
    // which were individually try/catch-guarded) would escape BOTH the
    // audit trail and translation into a safe client-facing reason —
    // propagating as a raw exception instead. Any such unmapped failure is
    // now treated as `persistence_failed` (the existing, closest-fitting
    // §11 reason for "the reference store could not be read/written"),
    // audited once, and never leaked to the caller as a raw exception.
    const isPipelineError = error instanceof BiometricPipelineError;
    const reason = isPipelineError ? (error as BiometricPipelineError).reason : 'persistence_failed';
    await deps.audit.writeEnrollmentEvent({ actor: auth, targetUserId, outcome: 'failure', reason });
    throw isPipelineError ? error : persistenceFailed();
  }
}
