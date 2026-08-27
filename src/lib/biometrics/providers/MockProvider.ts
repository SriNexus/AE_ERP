/**
 * MockProvider — Face Attendance + DeepFace Master Plan, Phase 2.
 *
 * Pure TypeScript, zero network calls, deterministic (Master Plan §10:
 * "pure TypeScript, zero network calls, deterministic. Every method is
 * driven by test-supplied fixtures/flags"). Fully implements
 * `BiometricProvider` so the remaining Neozy pipeline (Phase 4 onward) can
 * be developed and tested without DeepFace, a Python runtime, model
 * weights, camera hardware, or production infrastructure.
 *
 * Default (no config) behavior is a stable, deterministic "happy path" —
 * one face, good quality, live, a fixed embedding, a real (not canned)
 * distance computation between whatever two embeddings `verify()` is given.
 * Every method accepts an explicit override (a fixed result) or failure
 * injection (a `BiometricProviderError`) via the constructor config, so any
 * Master Plan §15 scenario is constructible on demand — this is what makes
 * the "fail-closed" and "every configurable outcome" Phase 2 requirements
 * testable without inventing a second mocking mechanism per test file.
 *
 * Security note (Phase 2 requirement: "no trusted identity can be forged
 * through arbitrary provider input"): every method here operates only on
 * `BiometricFrame` (opaque bytes) / `BiometricEmbeddingVector` (a plain
 * number array) — neither carries, nor is ever inspected for, an identity
 * field. Overriding a result via config is a TEST calling its own
 * constructor with its own fixture, not "caller input" in the sense of an
 * untrusted request payload — no method here ever reads a value out of
 * `frame`/`embeddingA`/`embeddingB` and treats it as an identity/company/
 * tenant claim. See `src/lib/__tests__/mockBiometricProvider.test.ts`.
 */

import type {
  BiometricEmbeddingVector,
  BiometricFrame,
  BiometricProvider,
  BiometricProviderError,
  DetectionResult,
  EmbeddingResult,
  HealthResult,
  LivenessResult,
  QualityResult,
  ResolvedFaceDetection,
  VerificationResult,
} from './BiometricProvider';

const DEFAULT_DETECTION_RESULT: DetectionResult = {
  faceCount: 1,
  faces: [{ x: 100, y: 100, width: 200, height: 200, confidence: 0.98 }],
};

const DEFAULT_QUALITY_RESULT: QualityResult = { passed: true, reasons: [] };

const DEFAULT_LIVENESS_RESULT: LivenessResult = { isLive: true, confidence: 0.95 };

const DEFAULT_EMBEDDING_VECTOR: BiometricEmbeddingVector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

const DEFAULT_EMBEDDING_RESULT: EmbeddingResult = {
  embedding: DEFAULT_EMBEDDING_VECTOR,
  modelName: 'mock-model',
  modelVersion: 'mock-v1',
};

const DEFAULT_HEALTH_RESULT: HealthResult = {
  available: true,
  modelName: 'mock-model',
  detectorBackend: 'mock-detector',
};

/** Default distance threshold for the built-in (non-overridden) verify()
 * computation — a MockProvider-only convenience value, unrelated to any
 * real recognition model's threshold (Master Plan §6: the real Neozy
 * threshold is locked in Phase 11 from real evidence, never here). */
const DEFAULT_MOCK_VERIFY_THRESHOLD = 0.5;

function euclideanDistance(a: BiometricEmbeddingVector, b: BiometricEmbeddingVector): number {
  const length = Math.max(a.length, b.length);
  let sumSquares = 0;
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumSquares += diff * diff;
  }
  return Math.sqrt(sumSquares);
}

export interface MockProviderResultOverrides {
  detectFace?: DetectionResult;
  assessQuality?: QualityResult;
  checkLiveness?: LivenessResult;
  generateEmbedding?: EmbeddingResult;
  verify?: VerificationResult;
  health?: HealthResult;
}

export interface MockProviderFailureInjection {
  detectFace?: BiometricProviderError;
  assessQuality?: BiometricProviderError;
  checkLiveness?: BiometricProviderError;
  generateEmbedding?: BiometricProviderError;
  verify?: BiometricProviderError;
  health?: BiometricProviderError;
}

export interface MockProviderConfig {
  /** Fixed results to return instead of the deterministic default. */
  results?: MockProviderResultOverrides;
  /** Throw this `BiometricProviderError` instead of returning a result —
   * for constructing the malformed_image/provider_unavailable/timeout
   * scenarios (Master Plan §15). Checked before `results` for the same
   * method, so a test can never accidentally configure both and get an
   * ambiguous outcome. */
  failures?: MockProviderFailureInjection;
  /** Threshold used by the built-in (non-overridden) verify() distance
   * computation. Defaults to `DEFAULT_MOCK_VERIFY_THRESHOLD`. */
  verifyThreshold?: number;
}

export class MockProvider implements BiometricProvider {
  private readonly results: MockProviderResultOverrides;
  private readonly failures: MockProviderFailureInjection;
  private readonly verifyThreshold: number;

  constructor(config: MockProviderConfig = {}) {
    this.results = config.results ?? {};
    this.failures = config.failures ?? {};
    this.verifyThreshold = config.verifyThreshold ?? DEFAULT_MOCK_VERIFY_THRESHOLD;
  }

  async detectFace(_frame: BiometricFrame): Promise<DetectionResult> {
    if (this.failures.detectFace) throw this.failures.detectFace;
    return this.results.detectFace ?? DEFAULT_DETECTION_RESULT;
  }

  async assessQuality(_frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<QualityResult> {
    if (this.failures.assessQuality) throw this.failures.assessQuality;
    return this.results.assessQuality ?? DEFAULT_QUALITY_RESULT;
  }

  async checkLiveness(_frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<LivenessResult> {
    if (this.failures.checkLiveness) throw this.failures.checkLiveness;
    return this.results.checkLiveness ?? DEFAULT_LIVENESS_RESULT;
  }

  async generateEmbedding(_frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<EmbeddingResult> {
    if (this.failures.generateEmbedding) throw this.failures.generateEmbedding;
    return this.results.generateEmbedding ?? DEFAULT_EMBEDDING_RESULT;
  }

  async verify(
    embeddingA: BiometricEmbeddingVector,
    embeddingB: BiometricEmbeddingVector,
  ): Promise<VerificationResult> {
    if (this.failures.verify) throw this.failures.verify;
    if (this.results.verify) return this.results.verify;

    // Real (not canned) computation by default — deterministic function of
    // whatever two embeddings the caller actually supplies, so "verification
    // success" / "verification mismatch" are provably a function of input,
    // not a hardcoded stub. See class doc comment.
    const distance = euclideanDistance(embeddingA, embeddingB);
    return {
      distance,
      threshold: this.verifyThreshold,
      verified: distance <= this.verifyThreshold,
      distanceMetric: 'euclidean',
    };
  }

  async health(): Promise<HealthResult> {
    if (this.failures.health) throw this.failures.health;
    return this.results.health ?? DEFAULT_HEALTH_RESULT;
  }
}
