/**
 * Duplicate-face policy — Face Attendance + DeepFace Master Plan §11/Phase 6.
 *
 * "Duplicate-face policy: before persisting, the orchestration layer should
 * check the new embedding's distance against other active references in the
 * same company to flag (not silently block, in v1 — surfaced as a warning to
 * the enrolling Admin/HR actor) a suspiciously close match to a different
 * employee's stored reference — a lightweight fraud/data-entry-error signal,
 * not a hard gate, since false positives here would block legitimate
 * enrollment. This is a bounded, same-company-only comparison (never
 * cross-tenant), computed server-side, using the same verify() provider
 * method."
 *
 * Deliberately advisory-only, never fail-closed: a provider failure or an
 * ambiguous/mismatched comparison during this check must never block or
 * delay the enrollment itself — it only ever adds an optional warning to an
 * otherwise-successful result. Contrast with `verify.ts`'s own
 * independently-re-derived threshold: that stage is the security-critical
 * gate; this one is not, so it is deliberately simpler — a same-company scan
 * using the provider's own reported distance/threshold, matching §11's own
 * "using the same verify() provider method" (not "re-deriving Neozy's own
 * stricter policy threshold", which §11 does not ask for here).
 *
 * Pure, zero-Firebase-dependency (matches this directory's own established
 * convention, `attendanceRuleEngine.ts`/`policy.ts`) — the caller
 * (`api/_lib/biometrics/enrollment.ts`) is responsible for loading the
 * candidate list from Firestore and passing it in.
 */

import type { BiometricEmbeddingVector, BiometricProvider } from '../providers/BiometricProvider.js';

export interface DuplicateFaceCandidate {
  readonly userId: string;
  readonly embedding: BiometricEmbeddingVector;
}

export interface DuplicateFaceWarning {
  readonly suspectedDuplicateOfUserIds: readonly string[];
}

/**
 * Compares `candidateEmbedding` against every entry in `existingReferences`
 * (already scoped to "same company, active, excluding the enrolling
 * target's own reference" by the caller — this function has no tenant
 * concept of its own, matching the provider layer's own "owns nothing about
 * who anyone is" boundary, §8). Returns `null` when no suspiciously-close
 * match is found (the common case).
 *
 * A per-candidate provider failure is skipped, not propagated — this check
 * must never turn a provider hiccup into a blocked enrollment (see module
 * doc comment). If every comparison fails, this simply returns `null`
 * (nothing detected), which is the correct fail-open behavior for an
 * advisory-only signal — never fail-closed, unlike every security-relevant
 * stage elsewhere in this pipeline.
 */
export async function evaluateDuplicateFacePolicy(
  provider: BiometricProvider,
  candidateEmbedding: BiometricEmbeddingVector,
  existingReferences: readonly DuplicateFaceCandidate[],
): Promise<DuplicateFaceWarning | null> {
  const suspectedDuplicateOfUserIds: string[] = [];

  for (const candidate of existingReferences) {
    let result;
    try {
      result = await provider.verify(candidateEmbedding, candidate.embedding);
    } catch {
      continue;
    }
    if (result.distance <= result.threshold) {
      suspectedDuplicateOfUserIds.push(candidate.userId);
    }
  }

  return suspectedDuplicateOfUserIds.length > 0 ? { suspectedDuplicateOfUserIds } : null;
}
