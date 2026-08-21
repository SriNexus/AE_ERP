/**
 * Phase 7 + 8 — CheckInPanel
 *
 * Self-service GPS Check-In / Check-Out panel, reusable by both desktop and mobile.
 * Phase 8 extends Phase 7's check-in panel with:
 * - Check-Out button when checked in but not checked out
 * - Working hours display after checkout
 * - Checkout outside-geofence warning (flag, not failure)
 * - Checkout state machine: idle → capturing → success/error
 *
 * State model:
 *   BEFORE CHECK-IN → "Check In" button
 *   AFTER CHECK-IN  → "Checked In" + check-in time + "Check Out" button
 *   DURING CHECK-OUT → "Capturing Location…"
 *   AFTER CHECK-OUT → "Checked Out" + check-out time + working hours
 */

import { MapPin, CheckCircle2, AlertTriangle, Clock, RefreshCw, Loader2, LogOut } from 'lucide-react';
import { Button } from '../ui';
import { useCheckIn, type CheckInStatus } from '../../features/attendance/hooks/useCheckIn';
import { useCheckOut, type CheckOutStatus } from '../../features/attendance/hooks/useCheckOut';
import type { AttendanceRecord } from '../../features/attendance/types';

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

interface CheckInPanelProps {
  /** Today's existing attendance record (if already checked in or manually marked) */
  todayRecord?: AttendanceRecord | null;
  /** Whether the record is still loading */
  isLoading?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Status display helpers
// ═══════════════════════════════════════════════════════════════════

function CheckInStatusIcon({ status }: { status: CheckInStatus }) {
  switch (status) {
    case 'capturing':
      return <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-primary)' }} />;
    case 'success':
      return <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />;
    case 'error':
      return <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />;
    default:
      return <MapPin className="h-5 w-5" style={{ color: 'var(--color-text-muted)' }} />;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function CheckInPanel({ todayRecord, isLoading }: CheckInPanelProps) {
  const checkInHook = useCheckIn();
  const checkOutHook = useCheckOut();

  // Determine current state
  const alreadyCheckedIn = !!todayRecord?.checkIn;
  const isCheckedIn = alreadyCheckedIn || checkInHook.status === 'success';
  const isCheckedOut = !!todayRecord?.checkOut;
  const displayRecord = checkInHook.status === 'success' ? checkInHook.record : todayRecord;

  // Use the most up-to-date record (post-checkout mutation data takes precedence)
  const finalRecord = checkOutHook.record || displayRecord;

  // Check-out geofence warning — only meaningful for GPS-sourced evidence.
  // A manual_admin checkout (no location captured at all) also defaults
  // withinGeofence/accuracyAccepted to false, which must NOT be displayed
  // as "checkout was outside the work area" — there was no measurement,
  // GPS or otherwise, to be outside of.
  const checkoutIsGps = finalRecord?.checkOut?.source === 'gps';
  const checkoutOutsideGeofence = isCheckedOut && checkoutIsGps && !finalRecord!.checkOut!.withinGeofence;
  const checkoutLowAccuracy = isCheckedOut && checkoutIsGps && !finalRecord!.checkOut!.accuracyAccepted;

  // Working hours display
  const workingHours = finalRecord?.workingHours;

  // ── Render: Checked Out state ──────────────────────────────
  if (isCheckedOut && finalRecord?.checkOut) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          background: 'var(--color-success-bg, rgba(34,197,94,0.08))',
          borderColor: checkoutOutsideGeofence
            ? 'var(--color-warning-border, rgba(245,158,11,0.3))'
            : 'var(--color-success-border, rgba(34,197,94,0.3))',
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
                style={{
                  background: 'var(--color-success-bg, rgba(34,197,94,0.15))',
                  color: 'var(--color-success)',
                }}
              >
                Complete
              </span>
            </div>

            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(finalRecord.checkOut.timestamp).toLocaleTimeString()}
              </div>
              {typeof workingHours === 'number' && (
                <div className="mt-0.5 font-medium" style={{ color: 'var(--color-text)' }}>
                  {workingHours.toFixed(2)} hrs worked
                </div>
              )}
              {checkoutOutsideGeofence && (
                <div
                  className="mt-1 text-xs p-1.5 rounded"
                  style={{
                    background: 'var(--color-warning-bg, rgba(245,158,11,0.1))',
                    color: 'var(--color-warning, var(--color-text-secondary))',
                  }}
                >
                  Checkout location was outside the work area
                </div>
              )}
              {checkoutLowAccuracy && !checkoutOutsideGeofence && (
                <div
                  className="mt-1 text-xs p-1.5 rounded"
                  style={{
                    background: 'var(--color-warning-bg, rgba(245,158,11,0.1))',
                    color: 'var(--color-warning, var(--color-text-secondary))',
                  }}
                >
                  Location accuracy warning
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
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
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
                {displayRecord.checkIn.location?.address && (
                  <span className="ml-2">
                    · {displayRecord.checkIn.location.address}
                  </span>
                )}
              </div>
              {typeof displayRecord.checkIn.distanceFromLocationMeters === 'number' && (
                <div className="mt-0.5">
                  {Math.round(displayRecord.checkIn.distanceFromLocationMeters)}m from work location
                </div>
              )}
            </div>
          </div>

          {/* Check Out button */}
          <div className="flex-shrink-0">
            {checkOutHook.status === 'capturing' ? (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-primary)' }}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Capturing…
              </div>
            ) : checkOutHook.status === 'error' ? (
              <Button
                size="sm"
                variant="outline"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={checkOutHook.reset}
              >
                Retry
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                icon={<LogOut className="h-3.5 w-3.5" />}
                onClick={checkOutHook.checkOut}
                disabled={checkOutHook.isCapturing || isLoading}
              >
                Check Out
              </Button>
            )}
          </div>
        </div>

        {/* Check-out error message */}
        {checkOutHook.status === 'error' && checkOutHook.errorMessage && (
          <div
            className="mt-2 text-xs p-2 rounded"
            style={{
              background: 'var(--color-danger-bg, rgba(239,68,68,0.1))',
              color: 'var(--color-danger)',
            }}
          >
            {checkOutHook.errorMessage}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Not checked in yet (idle / capturing / error) ───
  const { status, errorMessage, isCapturing, checkIn, reset } = checkInHook;

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: status === 'error'
          ? 'var(--color-danger-bg, rgba(239,68,68,0.08))'
          : 'var(--color-surface)',
        borderColor: status === 'error'
          ? 'var(--color-danger-border, rgba(239,68,68,0.3))'
          : 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <CheckInStatusIcon status={status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
              {status === 'capturing' ? 'Capturing Location…' :
               status === 'error' ? 'Check-In Failed' :
               'Ready to Check In'}
            </span>
          </div>

          {/* Error message */}
          {status === 'error' && errorMessage && (
            <div
              className="mt-2 text-xs p-2 rounded"
              style={{
                background: 'var(--color-danger-bg, rgba(239,68,68,0.1))',
                color: 'var(--color-danger)',
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0">
          {status === 'error' ? (
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={reset}
            >
              Retry
            </Button>
          ) : (
            <Button
              size="sm"
              icon={isCapturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              onClick={checkIn}
              disabled={isCapturing || isLoading}
            >
              {isCapturing ? 'Capturing…' : 'Check In'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
