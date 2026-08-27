/**
 * DeepFaceProvider — Face Attendance + DeepFace Master Plan, Phase 5.
 * Conformance + fail-closed tests against a MOCKED HTTP layer (Master Plan
 * §20 item 17 shape, mirrored from `mockBiometricProvider.test.ts`'s own
 * conformance suite) — no real network call, no real Python process
 * required for this test tier (that is the separate, real smoke test,
 * §25 Phase 5's own "manual local run against Phase 1's actual running
 * service" requirement, run manually against `biometric-service/`).
 *
 * `fetchImpl` is injected via `DeepFaceProviderConfig` — the same
 * adapter-injection convention this codebase already established for
 * `BiometricReferenceStore`/`BiometricAuditWriter` (Phase 4).
 */

import { describe, it, expect, vi } from 'vitest';
import { BiometricProviderError, type BiometricProvider } from '../../../../../src/lib/biometrics/providers/BiometricProvider';
import { DeepFaceProvider } from '../DeepFaceProvider';

function fakeFrame(bytes: number[] = [1, 2, 3, 4]): Uint8Array {
  return new Uint8Array(bytes);
}

const DETECTION = { x: 0, y: 0, width: 100, height: 100, confidence: 0.9 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Records every call made to it, and dispatches by `path` to a per-test
 * handler map — the request/response shape a real `fetch` call would see. */
function makeFetchSpy(handlers: Record<string, (init: RequestInit, url: string) => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    for (const [path, handler] of Object.entries(handlers)) {
      if (urlStr.includes(path)) return handler(init, urlStr);
    }
    throw new Error(`Unhandled fetch path in test: ${urlStr}`);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function provider(handlers: Record<string, (init: RequestInit, url: string) => Response | Promise<Response>>, extra: Partial<{ authToken: string }> = {}) {
  const spy = makeFetchSpy(handlers);
  const p = new DeepFaceProvider({
    serviceUrl: 'http://biometric.internal:8090',
    authToken: extra.authToken ?? 'test-token',
    requestTimeoutMs: 5000,
    fetchImpl: spy.impl,
  });
  return { provider: p, calls: spy.calls };
}

describe('DeepFaceProvider — detectFace', () => {
  it('maps a successful single-face detection to DetectionResult', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(200, {
        status: 'ok',
        face_count: 1,
        faces: [{ x: 10, y: 20, w: 100, h: 120, confidence: 0.97 }],
        detector_backend: 'yunet',
      }),
    });
    const result = await p.detectFace(fakeFrame());
    expect(result).toEqual({
      faceCount: 1,
      faces: [{ x: 10, y: 20, width: 100, height: 120, confidence: 0.97 }],
    });
  });

  it('maps a zero-face detection without treating it as an error', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(200, { status: 'ok', face_count: 0, faces: [], detector_backend: 'yunet' }),
    });
    const result = await p.detectFace(fakeFrame());
    expect(result.faceCount).toBe(0);
    expect(result.faces).toEqual([]);
  });

  it('maps a multiple-face detection', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(200, {
        status: 'ok',
        face_count: 2,
        faces: [
          { x: 0, y: 0, w: 10, h: 10, confidence: 0.9 },
          { x: 50, y: 50, w: 10, h: 10, confidence: 0.9 },
        ],
        detector_backend: 'yunet',
      }),
    });
    const result = await p.detectFace(fakeFrame());
    expect(result.faceCount).toBe(2);
  });

  it('sends the frame as multipart/form-data under the "image" field, never a JSON body with an identity field', async () => {
    const { provider: p, calls } = provider({
      '/detect': () => jsonResponse(200, { status: 'ok', face_count: 1, faces: [{ x: 0, y: 0, w: 1, h: 1, confidence: 1 }], detector_backend: 'yunet' }),
    });
    await p.detectFace(fakeFrame());
    expect(calls).toHaveLength(1);
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(Array.from(form.keys())).toEqual(['image']);
  });

  it('sends the configured bearer token as an Authorization header', async () => {
    const { provider: p, calls } = provider(
      { '/detect': () => jsonResponse(200, { status: 'ok', face_count: 0, faces: [], detector_backend: 'yunet' }) },
      { authToken: 'super-secret-token' },
    );
    await p.detectFace(fakeFrame());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer super-secret-token');
  });
});

describe('DeepFaceProvider — assessQuality', () => {
  it('maps a passing quality result', async () => {
    const { provider: p } = provider({
      '/quality': () => jsonResponse(200, { status: 'ok', passed: true, reasons: [], face: { x: 0, y: 0, w: 1, h: 1, confidence: 1 } }),
    });
    const result = await p.assessQuality(fakeFrame(), DETECTION);
    expect(result).toEqual({ passed: true, reasons: [] });
  });

  it('maps a failing quality result with specific reasons, including the Phase 5 invalid_crop compatibility addition', async () => {
    const { provider: p } = provider({
      '/quality': () => jsonResponse(200, {
        status: 'ok',
        passed: false,
        reasons: ['too_dark', 'invalid_crop'],
        face: { x: 0, y: 0, w: 1, h: 1, confidence: 1 },
      }),
    });
    const result = await p.assessQuality(fakeFrame(), DETECTION);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['too_dark', 'invalid_crop']);
  });

  it('filters out an unrecognized reason string rather than crashing or inventing a new type member', async () => {
    const { provider: p } = provider({
      '/quality': () => jsonResponse(200, { status: 'ok', passed: false, reasons: ['some_future_reason_not_yet_known'], face: { x: 0, y: 0, w: 1, h: 1, confidence: 1 } }),
    });
    const result = await p.assessQuality(fakeFrame(), DETECTION);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});

describe('DeepFaceProvider — checkLiveness', () => {
  it('maps a live result with a numeric antispoof score', async () => {
    const { provider: p } = provider({
      '/liveness': () => jsonResponse(200, { status: 'ok', is_live: true, antispoof_score: 0.94, model_used: 'Fasnet' }),
    });
    const result = await p.checkLiveness(fakeFrame(), DETECTION);
    expect(result).toEqual({ isLive: true, confidence: 0.94 });
  });

  it('maps a spoof/non-live result', async () => {
    const { provider: p } = provider({
      '/liveness': () => jsonResponse(200, { status: 'ok', is_live: false, antispoof_score: 0.1, model_used: 'Fasnet' }),
    });
    const result = await p.checkLiveness(fakeFrame(), DETECTION);
    expect(result.isLive).toBe(false);
  });

  it('maps a null antispoof_score (anti-spoofing disabled) to a null confidence, not zero', async () => {
    const { provider: p } = provider({
      '/liveness': () => jsonResponse(200, { status: 'ok', is_live: true, antispoof_score: null, model_used: 'disabled' }),
    });
    const result = await p.checkLiveness(fakeFrame(), DETECTION);
    expect(result.confidence).toBeNull();
  });
});

describe('DeepFaceProvider — generateEmbedding', () => {
  it('maps a successful embedding response, using deepface_version as modelVersion', async () => {
    const { provider: p } = provider({
      '/represent': () => jsonResponse(200, {
        status: 'ok',
        embedding: [0.1, 0.2, 0.3],
        embedding_dim: 3,
        model_name: 'ArcFace',
        detector_backend: 'yunet',
        deepface_version: '0.0.100',
      }),
    });
    const result = await p.generateEmbedding(fakeFrame(), DETECTION);
    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], modelName: 'ArcFace', modelVersion: '0.0.100' });
  });

  it('fails closed with provider_unavailable when embedding_dim disagrees with the actual vector length', async () => {
    const { provider: p } = provider({
      '/represent': () => jsonResponse(200, {
        status: 'ok', embedding: [0.1, 0.2, 0.3], embedding_dim: 512, model_name: 'ArcFace', detector_backend: 'yunet', deepface_version: '0.0.100',
      }),
    });
    await expect(p.generateEmbedding(fakeFrame(), DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('fails closed with provider_unavailable on an empty embedding array', async () => {
    const { provider: p } = provider({
      '/represent': () => jsonResponse(200, {
        status: 'ok', embedding: [], embedding_dim: 0, model_name: 'ArcFace', detector_backend: 'yunet', deepface_version: '0.0.100',
      }),
    });
    await expect(p.generateEmbedding(fakeFrame(), DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('fails closed with provider_unavailable when the embedding contains a NaN/Infinity value', async () => {
    const { provider: p } = provider({
      '/represent': () => jsonResponse(200, {
        status: 'ok', embedding: [0.1, Number.NaN, 0.3], embedding_dim: 3, model_name: 'ArcFace', detector_backend: 'yunet', deepface_version: '0.0.100',
      }),
    });
    await expect(p.generateEmbedding(fakeFrame(), DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });

    const { provider: p2 } = provider({
      '/represent': () => jsonResponse(200, {
        status: 'ok', embedding: [0.1, Number.POSITIVE_INFINITY, 0.3], embedding_dim: 3, model_name: 'ArcFace', detector_backend: 'yunet', deepface_version: '0.0.100',
      }),
    });
    await expect(p2.generateEmbedding(fakeFrame(), DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });
});

describe('DeepFaceProvider — verify', () => {
  it('sends embeddings as a JSON body, not multipart, and maps the response', async () => {
    const { provider: p, calls } = provider({
      '/verify': () => jsonResponse(200, {
        status: 'ok', distance: 0.4848, deepface_threshold: 0.68, deepface_verified: true, distance_metric: 'cosine', model_name: 'ArcFace',
      }),
    });
    const result = await p.verify([0.1, 0.2], [0.1, 0.2]);
    expect(result).toEqual({ distance: 0.4848, threshold: 0.68, verified: true, distanceMetric: 'cosine' });
    const init = calls[0].init;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ embedding_a: [0.1, 0.2], embedding_b: [0.1, 0.2] });
  });

  it('maps a genuine mismatch (DeepFace itself reports verified:false)', async () => {
    const { provider: p } = provider({
      '/verify': () => jsonResponse(200, {
        status: 'ok', distance: 0.93, deepface_threshold: 0.68, deepface_verified: false, distance_metric: 'cosine', model_name: 'ArcFace',
      }),
    });
    const result = await p.verify([0, 0], [9, 9]);
    expect(result.verified).toBe(false);
    expect(result.distance).toBeGreaterThan(result.threshold);
  });
});

describe('DeepFaceProvider — health (never throws, calls /readiness not /health)', () => {
  it('reports available:true with model metadata when ready', async () => {
    const { provider: p, calls } = provider({
      '/readiness': () => jsonResponse(200, {
        status: 'ok', ready: true, recognition_model: 'ArcFace', detector_backend: 'yunet', anti_spoofing_enabled: true, deepface_version: '0.0.100', trivial_inference_ms: 5.4,
      }),
    });
    const result = await p.health();
    expect(result).toEqual({ available: true, modelName: 'ArcFace', detectorBackend: 'yunet' });
    expect(calls[0].url).toContain('/readiness');
    expect(calls[0].url).not.toContain('/health"');
  });

  it('reports available:false (not throwing) when the service reports not ready', async () => {
    const { provider: p } = provider({
      '/readiness': () => jsonResponse(200, { status: 'not_ready', ready: false, reason: 'models_not_loaded', detail: 'TimeoutError' }),
    });
    const result = await p.health();
    expect(result.available).toBe(false);
    expect(result.detail).toContain('models_not_loaded');
  });

  it('reports available:false (not throwing) when the network call itself fails', async () => {
    const { provider: p } = provider({
      '/readiness': () => { throw new Error('ECONNREFUSED'); },
    });
    const result = await p.health();
    expect(result.available).toBe(false);
  });
});

describe('DeepFaceProvider — error mapping (fail-closed, never a false success)', () => {
  it('maps a 400 malformed_image response to BiometricProviderError(malformed_image)', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(400, { status: 'error', error_code: 'malformed_image', detail: 'The submitted image could not be decoded.' }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toThrow(BiometricProviderError);
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'malformed_image' });
  });

  it('maps a 400 invalid_request response (the real zero-byte-upload code path) to malformed_image, not the generic fallback', async () => {
    // Real Phase 5 finding: `app/main.py::_read_image_bytes()` raises
    // `invalid_request` for an empty upload, distinct from `decode_image()`'s
    // `malformed_image` for non-empty-but-undecodable bytes — discovered via
    // the real smoke test (`deepFaceProvider.realSmoke.manual.ts`) against
    // the actual zero_byte.jpg fixture, not assumed from reading the Python
    // source. Both are "no usable image" from Neozy's own §15 taxonomy.
    const { provider: p } = provider({
      '/detect': () => jsonResponse(400, { status: 'error', error_code: 'invalid_request', detail: 'No image data was submitted.' }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'malformed_image' });
  });

  it('maps a 401 unauthenticated response to provider_unavailable, never a silent bypass', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(401, { status: 'error', error_code: 'unauthenticated', detail: 'Missing or invalid service credentials.' }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('maps a 500 model_failure response to provider_unavailable', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(500, { status: 'error', error_code: 'model_failure', detail: 'An internal error occurred.' }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('maps an unexpected no_face_detected error from a post-Detect stage (the real Python re-detection quirk) to provider_unavailable rather than inventing a new reason code', async () => {
    const { provider: p } = provider({
      '/represent': () => jsonResponse(422, { status: 'error', error_code: 'no_face_detected', detail: 'No face could be detected in the submitted frame.' }),
    });
    await expect(p.generateEmbedding(fakeFrame(), DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('maps a network-level failure (fetch rejects) to provider_unavailable without leaking the underlying error message', async () => {
    const spy = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:8090 at /some/local/path'); });
    const p = new DeepFaceProvider({ serviceUrl: 'http://x', authToken: 't', fetchImpl: spy as unknown as typeof fetch });
    try {
      await p.detectFace(fakeFrame());
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BiometricProviderError);
      expect((error as BiometricProviderError).reason).toBe('provider_unavailable');
      expect((error as BiometricProviderError).message).not.toContain('10.0.0.5');
      expect((error as BiometricProviderError).message).not.toContain('/some/local/path');
    }
  });

  it('maps an AbortSignal timeout error distinctly as reason "timeout"', async () => {
    const spy = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const p = new DeepFaceProvider({ serviceUrl: 'http://x', authToken: 't', requestTimeoutMs: 10, fetchImpl: spy as unknown as typeof fetch });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('maps an unparseable (non-JSON) response body to provider_unavailable', async () => {
    const { provider: p } = provider({
      '/detect': () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('maps a well-formed-JSON-but-schema-missing-fields success response to provider_unavailable rather than propagating undefined values', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(200, { status: 'ok' }), // missing face_count/faces entirely
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('maps a face_count/faces-array-length mismatch to provider_unavailable (self-consistency check)', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(200, { status: 'ok', face_count: 2, faces: [{ x: 0, y: 0, w: 1, h: 1, confidence: 1 }], detector_backend: 'yunet' }),
    });
    await expect(p.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('a malformed verify response never resolves to a false verification success', async () => {
    const { provider: p } = provider({
      '/verify': () => jsonResponse(200, { status: 'ok', distance: 'not-a-number', deepface_threshold: 0.68, deepface_verified: true, distance_metric: 'cosine', model_name: 'ArcFace' }),
    });
    await expect(p.verify([0], [0])).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });
});

describe('DeepFaceProvider — interface/provider compatibility (same shape as MockProvider\'s own suite)', () => {
  it('is structurally assignable to the BiometricProvider interface', () => {
    const p: BiometricProvider = new DeepFaceProvider({ serviceUrl: 'http://x', fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(p).toBeInstanceOf(DeepFaceProvider);
  });

  it('implements every required method as a callable function', () => {
    const p = new DeepFaceProvider({ serviceUrl: 'http://x', fetchImpl: vi.fn() as unknown as typeof fetch });
    const methods: (keyof BiometricProvider)[] = ['detectFace', 'assessQuality', 'checkLiveness', 'generateEmbedding', 'verify', 'health'];
    for (const method of methods) {
      expect(typeof p[method]).toBe('function');
    }
  });
});

describe('DeepFaceProvider — no raw biometric material ever appears in a thrown error message', () => {
  it('a malformed_image rejection never echoes the submitted frame bytes', async () => {
    const { provider: p } = provider({
      '/detect': () => jsonResponse(400, { status: 'error', error_code: 'malformed_image', detail: 'The submitted image could not be decoded.' }),
    });
    const distinctiveFrame = fakeFrame([222, 173, 190, 239, 1, 2, 3, 4, 5, 6, 7, 8]);
    try {
      await p.detectFace(distinctiveFrame);
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as BiometricProviderError).message;
      expect(message).not.toContain('222');
      expect(message).not.toContain(String(distinctiveFrame));
    }
  });

  it('a malformed verify response rejection never echoes the submitted embeddings', async () => {
    const distinctiveEmbedding = [0.123456789, 0.987654321, 0.111111];
    const { provider: p } = provider({
      '/verify': () => jsonResponse(200, { status: 'ok' }), // missing every required field
    });
    try {
      await p.verify(distinctiveEmbedding, distinctiveEmbedding);
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as BiometricProviderError).message;
      expect(message).not.toContain('0.123456789');
    }
  });
});
