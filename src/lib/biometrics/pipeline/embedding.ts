/**
 * Embedding stage — Face Attendance + DeepFace Master Plan §10/Phase 4.
 * "embedding.ts → calls provider.generateEmbedding()."
 *
 * No fail-closed decision lives here — a successful call always returns a
 * usable embedding by construction of the Phase 2 interface (a 0/multi-face
 * frame was already rejected by the Detect stage before this one runs).
 */

import type { BiometricFrame, BiometricProvider, EmbeddingResult, ResolvedFaceDetection } from '../providers/BiometricProvider';
import { translateProviderError } from './detect';

export async function runEmbeddingStage(
  provider: BiometricProvider,
  frame: BiometricFrame,
  detection: ResolvedFaceDetection,
): Promise<EmbeddingResult> {
  try {
    return await provider.generateEmbedding(frame, detection);
  } catch (error) {
    throw translateProviderError(error);
  }
}
