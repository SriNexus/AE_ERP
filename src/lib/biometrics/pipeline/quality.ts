/**
 * Quality stage — Face Attendance + DeepFace Master Plan §10/Phase 4.
 * "quality.ts → calls provider.assessQuality(), fails closed below threshold."
 */

import type { BiometricFrame, BiometricProvider, QualityResult, ResolvedFaceDetection } from '../providers/BiometricProvider.js';
import { poorQuality } from './types.js';
import { translateProviderError } from './detect.js';

export async function runQualityStage(
  provider: BiometricProvider,
  frame: BiometricFrame,
  detection: ResolvedFaceDetection,
): Promise<QualityResult> {
  let result: QualityResult;
  try {
    result = await provider.assessQuality(frame, detection);
  } catch (error) {
    throw translateProviderError(error);
  }
  if (!result.passed) throw poorQuality(result.reasons);
  return result;
}
