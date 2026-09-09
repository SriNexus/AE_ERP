/**
 * biometric_face_references — Firestore document schema.
 * Face Attendance + DeepFace Master Plan, Phase 3 (§9's data model,
 * implemented field-for-field).
 *
 * This is the DATA MODEL only — no enrollment/verification write helper is
 * built in this phase (that is Phase 4's Node orchestration layer, §10:
 * "writes the biometric-reference collection"). This file exists so Phase 3
 * has an explicit, shared type (not `any`) for the emulator tests to
 * construct documents against, and so later phases import one canonical
 * schema definition rather than re-deriving it from `firestore.rules` prose.
 *
 * Provider-independence (Phase 2 integration): `embedding` reuses
 * `BiometricEmbeddingVector` from the Phase 2 provider abstraction — the
 * Firestore schema is deliberately NOT coupled to DeepFace-specific types;
 * `embeddingModel`/`embeddingModelVersion`/`detectorBackend`/`detectorVersion`
 * are plain strings (stamped values), never a DeepFace SDK type.
 */

import type { BiometricEmbeddingVector } from './providers/BiometricProvider.js';

export const BIOMETRIC_FACE_REFERENCE_SCHEMA_VERSION = 1;

export type BiometricFaceReferenceStatus = 'active' | 'revoked';

/** One entry per prior enrollment/re-enrollment event. Metadata only — the
 * prior embedding vector itself is never retained (§9's retention policy:
 * "never prior raw embeddings, to bound document growth and avoid retaining
 * more biometric material than the active reference needs"). */
export interface BiometricFaceReferenceHistoryEntry {
  readonly enrolledAt: string;
  readonly enrolledBy: string;
  readonly embeddingModel: string;
  readonly embeddingModelVersion: string;
  readonly revokedAt?: string;
}

/**
 * `biometric_face_references/{userId}` — one document per enrolled
 * employee, id == userId (§9: "deterministic `${userId}` is recommended...
 * matches the `${companyId}_settings_${section}` singleton-per-owner
 * convention already established in this codebase").
 *
 * Field mutability (enforced by `firestore.rules`, not just documented
 * here): `id`/`userId`/`companyId`/`groupId`/`enrolledAt`/`enrolledBy`/
 * `schemaVersion` are immutable forever, for every actor including Owner/
 * Super Admin (see firestore.rules' `biometricImmutableFieldsUnchanged()`
 * comment for why). `embedding`/`embeddingModel`/`embeddingModelVersion`/
 * `detectorBackend`/`detectorVersion`/`history`/`reEnrollmentCount` change
 * only via an authorized re-enrollment write (same authorization as
 * create). `status`/`revokedAt`/`revokedBy` change only via an Admin/HR/
 * GroupAdmin/Owner/SuperAdmin write, never self-service.
 */
export interface BiometricFaceReference {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly groupId?: string;

  /** Never a raw image — a fixed-length embedding vector only (§3/§9/§12's
   * hard "never store raw face images" requirement). */
  readonly embedding: BiometricEmbeddingVector;
  readonly embeddingModel: string;
  readonly embeddingModelVersion: string;
  readonly detectorBackend: string;
  readonly detectorVersion: string;

  readonly schemaVersion: number;
  readonly status: BiometricFaceReferenceStatus;

  readonly enrolledAt: string;
  readonly enrolledBy: string;
  readonly reEnrollmentCount: number;
  readonly history: readonly BiometricFaceReferenceHistoryEntry[];

  readonly lastVerifiedAt?: string;

  readonly revokedAt?: string;
  readonly revokedBy?: string;

  // Standard audit-stamp fields (createDocWithId/updateDocById's existing
  // auto-stamp, §9: "Reuse sanitizePayload") — anchored to the real actor
  // identity by firestore.rules, never client-trusted, mirroring every
  // OWNERSHIP-001 fix in the Security Remediation program.
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}
