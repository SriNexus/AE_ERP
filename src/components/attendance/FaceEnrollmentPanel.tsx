/**
 * Face Attendance + DeepFace Master Plan, Phase 7 — `FaceEnrollmentPanel`.
 *
 * Composes `FaceCapture` (generic camera UX) with `useFaceEnrollment`
 * (the existing `POST /api/biometrics/enroll` boundary, Phases 4/6) into a
 * complete, usable enrollment flow — the concrete UI this phase's own
 * "Expected outcomes: a real, usable camera capture flow for... enrollment"
 * line requires.
 *
 * SELF-ENROLLMENT ONLY in this phase — a deliberate, recorded scope
 * decision (see the master document's Phase 7 completion record): no
 * `targetUserId` is ever sent, matching this session's own instruction
 * ("For self-enrollment, use the authenticated user's context rather than
 * allowing arbitrary user selection"). Building an Admin/HR "enroll on
 * behalf of" employee-picker is a separate, larger UI surface not listed in
 * this phase's own file scope (`src/components/attendance/FaceCapture.tsx`
 * + its state-machine hook) — the backend (Phase 4/6) already fully
 * supports it server-side; only the picker UI is deferred, exactly the
 * same kind of documented boundary Phase 6 itself already drew for
 * GroupAdmin cross-company on-behalf-of enrollment.
 */

import { useRef } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import FaceCapture from './FaceCapture';
import { useFaceEnrollment } from '../../features/attendance/hooks/useFaceEnrollment';

export default function FaceEnrollmentPanel() {
  const enrollment = useFaceEnrollment();
  const lastBlobRef = useRef<Blob | null>(null);

  function handleCapture(blob: Blob) {
    lastBlobRef.current = blob;
    enrollment.submit(blob);
  }

  function handleRetrySubmit() {
    if (lastBlobRef.current) enrollment.submit(lastBlobRef.current);
  }

  if (enrollment.status === 'success' && enrollment.result) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-success-bg, rgba(34,197,94,0.08))', borderColor: 'var(--color-success-border, rgba(34,197,94,0.3))' }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
            {enrollment.result.reEnrolled ? 'Face re-enrolled' : 'Face enrolled'}
          </span>
        </div>

        {/* Master Plan §11's duplicate-face policy result — surfaced here
            without ever rendering the OTHER employee's userId into the DOM
            (this phase is self-enrollment only; there is no Admin/HR actor
            context to show a specific matched identity to, and doing so to
            a self-enrolling employee would leak another employee's
            enrollment state). A neutral, non-identifying advisory only. */}
        {enrollment.result.duplicateFaceWarning && (
          <div
            className="mt-2 text-xs p-2 rounded flex items-start gap-1.5"
            style={{ background: 'var(--color-warning-bg, rgba(245,158,11,0.1))', color: 'var(--color-warning, var(--color-text-secondary))' }}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>A similar face was detected on another account. If this seems unexpected, contact HR.</span>
          </div>
        )}

        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={enrollment.reset}>
            Enroll Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FaceCapture
        title="Enroll Your Face"
        onCapture={handleCapture}
        isSubmitting={enrollment.status === 'submitting'}
      />

      {enrollment.status === 'error' && enrollment.errorMessage && (
        <div
          className="mt-2 text-xs p-2 rounded flex items-center justify-between gap-2"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
        >
          <span>{enrollment.errorMessage}</span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRetrySubmit}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
