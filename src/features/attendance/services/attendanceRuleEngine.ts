/**
 * Phase 9 — Attendance Rule Engine
 *
 * Pure, deterministic, side-effect-free function that computes
 * `computedStatus` from a completed check-in/check-out pair
 * plus attendance policy settings.
 *
 * Architecture:
 *   UI → AttendanceService.checkOut()
 *       → computeStatus(record, settings)  ← THIS MODULE
 *       → writes computedStatus + policyVersion
 *
 * This module MUST NOT import:
 *   - Firebase / Firestore
 *   - UI components
 *   - Zustand store
 *   - React hooks
 *
 * Source of truth: Master Plan Phase 9, audit §28, §18.
 */

import type { AttendanceRecord, AttendanceSettings, ComputedAttendanceStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Precedence Order (Master Plan Phase 9, explicitly documented)
//
// computedStatus is a SINGLE enum value — must resolve conflicts.
//
// Precedence (highest to lowest):
//   1. HalfDay     — worked meaningfully less than expected (most consequential for payroll)
//   2. Late        — arrived after grace period (more actionable than early exit)
//   3. EarlyExit   — left before shift end (less actionable than late arrival)
//   4. Present     — worked full expected duration, on time
//
// Combined scenarios:
//   Late + HalfDay      → HalfDay  (HalfDay takes precedence)
//   Late + EarlyExit    → Late     (Late takes precedence over EarlyExit)
//   HalfDay + EarlyExit → HalfDay  (HalfDay takes precedence)
//   Late + HalfDay + EarlyExit → HalfDay (HalfDay takes precedence)
//
// Non-attendance statuses (set by admin, not computed):
//   OnLeave, Holiday, WeeklyOff — these bypass the rule engine entirely
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a time string "HH:mm" into minutes since midnight.
 * Returns NaN if invalid.
 */
function parseTimeToMinutes(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

/**
 * Extract the time-of-day in minutes from an ISO 8601 timestamp.
 */
function timestampToTimeMinutes(timestamp: string): number {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return NaN;
  // Use UTC hours to match the UTC timestamps used throughout the system
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * Calculate the expected full-day working hours from shift times.
 * E.g., shiftStartTime='09:00', shiftEndTime='18:00' → 9 hours.
 */
function expectedFullDayHours(settings: AttendanceSettings): number {
  const start = parseTimeToMinutes(settings.shiftStartTime);
  const end = parseTimeToMinutes(settings.shiftEndTime);
  if (isNaN(start) || isNaN(end)) return 8; // fallback
  const diff = end - start;
  return diff > 0 ? diff / 60 : ((1440 - start + end) / 60); // handle overnight shifts
}

/**
 * Determine if the check-in was late (after grace period).
 */
function isLateArrival(checkInTimestamp: string, settings: AttendanceSettings): boolean {
  const arrivalMinutes = timestampToTimeMinutes(checkInTimestamp);
  const graceEnd = parseTimeToMinutes(settings.shiftStartTime) + settings.gracePeriodMinutes;
  if (isNaN(arrivalMinutes) || isNaN(graceEnd)) return false;
  return arrivalMinutes > graceEnd;
}

/**
 * Determine if the employee left early (before shift end).
 * Uses the check-out timestamp's time-of-day.
 */
function isEarlyDeparture(checkOutTimestamp: string, settings: AttendanceSettings): boolean {
  const departureMinutes = timestampToTimeMinutes(checkOutTimestamp);
  const shiftEnd = parseTimeToMinutes(settings.shiftEndTime);
  if (isNaN(departureMinutes) || isNaN(shiftEnd)) return false;
  return departureMinutes < shiftEnd;
}

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the `computedStatus` for an attendance record.
 *
 * Rules:
 * - If no checkIn exists → 'Absent'
 * - If checkIn exists but no checkOut → undefined (incomplete — UI layer concern)
 * - If workingHours < halfDayThresholdHours → 'HalfDay'
 * - If check-in is after grace period → 'Late'
 * - If check-out is before shift end → 'EarlyExit'
 * - Combined Late+EarlyExit → 'Late' (arrival is more actionable)
 * - Combined HalfDay+Late/EarlyExit → 'HalfDay' (most consequential)
 * - Otherwise → 'Present'
 *
 * Manual `status` is NEVER overwritten by this function.
 * The caller decides how to handle manual vs computed status.
 *
 * @param record - The attendance record (must have checkIn/checkOut)
 * @param settings - The attendance policy settings
 * @returns The computed status, or undefined if incomplete (no checkOut yet)
 */
export function computeStatus(
  record: AttendanceRecord,
  settings: AttendanceSettings,
): ComputedAttendanceStatus | undefined {
  // ── No check-in → Absent or WeeklyOff ────────────────────
  // Phase 12: if the attendance date is a configured weekly-off day
  // and no check-in exists, return 'WeeklyOff' instead of 'Absent'.
  // A real check-in on a weekly-off day still computes normally
  // (weekly-off is a default-when-absent, not an override-when-present).
  if (!record.checkIn) {
    if (record.date && Array.isArray(settings.weeklyOffDays) && settings.weeklyOffDays.length > 0) {
      const dateObj = new Date(record.date + 'T12:00:00.000Z'); // noon UTC to avoid timezone edge cases
      if (!isNaN(dateObj.getTime())) {
        const dayOfWeek = dateObj.getUTCDay(); // 0=Sunday..6=Saturday
        if (settings.weeklyOffDays.includes(dayOfWeek)) {
          return 'WeeklyOff';
        }
      }
    }
    return 'Absent';
  }

  // ── No check-out → incomplete (undefined) ──────────────────
  // The Master Plan says: "Incomplete" is NOT a stored enum value.
  // The UI detects incompleteness by: checkIn exists + checkOut absent + computedStatus absent.
  if (!record.checkOut) {
    return undefined;
  }

  // ── Has both check-in and check-out → evaluate policy ──────
  const workingHours = record.workingHours ?? 0;
  const expectedHours = expectedFullDayHours(settings);
  const halfDayThreshold = settings.halfDayThresholdHours;

  // Compute individual flags
  const late = isLateArrival(record.checkIn.timestamp, settings);
  const earlyExit = isEarlyDeparture(record.checkOut.timestamp, settings);
  const shortDay = workingHours < halfDayThreshold;
  const fullDay = workingHours >= expectedHours;

  // ── Apply precedence order ─────────────────────────────────
  // HalfDay is most consequential (affects payroll most)
  if (shortDay) {
    return 'HalfDay';
  }

  // Late + EarlyExit → Late (arrival is more actionable)
  if (late && earlyExit) {
    return 'Late';
  }

  // Late only
  if (late) {
    return 'Late';
  }

  // EarlyExit only
  if (earlyExit) {
    return 'EarlyExit';
  }

  // Full/near-full day, on time
  return 'Present';
}

/**
 * Generate a policy version string from the current settings.
 * Used for historical traceability — once computed, the policyVersion
 * on an attendance record must never change.
 */
/**
 * Phase 11 — Determine if the employee left before shift end.
 *
 * This is an independent, pure computation kept separate from computeStatus()
 * so Phase 9's contract is not broken. The result is persisted as `earlyExit`
 * alongside computedStatus at checkout time.
 *
 * When both Late and EarlyExit occur:
 *   - computedStatus = 'Late' (Phase 9 precedence: arrival more actionable)
 *   - earlyExit = true (both facts preserved independently)
 *
 * @param record - Must have checkOut.timestamp to evaluate
 * @param settings - Shift end time from attendance policy
 * @returns true if checkout time is before shift end time
 */
export function hasEarlyExit(
  record: AttendanceRecord,
  settings: AttendanceSettings,
): boolean {
  if (!record.checkOut?.timestamp) return false;
  return isEarlyDeparture(record.checkOut.timestamp, settings);
}

export function generatePolicyVersion(settings: AttendanceSettings): string {
  // Simple version: hash of key settings values
  // This is intentionally not a complex versioning system —
  // the key requirement is that settings changes produce a different version string
  const key = [
    settings.shiftStartTime,
    settings.shiftEndTime,
    settings.gracePeriodMinutes,
    settings.halfDayThresholdHours,
    settings.gpsAccuracyThresholdMeters,
    settings.geofenceRadiusDefaultMeters,
  ].join(':');

  // Simple deterministic hash (not cryptographic — just for differentiation)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `att-v1-${Math.abs(hash).toString(36)}`;
}
