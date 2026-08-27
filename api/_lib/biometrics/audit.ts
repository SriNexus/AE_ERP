/**
 * Face Attendance + DeepFace Master Plan, Phase 4 — audit writing for the
 * Node orchestration layer.
 *
 * `src/lib/auditLogger.ts`'s own functions (`logCreate`/`logActivity`/etc.)
 * read the acting identity from `useAppStore.getState()` (a browser-only
 * Zustand store) and write via the CLIENT Firebase SDK — neither exists in
 * a Vercel API route's Node process. This module reuses that file's TYPES
 * (`AuditLogEntry`, `AuditActionType`, `AuditSeverity` — pure type-only
 * imports, zero runtime dependency) and its documented BEHAVIOR (append-only
 * writes to `audit_logs`; `severity: 'critical'|'danger'` also dual-writes
 * to `security_logs`) via a direct Admin-SDK write, mirroring the exact,
 * already-established precedent for this in `api/_lib/integrationPlatform.ts`'s
 * `appendAuditLog()` — this is not a new audit architecture, it is that
 * same file's own pattern applied to a second Node-side caller.
 *
 * The acting identity is always the caller's `AuthenticatedUser` — a
 * request payload can never supply/override userId/userEmail/userRole/
 * companyId here (Master Plan Phase 4: "Never accept audit identity from
 * request payloads").
 */

import { getAdminDb } from '../firebase';
import { sanitizePayload } from '../../../src/lib/sanitizer';
import { COLLECTIONS } from '../../../src/lib/collections';
import type { AuditLogEntry, AuditSeverity } from '../../../src/lib/auditLogger';
import type { AuthenticatedUser } from '../auth';
import type { PipelineReason } from '../../../src/lib/biometrics/pipeline/types';
import type { DuplicateFaceWarning } from '../../../src/lib/biometrics/pipeline/duplicateFacePolicy';

export interface BiometricAuditWriter {
  writeEnrollmentEvent(input: {
    actor: AuthenticatedUser;
    targetUserId: string;
    outcome: 'success' | 'failure';
    reason?: PipelineReason;
    embeddingModel?: string;
    embeddingModelVersion?: string;
    detectorBackend?: string;
    /** Master Plan §11/Phase 6: a non-blocking same-company duplicate-face
     * advisory, when one was found. Carries only OTHER employees' userIds
     * (already-known identifiers, not biometric material) — never a raw
     * embedding or distance value. */
    duplicateFaceWarning?: DuplicateFaceWarning;
  }): Promise<void>;
  writeVerificationEvent(input: {
    actor: AuthenticatedUser;
    outcome: 'success' | 'failure';
    reason?: PipelineReason;
    // Rounded, not full precision — kept coarse deliberately (never a raw
    // biometric payload; a distance value is a derived scalar, not an
    // embedding, but is still kept low-precision as an extra margin).
    distanceBucket?: string;
    embeddingModelVersion?: string;
  }): Promise<void>;
}

// Reasons severe enough to also dual-write to security_logs, mirroring
// auditLogger.ts's own documented rule ("severity 'critical'|'danger' also
// written to SECURITY_LOGS") — the security-relevant subset of Master Plan
// §17's list: liveness_failed and any authorization/tenant-scope denial.
const CRITICAL_REASONS = new Set<PipelineReason>([
  'liveness_failed',
  'not_authorized',
  'cross_tenant_denied',
]);

function severityFor(outcome: 'success' | 'failure', reason?: PipelineReason, hasDuplicateFaceWarning = false): AuditSeverity {
  if (outcome === 'success') {
    // A successful enrollment carrying a duplicate-face advisory (§11) is
    // still recorded as 'warning', not 'success' — a fraud/data-entry
    // signal worth an operator's attention, though never severe enough to
    // dual-write to security_logs (that stays reserved for the genuinely
    // security-relevant CRITICAL_REASONS below).
    return hasDuplicateFaceWarning ? 'warning' : 'success';
  }
  if (reason && CRITICAL_REASONS.has(reason)) return 'critical';
  return 'warning';
}

function genAuditId(): string {
  return `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultBiometricAuditWriter(): BiometricAuditWriter {
  const db = getAdminDb();

  async function write(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'status' | 'message' | 'metadata'> & {
    message: string;
    metadata: Record<string, unknown>;
    status: 'success' | 'failure';
  }): Promise<void> {
    const id = genAuditId();
    const fullEntry: AuditLogEntry = {
      id,
      timestamp: new Date().toISOString(),
      source: 'api',
      ...entry,
    };
    try {
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(id).set(sanitizePayload(fullEntry));
      if (fullEntry.severity === 'critical' || fullEntry.severity === 'danger') {
        const secId = `${id}-sec`;
        await db.collection(COLLECTIONS.AUDIT_LOGS).doc(secId).set(sanitizePayload({
          ...fullEntry,
          id: secId,
          module: 'security',
          severity: 'critical',
        }));
      }
    } catch {
      // Audit logging must never break the primary biometric operation
      // (matches AttendanceService.correctAttendance()'s own established
      // "correction succeeded, audit warning only" precedent, and
      // integrationPlatform.ts's appendAuditLogSafely()).
    }
  }

  return {
    async writeEnrollmentEvent({ actor, targetUserId, outcome, reason, embeddingModel, embeddingModelVersion, detectorBackend, duplicateFaceWarning }) {
      await write({
        userId: actor.erpUserId,
        userEmail: actor.email,
        userRole: actor.role,
        companyId: actor.companyId,
        action: 'biometric_enrollment',
        entityType: 'biometric_face_reference',
        entityId: targetUserId,
        module: 'attendance',
        status: outcome,
        severity: severityFor(outcome, reason, !!duplicateFaceWarning),
        message: outcome === 'success'
          ? `Biometric enrollment succeeded for ${targetUserId}`
          : `Biometric enrollment failed for ${targetUserId}: ${reason || 'unknown'}`,
        metadata: {
          reason: reason || null,
          embeddingModel: embeddingModel || null,
          embeddingModelVersion: embeddingModelVersion || null,
          detectorBackend: detectorBackend || null,
          onBehalfOf: targetUserId !== actor.erpUserId,
          // Other employees' userIds only (already-known identifiers, not
          // biometric material) — never a raw embedding or distance value,
          // per §17's own "never embeddings" rule extended to this signal.
          duplicateFaceSuspectedOfUserIds: duplicateFaceWarning ? duplicateFaceWarning.suspectedDuplicateOfUserIds : null,
        },
      });
    },
    async writeVerificationEvent({ actor, outcome, reason, distanceBucket, embeddingModelVersion }) {
      await write({
        userId: actor.erpUserId,
        userEmail: actor.email,
        userRole: actor.role,
        companyId: actor.companyId,
        action: 'biometric_verification',
        entityType: 'biometric_face_reference',
        entityId: actor.erpUserId,
        module: 'attendance',
        status: outcome,
        severity: severityFor(outcome, reason),
        message: outcome === 'success'
          ? 'Biometric verification succeeded'
          : `Biometric verification failed: ${reason || 'unknown'}`,
        metadata: {
          reason: reason || null,
          distanceBucket: distanceBucket || null,
          embeddingModelVersion: embeddingModelVersion || null,
        },
      });
    },
  };
}
