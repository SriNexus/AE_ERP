/**
 * Phase 13 — Attendance Dashboard KPI Derivation
 *
 * Pure, deterministic functions that derive dashboard KPI values
 * from the existing useAttendance() result set.
 *
 * Architecture:
 *   useAttendance() (existing, unmodified) → this module → KPI cards
 *
 * This module MUST NOT:
 *   - Make Firestore queries
 *   - Import Firebase/Firestore
 *   - Import UI components
 *   - Import Zustand store
 *   - Import React hooks
 *
 * Source of truth: Master Plan Phase 13, audit §28.
 */

import type { AttendanceRecord } from '../types';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface AttendanceDashboardKPIs {
  /** Total attendance records in the filtered set */
  totalRecords: number;

  /** Records with a GPS/self-service checkIn for the filtered period */
  checkedInGPS: number;

  /** Records with computedStatus === 'Late' (GPS-derived) */
  lateGPS: number;

  /** Records with computedStatus === 'HalfDay' (GPS-derived) */
  halfDayGPS: number;

  /** Records with earlyExit === true */
  earlyExitCount: number;

  /** Records with computedStatus === 'WeeklyOff' */
  weeklyOffCount: number;

  /** Employees with no attendance record for the given date */
  missingToday: number;

  /** Total active employees (for missing calculation) */
  totalActiveEmployees: number;
}

// ═══════════════════════════════════════════════════════════════════
// Pure KPI Derivation
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive GPS-specific dashboard KPIs from the existing attendance records.
 *
 * This reads `computedStatus` and `earlyExit` directly from the records
 * — it does NOT reimplement the Rule Engine. The Rule Engine is the
 * single source of truth for status classification.
 *
 * @param records - The full attendance record set from useAttendance()
 * @param totalActiveEmployees - Total active employee count (for "missing" calculation)
 * @param targetDate - Optional date string (YYYY-MM-DD) to filter for "today" metrics.
 *                     If not provided, uses the most recent date in the records.
 * @returns Dashboard KPIs
 */
export function computeDashboardKPIs(
  records: AttendanceRecord[],
  totalActiveEmployees: number,
  targetDate?: string,
): AttendanceDashboardKPIs {
  // ── Filter to the target date for today-specific metrics ────────
  const dateToUse = targetDate || getMostRecentDate(records);
  const todayRecords = dateToUse
    ? records.filter(r => r.date === dateToUse)
    : [];

  // ── GPS-specific KPIs (read computedStatus, do NOT reimplement) ─
  const checkedInGPS = todayRecords.filter(r => !!r.checkIn).length;
  const lateGPS = todayRecords.filter(r => r.computedStatus === 'Late').length;
  const halfDayGPS = todayRecords.filter(r => r.computedStatus === 'HalfDay').length;
  const earlyExitCount = todayRecords.filter(r => r.earlyExit === true).length;
  const weeklyOffCount = todayRecords.filter(r => r.computedStatus === 'WeeklyOff').length;

  // ── Missing Today ───────────────────────────────────────────────
  // Employees with NO attendance record for today, excluding those
  // on WeeklyOff (they have a record with computedStatus='WeeklyOff').
  // Also excludes employees with a manual status (manual-status-wins).
  const todayEmployeeIds = new Set(
    todayRecords
      .filter(r => r.employeeId)
      .map(r => r.employeeId),
  );
  // Missing = active employees minus those with any record today
  // (including WeeklyOff — they have a record, they're just off)
  const missingToday = Math.max(0, totalActiveEmployees - todayEmployeeIds.size);

  return {
    totalRecords: records.length,
    checkedInGPS,
    lateGPS,
    halfDayGPS,
    earlyExitCount,
    weeklyOffCount,
    missingToday,
    totalActiveEmployees,
  };
}

/**
 * Get the most recent date from a set of attendance records.
 * Used as a fallback when no explicit target date is provided.
 */
function getMostRecentDate(records: AttendanceRecord[]): string | null {
  const dates = records
    .map(r => r.date)
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
  return dates[0] || null;
}
