/**
 * Face Attendance — final completion pass: Employee-View "Register Face".
 *
 * The PRIMARY, recommended path for registering an employee's face —
 * launched from the Employee View popup (`Employees.tsx`'s "Face
 * Registration" card), not from Check In/Check Out. An Admin/HR user opens
 * an employee's profile and captures that employee's face on their behalf.
 *
 * Reuses the EXISTING, unmodified biometric enrollment pipeline end-to-end —
 * `useFaceEnrollment(targetUserId)` → `POST /api/biometrics/enroll` →
 * `enrollBiometricFace()` → `resolveEnrollmentTarget()` (Admin/HR/SuperAdmin,
 * same company only) → Detect/Quality/Liveness/Embedding → persist. No new
 * enrollment endpoint, no client-side biometric decision, no raw image
 * persisted (the captured Blob is converted to base64 only transiently,
 * immediately before the request — see `faceCaptureSupport.ts`).
 *
 * Deliberately NOT `FaceAttendanceFlow` — this flow only enrolls; it never
 * verifies, never captures GPS, never calls `AttendanceService`. Reuses the
 * SAME generic `FaceCapture` camera component (camera-first, auto-capture,
 * no manual "Capture" button) and the SAME retriable/terminal error
 * classification (`faceCaptureSupport.ts`) `FaceAttendanceFlow.tsx` uses, so
 * the live-scan UX is consistent across both surfaces. No enrollment-consent
 * gate is needed here (unlike the self-service Check In/Out first-time
 * flow) — opening this modal via an explicit "Register Face" click already
 * IS the deliberate action; there is no ambiguity about intent to gate.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import FaceCapture from './FaceCapture';
import { useFaceEnrollment } from '../../features/attendance/hooks/useFaceEnrollment';
import { describeLiveScanGuidance, isRetriableBiometricErrorCode } from '../../features/attendance/services/faceCaptureSupport';

export interface EmployeeFaceRegistrationFlowProps {
  /** The employee's linked `users/{id}` identity — biometric references are
   * keyed by this, never by the `employees` collection's own doc id. */
  targetUserId: string;
  /** Called once, shortly after a successful enrollment. */
  onSuccess?: () => void;
  onCancel?: () => void;
}

/** Same success-display duration as `FaceAttendanceFlow.tsx` — long enough
 * to read, short enough to feel instant. */
const SUCCESS_DISPLAY_MS = 1400;

export default function EmployeeFaceRegistrationFlow({ targetUserId, onSuccess, onCancel }: EmployeeFaceRegistrationFlowProps) {
  const enrollment = useFaceEnrollment(targetUserId);
  const notifiedRef = useRef(false);

  // A TERMINAL failure (not authorized, cross-tenant, provider unavailable,
  // network, rate-limited...) pauses the auto-capture loop and requires an
  // explicit "Try Again" — mirrors `FaceAttendanceFlow.tsx`'s own pattern
  // exactly, using the SAME classification function. A RETRIABLE outcome
  // (no face, poor quality, ...) never sets this; the next auto-captured
  // frame is a safe, cheap retry.
  const [pausedForTerminalError, setPausedForTerminalError] = useState(false);

  useEffect(() => {
    if (enrollment.status !== 'error') return;
    if (!isRetriableBiometricErrorCode(enrollment.errorCode)) {
      setPausedForTerminalError(true);
    }
  }, [enrollment.status, enrollment.errorCode]);

  useEffect(() => {
    if (enrollment.status === 'success' && !notifiedRef.current) {
      notifiedRef.current = true;
      const t = setTimeout(() => onSuccess?.(), SUCCESS_DISPLAY_MS);
      return () => clearTimeout(t);
    }
  }, [enrollment.status, onSuccess]);

  function handleCapture(blob: Blob) {
    enrollment.submit(blob);
  }

  function handleTryAgain() {
    setPausedForTerminalError(false);
    enrollment.reset();
  }

  if (enrollment.status === 'success') {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-success-bg, rgba(34,197,94,0.08))', borderColor: 'var(--color-success-border, rgba(34,197,94,0.3))' }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
            {enrollment.result?.reEnrolled ? 'Face re-registered successfully' : 'Face registered successfully'}
          </span>
        </div>
      </div>
    );
  }

  const isRetriable = enrollment.status === 'error' && isRetriableBiometricErrorCode(enrollment.errorCode);
  const scanMessage = enrollment.isSubmitting
    ? 'Registering face…'
    : (isRetriable ? describeLiveScanGuidance(enrollment.errorCode) : undefined);
  const scanTone: 'muted' | 'danger' = isRetriable ? 'danger' : 'muted';

  return (
    <div>
      <FaceCapture
        title="Register Face"
        onCapture={handleCapture}
        isSubmitting={enrollment.isSubmitting}
        onCancel={onCancel}
        autoStart
        autoCapture={!pausedForTerminalError}
        scanMessage={scanMessage}
        scanTone={scanTone}
      />

      {pausedForTerminalError && enrollment.status === 'error' && enrollment.errorMessage && (
        <div
          className="mt-2 text-xs p-2 rounded flex items-center justify-between gap-2"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {enrollment.errorMessage}
          </span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleTryAgain}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
