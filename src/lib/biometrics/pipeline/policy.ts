/**
 * Policy stage — Face Attendance + DeepFace Master Plan §10/Phase 4.
 *
 * "policy.ts → pure function, no provider/Firestore access, decides
 * pass/fail given the verify result + any additional Neozy business policy
 * (e.g. 'reference must not be revoked'... not built in v1 beyond that)."
 *
 * Pure, deterministic, side-effect-free — same architectural convention as
 * `src/features/attendance/services/attendanceRuleEngine.ts` (this phase's
 * explicit instruction: "implement using the existing attendanceRuleEngine
 * architectural convention... no Firebase/UI dependency, explicitly
 * testable, fail closed"). No lockout/rate-limiting policy is implemented
 * here — the master plan explicitly scopes that out of v1 (§10), and
 * inventing one now would be exactly the kind of unrequested business rule
 * this phase's scope discipline forbids.
 */

import { enrollmentRevoked } from './types';
import type { VerifyOutcome } from './verify';

export type BiometricReferenceStatus = 'active' | 'revoked';

/**
 * Pre-check (Master Plan §15: "Revoked reference | Pre-check (before
 * Verify) | enrollment_revoked, reject") — called by the orchestrator
 * BEFORE any provider call is made, so a revoked employee's verification
 * attempt never spends a provider call at all.
 */
export function assertReferenceActive(status: BiometricReferenceStatus): void {
  if (status === 'revoked') throw enrollmentRevoked();
}

export interface VerificationDecision {
  readonly verified: true;
  readonly distance: number;
  readonly threshold: number;
}

/**
 * Final decision gate, called after a successful Verify stage. Re-asserts
 * revocation defensively (defense-in-depth alongside the pre-check above —
 * a reference revoked in the brief window between the pre-check and the
 * provider round-trip is still caught) and returns the one shape the
 * orchestrator needs to proceed. `verifyOutcome` is only ever passed here
 * once `runVerifyStage()` has already resolved (a failing/ambiguous verify
 * throws before reaching this function at all) — so this function's own
 * job is narrow by design: it is the single place future policy rules
 * (§10's example: a liveness-failure lockout) would be added, without
 * touching the provider-facing stages above.
 */
export function decideVerification(
  referenceStatus: BiometricReferenceStatus,
  verifyOutcome: VerifyOutcome,
): VerificationDecision {
  assertReferenceActive(referenceStatus);
  return { verified: true, distance: verifyOutcome.distance, threshold: verifyOutcome.threshold };
}
