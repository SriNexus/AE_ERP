/**
 * Phase 7 — useCheckIn hook
 *
 * TanStack Query mutation hook wrapping AttendanceService.checkIn().
 * Follows useMarkAttendance()'s existing shape (toast on success/error,
 * query invalidation of the same ['attendance'] query key).
 *
 * Data flow:
 *   UI → useCheckIn().mutate()
 *       → captureLocation() (Geo Platform)
 *       → AttendanceService.checkIn(location)
 *       → evaluateGeofence() + accuracy check
 *       → Firestore upsert
 *       → UI update (toast + query invalidation)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { captureLocationWithRetry, type GeoCaptureError, type CaptureProgressInfo } from '../../../lib/geo';
import { AttendanceService, AttendanceCheckError } from '../../../services/AttendanceService';
import { loadSettings } from '../../settings/services/settingsService';
import { normalizeAttendanceSettings } from '../../settings/attendanceRuntime';
import { describeCheckInToast } from '../toastMessages';
import toast from 'react-hot-toast';
import type { AttendanceCheckResult } from '../types';

// ── Error reason to user-facing message (§16 Error Handling Contract) ──
function describeGeoCaptureErrorReason(reason: GeoCaptureError['reason']): string {
  switch (reason) {
    case 'permission_denied':
      return 'Location permission was denied. Enable location access for this site and try again.';
    case 'position_unavailable':
      return 'Your device could not determine its location right now. Try again in an open area.';
    case 'timeout':
      return 'Location capture timed out. Try again — this can take longer indoors or with a weak signal.';
    case 'unsupported':
      return 'GPS is not available on this device.';
    default:
      return 'Location capture failed. Please try again.';
  }
}

// ═══════════════════════════════════════════════════════════════════
// Check-in status for UI state machine
// ═══════════════════════════════════════════════════════════════════

export type CheckInStatus = 'idle' | 'capturing' | 'validating' | 'success' | 'error';

export interface UseCheckInReturn {
  /** Current status of the check-in flow */
  status: CheckInStatus;
  /** The persisted attendance record after successful check-in */
  record: import('../types').AttendanceRecord | null;
  /** Error message if check-in failed */
  errorMessage: string | null;
  /** Error reason code for programmatic branching */
  errorReason: string | null;
  /** Whether a check-in is currently in progress */
  isCapturing: boolean;
  /**
   * Live GPS-acquisition progress (§10 of the production-fix brief) — set
   * while `status === 'capturing'`, so the UI can show "Getting your
   * location… Best accuracy so far: ±82m" instead of a silent spinner.
   * `null` when not currently capturing.
   */
  progress: CaptureProgressInfo | null;
  /** Trigger the check-in flow */
  checkIn: () => void;
  /** Reset to idle state */
  reset: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useCheckIn(): UseCheckInReturn {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<CaptureProgressInfo | null>(null);

  const mutation = useMutation<AttendanceCheckResult, Error, void>({
    mutationFn: async () => {
      setProgress(null);

      // ── Step 0: Read the company's accuracy target (§17: no scattered
      // magic numbers — the GPS retry loop's target comes from the same
      // AttendanceSettings the final decision is judged against). ────
      const settings = normalizeAttendanceSettings(await loadSettings('attendance').catch(() => null));

      // ── Step 1: Capture GPS (bounded retry for accuracy) ───
      let location;
      try {
        location = await captureLocationWithRetry({
          enableHighAccuracy: true,
          targetAccuracyMeters: settings.gpsAccuracyThresholdMeters,
          onProgress: (info) => setProgress(info),
        });
      } catch (err) {
        // Map GeoCaptureError to user-facing message per §16
        if (err && typeof err === 'object' && 'reason' in err) {
          const geoErr = err as GeoCaptureError;
          const message = describeGeoCaptureErrorReason(geoErr.reason);
          throw new AttendanceCheckError(geoErr.reason, message);
        }
        throw new AttendanceCheckError('unknown', 'An unexpected error occurred while capturing location.');
      }

      // ── Step 2: Validate + persist via AttendanceService ────
      return AttendanceService.checkIn(location);
    },
    onSuccess: (result) => {
      // Invalidate the same query key useAttendance() uses
      qc.invalidateQueries({ queryKey: ['attendance'] });
      // Small, auto-dismissing toast — employee, time, geofence status.
      // Never a modal (Attendance page redesign spec §6).
      toast.success(describeCheckInToast(result.record?.employee || '', result.record?.checkIn));
      setProgress(null);
    },
    onError: (err) => {
      // Toast is NOT shown here — the component reads errorMessage/state
      // to show the specific failure message per §16's error handling contract.
      // Only show a generic toast for truly unexpected errors.
      if (!(err instanceof AttendanceCheckError)) {
        toast.error('Something went wrong. Please try again.');
      }
      setProgress(null);
    },
  });

  // Derive state from mutation
  const status: CheckInStatus = (() => {
    if (mutation.isPending) return 'capturing';
    if (mutation.isSuccess) return 'success';
    if (mutation.isError) return 'error';
    return 'idle';
  })();

  const errorReason = mutation.error instanceof AttendanceCheckError
    ? mutation.error.reason
    : null;

  const errorMessage = mutation.error instanceof AttendanceCheckError
    ? mutation.error.message
    : mutation.isError
      ? 'Something went wrong. Please try again.'
      : null;

  return {
    status,
    record: mutation.data?.record ?? null,
    errorMessage,
    errorReason,
    progress: mutation.isPending ? progress : null,
    isCapturing: mutation.isPending,
    checkIn: () => mutation.mutate(),
    reset: () => { mutation.reset(); setProgress(null); },
  };
}
