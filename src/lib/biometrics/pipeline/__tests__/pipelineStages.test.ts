/**
 * Face Attendance + DeepFace Master Plan, Phase 10 — direct unit tests for
 * the individual pipeline-stage functions (`detect.ts`, `quality.ts`,
 * `liveness.ts`, `embedding.ts`).
 *
 * §20 item 1: "Pipeline-stage functions (detect.ts, quality.ts,
 * liveness.ts, embedding.ts, verify.ts, policy.ts) each get focused tests
 * against MockProvider fixtures." `verify.ts` (`runVerifyStage`) and
 * `policy.ts` (`assertReferenceActive`/`decideVerification`) already have
 * exactly this kind of direct, isolated unit coverage in
 * `api/_lib/biometrics/__tests__/phase4Orchestration.test.ts` (imported and
 * called directly there, not just exercised through the full orchestrator).
 * `detect.ts`/`quality.ts`/`liveness.ts`/`embedding.ts` did not — their
 * behavior was previously only provable indirectly, through
 * `enrollBiometricFace()`/`verifyBiometricFace()`'s own end-to-end tests.
 * This file closes that gap with the SAME kind of direct-unit tests the
 * other two stages already have, isolated from authorization/persistence/
 * every other pipeline stage — a genuine, non-duplicative addition (these
 * assert on the STAGE FUNCTIONS' own return values/thrown errors directly,
 * not on an orchestrator's end-to-end result).
 */

import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../providers/MockProvider';
import { BiometricProviderError, type ResolvedFaceDetection } from '../../providers/BiometricProvider';
import { runDetectStage, translateProviderError } from '../detect';
import { runQualityStage } from '../quality';
import { runLivenessStage } from '../liveness';
import { runEmbeddingStage } from '../embedding';
import { BiometricPipelineError } from '../types';

const FRAME = new Uint8Array([1, 2, 3, 4]);
const DETECTION: ResolvedFaceDetection = { x: 0, y: 0, width: 100, height: 100, confidence: 0.9 };

describe('translateProviderError (detect.ts)', () => {
  it('maps a BiometricProviderError to a BiometricPipelineError with the SAME reason', () => {
    const result = translateProviderError(new BiometricProviderError('timeout', 'too slow'));
    expect(result).toBeInstanceOf(BiometricPipelineError);
    expect(result.reason).toBe('timeout');
  });

  it('passes an already-BiometricPipelineError through unchanged', () => {
    const original = new BiometricPipelineError('no_face', 'no face');
    expect(translateProviderError(original)).toBe(original);
  });

  it('maps any unmapped/unexpected exception to provider_unavailable, never leaking the raw message', () => {
    const result = translateProviderError(new Error('some internal TensorFlow stack trace with a local file path'));
    expect(result.reason).toBe('provider_unavailable');
    expect(result.message).not.toContain('TensorFlow');
    expect(result.message).not.toContain('file path');
  });
});

describe('runDetectStage', () => {
  it('returns the single detected face when exactly one is found', async () => {
    const provider = new MockProvider();
    const face = await runDetectStage(provider, FRAME);
    expect(face).toEqual({ x: 100, y: 100, width: 200, height: 200, confidence: 0.98 });
  });

  it('fails closed with no_face on zero detections', async () => {
    const provider = new MockProvider({ results: { detectFace: { faceCount: 0, faces: [] } } });
    await expect(runDetectStage(provider, FRAME)).rejects.toMatchObject({ reason: 'no_face' });
  });

  it('fails closed with multiple_faces on more than one detection, never silently picking one', async () => {
    const provider = new MockProvider({
      results: {
        detectFace: {
          faceCount: 2,
          faces: [{ x: 0, y: 0, width: 10, height: 10, confidence: 0.9 }, { x: 50, y: 50, width: 10, height: 10, confidence: 0.9 }],
        },
      },
    });
    await expect(runDetectStage(provider, FRAME)).rejects.toMatchObject({ reason: 'multiple_faces' });
  });

  it('translates a provider-level failure (malformed_image/provider_unavailable/timeout) rather than throwing the raw provider error', async () => {
    const provider = new MockProvider({ failures: { detectFace: new BiometricProviderError('malformed_image', 'bad bytes') } });
    const error = await runDetectStage(provider, FRAME).catch((e) => e);
    expect(error).toBeInstanceOf(BiometricPipelineError);
    expect(error.reason).toBe('malformed_image');
  });
});

describe('runQualityStage', () => {
  it('returns the quality result on pass', async () => {
    const provider = new MockProvider();
    const result = await runQualityStage(provider, FRAME, DETECTION);
    expect(result).toEqual({ passed: true, reasons: [] });
  });

  it('fails closed with poor_quality, surfacing the specific reasons for UX retry guidance', async () => {
    const provider = new MockProvider({ results: { assessQuality: { passed: false, reasons: ['too_dark', 'blurry'] } } });
    const error = await runQualityStage(provider, FRAME, DETECTION).catch((e) => e);
    expect(error).toBeInstanceOf(BiometricPipelineError);
    expect(error.reason).toBe('poor_quality');
    expect(error.message).toContain('too_dark');
    expect(error.message).toContain('blurry');
  });

  it('translates a provider-level failure during quality assessment', async () => {
    const provider = new MockProvider({ failures: { assessQuality: new BiometricProviderError('timeout', 'slow') } });
    await expect(runQualityStage(provider, FRAME, DETECTION)).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('runLivenessStage', () => {
  it('returns the liveness result when live', async () => {
    const provider = new MockProvider();
    const result = await runLivenessStage(provider, FRAME, DETECTION);
    expect(result.isLive).toBe(true);
  });

  it('fails closed with liveness_failed on a spoof/non-live classification', async () => {
    const provider = new MockProvider({ results: { checkLiveness: { isLive: false, confidence: 0.05 } } });
    await expect(runLivenessStage(provider, FRAME, DETECTION)).rejects.toMatchObject({ reason: 'liveness_failed' });
  });

  it('translates a provider-level failure during liveness classification', async () => {
    const provider = new MockProvider({ failures: { checkLiveness: new BiometricProviderError('provider_unavailable', 'down') } });
    await expect(runLivenessStage(provider, FRAME, DETECTION)).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });
});

describe('runEmbeddingStage', () => {
  it('returns the embedding result on success (no fail-closed decision of its own, per its own design)', async () => {
    const provider = new MockProvider();
    const result = await runEmbeddingStage(provider, FRAME, DETECTION);
    expect(result.embedding.length).toBeGreaterThan(0);
    expect(result.modelName).toBeTruthy();
    expect(result.modelVersion).toBeTruthy();
  });

  it('translates a provider-level failure during embedding generation, its only failure path', async () => {
    const provider = new MockProvider({ failures: { generateEmbedding: new BiometricProviderError('malformed_image', 'bad frame') } });
    await expect(runEmbeddingStage(provider, FRAME, DETECTION)).rejects.toMatchObject({ reason: 'malformed_image' });
  });
});
