/**
 * useSelfAttendance — Manual Attendance hook
 *
 * TanStack Query mutation wrapping AttendanceService.markAttendance(): a
 * single-click, no-GPS self-service action. There is no employeeId/date/
 * time input — the server determines the current user, the current
 * instant, and whether this call is a Check In or a Check Out.
 *
 * Follows useCheckIn()/useCheckOut()'s shape (toast on success/error, same
 * ['attendance'] query-key invalidation) so ManualAttendancePanel can sit
 * next to CheckInPanel using the same interaction pattern.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AttendanceService, AttendanceCheckError } from '../../../services/AttendanceService';
import toast from 'react-hot-toast';
import type { AttendanceCheckResult, AttendanceRecord } from '../types';

export type SelfAttendanceStatus = 'idle' | 'marking' | 'success' | 'error';

export interface UseSelfAttendanceReturn {
  /** Current status of the mark-attendance flow */
  status: SelfAttendanceStatus;
  /** The persisted attendance record after a successful call */
  record: AttendanceRecord | null;
  /** Which action the last successful call performed */
  action: 'checkIn' | 'checkOut' | null;
  /** Error message if the call failed */
  errorMessage: string | null;
  /** Error reason code for programmatic branching */
  errorReason: string | null;
  /** Whether a call is currently in progress */
  isMarking: boolean;
  /** Trigger the mark-attendance flow */
  mark: () => void;
  /** Reset to idle state */
  reset: () => void;
}

export function useSelfAttendance(): UseSelfAttendanceReturn {
  const qc = useQueryClient();

  const mutation = useMutation<AttendanceCheckResult & { action: 'checkIn' | 'checkOut' }, Error, void>({
    mutationFn: () => AttendanceService.markAttendance(),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      toast.success(result.action === 'checkIn' ? 'Checked in!' : 'Checked out!');
    },
    onError: (err) => {
      if (!(err instanceof AttendanceCheckError)) {
        toast.error('Something went wrong. Please try again.');
      }
    },
  });

  const status: SelfAttendanceStatus = (() => {
    if (mutation.isPending) return 'marking';
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
    action: mutation.data?.action ?? null,
    errorMessage,
    errorReason,
    isMarking: mutation.isPending,
    mark: () => mutation.mutate(),
    reset: () => mutation.reset(),
  };
}
