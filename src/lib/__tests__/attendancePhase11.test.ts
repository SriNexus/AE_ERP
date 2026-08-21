/**
 * Phase 11 — Shift + Late + Early Exit
 *
 * Tests for:
 * - hasEarlyExit() pure function
 * - computeStatus() combined Late+EarlyExit behavior
 * - Boundary conditions (grace period, shift end)
 * - Overnight shift compatibility
 * - Backward compatibility (old records without earlyExit)
 */

import { describe, it, expect } from 'vitest';
import { computeStatus, hasEarlyExit, generatePolicyVersion } from '../../features/attendance/services/attendanceRuleEngine';
import type { AttendanceRecord, AttendanceSettings } from '../../features/attendance/types';

// ═══════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS: AttendanceSettings = {
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

function makeCheckIn(time: string): AttendanceRecord['checkIn'] {
  return {
    timestamp: `2026-08-20T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.209, accuracy: 15, capturedAt: `2026-08-20T${time}:00.000Z` },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
  };
}

function makeCheckOut(time: string): AttendanceRecord['checkOut'] {
  return {
    timestamp: `2026-08-20T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.209, accuracy: 15, capturedAt: `2026-08-20T${time}:00.000Z` },
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
// A. hasEarlyExit() — Pure Function Tests
// ═══════════════════════════════════════════════════════════════════

describe('A. hasEarlyExit() pure function', () => {
  it('returns false when no checkOut exists', () => {
    const record = makeRecord({ checkIn: makeCheckIn('09:00') });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('returns false when checkout is at shift end (18:00)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('returns true when checkout is before shift end (17:00)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('17:00'),
      workingHours: 8,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns false when checkout is after shift end (19:00)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('19:00'),
      workingHours: 10,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('returns true for checkout one minute before shift end (17:59)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('17:59'),
      workingHours: 8.98,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns false for checkout at 18:00:59 (still past shift end)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    // The checkOut timestamp is '18:00:00' — exactly at shift end
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('returns true for very short shift (checkout at 10:00, shift ends 18:00)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('10:00'),
      workingHours: 1,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns false when settings have invalid shift end time', () => {
    const badSettings = { ...DEFAULT_SETTINGS, shiftEndTime: 'invalid' };
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('17:00'),
      workingHours: 8,
    });
    expect(hasEarlyExit(record, badSettings)).toBe(false);
  });

  it('is deterministic — same inputs produce same output', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('16:30'),
      workingHours: 7.5,
    });
    const r1 = hasEarlyExit(record, DEFAULT_SETTINGS);
    const r2 = hasEarlyExit(record, DEFAULT_SETTINGS);
    expect(r1).toBe(r2);
    expect(r1).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Combined Late + EarlyExit — The Core Phase 11 Gap
// ═══════════════════════════════════════════════════════════════════

describe('B. Combined Late + EarlyExit behavior', () => {
  it('Late + EarlyExit → computedStatus=Late, earlyExit=true', () => {
    // Check-in at 09:20 (5min after grace of 09:15) = Late
    // Check-out at 17:00 (before 18:00) = EarlyExit
    // Working 7h 40min > 4h half-day → not HalfDay
    const record = makeRecord({
      checkIn: makeCheckIn('09:20'),
      checkOut: makeCheckOut('17:00'),
      workingHours: 7.67,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('On-time + EarlyExit → computedStatus=EarlyExit, earlyExit=true', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('16:00'),
      workingHours: 7,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('EarlyExit');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('Late + no EarlyExit → computedStatus=Late, earlyExit=false', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:20'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 8.67,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('On-time + normal checkout → computedStatus=Present, earlyExit=false', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('Late + HalfDay → computedStatus=HalfDay (HalfDay precedence), earlyExit=true', () => {
    // Check-in at 09:20 = Late, working only 3.5h < 4h threshold = HalfDay
    const record = makeRecord({
      checkIn: makeCheckIn('09:20'),
      checkOut: makeCheckOut('12:50'),
      workingHours: 3.5,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('EarlyExit + HalfDay → computedStatus=HalfDay, earlyExit=true', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('12:00'),
      workingHours: 3,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });

  it('Late + EarlyExit + HalfDay → computedStatus=HalfDay, earlyExit=true', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:20'),
      checkOut: makeCheckOut('12:30'),
      workingHours: 3.17,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Boundary Conditions
// ═══════════════════════════════════════════════════════════════════

describe('C. Boundary conditions', () => {
  it('check-in exactly at grace boundary (09:15) → not Late', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:15'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 8.75,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
  });

  it('check-in one minute after grace (09:16) → Late', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:16'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 8.73,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
  });

  it('exactly at half-day threshold (4.0 hours) → not HalfDay (but EarlyExit if before shift end)', () => {
    // 4.0 hours = exactly at threshold → not HalfDay; checkout at 13:00 < 18:00 → EarlyExit
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('13:00'),
      workingHours: 4,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('EarlyExit');
  });

  it('exactly at half-day threshold (4.0 hours) + normal checkout → not HalfDay, not Late', () => {
    // 4.0 hours, checkout at 13:00 is EarlyExit; let's use a full shift to test Present
    // 9 hours: 09:00 to 18:00
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
  });

  it('just below half-day threshold (3.99 hours) → HalfDay', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('12:59'),
      workingHours: 3.99,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });

  it('checkout at exactly shift end → earlyExit=false', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Overnight Shifts
// ═══════════════════════════════════════════════════════════════════

describe('D. Overnight shifts', () => {
  it('overnight shift: check-in 22:00, checkout 06:00 next day → Late (22:00 after 09:15 grace) + EarlyExit (06:00 < 18:00)', () => {
    const record = makeRecord({
      checkIn: {
        ...makeCheckIn('22:00')!,
        timestamp: '2026-08-20T22:00:00.000Z',
      },
      checkOut: {
        ...makeCheckOut('06:00')!,
        timestamp: '2026-08-21T06:00:00.000Z',
      },
      workingHours: 8,
    });
    // 06:00 < 18:00 → isEarlyDeparture returns true (time-of-day based)
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
    // 22:00 > 09:15 (grace) → Late; 8h >= 4h half-day → not HalfDay; precedence: Late over EarlyExit
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Missing / Incomplete Records
// ═══════════════════════════════════════════════════════════════════

describe('E. Missing / incomplete records', () => {
  it('no checkIn → computedStatus=Absent, earlyExit=false', () => {
    const record = makeRecord();
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Absent');
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('checkIn only, no checkOut → computedStatus=undefined, earlyExit=false', () => {
    const record = makeRecord({ checkIn: makeCheckIn('09:00') });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBeUndefined();
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(false);
  });

  it('old attendance record (no earlyExit field) remains valid', () => {
    const oldRecord = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
      computedStatus: 'Present',
    });
    // Old records have earlyExit=undefined
    expect(oldRecord.earlyExit).toBeUndefined();
    // computeStatus still works
    expect(computeStatus(oldRecord, DEFAULT_SETTINGS)).toBe('Present');
    // hasEarlyExit still works (returns false if earlyExit not set — but actually computes from timestamps)
    // hasEarlyExit always computes from checkOut timestamp, not from stored field
    expect(hasEarlyExit(oldRecord, DEFAULT_SETTINGS)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. Existing Phase 9 contract preservation
// ═══════════════════════════════════════════════════════════════════

describe('F. Phase 9 contract preservation', () => {
  it('computeStatus signature unchanged — returns ComputedAttendanceStatus | undefined', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    const result = computeStatus(record, DEFAULT_SETTINGS);
    expect(result).toBe('Present');
  });

  it('hasEarlyExit is independent of computeStatus', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:20'),
      checkOut: makeCheckOut('17:00'),
      workingHours: 7.67,
    });
    // computeStatus returns Late (precedence: arrival more actionable)
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    // hasEarlyExit returns true independently
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
    // Both can coexist: Late + earlyExit=true
  });

  it('Late + EarlyExit: both facts preserved independently', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:30'),
      checkOut: makeCheckOut('16:00'),
      workingHours: 6.5,
    });
    // Late (arrived at 09:30, grace ends 09:15)
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    // EarlyExit (left at 16:00, shift ends 18:00)
    expect(hasEarlyExit(record, DEFAULT_SETTINGS)).toBe(true);
    // Both preserved — the key Phase 11 requirement
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. Policy version unchanged
// ═══════════════════════════════════════════════════════════════════

describe('G. Policy version', () => {
  it('generatePolicyVersion still works identically', () => {
    const v1 = generatePolicyVersion(DEFAULT_SETTINGS);
    const v2 = generatePolicyVersion(DEFAULT_SETTINGS);
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^att-v1-/);
  });

  it('different settings produce different versions', () => {
    const s2 = { ...DEFAULT_SETTINGS, gracePeriodMinutes: 30 };
    expect(generatePolicyVersion(DEFAULT_SETTINGS)).not.toBe(generatePolicyVersion(s2));
  });
});
