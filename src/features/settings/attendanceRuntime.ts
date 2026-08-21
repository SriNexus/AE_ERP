/**
 * Phase 9 — Attendance Settings Runtime
 *
 * Normalization/validation for the Attendance Settings section.
 * Follows the existing per-section runtime convention
 * (appearanceRuntime.ts, documentRuntime.ts, emailRuntime.ts).
 *
 * Requirements:
 * - defensive: invalid values fall back to safe defaults
 * - deterministic: same input → same output
 * - pure: no side effects, no Firestore, no UI
 * - preserves documented units (hours, meters, minutes, seconds)
 */

import type { AttendanceSettings } from '../attendance/types';

// ── Defaults ─────────────────────────────────────────────────

export const ATTENDANCE_SETTINGS_DEFAULTS: AttendanceSettings = {
  geofenceRadiusDefaultMeters: 200,
  gpsAccuracyThresholdMeters: 50,
  gracePeriodMinutes: 15,
  shiftStartTime: '09:00',
  shiftEndTime: '18:00',
  halfDayThresholdHours: 4,
  staleLocationMaxAgeSeconds: 300,
  checkInMethod: 'gps',
  weeklyOffDays: [0],
};

// ── Helpers ──────────────────────────────────────────────────

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function toTimeString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return fallback;
}

function toWeeklyOffDays(value: unknown): number[] {
  if (!Array.isArray(value)) return ATTENDANCE_SETTINGS_DEFAULTS.weeklyOffDays!;
  const valid = value.filter(
    (d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 6,
  );
  return valid.length > 0 ? valid : ATTENDANCE_SETTINGS_DEFAULTS.weeklyOffDays!;
}

// ── Normalization ────────────────────────────────────────────

/**
 * Normalize and validate raw attendance settings from Firestore.
 * Invalid/missing values fall back to safe defaults.
 * Does not mutate the input.
 */
export function normalizeAttendanceSettings(
  raw: Record<string, unknown> | null | undefined,
): AttendanceSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...ATTENDANCE_SETTINGS_DEFAULTS };
  }

  return {
    geofenceRadiusDefaultMeters: toNumber(
      raw.geofenceRadiusDefaultMeters,
      ATTENDANCE_SETTINGS_DEFAULTS.geofenceRadiusDefaultMeters,
    ),
    gpsAccuracyThresholdMeters: toNumber(
      raw.gpsAccuracyThresholdMeters,
      ATTENDANCE_SETTINGS_DEFAULTS.gpsAccuracyThresholdMeters,
    ),
    gracePeriodMinutes: toNumber(
      raw.gracePeriodMinutes,
      ATTENDANCE_SETTINGS_DEFAULTS.gracePeriodMinutes,
    ),
    shiftStartTime: toTimeString(
      raw.shiftStartTime,
      ATTENDANCE_SETTINGS_DEFAULTS.shiftStartTime,
    ),
    shiftEndTime: toTimeString(
      raw.shiftEndTime,
      ATTENDANCE_SETTINGS_DEFAULTS.shiftEndTime,
    ),
    halfDayThresholdHours: toNumber(
      raw.halfDayThresholdHours,
      ATTENDANCE_SETTINGS_DEFAULTS.halfDayThresholdHours,
    ),
    staleLocationMaxAgeSeconds: toNumber(
      raw.staleLocationMaxAgeSeconds,
      ATTENDANCE_SETTINGS_DEFAULTS.staleLocationMaxAgeSeconds,
    ),
    checkInMethod: 'gps', // extensibility placeholder, always 'gps' for now
    weeklyOffDays: toWeeklyOffDays(raw.weeklyOffDays),
  };
}
