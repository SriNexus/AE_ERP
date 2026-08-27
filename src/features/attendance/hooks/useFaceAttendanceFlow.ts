/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * `useFaceAttendanceFlow` hook.
 *
 * The single orchestration point behind the unified "Mark Attendance" /
 * "Check In" / "Check Out" employee experience. Composes THREE already-
 * complete, already-tested hooks — never reimplements or duplicates any of
 * their logic, never adds a third API call:
 *
 *   useFaceEnrollmentStatus() — is there already an active reference?
 *   useFaceEnrollment()       — POST /api/biometrics/enroll (Phases 4/6/7)
 *   useFaceAttendance(action) — POST /api/biometrics/verify + GPS +
 *                                AttendanceService.checkIn()/checkOut()
 *                                (Phase 8)
 *
 * First-time flow (no active reference): a single captured frame is sent to
 * enroll() first; on its success, the SAME frame is immediately sent to the
 * existing verify-then-GPS-then-AttendanceService flow — never a second
 * capture, never skipping verification (an enrolled-but-unverified frame
 * could never itself satisfy `AttendanceService`'s biometric anti-replay
 * claim, which only `verify.ts` can mint — see that file's own doc comment).
 * Already-enrolled flow: the frame goes straight to verify/GPS/attendance,
 * identical to Phase 8's own existing behavior, byte-for-byte.
 *
 * Deliberately does NOT touch `useFaceEnrollment.ts`/`useFaceAttendance.ts`
 * themselves — both are used exactly as Phases 7/8 built and tested them,
 * preserving every one of their own structural test guarantees (single
 * endpoint each, no client-supplied identity field, no raw image/embedding
 * persistence, camera-lifecycle ownership staying in `useFaceCapture`).
 */

import { useEffect, useRef, useState } from 'react';
import { useFaceEnrollmentStatus, type BiometricEnrollmentStatus } from './useFaceEnrollmentStatus';
import { useFaceEnrollment } from './useFaceEnrollment';
import { useFaceAttendance, type FaceAttendanceAction } from './useFaceAttendance';

export type FaceAttendanceFlowPhase =
  | 'idle'
  | 'enrolling'
  | 'verifying'
  | 'capturing-location'
  | 'submitting'
  | 'success'
  | 'error';

export function useFaceAttendanceFlow(action: FaceAttendanceAction) {
  const enrollmentStatus = useFaceEnrollmentStatus();
  const enrollment = useFaceEnrollment();
  const attendance = useFaceAttendance(action);

  const pendingBlobRef = useRef<Blob | null>(null);
  const chainedRef = useRef(false);
  // Once this hook instance has itself completed a successful enrollment,
  // treat every SUBSEQUENT submit in this same instance as "already
  // enrolled" regardless of whether the invalidated query has finished
  // refetching yet — never a double-enrollment attempt on a fast retry
  // after a verification-step failure that followed a successful enroll.
  const [enrolledThisSession, setEnrolledThisSession] = useState(false);

  useEffect(() => {
    if (enrollment.status === 'success' && !enrolledThisSession) {
      setEnrolledThisSession(true);
    }
  }, [enrollment.status, enrolledThisSession]);

  useEffect(() => {
    if (enrollment.status === 'success' && pendingBlobRef.current && !chainedRef.current) {
      chainedRef.current = true;
      const blob = pendingBlobRef.current;
      pendingBlobRef.current = null;
      attendance.submit(blob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment.status]);

  const needsEnrollment = !enrolledThisSession && enrollmentStatus.status === 'none';

  // Hard invariant (Critical Bug #1 fix): the enrollment-status query result
  // is `undefined` both while its very first fetch is still in flight AND
  // after it has genuinely failed (`isError`) — in EITHER case, whether this
  // employee has an active reference is NOT YET KNOWN. Previously
  // `needsEnrollment` failed OPEN in this window (anything other than the
  // exact string `'none'` was treated as "already enrolled, go straight to
  // verify"), so a slow or failed status check let a genuinely unenrolled
  // employee's very first auto-captured frame reach `/api/biometrics/verify`
  // directly, which correctly rejects with `NO_ENROLLMENT` — but by then the
  // employee has already seen a confusing "verification failed"-shaped
  // outcome instead of the intended "Register Face" prompt. `submit()` below
  // now refuses to call EITHER enroll or verify while this is true — the
  // auto-capture loop's frames are safely dropped instead (see
  // `FaceAttendanceFlow.tsx`'s own `isEnrollmentStatusUnknown` handling,
  // which also pauses `autoCapture` itself so this is not just a silent
  // no-op but a visible "checking your registration status" state).
  const isEnrollmentStatusUnknown = !enrolledThisSession && enrollmentStatus.status === undefined;

  function submit(blob: Blob) {
    if (isEnrollmentStatusUnknown) return;
    chainedRef.current = false;
    if (needsEnrollment) {
      pendingBlobRef.current = blob;
      enrollment.submit(blob);
    } else {
      pendingBlobRef.current = null;
      attendance.submit(blob);
    }
  }

  function reset() {
    pendingBlobRef.current = null;
    chainedRef.current = false;
    enrollment.reset();
    attendance.reset();
  }

  const phase: FaceAttendanceFlowPhase = (() => {
    if (attendance.status === 'success') return 'success';
    if (enrollment.isSubmitting) return 'enrolling';
    if (attendance.isSubmitting) {
      if (attendance.step === 'verifying') return 'verifying';
      if (attendance.step === 'capturing-location') return 'capturing-location';
      return 'submitting';
    }
    if (attendance.status === 'error' || enrollment.status === 'error') return 'error';
    return 'idle';
  })();

  const errorMessage = attendance.status === 'error'
    ? attendance.errorMessage
    : enrollment.status === 'error'
      ? enrollment.errorMessage
      : null;

  // Live-scan hardening: the raw reason code behind `errorMessage` above —
  // lets the presentation layer (`FaceAttendanceFlow.tsx`'s continuous
  // auto-capture loop) classify a failure as retriable (keep scanning) vs
  // terminal (pause, require an explicit "Try Again"), and specifically
  // recognize a duplicate-check-in/out reconciliation signal, via
  // `faceCaptureSupport.ts`'s `isRetriableBiometricErrorCode()`/
  // `isDuplicateAttendanceErrorCode()`. Same precedence as errorMessage.
  const errorCode = attendance.status === 'error'
    ? attendance.errorCode
    : enrollment.status === 'error'
      ? enrollment.errorCode
      : null;

  return {
    /** `undefined` while not yet known — callers should not render the
     * button until this resolves (or show a neutral loading state). */
    enrollmentStatus: enrollmentStatus.status as BiometricEnrollmentStatus | undefined,
    isEnrollmentStatusLoading: enrollmentStatus.isLoading,
    isEnrollmentStatusError: enrollmentStatus.isError,
    isEnrollmentStatusUnknown,
    /** The real, server-sourced reason the status check failed — see
     * `useFaceEnrollmentStatus.ts`'s own field doc comment. Never replace
     * this with a hardcoded generic string in the UI layer. */
    enrollmentStatusErrorMessage: enrollmentStatus.errorMessage,
    refetchEnrollmentStatus: enrollmentStatus.refetch,
    needsEnrollment,
    phase,
    isSubmitting: enrollment.isSubmitting || attendance.isSubmitting,
    errorMessage,
    errorCode,
    record: attendance.record,
    progress: attendance.progress,
    submit,
    reset,
  };
}
