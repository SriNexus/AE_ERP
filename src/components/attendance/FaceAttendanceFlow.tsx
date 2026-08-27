/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * `FaceAttendanceFlow`.
 *
 * Camera-first live verification hardening pass: the employee never
 * presses a "Capture" button for normal attendance. Once the camera is
 * live, frames are sampled automatically (`FaceCapture`'s own
 * `autoCapture` mode) and submitted through the existing
 * `useFaceAttendanceFlow` pipeline — the SAME server-side enroll/verify/
 * GPS/AttendanceService boundary Phase 4–8 already built and tested,
 * never bypassed, never duplicated. A rejected attempt (no face, poor
 * quality, wrong face, etc.) just updates the on-screen guidance and the
 * scan keeps going; only a genuinely terminal failure (network, provider
 * down, revoked, rate-limited, a GPS/geofence policy failure) pauses
 * scanning and asks for an explicit "Try Again" tap — never a silent
 * request storm against the backend.
 *
 * Reuses the existing, generic `FaceCapture` component exactly (no
 * parallel camera implementation, front camera default, permission/
 * unavailable/insecure-context handling, guaranteed stream cleanup — all
 * inherited unchanged from `useFaceCapture.ts`/`faceCaptureSupport.ts`).
 *
 * Never exposes internal detail (thresholds, distances, provider/model
 * names, raw reason codes) — every message shown here is either the
 * existing `describeEnrollmentErrorCode()`/`describeVerificationErrorCode()`
 * terminal-error text (Phase 7/8, unchanged) or the new, short
 * `describeLiveScanGuidance()` scan-in-progress text — never a raw code.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, ScanFace } from 'lucide-react';
import { Button } from '../ui';
import FaceCapture from './FaceCapture';
import { useFaceAttendanceFlow } from '../../features/attendance/hooks/useFaceAttendanceFlow';
import { describeLiveScanGuidance, isDuplicateAttendanceErrorCode, isRetriableBiometricErrorCode } from '../../features/attendance/services/faceCaptureSupport';
import type { FaceAttendanceAction } from '../../features/attendance/hooks/useFaceAttendance';

export interface FaceAttendanceFlowProps {
  action: FaceAttendanceAction;
  /** Called once, the moment the whole flow (enroll-if-needed + verify + GPS
   * + AttendanceService) completes successfully — or a `duplicate_check_in`/
   * `duplicate_check_out` reconciliation determines the attendance state
   * the employee wanted already exists server-side. */
  onSuccess?: () => void;
  /** The camera's own cancel affordance (§16's "always-reachable non-visual
   * fallback"). Also invoked automatically when the enclosing modal/sheet is
   * dismissed by its own close control. */
  onCancel?: () => void;
}

/** How long the success view stays visible before `onSuccess` fires and the
 * caller closes the camera — long enough to read, short enough to feel
 * instant ("Do not require another click... do not leave the camera
 * running behind the success modal" — the camera itself has ALREADY
 * stopped by this point, since `FaceCapture` is unmounted the instant this
 * branch renders; only the confirmation banner lingers). */
const SUCCESS_DISPLAY_MS = 1400;

function describeStep(phase: 'enrolling' | 'verifying' | 'capturing-location' | 'submitting'): string {
  switch (phase) {
    case 'enrolling':
      return 'Registering your face…';
    case 'verifying':
      return 'Verifying your identity…';
    case 'capturing-location':
      return 'Confirming your location…';
    case 'submitting':
      return 'Saving attendance…';
  }
}

export default function FaceAttendanceFlow({ action, onSuccess, onCancel }: FaceAttendanceFlowProps) {
  const flow = useFaceAttendanceFlow(action);
  const qc = useQueryClient();
  const notifiedRef = useRef(false);

  // First-time enrollment requires one explicit "Register Face" tap before
  // automatic scanning begins — a deliberate consent step (§16: "never
  // silently enroll a face without a clear user action"), distinct from
  // routine verification, which is fully automatic from the moment the
  // employee taps Check In/Check Out. The camera is already live (front
  // camera, auto-started) so the employee can see themselves before
  // confirming — only frame SAMPLING is gated on this flag.
  const [enrollmentConfirmed, setEnrollmentConfirmed] = useState(false);

  // A TERMINAL biometric/attendance failure (network, provider down,
  // revoked, rate-limited, a GPS/geofence policy failure — see
  // `isRetriableBiometricErrorCode()`'s own doc comment for the exact
  // classification) pauses automatic scanning until the employee
  // explicitly taps "Try Again" — never an unattended request storm
  // against a genuinely failing backend. A RETRIABLE outcome (no face,
  // wrong face, poor quality, ...) never sets this — the scan loop simply
  // continues on its own next tick.
  const [pausedForTerminalError, setPausedForTerminalError] = useState(false);

  const isDuplicateReconciliation = flow.phase === 'error' && isDuplicateAttendanceErrorCode(flow.errorCode);

  useEffect(() => {
    if (flow.phase !== 'error') return;
    if (isDuplicateAttendanceErrorCode(flow.errorCode)) return; // handled as reconciliation below, never a pause
    if (!isRetriableBiometricErrorCode(flow.errorCode)) {
      setPausedForTerminalError(true);
    }
  }, [flow.phase, flow.errorCode]);

  // `duplicate_check_in`/`duplicate_check_out` — AttendanceService's own
  // pre-existing duplicate-write guard — means the attendance state the
  // employee wanted already exists server-side (most likely: an earlier
  // attempt's write actually landed but its response was lost to a
  // network hiccup, and this retry just proved it). Reconciled from the
  // server (a fresh `['attendance']` refetch), never shown as a scary
  // error and never blindly retried — exactly this session's own
  // "resolve uncertainty from the server, don't duplicate the write"
  // resilience requirement.
  useEffect(() => {
    if (isDuplicateReconciliation && !notifiedRef.current) {
      notifiedRef.current = true;
      qc.invalidateQueries({ queryKey: ['attendance'] });
      const t = setTimeout(() => onSuccess?.(), SUCCESS_DISPLAY_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDuplicateReconciliation]);

  useEffect(() => {
    if (flow.phase === 'success' && !notifiedRef.current) {
      notifiedRef.current = true;
      const t = setTimeout(() => onSuccess?.(), SUCCESS_DISPLAY_MS);
      return () => clearTimeout(t);
    }
  }, [flow.phase, onSuccess]);

  function handleCapture(blob: Blob) {
    // The camera is already live (front camera, auto-started) while a
    // first-time employee is still reading the "not registered yet" prompt
    // — `FaceCapture` itself has no separate "live preview, not scanning
    // yet" mode (that would mean a THIRD UI variant just for this one
    // brief moment), so it keeps sampling frames the whole time; they are
    // simply discarded here, silently, until the employee explicitly taps
    // "Register Face". No network call, no submission, happens before that
    // tap — satisfies "never silently enroll a face without a clear user
    // action" without adding another camera-component mode.
    if (awaitingEnrollmentConfirmation) return;
    flow.submit(blob);
  }

  function handleTryAgain() {
    setPausedForTerminalError(false);
    flow.reset();
  }

  const showSuccessView = flow.phase === 'success' || isDuplicateReconciliation;

  if (showSuccessView) {
    const label = isDuplicateReconciliation
      ? (action === 'checkIn' ? "You're already checked in" : "You're already checked out")
      : flow.needsEnrollment
        ? (action === 'checkIn' ? 'Face registered — checked in' : 'Face registered — checked out')
        : (action === 'checkIn' ? 'Checked in with face verification' : 'Checked out with face verification');
    return (
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-success-bg, rgba(34,197,94,0.08))', borderColor: 'var(--color-success-border, rgba(34,197,94,0.3))' }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
        </div>
      </div>
    );
  }

  const captureTitle = flow.needsEnrollment
    ? 'Set Up Face Attendance'
    : action === 'checkIn' ? 'Check In with Face' : 'Check Out with Face';

  const stepLabel = flow.isSubmitting && flow.phase !== 'idle' && flow.phase !== 'error' && flow.phase !== 'success'
    ? describeStep(flow.phase)
    : null;

  // What the live camera shows while scanning: the current processing step
  // ("Verifying your identity…") while a request is in flight, otherwise
  // the short guidance for the LAST retriable rejection (if any), otherwise
  // a neutral "position your face" prompt. Never the raw server reason
  // code, never a terminal-error's own longer message (that gets its own
  // distinct banner below, with a "Try Again" action, once paused).
  // Critical Bug #1 fix: while it is not yet KNOWN whether this employee has
  // an active face reference (first fetch still in flight, or the status
  // check itself failed), never show the normal scan guidance and never let
  // the auto-capture loop submit anything — `useFaceAttendanceFlow.submit()`
  // already refuses this server-side-equivalent case defensively, but the
  // camera should visibly say so rather than silently dropping frames.
  const scanMessage = flow.isEnrollmentStatusUnknown
    ? 'Checking your registration status…'
    : stepLabel
      || (flow.phase === 'error' && isRetriableBiometricErrorCode(flow.errorCode) ? describeLiveScanGuidance(flow.errorCode) : undefined);
  const scanTone: 'muted' | 'danger' = flow.phase === 'error' && isRetriableBiometricErrorCode(flow.errorCode) ? 'danger' : 'muted';

  const awaitingEnrollmentConfirmation = flow.needsEnrollment && !enrollmentConfirmed;

  return (
    <div>
      {awaitingEnrollmentConfirmation ? (
        <div className="text-center py-4 mb-1">
          <ScanFace className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
            Your face is not registered yet
          </p>
          <p className="text-xs max-w-xs mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }}>
            This will register your face and mark today's attendance. You will only need to do this once.
          </p>
          <Button size="sm" icon={<ScanFace className="h-3.5 w-3.5" />} onClick={() => setEnrollmentConfirmed(true)}>
            Register Face
          </Button>
        </div>
      ) : null}

      <FaceCapture
        title={captureTitle}
        onCapture={handleCapture}
        isSubmitting={flow.isSubmitting}
        onCancel={onCancel}
        autoStart
        autoCapture={!pausedForTerminalError && !flow.isEnrollmentStatusUnknown}
        scanMessage={awaitingEnrollmentConfirmation ? 'Tap "Register Face" below to begin.' : scanMessage}
        scanTone={scanTone}
      />

      {pausedForTerminalError && flow.phase === 'error' && flow.errorMessage && (
        <div
          className="mt-2 text-xs p-2 rounded flex items-center justify-between gap-2"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {flow.errorMessage}
          </span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleTryAgain}>
            Try Again
          </Button>
        </div>
      )}

      {/* Critical Bug #1 fix: the enrollment-status check itself failed
          (not merely still loading) — never silently fall through to
          verification. Gives the employee a real retry, not an indefinite
          "Checking your registration status…" spinner.
          Shows the REAL server-sourced reason (`enrollmentStatusErrorMessage`)
          — never a hardcoded "check your connection" string. Collapsing
          every failure into a network-sounding message previously hid a
          genuine server-side problem (a missing local API server, or a
          missing Admin SDK credential) behind a misleading diagnosis. */}
      {flow.isEnrollmentStatusUnknown && flow.isEnrollmentStatusError && (
        <div
          className="mt-2 text-xs p-2 rounded flex items-center justify-between gap-2"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
        >
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {flow.enrollmentStatusErrorMessage || 'Could not determine face enrollment status.'}
          </span>
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => flow.refetchEnrollmentStatus()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
