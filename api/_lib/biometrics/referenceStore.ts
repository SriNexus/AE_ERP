/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — Admin-SDK-backed store
 * for the Phase 3 `biometric_face_references` collection.
 *
 * Adapter-injected (mirrors `api/_lib/integrationPlatform.ts`'s
 * `IntegrationPlatformAdapter` pattern exactly) so Phase 4's orchestration
 * tests can inject an in-memory fake instead of touching a real emulator
 * for every unit test — while still having a real Firestore-emulator-backed
 * integration test for the security-critical paths, per this phase's own
 * testing instruction.
 *
 * Every field written here matches Phase 3's `BiometricFaceReference` type
 * (`src/lib/biometrics/biometricFaceReference.ts`) exactly — this module
 * does not invent any field Phase 3 did not already define.
 */

import { getAdminDb } from '../firebase';
import { sanitizePayload } from '../../../src/lib/sanitizer';
import { COLLECTIONS } from '../../../src/lib/collections';
import {
  BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
  type BiometricFaceReference,
  type BiometricFaceReferenceHistoryEntry,
} from '../../../src/lib/biometrics/biometricFaceReference';

export interface ActiveReferenceSummary {
  readonly userId: string;
  readonly embedding: readonly number[];
}

export interface BiometricReferenceStore {
  getReference(userId: string): Promise<BiometricFaceReference | null>;
  createReference(doc: BiometricFaceReference): Promise<void>;
  updateReference(userId: string, patch: Record<string, unknown>): Promise<void>;
  /** Company's authoritative groupId, for stamping new references the same
   * way the client-side `resolveWriteGroupId()` convention does — never a
   * client-claimed groupId. Returns '' when the company has none. */
  resolveCompanyGroupId(companyId: string): Promise<string>;
  /** Every OTHER active reference in `companyId` (`excludeUserId`'s own
   * reference, if any, is never included) — feeds Phase 6's §11
   * duplicate-face policy. Deliberately bounded to one company (never
   * cross-tenant, matching every other same-company-only comparison in this
   * codebase) and to `status === 'active'` only (a revoked reference is not
   * a meaningful duplicate-face signal). */
  listActiveReferencesInCompany(companyId: string, excludeUserId: string): Promise<ActiveReferenceSummary[]>;
}

export function createDefaultBiometricReferenceStore(): BiometricReferenceStore {
  const db = getAdminDb();
  const col = db.collection(COLLECTIONS.BIOMETRIC_FACE_REFERENCES);

  return {
    async getReference(userId) {
      const snap = await col.doc(userId).get();
      if (!snap.exists) return null;
      return snap.data() as BiometricFaceReference;
    },
    async createReference(doc) {
      await col.doc(doc.id).set(sanitizePayload(doc));
    },
    async updateReference(userId, patch) {
      await col.doc(userId).update(sanitizePayload(patch) as FirebaseFirestore.UpdateData<BiometricFaceReference>);
    },
    async resolveCompanyGroupId(companyId) {
      if (!companyId) return '';
      const snap = await db.collection(COLLECTIONS.COMPANIES).doc(companyId).get();
      const groupId = snap.exists ? snap.data()?.groupId : undefined;
      return typeof groupId === 'string' ? groupId : '';
    },
    async listActiveReferencesInCompany(companyId, excludeUserId) {
      if (!companyId) return [];
      const snap = await col.where('companyId', '==', companyId).where('status', '==', 'active').get();
      const results: ActiveReferenceSummary[] = [];
      for (const doc of snap.docs) {
        if (doc.id === excludeUserId) continue;
        const data = doc.data() as BiometricFaceReference;
        if (Array.isArray(data.embedding) && data.embedding.length > 0) {
          results.push({ userId: data.userId, embedding: data.embedding });
        }
      }
      return results;
    },
  };
}

/**
 * Builds a brand-new reference document for a first-time enrollment.
 * `history` starts empty (Master Plan §9: history records PRIOR
 * enrollment events; the first enrollment has none yet).
 */
export function buildNewReference(input: {
  userId: string;
  companyId: string;
  groupId: string;
  embedding: readonly number[];
  embeddingModel: string;
  embeddingModelVersion: string;
  detectorBackend: string;
  detectorVersion: string;
  enrolledBy: string;
  enrolledAt: string;
}): BiometricFaceReference {
  return {
    id: input.userId,
    userId: input.userId,
    companyId: input.companyId,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingModelVersion: input.embeddingModelVersion,
    detectorBackend: input.detectorBackend,
    detectorVersion: input.detectorVersion,
    schemaVersion: BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION,
    status: 'active',
    enrolledAt: input.enrolledAt,
    enrolledBy: input.enrolledBy,
    reEnrollmentCount: 0,
    history: [],
    createdBy: input.enrolledBy,
    updatedBy: input.enrolledBy,
  };
}

/**
 * Builds the UPDATE patch for a re-enrollment (Master Plan §9/§11: "always
 * fully replaces the active embedding... no merge/averaging in v1"; the
 * PRIOR embedding is discarded, only metadata about the prior enrollment
 * event is appended to `history`). Never touches the forever-immutable
 * anchor fields (id/userId/companyId/groupId/enrolledAt/enrolledBy/
 * schemaVersion) — matches `firestore.rules`' own
 * `biometricImmutableFieldsUnchanged()` guard exactly, enforced here
 * independently since the Admin SDK bypasses that rule.
 *
 * Phase 9 addition — §9's own Retention/Deletion Policy ("Revocation
 * policy"): "A revoked reference blocks verification but is not deleted —
 * re-activation (setting `status` back to `'active'`) is treated
 * identically to re-enrollment authorization-wise, and should in practice
 * require a fresh enrollment capture rather than silently reactivating a
 * possibly-stale embedding." A successfully-validated fresh capture on a
 * currently-`'revoked'` reference IS that required fresh capture — this
 * patch therefore ALWAYS sets `status: 'active'` (a harmless no-op when the
 * reference was already active). This is SAFE against the deactivation
 * scenario specifically: a deactivated user cannot authenticate at all
 * (`api/_lib/auth.ts`'s `resolveAuthenticatedUser()` already rejects
 * inactive/suspended/deleted actors before any biometric code runs), so a
 * revoked-via-deactivation reference can only ever be reactivated by a
 * caller who is either the same user AFTER being reactivated by an Admin,
 * or an Admin/HR/GroupAdmin acting on that (now-active) employee's behalf —
 * never by the deactivated identity itself. `revokedAt`/`revokedBy` are
 * deliberately left untouched (not cleared) — they remain an honest,
 * permanent record of the most recent revocation event; the document's
 * CURRENT `status` is what actually governs authorization, exactly like
 * `lastVerifiedAt` is "informational... not a security control" per §9's
 * own field-table note.
 */
export function buildReEnrollmentPatch(
  existing: BiometricFaceReference,
  input: {
    embedding: readonly number[];
    embeddingModel: string;
    embeddingModelVersion: string;
    detectorBackend: string;
    detectorVersion: string;
    actorUserId: string;
  },
): Record<string, unknown> {
  const historyEntry: BiometricFaceReferenceHistoryEntry = {
    enrolledAt: existing.enrolledAt,
    enrolledBy: existing.enrolledBy,
    embeddingModel: existing.embeddingModel,
    embeddingModelVersion: existing.embeddingModelVersion,
    // Completes the historical record for a revoked prior enrollment being
    // replaced: this entry now shows exactly when that enrollment ran
    // (enrolledAt → revokedAt), matching the schema's own optional
    // `revokedAt?` field (BiometricFaceReferenceHistoryEntry) designed for
    // exactly this case.
    ...(existing.status === 'revoked' && existing.revokedAt ? { revokedAt: existing.revokedAt } : {}),
  };
  return {
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingModelVersion: input.embeddingModelVersion,
    detectorBackend: input.detectorBackend,
    detectorVersion: input.detectorVersion,
    reEnrollmentCount: (existing.reEnrollmentCount || 0) + 1,
    history: [...(existing.history || []), historyEntry],
    updatedBy: input.actorUserId,
    status: 'active',
  };
}
