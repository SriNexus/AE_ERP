/**
 * Phase 8 — useCheckOut hook
 *
 * TanStack Query mutation hook wrapping AttendanceService.checkOut().
 * Follows the same pattern as useCheckIn() from Phase 7.
 *
 * Data flow:
 *   UI → useCheckOut().mutate()
 *       → captureLocation() (Geo Platform)
 *       → AttendanceService.checkOut(location)
 *       → evaluateGeofence() (flag only, never block)
 *       → workingHours calculation
 *       → Firestore update (checkOut + workingHours)
 *       → UI update (toast + query invalidation)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { captureLocationWithRetry, type GeoCaptureError } from '../../../lib/geo';
import { AttendanceService, AttendanceCheckError } from '../../../services/AttendanceService';
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
// Check-out status for UI state machine
// ═══════════════════════════════════════════════════════════════════

export type CheckOutStatus = 'idle' | 'capturing' | 'success' | 'error';

export interface UseCheckOutReturn {
  /** Current status of the check-out flow */
  status: CheckOutStatus;
  /** The persisted attendance record after successful check-out */
  record: import('../types').AttendanceRecord | null;
  /** Error message if check-out failed */
  errorMessage: string | null;
  /** Error reason code for programmatic branching */
  errorReason: string | null;
  /** Whether a check-out is currently in progress */
  isCapturing: boolean;
  /** Trigger the check-out flow */
  checkOut: () => void;
  /** Reset to idle state */
  reset: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useCheckOut(): UseCheckOutReturn {
  const qc = useQueryClient();

  const mutation = useMutation<AttendanceCheckResult, Error, void>({
    mutationFn: async () => {
      // ── Step 1: Capture GPS (bounded retry for accuracy) ───
      let location;
      try {
        location = await captureLocationWithRetry({
          enableHighAccuracy: true,
          timeoutMs: 10_000,
          totalTimeoutMs: 20_000,
          retryIntervalMs: 2_000,
          targetAccuracyMeters: 50,
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'reason' in err) {
          const geoErr = err as GeoCaptureError;
          const message = describeGeoCaptureErrorReason(geoErr.reason);
          throw new AttendanceCheckError(geoErr.reason, message);
        }
        throw new AttendanceCheckError('unknown', 'An unexpected error occurred while capturing location.');
      }

      // ── Step 2: Validate + persist via AttendanceService ────
      return AttendanceService.checkOut(location);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Check-out successful!');
    },
    onError: (err) => {
      if (!(err instanceof AttendanceCheckError)) {
        toast.error('Something went wrong. Please try again.');
      }
    },
  });

  const status: CheckOutStatus = (() => {
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
    isCapturing: mutation.isPending,
    checkOut: () => mutation.mutate(),
    reset: () => mutation.reset(),
  };
}
