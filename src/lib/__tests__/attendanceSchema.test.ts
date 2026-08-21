/**
 * Phase 6 — Attendance Schema & Domain Foundation Tests
 *
 * Verifies the correctness of:
 * - AttendanceCheckSubRecord type shape
 * - AttendanceRecord type extensions (backward-compatible)
 * - ComputedAttendanceStatus values
 * - AttendanceSettings defaults
 * - Warehouse geo-fence field extensions
 * - GeoEvidence integration compatibility
 * - Backward compatibility: old records without new fields remain valid
 */

import { describe, it, expect } from 'vitest';
import type {
  AttendanceCheckSubRecord,
  AttendanceRecord,
  ComputedAttendanceStatus,
  AttendanceCorrection,
  AttendanceSettings,
  AttendanceCheckResult,
} from '../../features/attendance/types';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../../features/attendance/types';
import type { Warehouse } from '../../features/warehouses/types';
import type { GeoEvidence } from '../../lib/geo';

// ═══════════════════════════════════════════════════════════════════
// Helper: create a minimal GeoEvidence for testing
// ═══════════════════════════════════════════════════════════════════

function makeGeoEvidence(overrides?: Partial<GeoEvidence>): GeoEvidence {
  return {
    latitude: 28.6139,
    longitude: 77.2090,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
    address: 'New Delhi, India',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Helper: create a minimal AttendanceCheckSubRecord for testing
// ═══════════════════════════════════════════════════════════════════

function makeCheckSubRecord(overrides?: Partial<AttendanceCheckSubRecord>): AttendanceCheckSubRecord {
  return {
    timestamp: new Date().toISOString(),
    location: makeGeoEvidence(),
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. AttendanceCheckSubRecord shape verification
// ═══════════════════════════════════════════════════════════════════

describe('AttendanceCheckSubRecord', () => {
  it('has all required fields', () => {
    const record = makeCheckSubRecord();
    expect(typeof record.timestamp).toBe('string');
    expect(typeof record.location).toBe('object');
    expect(typeof record.withinGeofence).toBe('boolean');
    expect(typeof record.accuracyAccepted).toBe('boolean');
    expect(['gps', 'manual_admin']).toContain(record.source);
  });

  it('accepts optional approvedLocationId', () => {
    const record = makeCheckSubRecord({ approvedLocationId: 'wh-001' });
    expect(record.approvedLocationId).toBe('wh-001');
  });

  it('accepts optional distanceFromLocationMeters', () => {
    const record = makeCheckSubRecord({ distanceFromLocationMeters: 123.45 });
    expect(record.distanceFromLocationMeters).toBe(123.45);
  });

  it('accepts optional deviceInfo', () => {
    const record = makeCheckSubRecord({
      deviceInfo: { userAgent: 'Mozilla/5.0', platform: 'Win32' },
    });
    expect(record.deviceInfo?.userAgent).toBe('Mozilla/5.0');
  });

  it('location contains valid GeoEvidence fields', () => {
    const record = makeCheckSubRecord();
    expect(typeof record.location!.latitude).toBe('number');
    expect(typeof record.location!.longitude).toBe('number');
    expect(typeof record.location!.capturedAt).toBe('string');
    // accuracy is optional
    expect(typeof record.location!.accuracy).toBe('number');
    // address is optional
    expect(typeof record.location!.address).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. AttendanceRecord type extensions
// ═══════════════════════════════════════════════════════════════════

describe('AttendanceRecord', () => {
  it('old manual-entry record (no new fields) is structurally valid', () => {
    // This simulates an existing attendance document from the manual HR flow
    const oldRecord: AttendanceRecord = {
      id: 'ATT-001',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-001',
      employee: 'Aarav Kumar',
      date: '2026-08-20',
      status: 'Present',
      inTime: '09:00',
      outTime: '18:00',
      notes: 'Regular day',
      createdBy: 'admin-uid',
    };

    // Old fields exist
    expect(oldRecord.status).toBe('Present');
    expect(oldRecord.inTime).toBe('09:00');

    // New fields are absent (undefined)
    expect(oldRecord.checkIn).toBeUndefined();
    expect(oldRecord.checkOut).toBeUndefined();
    expect(oldRecord.workingHours).toBeUndefined();
    expect(oldRecord.computedStatus).toBeUndefined();
    expect(oldRecord.policyVersion).toBeUndefined();
    expect(oldRecord.correction).toBeUndefined();
  });

  it('new GPS-verified record with checkIn sub-record is valid', () => {
    const newRecord: AttendanceRecord = {
      id: 'ATT-002',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-002',
      employee: 'Priya Sharma',
      date: '2026-08-20',
      checkIn: makeCheckSubRecord(),
    };

    expect(newRecord.checkIn).toBeDefined();
    expect(newRecord.checkIn?.withinGeofence).toBe(true);
    expect(newRecord.checkIn?.source).toBe('gps');
    // Manual fields should be absent for a pure GPS check-in
    expect(newRecord.status).toBeUndefined();
  });

  it('hybrid record (manual + GPS) is valid', () => {
    const hybridRecord: AttendanceRecord = {
      id: 'ATT-003',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-003',
      employee: 'Ravi Patel',
      date: '2026-08-20',
      status: 'Present',
      inTime: '09:00',
      outTime: '18:00',
      checkIn: makeCheckSubRecord(),
      checkOut: makeCheckSubRecord(),
      workingHours: 9,
      computedStatus: 'Present',
      policyVersion: 'v1.0',
    };

    // Both manual and GPS fields coexist
    expect(hybridRecord.status).toBe('Present');
    expect(hybridRecord.computedStatus).toBe('Present');
    expect(hybridRecord.checkIn).toBeDefined();
    expect(hybridRecord.workingHours).toBe(9);
  });

  it('correction sub-record is valid', () => {
    const correction: AttendanceCorrection = {
      correctedBy: 'admin-uid',
      correctedAt: new Date().toISOString(),
      reason: 'Employee was present but GPS failed; Admin verified manually',
      previousValues: {
        checkIn: makeCheckSubRecord(),
        computedStatus: 'Absent',
      },
    };

    const record: AttendanceRecord = {
      id: 'ATT-004',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-004',
      employee: 'Anjali Gupta',
      date: '2026-08-20',
      correction,
    };

    expect(record.correction).toBeDefined();
    expect(record.correction?.reason).toContain('GPS failed');
    expect(record.correction?.previousValues.computedStatus).toBe('Absent');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. ComputedAttendanceStatus values
// ═══════════════════════════════════════════════════════════════════

describe('ComputedAttendanceStatus', () => {
  const allStatuses: ComputedAttendanceStatus[] = [
    'Present', 'Absent', 'HalfDay', 'Late', 'EarlyExit',
    'OnLeave', 'Holiday', 'WeeklyOff',
  ];

  it('all defined statuses are valid', () => {
    for (const status of allStatuses) {
      const record: AttendanceRecord = {
        id: `ATT-${status}`,
        companyId: 'company-demo-neozy',
        employeeId: 'emp-test',
        employee: 'Test',
        date: '2026-08-20',
        computedStatus: status,
      };
      expect(record.computedStatus).toBe(status);
    }
  });

  it('computedStatus is separate from manual status', () => {
    const record: AttendanceRecord = {
      id: 'ATT-sep',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-test',
      employee: 'Test',
      date: '2026-08-20',
      status: 'Late',          // manual
      computedStatus: 'Present', // computed — they can differ
    };
    expect(record.status).toBe('Late');
    expect(record.computedStatus).toBe('Present');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. AttendanceSettings defaults
// ═══════════════════════════════════════════════════════════════════

describe('AttendanceSettings', () => {
  it('DEFAULT_ATTENDANCE_SETTINGS has all required fields', () => {
    const s = DEFAULT_ATTENDANCE_SETTINGS;
    expect(typeof s.geofenceRadiusDefaultMeters).toBe('number');
    expect(typeof s.gpsAccuracyThresholdMeters).toBe('number');
    expect(typeof s.gracePeriodMinutes).toBe('number');
    expect(typeof s.shiftStartTime).toBe('string');
    expect(typeof s.shiftEndTime).toBe('string');
    expect(typeof s.halfDayThresholdHours).toBe('number');
    expect(typeof s.staleLocationMaxAgeSeconds).toBe('number');
    expect(s.checkInMethod).toBe('gps');
  });

  it('shift times are HH:mm format', () => {
    const s = DEFAULT_ATTENDANCE_SETTINGS;
    expect(s.shiftStartTime).toMatch(/^\d{2}:\d{2}$/);
    expect(s.shiftEndTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('weeklyOffDays defaults to Sunday', () => {
    expect(DEFAULT_ATTENDANCE_SETTINGS.weeklyOffDays).toEqual([0]);
  });

  it('geofenceRadiusDefaultMeters is positive', () => {
    expect(DEFAULT_ATTENDANCE_SETTINGS.geofenceRadiusDefaultMeters).toBeGreaterThan(0);
  });

  it('gpsAccuracyThresholdMeters is positive', () => {
    expect(DEFAULT_ATTENDANCE_SETTINGS.gpsAccuracyThresholdMeters).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Warehouse geo-fence field extensions
// ═══════════════════════════════════════════════════════════════════

describe('Warehouse geo-fence extensions', () => {
  it('old Warehouse (no geo fields) is structurally valid', () => {
    const oldWarehouse: Warehouse = {
      id: 'wh-001',
      companyId: 'company-demo-neozy',
      name: 'Central Warehouse',
      code: 'WH-001',
      status: 'Active',
    };

    expect(oldWarehouse.latitude).toBeUndefined();
    expect(oldWarehouse.longitude).toBeUndefined();
    expect(oldWarehouse.geofenceRadiusMeters).toBeUndefined();
  });

  it('new Warehouse with geo-fence fields is valid', () => {
    const newWarehouse: Warehouse = {
      id: 'wh-002',
      companyId: 'company-demo-neozy',
      name: 'Delhi Warehouse',
      code: 'WH-DEL',
      status: 'Active',
      latitude: 28.6139,
      longitude: 77.2090,
      geofenceRadiusMeters: 500,
    };

    expect(newWarehouse.latitude).toBe(28.6139);
    expect(newWarehouse.longitude).toBe(77.2090);
    expect(newWarehouse.geofenceRadiusMeters).toBe(500);
  });

  it('partial geo fields are valid', () => {
    const partialWarehouse: Warehouse = {
      id: 'wh-003',
      companyId: 'company-demo-neozy',
      name: 'Partial Warehouse',
      code: 'WH-PAR',
      status: 'Active',
      latitude: 19.0760,
      // longitude not set
      geofenceRadiusMeters: 300,
    };

    expect(partialWarehouse.latitude).toBe(19.0760);
    expect(partialWarehouse.longitude).toBeUndefined();
    expect(partialWarehouse.geofenceRadiusMeters).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. GeoEvidence integration compatibility
// ═══════════════════════════════════════════════════════════════════

describe('GeoEvidence integration', () => {
  it('AttendanceCheckSubRecord.location is compatible with GeoEvidence', () => {
    const geo: GeoEvidence = {
      latitude: 28.6139,
      longitude: 77.2090,
      accuracy: 10,
      capturedAt: '2026-08-20T09:00:00.000Z',
      address: 'New Delhi, India',
    };

    const checkSub: AttendanceCheckSubRecord = {
      timestamp: '2026-08-20T09:00:00.000Z',
      location: geo,
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    };

    // Location fields are accessible
    expect(checkSub.location!.latitude).toBe(28.6139);
    expect(checkSub.location!.longitude).toBe(77.2090);
    expect(checkSub.location!.accuracy).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Backward compatibility
// ═══════════════════════════════════════════════════════════════════

describe('Backward compatibility', () => {
  it('existing attendance document shape without new fields is valid', () => {
    // This is the shape the existing useMarkAttendance() creates
    const existingDoc = {
      id: 'ATT-EXISTING',
      companyId: 'company-demo-neozy',
      employeeId: 'emp-001',
      employee: 'Aarav Kumar',
      date: '2026-08-15',
      status: 'Present',
      inTime: '09:00',
      outTime: '18:00',
      notes: '',
      createdBy: 'admin-uid',
    };

    // Should be assignable to AttendanceRecord
    const record: AttendanceRecord = existingDoc as AttendanceRecord;
    expect(record.status).toBe('Present');
    expect(record.checkIn).toBeUndefined();
    expect(record.computedStatus).toBeUndefined();
  });

  it('existing useAttendance() query returns data compatible with new types', () => {
    // The existing query returns raw Firestore documents
    const rawDocs = [
      {
        id: 'ATT-001',
        companyId: 'company-demo-neozy',
        employeeId: 'emp-001',
        employee: 'Test',
        date: '2026-08-20',
        status: 'Present',
      },
      {
        id: 'ATT-002',
        companyId: 'company-demo-neozy',
        employeeId: 'emp-002',
        employee: 'Test 2',
        date: '2026-08-20',
        checkIn: makeCheckSubRecord(),
        computedStatus: 'Present',
      },
    ];

    // Both old and new documents should be processable
    for (const doc of rawDocs) {
      const record = doc as AttendanceRecord;
      expect(record.id).toBeDefined();
      expect(record.companyId).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. AttendanceCheckResult shape
// ═══════════════════════════════════════════════════════════════════

describe('AttendanceCheckResult', () => {
  it('success result contains record', () => {
    const result: AttendanceCheckResult = {
      success: true,
      record: {
        id: 'ATT-001',
        companyId: 'company-demo-neozy',
        employeeId: 'emp-001',
        employee: 'Test',
        date: '2026-08-20',
        checkIn: makeCheckSubRecord(),
      } as AttendanceRecord,
    };

    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('failure result contains error info', () => {
    const result: AttendanceCheckResult = {
      success: false,
      error: 'You are too far from the warehouse',
      errorReason: 'outside_geofence',
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('too far');
    expect(result.errorReason).toBe('outside_geofence');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Source field extensibility
// ═══════════════════════════════════════════════════════════════════

describe('Source field', () => {
  it('gps source is valid', () => {
    const record = makeCheckSubRecord({ source: 'gps' });
    expect(record.source).toBe('gps');
  });

  it('manual_admin source is valid', () => {
    const record = makeCheckSubRecord({ source: 'manual_admin' });
    expect(record.source).toBe('manual_admin');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Immutable fields concept
// ═══════════════════════════════════════════════════════════════════

describe('Immutability concept', () => {
  it('checkIn timestamp is immutable once set (documented behavior)', () => {
    const original = makeCheckSubRecord({
      timestamp: '2026-08-20T09:00:00.000Z',
    });

    // The rules enforce immutability via diff().affectedKeys() guards
    // This test documents the expected behavior
    expect(original.timestamp).toBe('2026-08-20T09:00:00.000Z');

    // A non-Admin update that tries to change checkIn would be denied by rules
    // An Admin correction must also populate the correction field
    const correction: AttendanceCorrection = {
      correctedBy: 'admin-uid',
      correctedAt: new Date().toISOString(),
      reason: 'GPS data was incorrect',
      previousValues: { checkIn: original },
    };

    expect(correction.previousValues.checkIn).toBeDefined();
    expect(correction.reason).toContain('GPS');
  });
});
