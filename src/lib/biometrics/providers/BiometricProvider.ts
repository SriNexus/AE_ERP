/**
 * BiometricProvider — Face Attendance + DeepFace Master Plan, Phase 2.
 *
 * Provider-independent contract for biometric detect/quality/liveness/
 * embedding/verification signal generation. Lives entirely in Neozy's
 * TypeScript orchestration layer (Master Plan §10) — it is NOT the
 * DeepFace/Python service's own HTTP contract (that is Phase 1's separate,
 * already-complete, immutable concern, §13/§25 Phase 1).
 *
 * Architectural boundary this file exists to enforce (Master Plan §5/§7/§8/§10,
 * "the single most important invariant of this whole design"):
 *   - A provider reports a raw signal (0/1/N faces, a quality verdict, a
 *     liveness verdict, an embedding, a distance) — it never decides
 *     Neozy identity, authorization, tenant scope, or the final
 *     attendance/enrollment outcome. That fail-closed policy decision
 *     belongs to the pipeline-stage/orchestration layer (Phase 4), not
 *     here — mirrored exactly by the Detect/Quality/Liveness/Verify
 *     methods below each returning a descriptive result rather than
 *     throwing on "0 faces" or "distance beyond threshold": those are
 *     valid, well-typed domain outcomes for the CALLER to fail-closed on,
 *     not provider-level errors.
 *   - The one exception is `BiometricProviderError` — reserved for cases
 *     where the provider could not even attempt the operation at all
 *     (malformed input, the provider being unavailable, a timeout) per
 *     Master Plan §15's distinction between those three rows and every
 *     other fail-closed row in that table.
 *   - No input or result type below carries a Neozy identity field
 *     (employeeId/companyId/groupId/userId or similar) — a provider must
 *     never be handed, and can never fabricate, an identity claim. See
 *     `src/lib/__tests__/mockBiometricProvider.test.ts`'s identity-safety
 *     tests for the enforced proof of this.
 *
 * `MockProvider` (this phase) and `DeepFaceProvider` (Phase 5/6) are the
 * only two classes that may ever implement this interface. Both
 * `AttendanceService` and the future business-policy layer
 * (`attendanceRuleEngine.ts`, Phase 4's `policy.ts`) must depend on this
 * interface's types only — never on `MockProvider`/`DeepFaceProvider`
 * directly (Master Plan §10, "Provider replaceability contract").
 */

// ── Frame / embedding primitives ────────────────────────────────────

/**
 * Raw, opaque captured-frame bytes. Deliberately just bytes — this type
 * carries no identity, tenant, or camera-source semantics of any kind, so
 * nothing about "whose face this is" can ever be smuggled through it.
 */
export type BiometricFrame = Uint8Array;

/** A single embedding vector, as returned by `generateEmbedding()` and
 * consumed by `verify()`. Deliberately a plain array — no identity fields. */
export type BiometricEmbeddingVector = readonly number[];

// ── Detect ───────────────────────────────────────────────────────────

export interface FaceBoxResult {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Detector-reported confidence, 0–1. */
  readonly confidence: number;
}

export interface DetectionResult {
  readonly faceCount: number;
  readonly faces: readonly FaceBoxResult[];
}

/**
 * A single, already-resolved detection — what a pipeline stage (Phase 4)
 * passes into `assessQuality()`/`checkLiveness()`/`generateEmbedding()`
 * after it has already decided (from a `DetectionResult`) which one face to
 * proceed with. A provider never re-runs its own multi-face rejection
 * inside these three methods — that decision was already made by the
 * caller from `detectFace()`'s result (Master Plan §10: "detect.ts → calls
 * provider.detectFace(), fails closed on 0 or >1 faces" — the fail-closing
 * is the CALLER's job, not the provider's).
 */
export type ResolvedFaceDetection = FaceBoxResult;

// ── Quality ──────────────────────────────────────────────────────────

export type QualityFailureReason =
  | 'face_too_small'
  | 'low_detector_confidence'
  | 'too_dark'
  | 'too_bright'
  | 'blurry'
  | 'occluded'
  // Phase 5 compatibility addition: the real Phase 1 Python service's
  // `/quality` endpoint (`biometric-service/app/provider.py::assess_quality`)
  // can report this when the detected face's bounding box crops to an empty
  // region of the source image — a real, observed provider outcome
  // `MockProvider` never needed to model. Additive only; no existing member
  // changed meaning (Master Plan Phase 5: "Do not modify the interface
  // unless the master plan proves a necessary compatibility defect").
  | 'invalid_crop';

export interface QualityResult {
  readonly passed: boolean;
  /** Empty when `passed` is true. One or more specific reasons when false —
   * never a single opaque "failed" flag, so the caller can surface
   * actionable retry guidance (Master Plan §15: "poor_quality, reject with
   * the specific reason surfaced for UX retry guidance"). */
  readonly reasons: readonly QualityFailureReason[];
}

// ── Liveness ─────────────────────────────────────────────────────────

export interface LivenessResult {
  readonly isLive: boolean;
  /** Provider-reported confidence, 0–1, when available. `null` when the
   * provider cannot report one (e.g. liveness disabled by config). */
  readonly confidence: number | null;
}

// ── Embedding ────────────────────────────────────────────────────────

export interface EmbeddingResult {
  readonly embedding: BiometricEmbeddingVector;
  /** Recognition model identifier — stamped by the provider, never
   * client-suppliable (Master Plan §9: "stamped from server-side config at
   * enrollment time, never client-supplied"). */
  readonly modelName: string;
  readonly modelVersion: string;
}

// ── Verify ───────────────────────────────────────────────────────────

export interface VerificationResult {
  readonly distance: number;
  /** The provider's own model-specific threshold for this distance metric.
   * Required (never optional) per Master Plan §6/Phase 2's own data-integrity
   * requirement: "VerificationResult must always carry a distance and a
   * verified boolean the caller can independently re-check" — carrying the
   * threshold alongside is what makes that independent re-check possible at
   * all; a caller with only `verified` could never audit the provider's math. */
  readonly threshold: number;
  /** The provider's OWN verdict. The pipeline stage (Phase 4) independently
   * re-derives pass/fail from `distance`/`threshold` using Neozy's own
   * policy threshold — this field is never trusted as final on its own
   * (Master Plan §6/§10: "never trusts the provider's own verified boolean
   * as final"). */
  readonly verified: boolean;
  readonly distanceMetric: string;
}

// ── Health ───────────────────────────────────────────────────────────

export interface HealthResult {
  readonly available: boolean;
  readonly modelName?: string;
  readonly detectorBackend?: string;
  readonly detail?: string;
}

// ── Provider-level failure (infrastructure, not a domain outcome) ──────

/**
 * Reserved for the Master Plan §15 rows where the provider could not even
 * attempt the operation — never for a domain outcome (0 faces, poor
 * quality, spoof, distance beyond threshold are all valid `...Result`
 * values, not errors). Mirrors `AttendanceCheckError`'s existing shape
 * (`src/services/AttendanceService.ts`) exactly, per this phase's
 * "reuse existing Neozy conventions for types/errors" requirement.
 */
export type BiometricProviderFailureReason = 'malformed_image' | 'provider_unavailable' | 'timeout';

export class BiometricProviderError extends Error {
  reason: BiometricProviderFailureReason;
  constructor(reason: BiometricProviderFailureReason, message: string) {
    super(message);
    this.name = 'BiometricProviderError';
    this.reason = reason;
  }
}

// ── The provider contract ───────────────────────────────────────────

/**
 * Master Plan §10's provider contract, implemented verbatim:
 *   detectFace(frame): DetectionResult
 *   assessQuality(frame, detection): QualityResult
 *   checkLiveness(frame, detection): LivenessResult
 *   generateEmbedding(frame, detection): EmbeddingResult
 *   verify(embeddingA, embeddingB): VerificationResult
 *   health(): HealthResult
 *
 * Every method is async (`Promise<...>`) — a real provider (`DeepFaceProvider`,
 * Phase 5/6) necessarily makes a network call; `MockProvider` (this phase)
 * resolves synchronously-fast promises so callers never need to special-case
 * which provider they hold.
 */
export interface BiometricProvider {
  /** Raw face detection over an entire frame — reports what was found,
   * including zero or many. Never fails closed itself (see
   * `ResolvedFaceDetection`'s doc comment) — may throw `BiometricProviderError`
   * only for `malformed_image` / `provider_unavailable` / `timeout`. */
  detectFace(frame: BiometricFrame): Promise<DetectionResult>;

  /** Quality assessment of one already-resolved detection. */
  assessQuality(frame: BiometricFrame, detection: ResolvedFaceDetection): Promise<QualityResult>;

  /** Liveness/anti-spoofing classification of one already-resolved detection. */
  checkLiveness(frame: BiometricFrame, detection: ResolvedFaceDetection): Promise<LivenessResult>;

  /** Embedding generation for one already-resolved detection. */
  generateEmbedding(frame: BiometricFrame, detection: ResolvedFaceDetection): Promise<EmbeddingResult>;

  /** Distance + the provider's own threshold/verdict between two embeddings.
   * Never itself a Neozy authorization/attendance decision (Master Plan §5/§7/§10). */
  verify(embeddingA: BiometricEmbeddingVector, embeddingB: BiometricEmbeddingVector): Promise<VerificationResult>;

  /** Provider-specific readiness signal — never throws; a down/unreachable
   * provider is reported via `available: false`, not an exception, so a
   * caller can check this before attempting any other call (Master Plan
   * §13: "health()/readiness short-circuits this before even attempting
   * inference when known-down"). */
  health(): Promise<HealthResult>;
}
