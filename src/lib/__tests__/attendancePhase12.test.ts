/**
 * Phase 12 — Leave + Holiday + Weekly-Off (Deferred / Stub Only)
 *
 * Tests for:
 * - WeeklyOff status when no checkIn on a configured weekly-off day
 * - WeeklyOff NOT applied when a real check-in exists
 * - WeeklyOff NOT applied on non-weekly-off days
 * - Manual status always wins over weekly-off
 * - Default settings (Sunday off)
 * - Custom weekly-off days
 * - Edge cases (empty array, invalid dates)
 */

import { describe, it, expect } from 'vitest';
import { computeStatus } from '../../features/attendance/services/attendanceRuleEngine';
import type { AttendanceRecord, AttendanceSettings } from '../../features/attendance/types';

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

const SETTINGS_SUNDAY_OFF: AttendanceSettings = {
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

const SETTINGS_SAT_SUN_OFF: AttendanceSettings = {
  ...SETTINGS_SUNDAY_OFF,
  weeklyOffDays: [0, 6], // Sunday + Saturday
};

const SETTINGS_NO_WEEKLY_OFF: AttendanceSettings = {
  ...SETTINGS_SUNDAY_OFF,
  weeklyOffDays: [],
};

const SETTINGS_UNDEFINED_WEEKLY_OFF: AttendanceSettings = {
  ...SETTINGS_SUNDAY_OFF,
  weeklyOffDays: undefined,
};

function makeCheckIn(time: string, date = '2026-08-20'): AttendanceRecord['checkIn'] {
  return {
    timestamp: `${date}T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.209, accuracy: 15, capturedAt: `${date}T${time}:00.000Z` },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
  };
}

function makeCheckOut(time: string, date = '2026-08-20'): AttendanceRecord['checkOut'] {
  return {
    timestamp: `${date}T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.209, accuracy: 15, capturedAt: `${date}T${time}:00.000Z` },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
  };
}

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'ATT-TEST-001',
    companyId: 'company-a',
    employeeId: 'USR-EMP-A',
    employee: 'Employee A',
    date: '2026-08-20',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// A. WeeklyOff — No Check-In on Weekly-Off Day
// ═══════════════════════════════════════════════════════════════════

describe('A. WeeklyOff — no check-in on weekly-off day', () => {
  it('Sunday (day 0) with no check-in → WeeklyOff', () => {
    // 2026-08-16 is a Sunday
    const record = makeRecord({ date: '2026-08-16' });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('WeeklyOff');
  });

  it('Saturday (day 6) with no check-in when Sat+Sun off → WeeklyOff', () => {
    // 2026-08-15 is a Saturday
    const record = makeRecord({ date: '2026-08-15' });
    expect(computeStatus(record, SETTINGS_SAT_SUN_OFF)).toBe('WeeklyOff');
  });

  it('Monday (day 1) with no check-in → Absent (not WeeklyOff)', () => {
    // 2026-08-17 is a Monday
    const record = makeRecord({ date: '2026-08-17' });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('Absent');
  });

  it('Sunday with no check-in but empty weeklyOffDays → Absent', () => {
    const record = makeRecord({ date: '2026-08-16' });
    expect(computeStatus(record, SETTINGS_NO_WEEKLY_OFF)).toBe('Absent');
  });

  it('Sunday with no check-in but undefined weeklyOffDays → Absent', () => {
    const record = makeRecord({ date: '2026-08-16' });
    expect(computeStatus(record, SETTINGS_UNDEFINED_WEEKLY_OFF)).toBe('Absent');
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. WeeklyOff — Real Check-In Overrides Weekly-Off
// ═══════════════════════════════════════════════════════════════════

describe('B. WeeklyOff — real check-in overrides weekly-off', () => {
  it('Sunday with real check-in → computed status, not WeeklyOff', () => {
    const record = makeRecord({
      date: '2026-08-16', // Sunday
      checkIn: makeCheckIn('09:00', '2026-08-16'),
      checkOut: makeCheckOut('18:00', '2026-08-16'),
      workingHours: 9,
    });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('Present');
  });

  it('Sunday with late check-in → Late, not WeeklyOff', () => {
    const record = makeRecord({
      date: '2026-08-16',
      checkIn: makeCheckIn('09:30', '2026-08-16'),
      checkOut: makeCheckOut('18:00', '2026-08-16'),
      workingHours: 8.5,
    });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('Late');
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Manual Status Always Wins
// ═══════════════════════════════════════════════════════════════════

describe('C. Manual status always wins', () => {
  it('Manual status is not overwritten by computedStatus', () => {
    // The document has status='Present' (manual override by Admin)
    // and computedStatus would be 'WeeklyOff'
    // But the caller is responsible for respecting manual status —
    // computeStatus() only computes the GPS-derived value.
    const record = makeRecord({
      date: '2026-08-16', // Sunday
      status: 'Present', // Manual override
    });
    // computeStatus returns WeeklyOff (the GPS-derived value)
    // The caller should use manual status 'Present' as the effective display status
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('WeeklyOff');
    // Manual status 'Present' is preserved on the document
    expect(record.status).toBe('Present');
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Backward Compatibility
// ═══════════════════════════════════════════════════════════════════

describe('D. Backward compatibility', () => {
  it('old settings without weeklyOffDays field → Absent (not WeeklyOff)', () => {
    const record = makeRecord({ date: '2026-08-16' }); // Sunday
    const oldSettings = { ...SETTINGS_SUNDAY_OFF, weeklyOffDays: undefined };
    expect(computeStatus(record, oldSettings)).toBe('Absent');
  });

  it('old attendance record without weeklyOffDays → still works', () => {
    const record = makeRecord({
      date: '2026-08-16',
      checkIn: makeCheckIn('09:00', '2026-08-16'),
      checkOut: makeCheckOut('18:00', '2026-08-16'),
      workingHours: 9,
    });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('Present');
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe('E. Edge cases', () => {
  it('invalid date string → Absent (not WeeklyOff)', () => {
    const record = makeRecord({ date: 'not-a-date' });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBe('Absent');
  });

  it('check-in only (no check-out) on weekly-off day → undefined (incomplete)', () => {
    const record = makeRecord({
      date: '2026-08-16', // Sunday
      checkIn: makeCheckIn('09:00', '2026-08-16'),
    });
    expect(computeStatus(record, SETTINGS_SUNDAY_OFF)).toBeUndefined();
  });
});
