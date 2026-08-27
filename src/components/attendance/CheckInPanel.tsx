/**
 * Phase 7 + 8 — CheckInPanel
 *
 * Self-service attendance panel, reusable by both desktop and mobile.
 *
 * Product-integration follow-up (post-Phase-13): this panel now shows
 * exactly ONE primary attendance action — never two independent controls
 * (a plain GPS button plus a separate biometric icon, as earlier phases
 * had). Tapping it always opens the same in-app camera experience
 * (`FaceAttendanceFlow`, front camera by default), which performs face
 * verification (or, for a first-time employee, registration immediately
 * followed by verification — never a second capture) THEN GPS THEN the
 * existing `AttendanceService` write — exactly Phase 8's existing,
 * unmodified biometric+GPS pipeline. GPS capture/validation is never
 * skipped or weakened; it is simply no longer offered as a
 * "skip the camera" option on this primary control (the separate, existing
 * `ManualAttendancePanel` — a true no-GPS/no-biometric fallback — is
 * untouched and still available alongside this panel).
 *
 * State model:
 *   NO ACTIVE ENROLLMENT   → "Mark Attendance" (registers face, then checks in)
 *   ENROLLED, NOT CHECKED IN → "Check In"
 *   CHECKED IN, NOT CHECKED OUT → "Checked In" summary + "Check Out"
 *   CHECKED OUT → "Checked Out" summary, no action (today is complete)
 *   REVOKED ENROLLMENT → a clear message, no camera offered (Phase 9's
 *     revocation policy — self-service must never bypass it)
 */

import { useEffect, useState } from 'react';
import { MapPin, CheckCircle2, AlertTriangle, Clock, Camera, Loader2 } from 'lucide-react';
import { Button, Modal } from '../ui';
import FaceAttendanceFlow from './FaceAttendanceFlow';
import { useFaceEnrollmentStatus } from '../../features/attendance/hooks/useFaceEnrollmentStatus';
import { deriveAttendanceButtonState } from '../../features/attendance/services/attendanceButtonState';
import type { FaceAttendanceAction } from '../../features/attendance/hooks/useFaceAttendance';
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
// Component
// ═══════════════════════════════════════════════════════════════════

export default function CheckInPanel({ todayRecord, isLoading }: CheckInPanelProps) {
  const enrollmentStatus = useFaceEnrollmentStatus();

  // Which action the camera modal is currently open for — mirrors this
  // component's own prior `biometricMode` convention: cleared automatically
  // once the parent's `todayRecord` confirms the action actually succeeded
  // (the authoritative source, not a local success flag), or immediately on
  // explicit cancel.
  const [cameraAction, setCameraAction] = useState<FaceAttendanceAction | null>(null);

  const isCheckedIn = !!todayRecord?.checkIn;
  const isCheckedOut = !!todayRecord?.checkOut;

  useEffect(() => {
    if (cameraAction === 'checkIn' && isCheckedIn) setCameraAction(null);
  }, [cameraAction, isCheckedIn]);
  useEffect(() => {
    if (cameraAction === 'checkOut' && isCheckedOut) setCameraAction(null);
  }, [cameraAction, isCheckedOut]);

  const buttonState = deriveAttendanceButtonState(todayRecord, enrollmentStatus.status);

  // ── Render: Checked Out state (terminal — no action offered) ──
  if (isCheckedOut && todayRecord?.checkOut) {
    const workingHours = todayRecord.workingHours;
    const checkoutIsGps = todayRecord.checkOut.source === 'gps' || todayRecord.checkOut.source === 'biometric';
    const checkoutOutsideGeofence = checkoutIsGps && !todayRecord.checkOut.withinGeofence;
    const checkoutLowAccuracy = checkoutIsGps && !todayRecord.checkOut.accuracyAccepted;

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
                {new Date(todayRecord.checkOut.timestamp).toLocaleTimeString()}
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

  // ── Render: revoked enrollment — self-service must never bypass this ──
  if (enrollmentStatus.status === 'revoked') {
    return (
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-danger-bg, rgba(239,68,68,0.08))', borderColor: 'var(--color-danger-border, rgba(239,68,68,0.3))' }}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
              Face Attendance Unavailable
            </span>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Your biometric enrollment has been revoked. Contact HR or an administrator to re-enable Face Attendance.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const openCamera = () => buttonState.action && setCameraAction(buttonState.action);
  const closeCamera = () => setCameraAction(null);
  const modalTitle = cameraAction === 'checkOut' ? 'Check Out' : buttonState.isFirstTimeSetup ? 'Set Up Face Attendance' : 'Check In';

  // ── Render: Checked In (not yet checked out) ───────────────
  if (isCheckedIn && todayRecord?.checkIn) {
    return (
      <>
        <div
          className="rounded-lg border p-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
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
                    background: todayRecord.checkIn.source !== 'manual_admin'
                      ? 'var(--color-success-bg, rgba(34,197,94,0.15))'
                      : 'var(--color-bg-elevated)',
                    color: todayRecord.checkIn.source !== 'manual_admin'
                      ? 'var(--color-success)'
                      : 'var(--color-text-muted)',
                  }}
                >
                  {todayRecord.checkIn.source === 'biometric' ? 'Face Verified'
                    : todayRecord.checkIn.source === 'gps' ? 'GPS Verified' : 'Manual'}
                </span>
              </div>

              <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(todayRecord.checkIn.timestamp).toLocaleTimeString()}
                  {todayRecord.checkIn.location?.address && (
                    <span className="ml-2">
                      · {todayRecord.checkIn.location.address}
                    </span>
                  )}
                </div>
                {typeof todayRecord.checkIn.distanceFromLocationMeters === 'number' && (
                  <div className="mt-0.5">
                    {Math.round(todayRecord.checkIn.distanceFromLocationMeters)}m from work location
                  </div>
                )}
              </div>
            </div>

            <div className="flex-shrink-0">
              <Button
                size="sm"
                icon={<Camera className="h-3.5 w-3.5" />}
                onClick={openCamera}
                disabled={isLoading || enrollmentStatus.isLoading}
              >
                Check Out
              </Button>
            </div>
          </div>
        </div>

        <Modal open={cameraAction === 'checkOut'} onClose={closeCamera} title={modalTitle} size="sm">
          <FaceAttendanceFlow action="checkOut" onCancel={closeCamera} />
        </Modal>
      </>
    );
  }

  // ── Render: Not checked in yet (idle) — ONE primary action ──
  return (
    <>
      <div
        className="rounded-lg border p-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5" style={{ color: 'var(--color-text-muted)' }} />

          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
              {buttonState.isFirstTimeSetup ? 'Set up Face Attendance to mark today' : 'Ready to Check In'}
            </span>
          </div>

          <div className="flex-shrink-0">
            <Button
              size="sm"
              icon={enrollmentStatus.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              onClick={openCamera}
              disabled={isLoading || enrollmentStatus.isLoading}
            >
              {buttonState.label}
            </Button>
          </div>
        </div>
      </div>

      <Modal open={cameraAction === 'checkIn'} onClose={closeCamera} title={modalTitle} size="sm">
        <FaceAttendanceFlow action="checkIn" onCancel={closeCamera} />
      </Modal>
    </>
  );
}
