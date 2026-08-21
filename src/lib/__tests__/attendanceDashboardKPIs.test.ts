/**
 * Phase 13 — Attendance Dashboard KPI Derivation Tests
 *
 * Tests for computeDashboardKPIs() — the pure function that derives
 * GPS-specific dashboard KPI values from the existing useAttendance() result set.
 */

import { describe, it, expect } from 'vitest';
import { computeDashboardKPIs } from '../../features/attendance/services/dashboardKPIs';
import type { AttendanceRecord } from '../../features/attendance/types';

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'ATT-001',
    companyId: 'company-a',
    employeeId: 'USR-001',
    employee: 'Employee 1',
    date: '2026-08-20',
    ...overrides,
  };
}

const TODAY = '2026-08-20';

// ═══════════════════════════════════════════════════════════════════
// A. Basic KPI Derivation
// ═══════════════════════════════════════════════════════════════════

describe('A. Basic KPI derivation', () => {
  it('empty records → all zeros', () => {
    const kpis = computeDashboardKPIs([], 10, TODAY);
    expect(kpis.totalRecords).toBe(0);
    expect(kpis.checkedInGPS).toBe(0);
    expect(kpis.lateGPS).toBe(0);
    expect(kpis.missingToday).toBe(10);
  });

  it('employee with GPS check-in → checkedInGPS increments', () => {
    const records = [makeRecord({ checkIn: { timestamp: '2026-08-20T09:00:00Z', location: { latitude: 0, longitude: 0, accuracy: 10, capturedAt: '2026-08-20T09:00:00Z' }, withinGeofence: true, accuracyAccepted: true, source: 'gps' } })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.checkedInGPS).toBe(1);
  });

  it('employee with computedStatus=Late → lateGPS increments', () => {
    const records = [makeRecord({ computedStatus: 'Late' })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.lateGPS).toBe(1);
  });

  it('employee with computedStatus=HalfDay → halfDayGPS increments', () => {
    const records = [makeRecord({ computedStatus: 'HalfDay' })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.halfDayGPS).toBe(1);
  });

  it('employee with earlyExit=true → earlyExitCount increments', () => {
    const records = [makeRecord({ earlyExit: true })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.earlyExitCount).toBe(1);
  });

  it('employee with computedStatus=WeeklyOff → weeklyOffCount increments', () => {
    const records = [makeRecord({ computedStatus: 'WeeklyOff' })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.weeklyOffCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Missing Today Calculation
// ═══════════════════════════════════════════════════════════════════

describe('B. Missing Today calculation', () => {
  it('3 employees, 2 with records today → missing=1', () => {
    const records = [
      makeRecord({ employeeId: 'E1' }),
      makeRecord({ employeeId: 'E2' }),
    ];
    const kpis = computeDashboardKPIs(records, 3, TODAY);
    expect(kpis.missingToday).toBe(1);
  });

  it('5 employees, 5 with records today → missing=0', () => {
    const records = [
      makeRecord({ employeeId: 'E1' }),
      makeRecord({ employeeId: 'E2' }),
      makeRecord({ employeeId: 'E3' }),
      makeRecord({ employeeId: 'E4' }),
      makeRecord({ employeeId: 'E5' }),
    ];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.missingToday).toBe(0);
  });

  it('more records than employees → missing=0 (not negative)', () => {
    const records = [
      makeRecord({ employeeId: 'E1' }),
      makeRecord({ employeeId: 'E1' }), // duplicate
    ];
    const kpis = computeDashboardKPIs(records, 1, TODAY);
    expect(kpis.missingToday).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Mixed Manual + GPS Records
// ═══════════════════════════════════════════════════════════════════

describe('C. Mixed manual + GPS records', () => {
  it('manual record (no checkIn, status=Present) → not counted as GPS check-in', () => {
    const records = [makeRecord({ status: 'Present' })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.checkedInGPS).toBe(0);
    expect(kpis.lateGPS).toBe(0);
  });

  it('GPS record with computedStatus=Present → not counted as Late', () => {
    const records = [makeRecord({ computedStatus: 'Present', checkIn: { timestamp: '2026-08-20T09:00:00Z', location: { latitude: 0, longitude: 0, accuracy: 10, capturedAt: '2026-08-20T09:00:00Z' }, withinGeofence: true, accuracyAccepted: true, source: 'gps' } })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.checkedInGPS).toBe(1);
    expect(kpis.lateGPS).toBe(0);
  });

  it('Late + EarlyExit coexistence: both counted independently', () => {
    const records = [makeRecord({ computedStatus: 'Late', earlyExit: true })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.lateGPS).toBe(1);
    expect(kpis.earlyExitCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Date Filtering
// ═══════════════════════════════════════════════════════════════════

describe('D. Date filtering', () => {
  it('records for different dates → only today counted', () => {
    const records = [
      makeRecord({ employeeId: 'E1', date: '2026-08-20', computedStatus: 'Late' }),
      makeRecord({ employeeId: 'E2', date: '2026-08-19', computedStatus: 'Late' }),
      makeRecord({ employeeId: 'E3', date: '2026-08-18', computedStatus: 'Present' }),
    ];
    const kpis = computeDashboardKPIs(records, 5, '2026-08-20');
    expect(kpis.lateGPS).toBe(1);
    expect(kpis.totalRecords).toBe(3); // total is unfiltered
  });

  it('no target date → uses most recent date in records', () => {
    const records = [
      makeRecord({ employeeId: 'E1', date: '2026-08-18', computedStatus: 'Late' }),
      makeRecord({ employeeId: 'E2', date: '2026-08-20', computedStatus: 'Present' }),
    ];
    const kpis = computeDashboardKPIs(records, 5); // no targetDate
    // Most recent date is 2026-08-20, so Late from 08-18 is not counted
    expect(kpis.lateGPS).toBe(0);
    expect(kpis.checkedInGPS).toBe(0); // no checkIn on E2's record
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Backward Compatibility
// ═══════════════════════════════════════════════════════════════════

describe('E. Backward compatibility', () => {
  it('old record without computedStatus/earlyExit → does not crash', () => {
    const records = [
      makeRecord({ status: 'Present' }), // old manual record
    ];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.totalRecords).toBe(1);
    expect(kpis.checkedInGPS).toBe(0);
    expect(kpis.lateGPS).toBe(0);
    expect(kpis.earlyExitCount).toBe(0);
  });

  it('record with computedStatus undefined → not counted in any GPS category', () => {
    const records = [makeRecord({ computedStatus: undefined })];
    const kpis = computeDashboardKPIs(records, 5, TODAY);
    expect(kpis.lateGPS).toBe(0);
    expect(kpis.halfDayGPS).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Determinism
// ═══════════════════════════════════════════════════════════════════

describe('F. Determinism', () => {
  it('same inputs produce same outputs', () => {
    const records = [
      makeRecord({ computedStatus: 'Late', earlyExit: true, checkIn: { timestamp: '2026-08-20T09:30:00Z', location: { latitude: 0, longitude: 0, accuracy: 10, capturedAt: '2026-08-20T09:30:00Z' }, withinGeofence: true, accuracyAccepted: true, source: 'gps' } }),
      makeRecord({ employeeId: 'E2', computedStatus: 'Present' }),
      makeRecord({ employeeId: 'E3' }), // no attendance
    ];
    const k1 = computeDashboardKPIs(records, 5, TODAY);
    const k2 = computeDashboardKPIs(records, 5, TODAY);
    expect(k1).toEqual(k2);
  });
});
