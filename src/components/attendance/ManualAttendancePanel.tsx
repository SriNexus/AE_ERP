/**
 * ManualAttendancePanel — one-click, no-GPS self-service attendance
 *
 * Sibling to CheckInPanel (the GPS mechanism) — same card treatment, same
 * size, placed beside it in a 2-column "Attendance Actions" row, never above
 * it as an oversized standalone section.
 *
 * There is no employee/date/time form here. A single click identifies the
 * current user, captures the current instant, and lets the server decide
 * whether this is a Check In or a Check Out (AttendanceService.
 * markAttendance()). State model mirrors CheckInPanel's three phases:
 *   NO ATTENDANCE TODAY → "Mark Attendance" (performs Check In)
 *   CHECKED IN           → "Mark Attendance" (performs Check Out)
 *   CHECKED OUT           → terminal, read-only summary
 */

import { Fingerprint, CheckCircle2, AlertTriangle, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '../ui';
import { useSelfAttendance, type SelfAttendanceStatus } from '../../features/attendance/hooks/useSelfAttendance';
import type { AttendanceRecord } from '../../features/attendance/types';

interface ManualAttendancePanelProps {
  /** Today's existing attendance record (if already checked in/out via any source) */
  todayRecord?: AttendanceRecord | null;
  /** Whether the record is still loading */
  isLoading?: boolean;
}

function StatusIcon({ status }: { status: SelfAttendanceStatus }) {
  switch (status) {
    case 'marking':
      return <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-primary)' }} />;
    case 'error':
      return <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />;
    default:
      return <Fingerprint className="h-5 w-5" style={{ color: 'var(--color-text-muted)' }} />;
  }
}

export default function ManualAttendancePanel({ todayRecord, isLoading }: ManualAttendancePanelProps) {
  const self = useSelfAttendance();

  const displayRecord = self.status === 'success' ? self.record : todayRecord;
  const isCheckedIn = !!displayRecord?.checkIn;
  const isCheckedOut = !!displayRecord?.checkOut;
  const workingHours = displayRecord?.workingHours;

  // ── Render: Checked Out (terminal) ─────────────────────────
  if (isCheckedOut && displayRecord?.checkOut) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          background: 'var(--color-success-bg, rgba(34,197,94,0.08))',
          borderColor: 'var(--color-success-border, rgba(34,197,94,0.3))',
        }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
                Checked Out
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'var(--color-success-bg, rgba(34,197,94,0.15))', color: 'var(--color-success)' }}
              >
                Complete
              </span>
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(displayRecord.checkOut.timestamp).toLocaleTimeString()}
              </div>
              {typeof workingHours === 'number' && (
                <div className="mt-0.5 font-medium" style={{ color: 'var(--color-text)' }}>
                  {workingHours.toFixed(2)} hrs worked
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Checked In (not yet checked out) ───────────────
  if (isCheckedIn && displayRecord?.checkIn) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          background: self.status === 'error' ? 'var(--color-danger-bg, rgba(239,68,68,0.08))' : 'var(--color-surface)',
          borderColor: self.status === 'error' ? 'var(--color-danger-border, rgba(239,68,68,0.3))' : 'var(--color-border)',
        }}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
                Checked In
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: displayRecord.checkIn.source === 'gps'
                    ? 'var(--color-success-bg, rgba(34,197,94,0.15))'
                    : 'var(--color-bg-elevated)',
                  color: displayRecord.checkIn.source === 'gps'
                    ? 'var(--color-success)'
                    : 'var(--color-text-muted)',
                }}
              >
                {displayRecord.checkIn.source === 'gps' ? 'GPS Verified' : 'Manual'}
              </span>
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(displayRecord.checkIn.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>

          <div className="flex-shrink-0">
            {self.status === 'marking' ? (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-primary)' }}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Marking…
              </div>
            ) : self.status === 'error' ? (
              <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={self.reset}>
                Retry
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={<Fingerprint className="h-3.5 w-3.5" />}
                onClick={self.mark}
                disabled={isLoading}
              >
                Mark Attendance
              </Button>
            )}
          </div>
        </div>

        {self.status === 'error' && self.errorMessage && (
          <div
            className="mt-2 text-xs p-2 rounded"
            style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
          >
            {self.errorMessage}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Not checked in yet (idle / marking / error) ────
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: self.status === 'error' ? 'var(--color-danger-bg, rgba(239,68,68,0.08))' : 'var(--color-surface)',
        borderColor: self.status === 'error' ? 'var(--color-danger-border, rgba(239,68,68,0.3))' : 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <StatusIcon status={self.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
              {self.status === 'marking' ? 'Marking Attendance…' :
               self.status === 'error' ? 'Attendance Failed' :
               'Ready to Mark Attendance'}
            </span>
          </div>

          {self.status === 'error' && self.errorMessage && (
            <div
              className="mt-2 text-xs p-2 rounded"
              style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', color: 'var(--color-danger)' }}
            >
              {self.errorMessage}
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          {self.status === 'error' ? (
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={self.reset}>
              Retry
            </Button>
          ) : (
            <Button
              size="sm"
              icon={self.status === 'marking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
              onClick={self.mark}
              disabled={self.status === 'marking' || isLoading}
            >
              {self.status === 'marking' ? 'Marking…' : 'Mark Attendance'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
