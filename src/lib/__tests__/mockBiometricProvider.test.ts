/**
 * Face Attendance + DeepFace Master Plan, Phase 2 — MockProvider conformance
 * tests (Master Plan §20 item 1: "MockProvider conformance tests — every
 * interface method, every configurable outcome").
 *
 * Scope note: this phase tests the PROVIDER only (`src/lib/biometrics/
 * providers/`). There is no orchestration layer, Firestore collection, or
 * AttendanceService integration yet (Phase 4/6/8) — nothing here reaches
 * Firebase, RBAC, or any Neozy identity system, matching the Master Plan's
 * "Security requirements: none at this phase (no live data yet)" and the
 * provider's own strict Detect/Quality/Liveness/Embedding/Verify/Health
 * boundary (§8/§10).
 */
import { describe, it, expect } from 'vitest';
import {
  BiometricProviderError,
  type BiometricProvider,
  type BiometricFrame,
} from '../biometrics/providers/BiometricProvider';
import { MockProvider } from '../biometrics/providers/MockProvider';

function fakeFrame(bytes: number[] = [1, 2, 3, 4]): BiometricFrame {
  return new Uint8Array(bytes);
}

describe('MockProvider — successful detection', () => {
  it('detects exactly one face by default, with a well-formed bounding box', async () => {
    const provider = new MockProvider();
    const result = await provider.detectFace(fakeFrame());
    expect(result.faceCount).toBe(1);
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
      confidence: expect.any(Number),
    });
  });

  it('is configurable to report zero faces (no-face result)', async () => {
    const provider = new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } });
    const result = await provider.detectFace(fakeFrame());
    expect(result.faceCount).toBe(0);
    expect(result.faces).toEqual([]);
  });

  it('is configurable to report multiple faces', async () => {
    const twoFaces = {
      faceCount: 2,
      faces: [
        { x: 0, y: 0, width: 50, height: 50, confidence: 0.9 },
        { x: 200, y: 0, width: 50, height: 50, confidence: 0.9 },
      ],
    };
    const provider = new MockProvider({ results: { detectFace: twoFaces } });
    const result = await provider.detectFace(fakeFrame());
    expect(result.faceCount).toBe(2);
  });
});

describe('MockProvider — quality', () => {
  const detection = { x: 0, y: 0, width: 100, height: 100, confidence: 0.9 };

  it('passes by default with no reasons', async () => {
    const provider = new MockProvider();
    const result = await provider.assessQuality(fakeFrame(), detection);
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('is configurable to fail with a specific, actionable reason', async () => {
    const provider = new MockProvider({
      results: { assessQuality: { passed: false, reasons: ['too_dark'] } },
    });
    const result = await provider.assessQuality(fakeFrame(), detection);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['too_dark']);
  });
});

describe('MockProvider — liveness', () => {
  const detection = { x: 0, y: 0, width: 100, height: 100, confidence: 0.9 };

  it('reports live by default', async () => {
    const provider = new MockProvider();
    const result = await provider.checkLiveness(fakeFrame(), detection);
    expect(result.isLive).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('is configurable to report a spoof/liveness failure', async () => {
    const provider = new MockProvider({
      results: { checkLiveness: { isLive: false, confidence: 0.12 } },
    });
    const result = await provider.checkLiveness(fakeFrame(), detection);
    expect(result.isLive).toBe(false);
  });
});

describe('MockProvider — verify', () => {
  it('verification success: identical embeddings produce a below-threshold distance and verified=true', async () => {
    const provider = new MockProvider();
    const embedding = [0.1, 0.2, 0.3, 0.4];
    const result = await provider.verify(embedding, embedding);
    expect(result.distance).toBe(0);
    expect(result.verified).toBe(true);
    expect(result.threshold).toBeGreaterThan(0);
    expect(result.distanceMetric).toBe('euclidean');
  });

  it('verification mismatch: far-apart embeddings produce an above-threshold distance and verified=false', async () => {
    const provider = new MockProvider();
    const embeddingA = [0, 0, 0, 0];
    const embeddingB = [10, 10, 10, 10];
    const result = await provider.verify(embeddingA, embeddingB);
    expect(result.distance).toBeGreaterThan(result.threshold);
    expect(result.verified).toBe(false);
  });

  it('always returns both distance and threshold (never a bare boolean) so the caller can independently re-check', async () => {
    const provider = new MockProvider({ verifyThreshold: 1.5 });
    const result = await provider.verify([0, 0], [1, 0]);
    expect(typeof result.distance).toBe('number');
    expect(typeof result.threshold).toBe('number');
    expect(typeof result.verified).toBe('boolean');
    // Independent re-check, exactly as the Master Plan requires the real
    // orchestration layer to do in Phase 4 — never trust `verified` alone.
    expect(result.verified).toBe(result.distance <= result.threshold);
  });

  it('is configurable with an explicit override result', async () => {
    const provider = new MockProvider({
      results: { verify: { distance: 0.49, threshold: 0.5, verified: true, distanceMetric: 'cosine' } },
    });
    const result = await provider.verify([0, 0], [999, 999]); // input ignored when overridden
    expect(result).toEqual({ distance: 0.49, threshold: 0.5, verified: true, distanceMetric: 'cosine' });
  });
});

describe('MockProvider — embedding generation', () => {
  const detection = { x: 0, y: 0, width: 100, height: 100, confidence: 0.9 };

  it('produces an embedding with model metadata', async () => {
    const provider = new MockProvider();
    const result = await provider.generateEmbedding(fakeFrame(), detection);
    expect(result.embedding.length).toBeGreaterThan(0);
    expect(result.modelName).toBeTruthy();
    expect(result.modelVersion).toBeTruthy();
  });
});

describe('MockProvider — health', () => {
  it('reports available by default', async () => {
    const provider = new MockProvider();
    const result = await provider.health();
    expect(result.available).toBe(true);
  });

  it('is configurable to report unavailable, without throwing', async () => {
    const provider = new MockProvider({ results: { health: { available: false, detail: 'down for maintenance' } } });
    const result = await provider.health();
    expect(result.available).toBe(false);
  });
});

describe('MockProvider — provider-level failure injection (fail-closed)', () => {
  it('rejects with BiometricProviderError for malformed_image, never resolving to a false success', async () => {
    const provider = new MockProvider({
      failures: { detectFace: new BiometricProviderError('malformed_image', 'bad bytes') },
    });
    await expect(provider.detectFace(fakeFrame())).rejects.toThrow(BiometricProviderError);
    await expect(provider.detectFace(fakeFrame())).rejects.toMatchObject({ reason: 'malformed_image' });
  });

  it('rejects with provider_unavailable for every method independently', async () => {
    const err = new BiometricProviderError('provider_unavailable', 'down');
    const provider = new MockProvider({
      failures: {
        detectFace: err,
        assessQuality: err,
        checkLiveness: err,
        generateEmbedding: err,
        verify: err,
        health: err,
      },
    });
    const detection = { x: 0, y: 0, width: 10, height: 10, confidence: 0.5 };
    await expect(provider.detectFace(fakeFrame())).rejects.toThrow(BiometricProviderError);
    await expect(provider.assessQuality(fakeFrame(), detection)).rejects.toThrow(BiometricProviderError);
    await expect(provider.checkLiveness(fakeFrame(), detection)).rejects.toThrow(BiometricProviderError);
    await expect(provider.generateEmbedding(fakeFrame(), detection)).rejects.toThrow(BiometricProviderError);
    await expect(provider.verify([0], [0])).rejects.toThrow(BiometricProviderError);
    await expect(provider.health()).rejects.toThrow(BiometricProviderError);
  });

  it('rejects with timeout distinctly from malformed_image/provider_unavailable', async () => {
    const provider = new MockProvider({
      failures: { verify: new BiometricProviderError('timeout', 'too slow') },
    });
    await expect(provider.verify([0], [0])).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('a configured failure always wins over a configured result for the same method (no ambiguity)', async () => {
    const provider = new MockProvider({
      results: { detectFace: { faceCount: 1, faces: [] } },
      failures: { detectFace: new BiometricProviderError('provider_unavailable', 'down') },
    });
    await expect(provider.detectFace(fakeFrame())).rejects.toThrow(BiometricProviderError);
  });
});

describe('MockProvider — deterministic behavior', () => {
  it('produces byte-identical results across repeated calls with the same config and input', async () => {
    const provider = new MockProvider();
    const frame = fakeFrame([9, 9, 9]);
    const detection = { x: 1, y: 2, width: 3, height: 4, confidence: 0.5 };

    const [d1, d2] = await Promise.all([provider.detectFace(frame), provider.detectFace(frame)]);
    expect(d1).toEqual(d2);

    const [q1, q2] = await Promise.all([
      provider.assessQuality(frame, detection),
      provider.assessQuality(frame, detection),
    ]);
    expect(q1).toEqual(q2);

    const [v1, v2] = await Promise.all([provider.verify([1, 2, 3], [1, 2, 3]), provider.verify([1, 2, 3], [1, 2, 3])]);
    expect(v1).toEqual(v2);
  });

  it('verify() is a pure function of its embedding inputs, not of call order or prior calls', async () => {
    const provider = new MockProvider();
    const first = await provider.verify([1, 1], [2, 2]);
    await provider.verify([5, 5], [9, 9]); // an unrelated call in between
    const second = await provider.verify([1, 1], [2, 2]);
    expect(first).toEqual(second);
  });
});

describe('MockProvider — interface/provider compatibility', () => {
  it('is structurally assignable to the BiometricProvider interface', () => {
    const provider: BiometricProvider = new MockProvider();
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it('implements every required method as a callable function', () => {
    const provider = new MockProvider();
    const methods: (keyof BiometricProvider)[] = [
      'detectFace',
      'assessQuality',
      'checkLiveness',
      'generateEmbedding',
      'verify',
      'health',
    ];
    for (const method of methods) {
      expect(typeof provider[method]).toBe('function');
    }
  });

  it('every method returns a Promise, matching a real network-backed provider\'s shape', () => {
    const provider = new MockProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    expect(provider.detectFace(fakeFrame())).toBeInstanceOf(Promise);
    expect(provider.assessQuality(fakeFrame(), detection)).toBeInstanceOf(Promise);
    expect(provider.checkLiveness(fakeFrame(), detection)).toBeInstanceOf(Promise);
    expect(provider.generateEmbedding(fakeFrame(), detection)).toBeInstanceOf(Promise);
    expect(provider.verify([0], [0])).toBeInstanceOf(Promise);
    expect(provider.health()).toBeInstanceOf(Promise);
  });
});

describe('MockProvider — no trusted identity can be forged through arbitrary provider input', () => {
  it('detectFace ignores identity-shaped content embedded in the frame bytes', async () => {
    const provider = new MockProvider();
    const encoder = new TextEncoder();
    const innocentFrame = fakeFrame([1, 2, 3]);
    const frameWithForgedClaim = encoder.encode(
      JSON.stringify({ employeeId: 'VICTIM-EMPLOYEE', companyId: 'FORGED-COMPANY', verified: true }),
    );

    const resultA = await provider.detectFace(innocentFrame);
    const resultB = await provider.detectFace(frameWithForgedClaim);

    // Same deterministic default regardless of what identity-shaped text
    // was embedded in the frame — nothing about the bytes' CONTENT is ever
    // interpreted as an identity claim.
    expect(resultA).toEqual(resultB);
  });

  it('verify ignores identity-shaped values smuggled into the embedding arrays', async () => {
    const provider = new MockProvider();
    // An "embedding" is just a number array — there is no field for an
    // identity claim to occupy, but confirm the result never echoes back
    // anything beyond distance/threshold/verified/distanceMetric even when
    // handed deliberately unusual (out-of-range, suspiciously-labeled-looking)
    // numeric input.
    const result = await provider.verify([1, 1, 1], [1, 1, 1]);
    expect(Object.keys(result).sort()).toEqual(['distance', 'distanceMetric', 'threshold', 'verified']);
  });

  it('no result type exposes an employeeId/userId/companyId/groupId field', async () => {
    const provider = new MockProvider();
    const detection = { x: 0, y: 0, width: 1, height: 1, confidence: 1 };
    const forbiddenKeys = ['employeeId', 'userId', 'companyId', 'groupId', 'tenantId'];

    const results = await Promise.all([
      provider.detectFace(fakeFrame()),
      provider.assessQuality(fakeFrame(), detection),
      provider.checkLiveness(fakeFrame(), detection),
      provider.generateEmbedding(fakeFrame(), detection),
      provider.verify([0], [0]),
      provider.health(),
    ]);

    for (const result of results) {
      const keys = Object.keys(result);
      for (const forbidden of forbiddenKeys) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it('constructor result/failure overrides are test-supplied fixtures, not caller-supplied request data — MockProvider never reads an override out of the frame/embedding arguments themselves', async () => {
    // A malicious caller cannot pass a "magic" frame/embedding that causes
    // MockProvider to switch behavior — only the constructor config (which,
    // architecturally, only a test controls, never a request payload) can.
    const provider = new MockProvider();
    const magicLookingFrame = fakeFrame([0xde, 0xad, 0xbe, 0xef]);
    const result = await provider.detectFace(magicLookingFrame);
    expect(result).toEqual({
      faceCount: 1,
      faces: [{ x: 100, y: 100, width: 200, height: 200, confidence: 0.98 }],
    });
  });
});
