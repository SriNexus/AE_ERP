/**
 * Phase 6 — Attendance Data Model Types
 *
 * These types define the additive schema extension to the existing
 * `attendance` Firestore collection. Existing `status`/`inTime`/`outTime`/
 * `notes` fields and existing rows are untouched.
 *
 * Source of truth: audit §28, Master Plan §7, Phase 6 specification.
 */

import type { GeoEvidence } from '../../../lib/geo';
import type { BaseRecord } from '../../../types';

// ── Check-in / Check-out sub-record ─────────────────────────
// The immutable sub-object written onto an attendance document.
// Once set, fields may only be modified via the Admin-correction path
// (firestore.rules enforces this via diff().affectedKeys() guards).
export interface AttendanceCheckSubRecord {
  /** ISO 8601 timestamp of the check-in or check-out event */
  timestamp: string;

  /** GPS evidence captured at the time of the event. Absent for `source: 'manual_admin'` entries. */
  location?: GeoEvidence;

  /** ID of the approved attendance location (Warehouse) used for geofence eval */
  approvedLocationId?: string;

  /** Distance from the user to the attendance location center, in meters */
  distanceFromLocationMeters?: number;

  /** Whether the point was within the configured geofence radius */
  withinGeofence: boolean;

  /** Whether GPS accuracy met the company threshold */
  accuracyAccepted: boolean;

  /** How the check-in/out was captured. Extensible for future 'biometric'|'qr'|'nfc' */
  source: 'gps' | 'manual_admin';

  /** Optional device info for auditability */
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
  };
}

// ── Computed status values ──────────────────────────────────
// Written by the rule engine at checkout time. Never overwrites the
// manual `status` field; both are visible simultaneously when both exist.
export type ComputedAttendanceStatus =
  | 'Present'
  | 'Absent'
  | 'HalfDay'
  | 'Late'
  | 'EarlyExit'
  | 'OnLeave'
  | 'Holiday'
  | 'WeeklyOff';

// ── Admin correction sub-record ─────────────────────────────
// Populated only by the Admin-only correction path.
// Paired with a mandatory auditLogger.ts call (Phase 15).
export interface AttendanceCorrection {
  /** Auth UID of the Admin who made the correction */
  correctedBy: string;

  /** ISO 8601 timestamp of the correction */
  correctedAt: string;

  /** Human-readable reason for the correction */
  reason: string;

  /** Snapshot of the values that were overwritten */
  previousValues: Record<string, unknown>;
}

// ── Attendance document (extended) ──────────────────────────
// Extends the existing manual-entry shape additively.
// Old documents simply lack the new optional fields until a check-in
// populates them — no migration required.
export interface AttendanceRecord extends BaseRecord {
  // ── Existing manual-entry fields (untouched, still authoritative for
  // manually-entered records) ──
  employeeId: string;
  employee: string;
  date: string;
  status?: string;       // manual status: 'Present'|'Absent'|'Late'|'Half Day'|'Holiday'|'On Leave'
  inTime?: string;       // manual in-time (free-text)
  outTime?: string;      // manual out-time (free-text)
  notes?: string;        // manual notes

  // ── New additive fields (Phase 6) ──

  /** Check-in sub-record (immutable once set, except via Admin correction) */
  checkIn?: AttendanceCheckSubRecord;

  /** Check-out sub-record (immutable once set, except via Admin correction) */
  checkOut?: AttendanceCheckSubRecord;

  /** Working hours derived at checkout from checkIn/checkOut timestamps */
  workingHours?: number;

  /** Rule-engine output, written once at checkout. Never overwrites manual `status` */
  computedStatus?: ComputedAttendanceStatus;

  /** Which Settings snapshot produced computedStatus, for auditability */
  policyVersion?: string;

  /** Admin-correction audit trail. Populated only by AttendanceService.correctAttendance() */
  correction?: AttendanceCorrection;

  /**
   * Phase 11 — Independently-visible early-exit flag.
   * Computed and persisted at checkout time alongside computedStatus.
   * When Late + EarlyExit co-occur, computedStatus = 'Late' but
   * earlyExit = true, preserving both facts.
   */
  earlyExit?: boolean;
}

// ── Attendance Settings (Phase 9 shape, defined here for type completeness) ──
// Company-scoped, Admin-write/any-member-read per settingsService.ts pattern.
// This interface is defined here so Phase 6/7 can reference it;
// actual Settings persistence is Phase 9.
export interface AttendanceSettings {
  /** Fallback geofence radius when Warehouse has no geofenceRadiusMeters */
  geofenceRadiusDefaultMeters: number;

  /** Reject GPS captures worse than this accuracy (meters) */
  gpsAccuracyThresholdMeters: number;

  /** Minutes after shiftStartTime before marked Late */
  gracePeriodMinutes: number;

  /** Company-default single shift start time ('HH:mm') */
  shiftStartTime: string;

  /** Company-default single shift end time ('HH:mm') */
  shiftEndTime: string;

  /** Worked hours below this (but above 0) => HalfDay */
  halfDayThresholdHours: number;

  /** Reject a captured GeoEvidence whose capturedAt is older than this (seconds) */
  staleLocationMaxAgeSeconds: number;

  /** Extensibility placeholder for future 'biometric'|'qr'|'nfc' */
  checkInMethod: 'gps';

  /** Optional: day-of-week numbers (0=Sunday..6=Saturday) for weekly off */
  weeklyOffDays?: number[];
}

// ── Default attendance settings ──────────────────────────────
// Sensible defaults for the Settings section. Phase 9 will persist these.
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  geofenceRadiusDefaultMeters: 200,
  gpsAccuracyThresholdMeters: 50,
  gracePeriodMinutes: 15,
  shiftStartTime: '09:00',
  shiftEndTime: '18:00',
  halfDayThresholdHours: 4,
  staleLocationMaxAgeSeconds: 300,
  checkInMethod: 'gps',
  weeklyOffDays: [0], // Sunday
};

// ── Attendance check result ──────────────────────────────────
// Return type for AttendanceService.checkIn() / checkOut()
export interface AttendanceCheckResult {
  success: boolean;
  record?: AttendanceRecord;
  error?: string;
  /** Specific reason code for programmatic branching (§16 error handling contract) */
  errorReason?: string;
}
