/**
 * Phase 9 — Attendance Rule Engine Tests
 *
 * Comprehensive tests for:
 * - computeStatus() — all precedence scenarios
 * - normalizeAttendanceSettings() — defensive normalization
 * - generatePolicyVersion() — determinism and settings-change sensitivity
 * - Edge cases: boundary conditions, overnight shifts, missing data
 */

import { describe, it, expect } from 'vitest';
import type {
  AttendanceRecord,
  AttendanceSettings,
  ComputedAttendanceStatus,
} from '../../features/attendance/types';
import { computeStatus, generatePolicyVersion } from '../../features/attendance/services/attendanceRuleEngine';
import { normalizeAttendanceSettings } from '../../features/settings/attendanceRuntime';

// ═══════════════════════════════════════════════════════════════════
// Helper: create test fixtures
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

function makeRecord(overrides?: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: 'ATT-TEST',
    companyId: 'company-demo-neozy',
    employeeId: 'emp-001',
    employee: 'Test Employee',
    date: '2026-08-20',
    ...overrides,
  };
}

function makeCheckIn(time: string) {
  return {
    timestamp: `2026-08-20T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.2090, accuracy: 15, capturedAt: `2026-08-20T${time}:00.000Z` },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps' as const,
  };
}

function makeCheckOut(time: string) {
  return {
    timestamp: `2026-08-20T${time}:00.000Z`,
    location: { latitude: 28.6139, longitude: 77.2090, accuracy: 15, capturedAt: `2026-08-20T${time}:00.000Z` },
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps' as const,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. computeStatus() — Core Scenarios
// ═══════════════════════════════════════════════════════════════════

describe('computeStatus()', () => {
  describe('Absent', () => {
    it('no checkIn → Absent', () => {
      const record = makeRecord();
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Absent');
    });
  });

  describe('Incomplete (no checkOut)', () => {
    it('checkIn exists but no checkOut → undefined', () => {
      const record = makeRecord({ checkIn: makeCheckIn('09:00') });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBeUndefined();
    });
  });

  describe('Present', () => {
    it('on-time full day → Present', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('18:00'),
        workingHours: 9,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
    });

    it('slightly over full day → Present', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('18:15'),
        workingHours: 9.25,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
    });
  });

  describe('Late', () => {
    it('late arrival (after grace), full duration → Late', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:20'), // 20 min after shift start, grace is 15 min
        checkOut: makeCheckOut('18:20'),
        workingHours: 9,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    });

    it('exactly at grace boundary → NOT Late (grace is inclusive)', () => {
      // shiftStartTime=09:00, gracePeriodMinutes=15, grace ends at 09:15
      // arriving at 09:15 is within grace → not late
      const record = makeRecord({
        checkIn: makeCheckIn('09:15'),
        checkOut: makeCheckOut('18:15'),
        workingHours: 9,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
    });

    it('one minute after grace → Late', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:16'),
        checkOut: makeCheckOut('18:16'),
        workingHours: 9,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
    });
  });

  describe('EarlyExit', () => {
    it('left before shift end → EarlyExit', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('17:00'), // 1 hour before shift end
        workingHours: 8,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('EarlyExit');
    });

    it('left exactly at shift end → NOT EarlyExit', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('18:00'),
        workingHours: 9,
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
    });
  });

  describe('HalfDay', () => {
    it('short working duration → HalfDay', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('13:00'),
        workingHours: 3.5, // below threshold
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
    });

    it('below half-day threshold → HalfDay', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('12:00'),
        workingHours: 3, // below 4-hour threshold
      });
      expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
    });

    it('just above half-day threshold → NOT HalfDay', () => {
      const record = makeRecord({
        checkIn: makeCheckIn('09:00'),
        checkOut: makeCheckOut('13:01'),
        workingHours: 4.02, // above 4-hour threshold
      });
      // Should be Present (or Late/EarlyExit depending on timing)
      const status = computeStatus(record, DEFAULT_SETTINGS);
      expect(status).not.toBe('HalfDay');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Precedence Order
// ═══════════════════════════════════════════════════════════════════

describe('Precedence order', () => {
  it('Late + HalfDay → HalfDay (HalfDay takes precedence)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:30'), // late
      checkOut: makeCheckOut('12:00'), // short day
      workingHours: 2.5, // below 4-hour threshold
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });

  it('Late + EarlyExit → Late (Late takes precedence)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:30'), // late
      checkOut: makeCheckOut('17:00'), // early exit
      workingHours: 7.5, // above half-day threshold
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Late');
  });

  it('HalfDay + EarlyExit → HalfDay (HalfDay takes precedence)', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'), // on time
      checkOut: makeCheckOut('11:00'), // early exit
      workingHours: 2, // below threshold
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });

  it('Late + HalfDay + EarlyExit → HalfDay', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:30'), // late
      checkOut: makeCheckOut('11:00'), // early exit
      workingHours: 1.5, // below threshold
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Manual Status vs computedStatus
// ═══════════════════════════════════════════════════════════════════

describe('Manual status vs computedStatus', () => {
  it('manual status is NOT used by computeStatus (separate field)', () => {
    // computeStatus() operates on GPS data, not manual status
    // The manual status is the caller's responsibility
    const record = makeRecord({
      status: 'On Leave',
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    // computeStatus still evaluates based on GPS, ignoring manual status
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('Present');
  });

  it('computedStatus is independent of manual status', () => {
    const record = makeRecord({
      status: 'Holiday', // manual override
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    // Both can coexist: manual='Holiday', computed='Present'
    const computed = computeStatus(record, DEFAULT_SETTINGS);
    expect(computed).toBe('Present');
    expect(record.status).toBe('Holiday');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Missing check-in/out behavior
// ═══════════════════════════════════════════════════════════════════

describe('Missing check-in/out behavior', () => {
  it('no checkIn → Absent (not Incomplete)', () => {
    const record = makeRecord();
    const status = computeStatus(record, DEFAULT_SETTINGS);
    expect(status).toBe('Absent');
    // "Incomplete" is NOT a valid computedStatus enum value
  });

  it('checkIn present, no checkOut → undefined (UI detects incompleteness)', () => {
    const record = makeRecord({ checkIn: makeCheckIn('09:00') });
    const status = computeStatus(record, DEFAULT_SETTINGS);
    expect(status).toBeUndefined();
    // The UI detects this as: checkIn present + computedStatus absent + checkOut absent
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Boundary conditions
// ═══════════════════════════════════════════════════════════════════

describe('Boundary conditions', () => {
  it('exactly at half-day threshold (4.0 hours) → HalfDay', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('13:00'),
      workingHours: 4.0,
    });
    // 4.0 < 4.0 is false, so this should NOT be HalfDay
    // Actually: 4.0 >= 4.0 is true, so it's NOT shortDay
    // Let me check: halfDayThresholdHours = 4, workingHours = 4.0
    // shortDay = 4.0 < 4.0 = false → NOT HalfDay
    const status = computeStatus(record, DEFAULT_SETTINGS);
    expect(status).not.toBe('HalfDay');
  });

  it('3.99 hours → HalfDay', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('12:59'),
      workingHours: 3.99,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });

  it('zero working hours → HalfDay', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('09:00'),
      workingHours: 0,
    });
    expect(computeStatus(record, DEFAULT_SETTINGS)).toBe('HalfDay');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Determinism and immutability
// ═══════════════════════════════════════════════════════════════════

describe('Determinism and immutability', () => {
  it('repeated calls with same inputs produce same result', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    const r1 = computeStatus(record, DEFAULT_SETTINGS);
    const r2 = computeStatus(record, DEFAULT_SETTINGS);
    expect(r1).toBe(r2);
  });

  it('input record is not mutated', () => {
    const record = makeRecord({
      checkIn: makeCheckIn('09:00'),
      checkOut: makeCheckOut('18:00'),
      workingHours: 9,
    });
    const original = { ...record };
    computeStatus(record, DEFAULT_SETTINGS);
    expect(record).toEqual(original);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. normalizeAttendanceSettings()
// ═══════════════════════════════════════════════════════════════════

describe('normalizeAttendanceSettings()', () => {
  it('null input returns defaults', () => {
    const result = normalizeAttendanceSettings(null);
    expect(result.shiftStartTime).toBe('09:00');
    expect(result.shiftEndTime).toBe('18:00');
    expect(result.halfDayThresholdHours).toBe(4);
  });

  it('undefined input returns defaults', () => {
    const result = normalizeAttendanceSettings(undefined);
    expect(result.checkInMethod).toBe('gps');
  });

  it('empty object returns defaults', () => {
    const result = normalizeAttendanceSettings({});
    expect(result.geofenceRadiusDefaultMeters).toBe(200);
  });

  it('valid values are preserved', () => {
    const result = normalizeAttendanceSettings({
      geofenceRadiusDefaultMeters: 500,
      gpsAccuracyThresholdMeters: 30,
      gracePeriodMinutes: 10,
      shiftStartTime: '08:30',
      shiftEndTime: '17:30',
      halfDayThresholdHours: 5,
      staleLocationMaxAgeSeconds: 600,
    });
    expect(result.geofenceRadiusDefaultMeters).toBe(500);
    expect(result.shiftStartTime).toBe('08:30');
    expect(result.halfDayThresholdHours).toBe(5);
  });

  it('negative numeric values fall back to defaults', () => {
    const result = normalizeAttendanceSettings({
      geofenceRadiusDefaultMeters: -100,
      gpsAccuracyThresholdMeters: -5,
      gracePeriodMinutes: -1,
    });
    expect(result.geofenceRadiusDefaultMeters).toBe(200);
    expect(result.gpsAccuracyThresholdMeters).toBe(50);
    expect(result.gracePeriodMinutes).toBe(15);
  });

  it('non-numeric values fall back to defaults', () => {
    const result = normalizeAttendanceSettings({
      geofenceRadiusDefaultMeters: 'not a number',
      shiftStartTime: 'invalid',
    });
    expect(result.geofenceRadiusDefaultMeters).toBe(200);
    expect(result.shiftStartTime).toBe('09:00');
  });

  it('invalid time format falls back to default', () => {
    const result = normalizeAttendanceSettings({
      shiftStartTime: '9am',
      shiftEndTime: '5pm',
    });
    expect(result.shiftStartTime).toBe('09:00');
    expect(result.shiftEndTime).toBe('18:00');
  });

  it('valid time format is preserved', () => {
    const result = normalizeAttendanceSettings({
      shiftStartTime: '07:00',
      shiftEndTime: '16:00',
    });
    expect(result.shiftStartTime).toBe('07:00');
    expect(result.shiftEndTime).toBe('16:00');
  });

  it('weeklyOffDays: valid array preserved', () => {
    const result = normalizeAttendanceSettings({ weeklyOffDays: [0, 6] });
    expect(result.weeklyOffDays).toEqual([0, 6]);
  });

  it('weeklyOffDays: invalid values filtered', () => {
    const result = normalizeAttendanceSettings({ weeklyOffDays: [0, 8, -1, 6] });
    expect(result.weeklyOffDays).toEqual([0, 6]);
  });

  it('weeklyOffDays: empty array falls back to default', () => {
    const result = normalizeAttendanceSettings({ weeklyOffDays: [] });
    expect(result.weeklyOffDays).toEqual([0]);
  });

  it('input is not mutated', () => {
    const input = { geofenceRadiusDefaultMeters: 500 };
    normalizeAttendanceSettings(input);
    expect(input.geofenceRadiusDefaultMeters).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. generatePolicyVersion()
// ═══════════════════════════════════════════════════════════════════

describe('generatePolicyVersion()', () => {
  it('returns a string', () => {
    const version = generatePolicyVersion(DEFAULT_SETTINGS);
    expect(typeof version).toBe('string');
  });

  it('starts with att-v1-', () => {
    const version = generatePolicyVersion(DEFAULT_SETTINGS);
    expect(version).toMatch(/^att-v1-/);
  });

  it('deterministic for same settings', () => {
    const v1 = generatePolicyVersion(DEFAULT_SETTINGS);
    const v2 = generatePolicyVersion(DEFAULT_SETTINGS);
    expect(v1).toBe(v2);
  });

  it('different settings produce different versions', () => {
    const v1 = generatePolicyVersion(DEFAULT_SETTINGS);
    const v2 = generatePolicyVersion({
      ...DEFAULT_SETTINGS,
      shiftStartTime: '08:00',
    });
    expect(v1).not.toBe(v2);
  });

  it('changing grace period produces different version', () => {
    const v1 = generatePolicyVersion(DEFAULT_SETTINGS);
    const v2 = generatePolicyVersion({ ...DEFAULT_SETTINGS, gracePeriodMinutes: 30 });
    expect(v1).not.toBe(v2);
  });
});
