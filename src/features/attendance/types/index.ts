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

  /** ID of the approved attendance location (Warehouse or Company) used for geofence eval */
  approvedLocationId?: string;

  /** Name of the matched Warehouse/Company, denormalized at write time so the
   * Attendance detail view never needs a second fetch (and keeps showing the
   * name that was actually used, even if the location is later renamed). */
  approvedLocationName?: string;

  /** Whether the matched location was the employee's assigned Warehouse or the Company fallback. */
  approvedLocationSource?: 'warehouse' | 'company';

  /** Saved/verified address of the matched Warehouse/Company at check-in/out time. */
  approvedLocationAddress?: string;

  /** The geofence radius (metres) that was actually used for this evaluation. */
  geofenceRadiusMeters?: number;

  /** Latitude/longitude of the matched Warehouse/Company's configured centre (distinct from the employee's own recorded GPS in `location`). */
  approvedLocationLatitude?: number;
  approvedLocationLongitude?: number;

  /** Distance from the user to the attendance location center, in meters */
  distanceFromLocationMeters?: number;

  /** Whether the point was within the configured geofence radius */
  withinGeofence: boolean;

  /**
   * Whether GPS accuracy was usable at all (finite, positive, and within
   * `gpsAccuracyCeilingMeters`). Renamed in meaning (not in field name, to
   * avoid a schema migration) by the production geofence-accuracy fix:
   * this used to mean "accuracy met the strict target threshold" — a
   * single hard gate independent of distance, which rejected legitimate
   * nearby check-ins purely for having a noisy GPS chip. It now means
   * "accuracy was good enough to reason about at all" — the actual
   * within-fence decision, including how the device's uncertainty was
   * weighed against distance, is recorded in `geoConfidence` below.
   */
  accuracyAccepted: boolean;

  /**
   * Confidence grade behind `withinGeofence`, from
   * `evaluateGeofenceWithConfidence()` (src/lib/geo.ts) — 'high' (worst
   * case still inside the fence), 'medium' (best estimate inside),
   * 'low' (best estimate outside, but plausible given reported GPS
   * uncertainty), or 'none' (rejected). Absent on pre-fix records and on
   * `source: 'manual_admin'` entries, which never went through geofence
   * evaluation at all.
   */
  geoConfidence?: 'high' | 'medium' | 'low' | 'none';

  /**
   * How the check-in/out was captured. Extensible for future 'qr'|'nfc'.
   * Phase 8 (Face Attendance + DeepFace Master Plan §14) adds `'biometric'`
   * — additive only; existing `'gps'`/`'manual_admin'` values and their
   * behavior are completely unchanged. A `'biometric'` check-in/out still
   * captures and validates GPS exactly like the `'gps'` path (§12: biometric
   * verification SUPPLEMENTS GPS attendance, it never replaces it) — this
   * field only records which additional identity/liveness gate was passed
   * before the existing GPS pipeline ran.
   */
  source: 'gps' | 'manual_admin' | 'biometric';

  /**
   * Phase 8 addition. Present only when `source === 'biometric'`. Carries
   * the server-derived proof of the verification event this check-in/out
   * was gated on — `AttendanceService.checkIn()`/`checkOut()` independently
   * re-reads the caller's own `biometric_face_references` document and
   * requires this value to match its `lastVerifiedAt` field exactly, within
   * a short freshness window, before accepting the write (see that file's
   * `validateBiometricVerificationClaim()`) — never trusted as a bare claim.
   * Never a raw embedding, distance, or any other biometric payload — just
   * an ISO timestamp string, for traceability only.
   */
  biometricVerificationId?: string;

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
  /**
   * Default Geofence Radius pre-filled when an admin adds a NEW Warehouse
   * or configures the Company attendance location — a UI convenience, not
   * a runtime fallback. A location's own `geofenceRadiusMeters` remains
   * genuinely required for that location to be attendance-ready
   * (`AttendanceService.hasValidGeo()`/`resolveAttendanceLocation()` never
   * substitute this value for a missing per-location radius — see
   * docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md Finding F1 for why
   * that specific fallback was rejected as the fix).
   */
  geofenceRadiusDefaultMeters: number;

  /**
   * Target/"good" GPS accuracy (meters). `captureLocationWithRetry()` aims
   * for this and stops retrying early once achieved; it is also the
   * boundary between the 'good' and 'acceptable' GPS quality tiers shown
   * to the user. It is NOT a hard reject threshold — see
   * `gpsAccuracyCeilingMeters` for that.
   */
  gpsAccuracyThresholdMeters: number;

  /**
   * Hard-reject accuracy ceiling (meters) — a reading worse than this is
   * treated as too unreliable to reason about at all and is rejected
   * outright ('gps_unusable'), regardless of distance. Below this ceiling,
   * accuracy is folded into the geofence decision as uncertainty rather
   * than gated independently — see `evaluateGeofenceWithConfidence()`
   * (src/lib/geo.ts) and AttendanceService.checkIn()/checkOut().
   */
  gpsAccuracyCeilingMeters: number;

  /**
   * Maximum acceptable spread (meters) between the multiple GPS readings
   * `captureLocationWithRetry()` collects within one capture window. A
   * larger spread means the device's own fixes disagree with each other
   * beyond what normal GPS noise explains — rejected as
   * 'location_inconsistent' rather than silently averaged/trusted.
   */
  locationConsistencyMaxSpreadMeters: number;

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
  gpsAccuracyCeilingMeters: 150,
  locationConsistencyMaxSpreadMeters: 250,
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
