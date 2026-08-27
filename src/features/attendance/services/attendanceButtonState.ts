/**
 * Face Attendance product-integration follow-up (post-Phase-13) —
 * pure, framework-free derivation of the ONE primary attendance action's
 * label/target, shared by the mobile (`CheckInPanel.tsx`) and desktop
 * (`Attendance.tsx` header) surfaces so both stay in lock-step without
 * duplicating this decision. Deterministic, no Firebase/React dependency —
 * matches this codebase's own established convention for UI-tier decision
 * logic (`attendanceRuleEngine.ts`, `faceCaptureSupport.ts`).
 *
 * The employee must see exactly ONE action, never two independent controls:
 *   no active biometric reference  -> "Mark Attendance" (enroll, then check in)
 *   active reference, not checked in today -> "Check In"
 *   checked in, not checked out -> "Check Out"
 *   checked out -> no action (today's attendance is complete)
 */

import type { BiometricEnrollmentStatus } from '../hooks/useFaceEnrollmentStatus';
import type { FaceAttendanceAction } from '../hooks/useFaceAttendance';

export interface AttendanceButtonState {
  /** `null` only when today's attendance is already complete (checked out)
   * — no action should be offered at all. */
  action: FaceAttendanceAction | null;
  label: string;
  /** True when the label reflects a first-time enrollment (copy changes,
   * see `FaceAttendanceFlow`'s own "Set Up Face Attendance" framing). */
  isFirstTimeSetup: boolean;
}

export function deriveAttendanceButtonState(
  todayRecord: { checkIn?: unknown; checkOut?: unknown } | null | undefined,
  enrollmentStatus: BiometricEnrollmentStatus | undefined,
): AttendanceButtonState {
  const isCheckedIn = !!todayRecord?.checkIn;
  const isCheckedOut = !!todayRecord?.checkOut;

  if (isCheckedOut) {
    return { action: null, label: '', isFirstTimeSetup: false };
  }

  const isFirstTimeSetup = enrollmentStatus === 'none';

  if (isCheckedIn) {
    return { action: 'checkOut', label: 'Check Out', isFirstTimeSetup: false };
  }

  return {
    action: 'checkIn',
    label: isFirstTimeSetup ? 'Mark Attendance' : 'Check In',
    isFirstTimeSetup,
  };
}
