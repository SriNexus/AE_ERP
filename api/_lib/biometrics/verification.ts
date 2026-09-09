/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — verification orchestrator.
 *
 * Flow (Master Plan §12): authorization (always self) → load own reference
 * (no_enrollment / enrollment_revoked pre-check) → Detect → Quality →
 * Liveness → Embedding → Verify (independent threshold re-check) → Policy →
 * audit → result.
 *
 * Deliberately stops at a VERIFICATION VERDICT — it does NOT call
 * `AttendanceService` or write an attendance record. Master Plan Phase 4's
 * own text: "What MUST NOT be changed: AttendanceService.ts itself (Phase 8
 * wires the actual call into it — this phase builds the orchestration layer
 * in isolation, testable on its own)." Wiring this verdict into an actual
 * biometric check-in/out is explicitly Phase 8's job.
 */

import type { AuthenticatedUser } from '../auth.js';
import type { BiometricFrame, BiometricProvider } from '../../../src/lib/biometrics/providers/BiometricProvider.js';
import { BiometricPipelineError, noEnrollment, persistenceFailed } from '../../../src/lib/biometrics/pipeline/types.js';
import { runDetectStage } from '../../../src/lib/biometrics/pipeline/detect.js';
import { runQualityStage } from '../../../src/lib/biometrics/pipeline/quality.js';
import { runLivenessStage } from '../../../src/lib/biometrics/pipeline/liveness.js';
import { runEmbeddingStage } from '../../../src/lib/biometrics/pipeline/embedding.js';
import { runVerifyStage, type VerifyPolicyConfig } from '../../../src/lib/biometrics/pipeline/verify.js';
import { assertReferenceActive, decideVerification } from '../../../src/lib/biometrics/pipeline/policy.js';
import { resolveVerificationTarget } from './authorization.js';
import type { BiometricReferenceStore } from './referenceStore.js';
import type { BiometricAuditWriter } from './audit.js';

export interface VerificationDependencies {
  provider: BiometricProvider;
  store: BiometricReferenceStore;
  audit: BiometricAuditWriter;
  policyConfig?: VerifyPolicyConfig;
}

export interface VerificationResultOutcome {
  readonly verified: true;
  readonly userId: string;
  /**
   * Face Attendance + DeepFace Master Plan, Phase 8 addition: the exact
   * `lastVerifiedAt` value this call just stamped onto the caller's own
   * `biometric_face_references` document. Deliberately returned so
   * `AttendanceService.checkIn()`/`checkOut()` (client-side, existing
   * pre-Phase-8 code) can be handed a genuine, server-derived
   * proof-of-freshness to independently re-check before accepting a
   * `source: 'biometric'` attendance write (§5's threat table: "bound to a
   * single attendance write attempt... not a standing 'verified' flag").
   * Not a secret — its security value comes from `firestore.rules` making
   * `lastVerifiedAt` exclusively Admin-SDK-writable (Phase 8 rules
   * addition), not from this value being hidden.
   */
  readonly verifiedAt: string;
}

function bucketDistance(distance: number): string {
  // Coarse bucketing only — never full-precision raw distance in audit
  // metadata (this phase's own "return only minimum information" /
  // "no unnecessary biometric payloads" instruction, applied to audit too).
  return (Math.round(distance * 20) / 20).toFixed(2);
}

export async function verifyBiometricFace(
  auth: AuthenticatedUser,
  frame: BiometricFrame,
  deps: VerificationDependencies,
): Promise<VerificationResultOutcome> {
  const target = resolveVerificationTarget(auth);

  try {
    const reference = await deps.store.getReference(target.userId);
    if (!reference) throw noEnrollment();
    assertReferenceActive(reference.status);

    const detection = await runDetectStage(deps.provider, frame);
    await runQualityStage(deps.provider, frame, detection);
    await runLivenessStage(deps.provider, frame, detection);
    const embeddingResult = await runEmbeddingStage(deps.provider, frame, detection);

    const verifyOutcome = await runVerifyStage(
      deps.provider,
      embeddingResult.embedding,
      reference.embedding,
      deps.policyConfig,
    );
    const decision = decideVerification(reference.status, verifyOutcome);

    const verifiedAt = new Date().toISOString();
    await deps.store.updateReference(target.userId, { lastVerifiedAt: verifiedAt, updatedBy: auth.erpUserId });

    await deps.audit.writeVerificationEvent({
      actor: auth,
      outcome: 'success',
      distanceBucket: bucketDistance(decision.distance),
      embeddingModelVersion: reference.embeddingModelVersion,
    });

    return { verified: true, userId: target.userId, verifiedAt };
  } catch (error) {
    // Phase 9 audit-completeness fix: mirrors enrollBiometricFace()'s own
    // fix — every failure path is now audited exactly once, not only
    // `BiometricPipelineError` instances. Before this fix, a raw/unexpected
    // exception from `getReference()` or the `lastVerifiedAt`-stamping
    // `updateReference()` call above (neither individually try/catch-guarded)
    // would escape both the audit trail and safe-error translation. Any
    // such unmapped failure is now treated as `persistence_failed`, audited
    // once, and never leaked to the caller as a raw exception.
    const isPipelineError = error instanceof BiometricPipelineError;
    const reason = isPipelineError ? (error as BiometricPipelineError).reason : 'persistence_failed';
    await deps.audit.writeVerificationEvent({ actor: auth, outcome: 'failure', reason });
    throw isPipelineError ? error : persistenceFailed();
  }
}
