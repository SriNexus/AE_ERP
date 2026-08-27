/**
 * Liveness stage — Face Attendance + DeepFace Master Plan §10/Phase 4.
 * "liveness.ts → calls provider.checkLiveness(), fails closed on spoof/low-confidence."
 *
 * Honesty note carried from §6: this stage enforces whatever the provider's
 * liveness signal says (passive, single-frame, per the locked Phase 1
 * strategy) — Phase 4 does not add its own confidence-threshold heuristics
 * on top of `isLive`, since the provider is already the sole source of that
 * signal (§8: "Owns nothing about who anyone is... Detect/Quality/Liveness"
 * responsibilities stay provider-side; only Verify's threshold is
 * independently re-checked here, per §6/§10).
 */

import type { BiometricFrame, BiometricProvider, LivenessResult, ResolvedFaceDetection } from '../providers/BiometricProvider';
import { livenessFailed } from './types';
import { translateProviderError } from './detect';

export async function runLivenessStage(
  provider: BiometricProvider,
  frame: BiometricFrame,
  detection: ResolvedFaceDetection,
): Promise<LivenessResult> {
  let result: LivenessResult;
  try {
    result = await provider.checkLiveness(frame, detection);
  } catch (error) {
    throw translateProviderError(error);
  }
  if (!result.isLive) throw livenessFailed();
  return result;
}
