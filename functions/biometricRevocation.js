/**
 * Face Attendance + DeepFace Master Plan, Phase 9 — revocation-on-
 * deactivation decision logic.
 *
 * §9's Retention/Deletion Policy: "Employee termination / account
 * deactivation: the existing `useAppStore`/`users.status` deactivation flow
 * ... must, as an ADDITIVE side effect, set
 * `biometric_face_references.status = 'revoked'` and stamp
 * `revokedAt`/`revokedBy`." Phase 9's own spec: "first locate the existing
 * user-deactivation code path — likely near `onUserDeactivated` in
 * `functions/index.js`... inspect before assuming which file." That
 * function was found, unmodified since the Multi-Tenant Master Plan's own
 * Phase 0 (§4.5) — this module wires the additive side effect into it,
 * WITHOUT introducing a second Cloud Function (that plan's §16.2 rule 6:
 * "no other Cloud Function may be introduced" — honored by extending the
 * one existing trigger, not adding a new one).
 *
 * Deliberately extracted into its own, dependency-free module (no
 * `firebase-admin`/`firebase-functions` imports) rather than living inline
 * in `index.js`: neither package is installed anywhere in this repository
 * (confirmed — absent from both the root `node_modules` and a never-`npm
 * install`ed `functions/node_modules`), so `index.js` itself cannot be
 * `require()`d in this environment at all. This module has zero such
 * dependency, so its actual decision logic — the part that matters for
 * correctness — is directly unit-testable from the main Neozy Vitest suite
 * even though the Cloud Function glue around it (Firestore Admin SDK reads/
 * writes, the trigger registration itself) cannot be exercised here. See
 * the Phase 9 completion record for the full, honest accounting of what
 * this does and does not prove.
 */

// Matches `index.js`'s own existing `INACTIVE_STATUSES`/`isDeactivated()`
// EXACTLY (both the lowercase canonical forms `authIdentity.validateProfile`
// uses and the capitalized forms the Users workspace actually writes) — this
// module is now the single source of truth for that check; `index.js`
// imports it rather than duplicating it.
const INACTIVE_STATUSES = ['inactive', 'suspended', 'disabled', 'Inactive', 'Suspended', 'Disabled'];

function isDeactivated(data) {
  if (!data) return false;
  const status = typeof data.status === 'string' ? data.status.trim() : '';
  return INACTIVE_STATUSES.includes(status) || data.isDeleted === true;
}

/**
 * True only on a genuine transition INTO deactivation (not-deactivated →
 * deactivated) — mirrors `onUserDeactivated`'s own existing guard exactly,
 * so re-activation, creation, and an already-deactivated document being
 * edited again are all no-ops. This is also this module's own idempotency
 * guarantee at the "should we even consider acting" layer: a
 * Cloud-Functions-platform redelivery of the SAME update event re-evaluates
 * `before`/`after` identically and reaches the same (false, on the second
 * delivery only if `before` itself already reflects the first delivery's
 * effect — which it does not, since this function never mutates `users`
 * itself) — so this check alone is not sufficient for full idempotency;
 * see `index.js`'s own additional active-status guard before writing.
 */
function isDeactivationTransition(before, after) {
  return !isDeactivated(before) && isDeactivated(after);
}

/**
 * Real, server-derived actor identity for the revocation record — never
 * fabricated, never a guess. `updateDocById()` (`src/lib/firestore.ts`)
 * already unconditionally stamps every `users/{id}` write with
 * `updatedBy: state.user?.id || 'system'` — the standard, already-audited
 * write path this ERP's own Users/PlatformUsers management UI uses to
 * change a user's `status` (confirmed via `updateDocById(COLLECTIONS.USERS,
 * ...)` call sites). A genuine deactivation transition's `after` snapshot
 * therefore already carries the real deactivating actor's own id (or the
 * literal string `'system'` for a genuinely automated/unattributed write).
 * Falls back to an honest, clearly-labeled sentinel only if that field is
 * somehow absent — defensive; should not occur in practice given
 * `updateDocById()`'s own unconditional stamp, but this function must never
 * write `revokedBy: undefined` to Firestore.
 */
function resolveRevocationActor(after) {
  const updatedBy = after && typeof after.updatedBy === 'string' ? after.updatedBy.trim() : '';
  return updatedBy || 'system:onUserDeactivated';
}

/**
 * The exact, additive Firestore patch §9 specifies — "set status =
 * 'revoked' and stamp revokedAt/revokedBy" — and NOTHING else. Never
 * touches `embedding`/`enrolledAt`/`enrolledBy`/`history`/any other field,
 * matching `firestore.rules`' own `biometricUpdateAllowed()` immutable-
 * field set (Phase 3/8) — this patch would remain rules-legal even if it
 * somehow went through the client-SDK rules path instead of the Admin SDK
 * (it does not touch `lastVerifiedAt` either, consistent with Phase 8's own
 * client-write-forbidden addition to that field).
 */
function buildBiometricRevocationPatch(after, nowIso) {
  return {
    status: 'revoked',
    revokedAt: nowIso,
    revokedBy: resolveRevocationActor(after),
  };
}

module.exports = {
  isDeactivated,
  isDeactivationTransition,
  resolveRevocationActor,
  buildBiometricRevocationPatch,
};
