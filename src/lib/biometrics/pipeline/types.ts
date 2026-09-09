/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — pipeline stage contracts.
 *
 * Pure types only, zero Firebase/UI dependency (matches
 * `attendanceRuleEngine.ts`'s own convention, reused deliberately per this
 * phase's "Policy Layer" instruction). Safe to import from either the
 * Node/API context (`api/_lib/biometrics/`) or, in principle, the browser —
 * though nothing here is imported by browser code in this phase (no camera
 * UI yet, §29 backlog / Phase 7).
 *
 * Reason codes below are Master Plan §15's FULL table, split into two
 * groups matching the provider-vs-orchestrator boundary (§5/§7/§8/§10):
 *   - `PipelineDomainReason`: a valid, well-typed outcome the PROVIDER (or a
 *     pure policy computation) produced from actually looking at the input —
 *     never a provider-level error.
 *   - `PipelineAuthReason`: an authorization/tenant/lifecycle decision made
 *     entirely by Neozy's own orchestration layer, before or independent of
 *     any provider call.
 *   - `BiometricProviderFailureReason` (imported from Phase 2's
 *     `BiometricProvider.ts`) covers the third group: the provider could not
 *     attempt the operation at all (malformed_image/provider_unavailable/timeout).
 * All three are merged into one `PipelineReason` union so a single
 * `BiometricPipelineError` type can represent any Phase 4 failure with one
 * discriminated `reason` field — mirroring `AttendanceCheckError`'s existing
 * `reason`-string convention (`src/services/AttendanceService.ts`).
 */

import type {
  BiometricProviderFailureReason,
  DetectionResult,
  EmbeddingResult,
  LivenessResult,
  QualityResult,
  ResolvedFaceDetection,
  VerificationResult,
} from '../providers/BiometricProvider.js';

export type PipelineDomainReason =
  | 'no_face'
  | 'multiple_faces'
  | 'poor_quality'
  | 'liveness_failed'
  | 'ambiguous_match'
  | 'verification_failed';

export type PipelineAuthReason =
  | 'not_authorized'
  | 'cross_tenant_denied'
  | 'no_enrollment'
  | 'enrollment_revoked'
  | 'persistence_failed';

export type PipelineReason = PipelineDomainReason | PipelineAuthReason | BiometricProviderFailureReason;

/**
 * The single error type every Phase 4 stage/orchestrator throws on failure.
 * Every raise site supplies a safe, user-presentable `message` — never a
 * raw provider/Firestore exception message (mirrors Phase 1's own
 * "never leak internal details" discipline, carried into this layer).
 */
export class BiometricPipelineError extends Error {
  reason: PipelineReason;
  constructor(reason: PipelineReason, message: string) {
    super(message);
    this.name = 'BiometricPipelineError';
    this.reason = reason;
  }
}

export function malformedImage(): BiometricPipelineError {
  return new BiometricPipelineError('malformed_image', 'The submitted image could not be decoded.');
}

export function noFace(): BiometricPipelineError {
  return new BiometricPipelineError('no_face', 'No face could be detected in the submitted frame.');
}

export function multipleFaces(count: number): BiometricPipelineError {
  return new BiometricPipelineError('multiple_faces', `${count} faces were detected; exactly one is required.`);
}

export function poorQuality(reasons: readonly string[]): BiometricPipelineError {
  return new BiometricPipelineError(
    'poor_quality',
    reasons.length ? `Image quality was not sufficient: ${reasons.join(', ')}.` : 'Image quality was not sufficient.',
  );
}

export function livenessFailed(): BiometricPipelineError {
  return new BiometricPipelineError('liveness_failed', 'The submitted frame failed the liveness check.');
}

export function ambiguousMatch(): BiometricPipelineError {
  return new BiometricPipelineError('ambiguous_match', 'The match confidence was too close to the decision boundary to accept.');
}

export function verificationFailed(): BiometricPipelineError {
  return new BiometricPipelineError('verification_failed', 'Face verification did not match the stored reference.');
}

export function notAuthorized(message = 'You are not authorized to perform this action.'): BiometricPipelineError {
  return new BiometricPipelineError('not_authorized', message);
}

export function crossTenantDenied(): BiometricPipelineError {
  return new BiometricPipelineError('cross_tenant_denied', 'The target employee is outside your authorized company/Group scope.');
}

export function noEnrollment(): BiometricPipelineError {
  return new BiometricPipelineError('no_enrollment', 'No biometric enrollment exists for this account. Enroll your face first.');
}

export function enrollmentRevoked(): BiometricPipelineError {
  return new BiometricPipelineError('enrollment_revoked', 'This biometric enrollment has been revoked. Contact an administrator.');
}

export function persistenceFailed(): BiometricPipelineError {
  return new BiometricPipelineError('persistence_failed', 'The biometric operation was validated, but the result could not be saved. Please try again.');
}

// ── Stage result re-exports (for orchestration-layer readability) ──────

export type { DetectionResult, EmbeddingResult, LivenessResult, QualityResult, ResolvedFaceDetection, VerificationResult };
