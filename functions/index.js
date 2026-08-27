/**
 * onUserDeactivated — the ONE Cloud Function introduced by the
 * Multi-Tenant Implementation Master Plan (§4.5), built in Phase 0 to close
 * the session-persistence half of audit finding F-13.
 *
 * F-13 (audit-confirmed CRITICAL): deactivation (`users.status` ->
 * inactive/suspended/disabled, or `isDeleted -> true`) was enforced only at
 * the one-time login boundary (src/lib/authIdentity.ts validateProfile) and
 * never mirrored into Firestore rules or paired with an Auth-side token
 * revocation. An already-open browser session (or a session restored from
 * Firebase Auth's persisted local credentials on the next page load, which
 * does not re-run the Login flow) therefore retained full rules-level access
 * for as long as its refresh token stayed valid — effectively indefinitely.
 *
 * Two-part fix, per Master Plan §4.5:
 *   1. The Firestore-rules-level `actorIsActive()` check (firestore.rules) is
 *      the PRIMARY, always-on enforcement — a deactivated user's NEXT
 *      Firestore request is denied even if this function is delayed or fails.
 *   2. THIS function closes the narrower remaining gap: a token already cached
 *      client-side that has not yet made a new Firestore request.
 *
 * Deliberate minimal scope (Master Plan §16.2 rule 6 — no other Cloud
 * Function may be introduced): its only action is
 * `admin.auth().revokeRefreshTokens(uid)` for the Firebase Auth UID(s)
 * resolved via `user_auth_maps`. It performs no Firestore reads or writes of
 * its own beyond the triggering event, and is deployed with the minimum IAM
 * role required (Firebase Authentication Admin).
 *
 * Face Attendance + DeepFace Master Plan, Phase 9 addition: an ADDITIVE
 * side effect (§9's own required wording) revoking the deactivated user's
 * `biometric_face_references` document, if one exists — this function's own
 * primary behavior above (refresh-token revocation) is completely
 * unmodified; the new logic only runs after it, in its own guarded,
 * independently-failing block, per §9's own "no other Cloud Function may be
 * introduced" constraint (extending this ONE existing trigger, not adding a
 * second one).
 */
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const {
  isDeactivated,
  isDeactivationTransition,
  buildBiometricRevocationPatch,
} = require('./biometricRevocation');

initializeApp();

exports.onUserDeactivated = onDocumentUpdated('users/{userId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  // Only react to a transition INTO deactivation. Re-activation, creation,
  // and edits that keep the user active are no-ops (and an already-deactivated
  // doc being edited stays deactivated — the rules gate it regardless).
  if (!isDeactivationTransition(before, after)) {
    return;
  }

  const userId = event.params.userId;
  const db = getFirestore();

  // Resolve the Firebase Auth UID(s) mapped to this ERP user. The mapping is
  // lazily created on first login (validOwnMapping), so every account with a
  // live session has a user_auth_maps/{authUid} entry. Admin SDK bypasses
  // Firestore rules by design — this is exactly the intended boundary for a
  // trusted revocation action (§9.7).
  const uids = new Set();
  try {
    const snap = await db.collection('user_auth_maps').where('userId', '==', userId).get();
    snap.forEach((doc) => uids.add(doc.id));
  } catch (error) {
    console.error(`[onUserDeactivated] Failed to resolve auth mapping for user ${userId}:`, error);
  }

  if (uids.size === 0) {
    console.log(`[onUserDeactivated] No auth mapping found for user ${userId}; nothing to revoke.`);
  }

  for (const uid of uids) {
    try {
      await getAuth().revokeRefreshTokens(uid);
      console.log(`[onUserDeactivated] Revoked refresh tokens for auth uid ${uid} (ERP user ${userId}).`);
    } catch (error) {
      console.error(`[onUserDeactivated] Failed to revoke refresh tokens for auth uid ${uid}:`, error);
    }
  }

  // ── Face Attendance + DeepFace Master Plan, Phase 9: revoke the
  // biometric reference (§9's retention/deletion policy), if one exists.
  // Independent try/catch — a failure here must never be conflated with,
  // or block, the (already-completed) refresh-token revocation above.
  // Idempotent by construction: only writes when an ACTIVE reference
  // exists — a repeat/redelivered event, or a user who was already
  // revoked (e.g. by Admin/HR action) or never enrolled at all, is a safe
  // no-op, never a duplicate/conflicting write and never an error. Uses a
  // read-then-conditional-update (not a blind `set(..., {merge:true})`),
  // deliberately — the latter would risk fabricating a malformed partial
  // `biometric_face_references` document (missing required §9 fields like
  // `embedding`/`companyId`) for a user who never enrolled at all.
  try {
    const bioRef = db.collection('biometric_face_references').doc(userId);
    const bioSnap = await bioRef.get();
    if (bioSnap.exists && bioSnap.data().status === 'active') {
      const patch = buildBiometricRevocationPatch(after, new Date().toISOString());
      await bioRef.update(patch);
      console.log(`[onUserDeactivated] Revoked biometric_face_references for user ${userId}.`);
    }
  } catch (error) {
    console.error(`[onUserDeactivated] Failed to revoke biometric_face_references for user ${userId}:`, error);
  }
});
