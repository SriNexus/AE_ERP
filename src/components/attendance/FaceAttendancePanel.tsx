/**
 * Face Attendance + DeepFace Master Plan, Phase 8 — `FaceAttendancePanel`.
 *
 * Composes `FaceCapture` (Phase 7, generic, decision-free — reused exactly
 * as-is, per this phase's own "carries into Phase 8+" line) with
 * `useFaceAttendance` (this phase's new orchestration hook) into the
 * complete biometric check-in/check-out UI: capture → server verification →
 * GPS capture → the existing `AttendanceService` write path → success/error.
 *
 * Self-service only, exactly like the GPS path it supplements — always
 * operates on `auth.currentUser`'s own identity, never a selectable target.
 */

import { useRef } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import FaceCapture from './FaceCapture';
import { useFaceAttendance, type FaceAttendanceAction } from '../../features/attendance/hooks/useFaceAttendance';

export interface FaceAttendancePanelProps {
  action: FaceAttendanceAction;
  onCancel?: () => void;
}

function describeStep(step: 'verifying' | 'capturing-location' | 'submitting' | null): string | null {
  switch (step) {
    case 'verifying':
      return 'Verifying your identity…';
    case 'capturing-location':
      return 'Confirming your location…';
    case 'submitting':
      return 'Saving attendance…';
    default:
      return null;
  }
}

export default function FaceAttendancePanel({ action, onCancel }: FaceAttendancePanelProps) {
  const attendance = useFaceAttendance(action);
  const lastBlobRef = useRef<Blob | null>(null);

  function handleCapture(blob: Blob) {
    lastBlobRef.current = blob;
    attendance.submit(blob);
  }

  function handleRetrySubmit() {
    if (lastBlobRef.current) attendance.submit(lastBlobRef.current);
  }

  if (attendance.status === 'success') {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-success-bg, rgba(34,197,94,0.08))', borderColor: 'var(--color-success-border, rgba(34,197,94,0.3))' }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
            {action === 'checkIn' ? 'Checked in with face verification' : 'Checked out with face verification'}
          </span>
        </div>
      </div>
    );
  }

  const stepLabel = describeStep(attendance.step);

  return (
    <div>
      <FaceCapture
        title={action === 'checkIn' ? 'Check In with Face' : 'Check Out with Face'}
        onCapture={handleCapture}
        isSubmitting={attendance.isSubmitting}
        onCancel={onCancel}
      />

      {attendance.isSubmitting && stepLabel && (
        <div role="status" aria-live="polite" className="mt-2 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          {stepLabel}
          {attendance.step === 'capturing-location' && typeof attendance.progress?.bestAccuracyMeters === 'number' && (
            <> — best accuracy so far: ±{Math.round(attendance.progress.bestAccuracyMeters)}m</>
          )}
        </div>
      )}

      {attendance.status === 'error' && attendance.errorMessage && (
        <div
          className="mt-2 text-xs p-2 rounded flex items-center justify-between gap-2"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {attendance.errorMessage}
          </span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRetrySubmit}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
