/**
 * DeepFaceProvider — Face Attendance + DeepFace Master Plan, Phase 5.
 *
 * A thin, typed HTTP client implementing the Phase 2 `BiometricProvider`
 * interface (`src/lib/biometrics/providers/BiometricProvider.ts`) against
 * the real, already-built Phase 1 Python service (`biometric-service/`).
 * Contains ZERO business/authorization logic — every method's job is
 * exactly "translate one HTTP round-trip," nothing more (Master Plan §10:
 * "Contains zero business/authorization logic — it is a thin, typed HTTP
 * client").
 *
 * Deliberately placed under `api/_lib/biometrics/providers/` (Node-only),
 * NOT alongside `MockProvider.ts` under `src/lib/biometrics/providers/`
 * (importable by both Node and the Vite browser bundle) — a deliberate
 * deviation from where the master plan's own prose loosely suggested this
 * file might live, justified by the exact same reasoning Phase 4's
 * completion record already established for the `src/lib` (pure) vs.
 * `api/_lib` (Node-only, Admin-SDK-adjacent) split: this class reads
 * `DEEPFACE_SERVICE_URL`/`DEEPFACE_SERVICE_AUTH_TOKEN` from `process.env`
 * and must never be reachable from the client bundle (Phase 5's own
 * instruction: "Never expose the DeepFace service URL/token through
 * VITE_* variables or browser code"). It still only ever implements the
 * Phase 2 interface — `src/lib/biometrics/providers/BiometricProvider.ts`
 * itself is untouched except for one additive compatibility fix (see that
 * file's `QualityFailureReason` doc comment).
 *
 * Real Phase 1 service contract this class targets (verified by reading
 * `biometric-service/app/{main,schemas,provider,errors,auth}.py` directly,
 * not assumed from Master Plan §13's original draft):
 *   - `POST /detect|/quality|/liveness|/represent` — multipart/form-data,
 *     one `image` file field, raw bytes, no Neozy identity field of any kind.
 *   - `POST /verify` — JSON body `{embedding_a, embedding_b}` (NOT frames —
 *     verification always operates on two already-generated embeddings).
 *   - `GET /health` / `GET /readiness` — no body, no auth required by the
 *     Phase 1 service itself (see `app/main.py` — these two routes carry no
 *     `Depends(require_service_auth)`); this class still sends the bearer
 *     token on every call for forward-compatibility, harmlessly ignored.
 *   - Every error response is `{status:"error", error_code, detail}` with
 *     an explicit HTTP status (400/401/422/500/503/504) — never a bare
 *     stack trace (`biometric-service/app/errors.py`).
 *   - Auth: `Authorization: Bearer <DEEPFACE_SERVICE_AUTH_TOKEN>` — the
 *     Phase 1 shared-secret bearer-token mechanism, explicitly documented
 *     there as transitional pending a Phase 12 infra decision (private
 *     network vs. rotated token). This class implements exactly that
 *     mechanism, invents no second one.
 *
 * Real Phase 1 architectural quirk this class works around defensively,
 * without redesigning either side (see the completion record for the full
 * writeup): `/quality`, `/liveness`, and `/represent` each independently
 * re-run their OWN face detection internally (`detect_faces(...,
 * require_single=True)`) rather than accepting a pre-resolved bounding box
 * — unlike Phase 2's own interface doc comment's assumption ("a provider
 * never re-runs its own multi-face rejection inside these three methods").
 * Since every pipeline call within one verification/enrollment attempt
 * passes the SAME immutable frame Detect already confirmed has exactly one
 * face, Python's internal re-detection is expected to agree every time —
 * this class therefore still sends `frame` (not `detection`) to every
 * image endpoint, and treats the theoretical case where a later stage's
 * re-detection disagrees (`no_face_detected`/`multiple_faces_detected` from
 * `/quality`, `/liveness`, or `/represent`, which Phase 2's
 * `BiometricProviderFailureReason` union has no dedicated slot for) as
 * `provider_unavailable` — fail-closed, never silently dropped, never
 * invented as a new reason code on an already-locked Phase 2 type for what
 * should be an exceptionally rare, anomalous outcome rather than a normal
 * control-flow path.
 */

import {
  BiometricProviderError,
  type BiometricEmbeddingVector,
  type BiometricFrame,
  type BiometricProvider,
  type DetectionResult,
  type EmbeddingResult,
  type FaceBoxResult,
  type HealthResult,
  type LivenessResult,
  type QualityFailureReason,
  type QualityResult,
  type ResolvedFaceDetection,
  type VerificationResult,
} from '../../../../src/lib/biometrics/providers/BiometricProvider.js';

export interface DeepFaceProviderConfig {
  /** `DEEPFACE_SERVICE_URL` — base URL of the Phase 1 Python service, no
   * trailing slash required (normalized internally). */
  serviceUrl: string;
  /** `DEEPFACE_SERVICE_AUTH_TOKEN` — the Phase 1 transitional shared-secret
   * bearer token (§13). Optional here only because the Python service's own
   * `require_service_auth` is the actual enforcement point — an unset token
   * against a real deployed service simply fails every authenticated call
   * closed with `provider_unavailable` (mapped from its 401), never a
   * silent bypass. */
  authToken?: string;
  /** `DEEPFACE_REQUEST_TIMEOUT_MS` — client-side timeout per HTTP call.
   * Default below is a deliberately provisional placeholder (this class's
   * own honest equivalent of the Python service's own un-locked
   * `DEEPFACE_INFERENCE_TIMEOUT_SECONDS` default) — Phase 11's real
   * benchmark is what tunes this from measured evidence, not this file. */
  requestTimeoutMs?: number;
  /** Test-only injection point for a fake `fetch` implementation — never
   * used by `providerConfig.ts`'s real construction path. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15000;

const KNOWN_QUALITY_REASONS: ReadonlySet<string> = new Set<QualityFailureReason>([
  'face_too_small',
  'low_detector_confidence',
  'too_dark',
  'too_bright',
  'blurry',
  'occluded',
  'invalid_crop',
]);

function providerUnavailable(detail: string): BiometricProviderError {
  return new BiometricProviderError('provider_unavailable', detail);
}

function malformedImage(detail: string): BiometricProviderError {
  return new BiometricProviderError('malformed_image', detail);
}

function timedOut(detail: string): BiometricProviderError {
  return new BiometricProviderError('timeout', detail);
}

/** Maps one of Phase 1's own `ErrorCode` values (`biometric-service/app/errors.py`)
 * onto Phase 2's three-member `BiometricProviderFailureReason` union. Never
 * throws itself — always returns a constructed `BiometricProviderError`. */
function mapServiceErrorCode(errorCode: string, detail: string): BiometricProviderError {
  switch (errorCode) {
    case 'malformed_image':
    // Real-evidence Phase 5 finding (discovered via the real smoke test
    // against `biometric-service/`, not assumed from reading source):
    // `app/main.py::_read_image_bytes()` raises `invalid_request` — a
    // DIFFERENT error code than `malformed_image` — for a zero-byte/empty
    // upload specifically, before `decode_image()` (which raises
    // `malformed_image`) ever runs. In this service's actual, complete
    // error taxonomy `invalid_request` has exactly one real trigger reachable
    // from this client (an empty image upload; the other, an empty
    // `VerifyRequest` embedding array, can never happen here since this
    // class only ever sends embeddings it already validated itself). Both
    // are "no usable image/input was submitted" from Neozy's own §15
    // taxonomy's point of view, so both map to the same
    // `malformed_image` pipeline reason — never left to fall through to
    // the generic `provider_unavailable` case below.
    case 'invalid_request':
      return malformedImage(detail);
    case 'timeout':
      return timedOut(detail);
    // no_face_detected / multiple_faces_detected: only ever surprising here
    // — see this file's own doc comment. liveness_failed / model_failure /
    // unauthenticated / not_ready / anything unrecognized: all collapse to
    // provider_unavailable, matching Master Plan §15's "Provider
    // unavailable / model failure / process crash | Any provider call |
    // provider_unavailable, reject" row.
    default:
      return providerUnavailable(detail || `The provider returned an unexpected error (${errorCode}).`);
  }
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw providerUnavailable(`The provider response was missing a valid numeric '${field}' field.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw providerUnavailable(`The provider response was missing a valid '${field}' field.`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw providerUnavailable(`The provider response was missing a valid boolean '${field}' field.`);
  }
  return value;
}

/** Validates an embedding vector defensively — this is the ONE place a real
 * (never a mock) provider's output can be malformed in ways nothing earlier
 * in this codebase had to guard against: a non-array, an empty array, a
 * reported dimension that disagrees with the actual array length, or a
 * NaN/Infinity component (a real, if rare, symptom of a model-layer
 * failure). Every case fails closed as `provider_unavailable` — never lets
 * a corrupted embedding reach the pipeline's Verify stage. */
function assertEmbeddingVector(embedding: unknown, reportedDim: unknown): BiometricEmbeddingVector {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw providerUnavailable('The provider returned an empty or invalid embedding.');
  }
  if (typeof reportedDim === 'number' && reportedDim !== embedding.length) {
    throw providerUnavailable('The provider reported an embedding dimension that does not match the returned vector length.');
  }
  for (const value of embedding) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw providerUnavailable('The provider returned a non-finite embedding value.');
    }
  }
  return embedding as BiometricEmbeddingVector;
}

function mapQualityReasons(reasons: unknown): QualityFailureReason[] {
  if (!Array.isArray(reasons)) {
    throw providerUnavailable("The provider response was missing a valid 'reasons' array.");
  }
  // Filter, never fabricate or crash on, a reason string outside the known
  // allowlist — `passed` itself (asserted separately) is what the pipeline's
  // fail-closed decision actually keys on; an unrecognized reason string is
  // dropped rather than invented as a new typed member here or trusted
  // as-is without validation.
  return reasons.filter((r): r is QualityFailureReason => typeof r === 'string' && KNOWN_QUALITY_REASONS.has(r));
}

function mapFaceBox(raw: unknown): FaceBoxResult {
  if (typeof raw !== 'object' || raw === null) {
    throw providerUnavailable('The provider response contained a malformed face box.');
  }
  const r = raw as Record<string, unknown>;
  return {
    x: assertFiniteNumber(r.x, 'x'),
    y: assertFiniteNumber(r.y, 'y'),
    width: assertFiniteNumber(r.w, 'w'),
    height: assertFiniteNumber(r.h, 'h'),
    confidence: assertFiniteNumber(r.confidence, 'confidence'),
  };
}

export class DeepFaceProvider implements BiometricProvider {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DeepFaceProviderConfig) {
    this.baseUrl = config.serviceUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
    this.timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private authHeaders(): Record<string, string> {
    return this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
  }

  /** POSTs `frame` as multipart/form-data under the `image` field — the
   * exact shape every Phase 1 image endpoint expects (`UploadFile = File(...)`
   * in `app/main.py`). Never sets a Content-Type header manually — `fetch`
   * derives the correct multipart boundary from the `FormData` body itself. */
  private async postImage(path: string, frame: BiometricFrame): Promise<Record<string, unknown>> {
    const form = new FormData();
    // BiometricFrame is opaque bytes only (Phase 2's own invariant) — no
    // identity/tenant field is ever attached here. Re-wrapped via the
    // ArrayLike constructor overload (not `frame` directly) purely to
    // satisfy `Blob`'s `ArrayBufferView<ArrayBuffer>` typing — `Uint8Array`
    // is generically parameterized over `ArrayBufferLike` and TS cannot
    // statically prove a caller-supplied one isn't backed by a
    // `SharedArrayBuffer`; this copy is a real (cheap, single-frame-sized)
    // byte copy, not a type-only cast.
    form.set('image', new Blob([new Uint8Array(frame)], { type: 'application/octet-stream' }), 'frame.bin');
    return this.send(path, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.send(path, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async send(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw timedOut(`The biometric provider did not respond within ${this.timeoutMs}ms.`);
      }
      // Network failure (connection refused, DNS failure, TLS error, etc.)
      // — the provider could not even be reached, never leaked verbatim
      // (could contain a local hostname/path) into the thrown message.
      throw providerUnavailable('The biometric provider could not be reached.');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw providerUnavailable('The biometric provider returned a response that could not be parsed.');
    }

    if (!response.ok) {
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      const errorCode = typeof b.error_code === 'string' ? b.error_code : 'unknown';
      const detail = typeof b.detail === 'string' ? b.detail : '';
      throw mapServiceErrorCode(errorCode, detail);
    }

    if (typeof body !== 'object' || body === null) {
      throw providerUnavailable('The biometric provider returned a malformed response body.');
    }
    return body as Record<string, unknown>;
  }

  async detectFace(frame: BiometricFrame): Promise<DetectionResult> {
    const body = await this.postImage('/detect', frame);
    const faceCount = assertFiniteNumber(body.face_count, 'face_count');
    if (!Array.isArray(body.faces)) {
      throw providerUnavailable("The provider response was missing a valid 'faces' array.");
    }
    if (body.faces.length !== faceCount) {
      throw providerUnavailable('The provider reported a face count that does not match the returned face list.');
    }
    return { faceCount, faces: body.faces.map(mapFaceBox) };
  }

  async assessQuality(frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<QualityResult> {
    const body = await this.postImage('/quality', frame);
    return {
      passed: assertBoolean(body.passed, 'passed'),
      reasons: mapQualityReasons(body.reasons),
    };
  }

  async checkLiveness(frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<LivenessResult> {
    const body = await this.postImage('/liveness', frame);
    const isLive = assertBoolean(body.is_live, 'is_live');
    const confidence = body.antispoof_score === null || body.antispoof_score === undefined
      ? null
      : assertFiniteNumber(body.antispoof_score, 'antispoof_score');
    return { isLive, confidence };
  }

  async generateEmbedding(frame: BiometricFrame, _detection: ResolvedFaceDetection): Promise<EmbeddingResult> {
    const body = await this.postImage('/represent', frame);
    const embedding = assertEmbeddingVector(body.embedding, body.embedding_dim);
    return {
      embedding,
      modelName: assertNonEmptyString(body.model_name, 'model_name'),
      // Master Plan §9's `embeddingModelVersion`: "DeepFace package version
      // + model identifier" — `modelName` already carries the model
      // identifier half; the package version (`deepface_version`) is what
      // this field carries, consistent with Phase 4's own stamping of both.
      modelVersion: assertNonEmptyString(body.deepface_version, 'deepface_version'),
    };
  }

  async verify(
    embeddingA: BiometricEmbeddingVector,
    embeddingB: BiometricEmbeddingVector,
  ): Promise<VerificationResult> {
    const body = await this.postJson('/verify', {
      embedding_a: embeddingA,
      embedding_b: embeddingB,
    });
    return {
      distance: assertFiniteNumber(body.distance, 'distance'),
      threshold: assertFiniteNumber(body.deepface_threshold, 'deepface_threshold'),
      verified: assertBoolean(body.deepface_verified, 'deepface_verified'),
      distanceMetric: assertNonEmptyString(body.distance_metric, 'distance_metric'),
    };
  }

  /** Never throws (Phase 2's own interface contract for `health()`) — calls
   * `/readiness`, not `/health`, per Phase 5's own instruction ("implement
   * health() against /readiness"): `/health` is mere process-liveness,
   * `/readiness` is the one that actually confirms models are loaded and a
   * trivial inference call succeeds (`biometric-service/app/main.py`). */
  async health(): Promise<HealthResult> {
    try {
      const body = await this.send('/readiness', { method: 'GET', headers: this.authHeaders() });
      const ready = body.ready === true;
      if (!ready) {
        const reason = typeof body.reason === 'string' ? body.reason : 'not_ready';
        const detail = typeof body.detail === 'string' ? body.detail : undefined;
        return { available: false, detail: detail ? `${reason}: ${detail}` : reason };
      }
      return {
        available: true,
        modelName: typeof body.recognition_model === 'string' ? body.recognition_model : undefined,
        detectorBackend: typeof body.detector_backend === 'string' ? body.detector_backend : undefined,
      };
    } catch (error) {
      const detail = error instanceof BiometricProviderError ? error.message : 'The biometric provider health check failed.';
      return { available: false, detail };
    }
  }
}
