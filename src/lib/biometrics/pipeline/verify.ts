/**
 * Verify stage — Face Attendance + DeepFace Master Plan §6/§10/Phase 4.
 *
 * "verify.ts → calls provider.verify() against the stored reference, then
 * INDEPENDENTLY re-applies Neozy's own threshold to the returned distance
 * — never trusts the provider's own `verified` boolean as final."
 *
 * This is the single most security-relevant stage in the pipeline: a
 * provider (mock today, DeepFace in Phase 5/6) is never trusted to make the
 * final pass/fail call by itself. Neozy re-derives the decision from the
 * raw `distance` every time.
 *
 * Thresholds are deliberately NOT hardcoded here (per this phase's explicit
 * instruction and §6: "the real threshold value must be set from the Phase
 * 11 real-model benchmark, not guessed"). `thresholdOverride` defaults to
 * the provider's own reported threshold when unset — Phase 11 is where a
 * real, evidence-based Neozy-specific override gets locked (via
 * environment config, §19, not a code change).
 */

import type { BiometricEmbeddingVector, BiometricProvider } from '../providers/BiometricProvider';
import { ambiguousMatch, verificationFailed } from './types';
import { translateProviderError } from './detect';

export interface VerifyPolicyConfig {
  /** Overrides the provider's own reported threshold. Unset by default —
   * see module doc comment for why this must not be hardcoded in Phase 4. */
  thresholdOverride?: number;
  /** Half-width of the "too close to call" band around the threshold, as a
   * fraction of the threshold value (Master Plan §15: "ambiguous_match...
   * exact band width tuned in Phase 11"). Conservative placeholder default,
   * explicitly not a claimed-final production value. */
  ambiguousBandFraction?: number;
}

export const DEFAULT_AMBIGUOUS_BAND_FRACTION = 0.05;

export interface VerifyOutcome {
  readonly distance: number;
  readonly threshold: number;
  readonly distanceMetric: string;
  /** Always true when this function returns normally — a failing/ambiguous
   * outcome throws instead (fail-closed, matching every other stage). Kept
   * as an explicit field anyway so a caller never has to assume it from
   * "didn't throw" alone. */
  readonly passed: true;
}

export async function runVerifyStage(
  provider: BiometricProvider,
  candidateEmbedding: BiometricEmbeddingVector,
  storedEmbedding: BiometricEmbeddingVector,
  config: VerifyPolicyConfig = {},
): Promise<VerifyOutcome> {
  let result;
  try {
    result = await provider.verify(candidateEmbedding, storedEmbedding);
  } catch (error) {
    throw translateProviderError(error);
  }

  const threshold = config.thresholdOverride ?? result.threshold;
  const bandFraction = config.ambiguousBandFraction ?? DEFAULT_AMBIGUOUS_BAND_FRACTION;
  const band = Math.abs(threshold) * bandFraction;

  // Independent re-derivation from the raw distance — result.verified is
  // never consulted for the pass/fail decision itself.
  if (Math.abs(result.distance - threshold) <= band) {
    throw ambiguousMatch();
  }
  if (result.distance > threshold) {
    throw verificationFailed();
  }

  return { distance: result.distance, threshold, distanceMetric: result.distanceMetric, passed: true };
}
