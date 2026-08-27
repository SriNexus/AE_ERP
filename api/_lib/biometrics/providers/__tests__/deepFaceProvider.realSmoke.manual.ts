/**
 * DeepFaceProvider — REAL integration smoke test, Face Attendance + DeepFace
 * Master Plan Phase 5.
 *
 * Deliberately named *without* a `.test.ts` suffix so it is never picked up
 * by `vitest.api.config.ts`'s `include: ['api/**\/*.test.ts']` glob (or any
 * routine `npm test` run) — this is a MANUAL, deliberately-invoked smoke
 * check against the real, running `biometric-service/` Python process, not
 * a suite that should run on every CI push (Master Plan §20 item 11: "Not
 * part of the Vitest suite... Explicitly not run on every CI push").
 *
 * Preconditions to run this file (NOT automated — a human/agent starts the
 * service first):
 *   cd biometric-service
 *   PYTHONUTF8=1 DEEPFACE_RECOGNITION_MODEL=ArcFace DEEPFACE_DETECTOR_BACKEND=yunet \
 *     DEEPFACE_ANTI_SPOOFING_ENABLED=true DEEPFACE_SERVICE_AUTH_TOKEN=phase5-smoke-test-token \
 *     .venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8091
 * Then, from the repo root:
 *   npx vitest run --config vitest.api.config.ts api/_lib/biometrics/providers/__tests__/deepFaceProvider.realSmoke.manual.ts
 *
 * Every fixture used below is `biometric-service/tests/fixtures/*.jpg` —
 * DeepFace's own public test images / synthetic Phase 1 fixtures. No real
 * Neozy employee/customer biometric data is used (matching every prior
 * phase's own non-negotiable data-safety rule).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BiometricProviderError } from '../../../../../src/lib/biometrics/providers/BiometricProvider';
import { DeepFaceProvider } from '../DeepFaceProvider';

const SERVICE_URL = process.env.DEEPFACE_SMOKE_SERVICE_URL || 'http://127.0.0.1:8091';
const AUTH_TOKEN = process.env.DEEPFACE_SMOKE_AUTH_TOKEN || 'phase5-smoke-test-token';
const FIXTURES_DIR = join(__dirname, '..', '..', '..', '..', '..', 'biometric-service', 'tests', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

const timings: Record<string, number> = {};

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  timings[label] = Math.round((performance.now() - start) * 100) / 100;
  return result;
}

function newProvider(): DeepFaceProvider {
  return new DeepFaceProvider({
    serviceUrl: SERVICE_URL,
    authToken: AUTH_TOKEN,
    requestTimeoutMs: 30000,
  });
}

describe('DeepFaceProvider — REAL biometric-service integration smoke test', () => {
  it('1. health() reaches the real Python service and reports the locked model/detector config', async () => {
    const provider = newProvider();
    const result = await timed('health', () => provider.health());
    expect(result.available).toBe(true);
    expect(result.modelName).toBe('ArcFace');
    expect(result.detectorBackend).toBe('yunet');
  });

  it('2. detectFace() finds exactly one real face in a genuine photo fixture', async () => {
    const provider = newProvider();
    const frame = loadFixture('face_a_1.jpg');
    const result = await timed('detectFace', () => provider.detectFace(frame));
    expect(result.faceCount).toBe(1);
    expect(result.faces[0].confidence).toBeGreaterThan(0);
  });

  it('2b. detectFace() correctly reports zero faces on the no-face fixture', async () => {
    const provider = newProvider();
    const frame = loadFixture('no_face.jpg');
    const result = await provider.detectFace(frame);
    expect(result.faceCount).toBe(0);
  });

  it('2c. detectFace() correctly reports multiple faces on the multi-face fixture', async () => {
    const provider = newProvider();
    const frame = loadFixture('multi_face.jpg');
    const result = await provider.detectFace(frame);
    expect(result.faceCount).toBeGreaterThan(1);
  });

  it('3. assessQuality() passes on a genuine, well-lit photo fixture', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const result = await timed('assessQuality', () => provider.assessQuality(loadFixture('face_a_1.jpg'), detection));
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('4. checkLiveness() classifies a genuine photo as live with a real antispoof score', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const result = await timed('checkLiveness', () => provider.checkLiveness(loadFixture('face_a_1.jpg'), detection));
    expect(result.isLive).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('5. generateEmbedding() returns the expected 512-dimensional ArcFace vector, all finite values', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const result = await timed('generateEmbedding', () => provider.generateEmbedding(loadFixture('face_a_1.jpg'), detection));
    expect(result.embedding).toHaveLength(512);
    expect(result.modelName).toBe('ArcFace');
    expect(result.modelVersion).toBe('0.0.100');
    for (const v of result.embedding) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('6. verify() confirms a genuine same-person pair (face_a_1 vs face_a_2)', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const embA = await provider.generateEmbedding(loadFixture('face_a_1.jpg'), detection);
    const embA2 = await provider.generateEmbedding(loadFixture('face_a_2.jpg'), detection);
    const result = await timed('verify_samePerson', () => provider.verify(embA.embedding, embA2.embedding));
    expect(result.distance).toBeLessThanOrEqual(result.threshold);
    expect(result.verified).toBe(true);
    expect(result.distanceMetric).toBeTruthy();
  });

  it('7. verify() rejects a genuine different-person pair (face_a_1 vs face_b_1)', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const embA = await provider.generateEmbedding(loadFixture('face_a_1.jpg'), detection);
    const embB = await provider.generateEmbedding(loadFixture('face_b_1.jpg'), detection);
    const result = await timed('verify_differentPerson', () => provider.verify(embA.embedding, embB.embedding));
    expect(result.distance).toBeGreaterThan(result.threshold);
    expect(result.verified).toBe(false);
  });

  it('8a. real provider errors are translated correctly: malformed image (zero-byte fixture)', async () => {
    const provider = newProvider();
    await expect(provider.detectFace(loadFixture('zero_byte.jpg'))).rejects.toMatchObject({ reason: 'malformed_image' });
  });

  it('8b. real provider errors are translated correctly: malformed image (non-image bytes fixture)', async () => {
    const provider = newProvider();
    await expect(provider.detectFace(loadFixture('malformed.jpg'))).rejects.toMatchObject({ reason: 'malformed_image' });
  });

  it('8c. real provider errors are translated correctly: no-face rejected by generateEmbedding (real internal re-detection)', async () => {
    const provider = newProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const error = await provider.generateEmbedding(loadFixture('no_face.jpg'), detection).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BiometricProviderError);
    // Real evidence for this file's own documented finding: /represent's
    // internal re-detection surfaces no_face_detected, which this class
    // maps to provider_unavailable (no dedicated Phase 2 reason exists for
    // "unexpected post-Detect no-face") — proven against the real service,
    // not assumed from reading the Python source alone.
    expect((error as BiometricProviderError).reason).toBe('provider_unavailable');
  });

  it('8d. real authentication failure is translated to provider_unavailable, never a silent bypass', async () => {
    const provider = new DeepFaceProvider({ serviceUrl: SERVICE_URL, authToken: 'wrong-token', requestTimeoutMs: 10000 });
    await expect(provider.detectFace(loadFixture('face_a_1.jpg'))).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('9. prints recorded real-provider latencies for the completion record (not an assertion — informational)', () => {
    // eslint-disable-next-line no-console
    console.log('DEEPFACE_SMOKE_TIMINGS_MS', JSON.stringify(timings));
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  });
});
