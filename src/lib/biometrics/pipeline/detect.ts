/**
 * Detect stage — Face Attendance + DeepFace Master Plan §10/Phase 4.
 *
 * "detect.ts → calls provider.detectFace(), fails closed on 0 or >1 faces
 * (§11)." The PROVIDER never fails closed itself (Phase 2's `detectFace()`
 * always resolves with a count, including zero) — this stage is where that
 * fail-closed decision actually happens, exactly as §10 assigns it.
 */

import { BiometricProviderError, type BiometricFrame, type BiometricProvider, type ResolvedFaceDetection } from '../providers/BiometricProvider.js';
import { BiometricPipelineError, multipleFaces, noFace } from './types.js';

/** Translates a Phase 2 provider-level failure into the Phase 4 pipeline's
 * shared error type — same reason string, never a different one, so callers
 * branch on one consistent set of codes regardless of which stage failed. */
export function translateProviderError(error: unknown): BiometricPipelineError {
  if (error instanceof BiometricProviderError) {
    return new BiometricPipelineError(error.reason, error.message);
  }
  if (error instanceof BiometricPipelineError) {
    return error;
  }
  // An unmapped provider exception must never leak its raw message (could
  // carry internal details) — treat as provider_unavailable, fail closed.
  return new BiometricPipelineError('provider_unavailable', 'The biometric provider failed to process the request.');
}

export async function runDetectStage(
  provider: BiometricProvider,
  frame: BiometricFrame,
): Promise<ResolvedFaceDetection> {
  let result;
  try {
    result = await provider.detectFace(frame);
  } catch (error) {
    throw translateProviderError(error);
  }
  if (result.faceCount === 0) throw noFace();
  if (result.faceCount > 1) throw multipleFaces(result.faceCount);
  return result.faces[0];
}
