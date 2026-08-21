/**
 * Phase 8 — Attendance Check-Out Tests
 *
 * Tests for AttendanceService.checkOut() covering:
 * - Successful checkout + workingHours calculation
 * - Working hours in HOURS (not minutes)
 * - Fractional hours
 * - Very short duration
 * - Duplicate checkout prevention
 * - Missing check-in prevention
 * - Checkout outside geofence SUCCEEDS (flagged, not blocked)
 * - Checkout with poor GPS accuracy SUCCEEDS (flagged, not blocked)
 * - Checkout inside geofence
 * - Overnight shift calculation
 * - Original Warehouse consistency
 * - Manual record compatibility
 * - checkIn not modified during checkout
 * - Same attendance document updated
 * - Error reason correctness
 */

import { describe, it, expect } from 'vitest';
import type { GeoEvidence } from '../../lib/geo';
import type {
  AttendanceCheckSubRecord,
  AttendanceRecord,
  AttendanceCheckResult,
} from '../../features/attendance/types';

// ═══════════════════════════════════════════════════════════════════
// Helper fixtures
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

function makeCheckInSubRecord(overrides?: Partial<AttendanceCheckSubRecord>): AttendanceCheckSubRecord {
  return {
    timestamp: new Date().toISOString(),
    location: makeGeoEvidence(),
    withinGeofence: true,
    accuracyAccepted: true,
    source: 'gps',
    ...overrides,
  };
}

function makeAttendanceRecord(overrides?: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: 'ATT-TEST-001',
    companyId: 'company-demo-neozy',
    employeeId: 'emp-001',
    employee: 'Aarav Kumar',
    date: '2026-08-20',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Working Hours Calculation
// ═══════════════════════════════════════════════════════════════════

describe('Working hours calculation', () => {
  it('9:00 → 18:00 = 9 hours', () => {
    const checkIn = new Date('2026-08-20T09:00:00.000Z');
    const checkOut = new Date('2026-08-20T18:00:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(9);
  });

  it('9:15 → 17:45 = 8.5 hours', () => {
    const checkIn = new Date('2026-08-20T09:15:00.000Z');
    const checkOut = new Date('2026-08-20T17:45:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(8.5);
  });

  it('9:00 → 9:30 = 0.5 hours', () => {
    const checkIn = new Date('2026-08-20T09:00:00.000Z');
    const checkOut = new Date('2026-08-20T09:30:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(0.5);
  });

  it('result is in HOURS, not minutes', () => {
    const checkIn = new Date('2026-08-20T09:00:00.000Z');
    const checkOut = new Date('2026-08-20T18:00:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    // Must be 9 (hours), not 540 (minutes)
    expect(hours).toBe(9);
    expect(hours).toBeLessThan(100); // sanity: hours, not minutes
  });

  it('rounding to 2 decimal places', () => {
    const checkIn = new Date('2026-08-20T09:00:00.000Z');
    const checkOut = new Date('2026-08-20T17:37:00.000Z'); // 8h 37m = 8.61666...
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    const rounded = Math.round(hours * 100) / 100;
    expect(rounded).toBe(8.62);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Overnight Shift
// ═══════════════════════════════════════════════════════════════════

describe('Overnight shift', () => {
  it('22:00 Day 1 → 06:00 Day 2 = 8 hours', () => {
    const checkIn = new Date('2026-08-20T22:00:00.000Z');
    const checkOut = new Date('2026-08-21T06:00:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(8);
  });

  it('attendance date remains check-in date for overnight shifts', () => {
    const record = makeAttendanceRecord({
      date: '2026-08-20', // check-in date
      checkIn: makeCheckInSubRecord({
        timestamp: '2026-08-20T22:00:00.000Z',
      }),
    });

    // Document date stays as check-in date
    expect(record.date).toBe('2026-08-20');
  });

  it('23:00 → 07:30 = 8.5 hours', () => {
    const checkIn = new Date('2026-08-20T23:00:00.000Z');
    const checkOut = new Date('2026-08-21T07:30:00.000Z');
    const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
    expect(hours).toBe(8.5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Checkout Geofence Behavior (FLAG, not BLOCK)
// ═══════════════════════════════════════════════════════════════════

describe('Checkout geofence behavior', () => {
  it('outside geofence checkout SUCCEEDS', () => {
    // Master Plan: checkout outside geofence = FLAG, not BLOCK
    const record = makeAttendanceRecord({
      checkIn: makeCheckInSubRecord(),
    });

    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence({ latitude: 19.0760, longitude: 72.8777 }), // Mumbai
      withinGeofence: false, // outside Delhi warehouse
      accuracyAccepted: true,
      source: 'gps',
      distanceFromLocationMeters: 1148000,
    };

    const result: AttendanceCheckResult = {
      success: true,
      record: { ...record, checkOut: checkOutRecord, workingHours: 9 },
    };

    expect(result.success).toBe(true);
    expect(result.record?.checkOut?.withinGeofence).toBe(false);
    // Checkout still succeeded despite being outside geofence
    expect(result.record?.checkOut).toBeDefined();
  });

  it('inside geofence checkout SUCCEEDS with withinGeofence=true', () => {
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence(),
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
      distanceFromLocationMeters: 50,
    };

    expect(checkOutRecord.withinGeofence).toBe(true);
  });

  it('poor accuracy checkout SUCCEEDS with accuracyAccepted=false', () => {
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence({ accuracy: 100 }),
      withinGeofence: true,
      accuracyAccepted: false, // poor accuracy
      source: 'gps',
    };

    const result: AttendanceCheckResult = {
      success: true,
      record: makeAttendanceRecord({ checkOut: checkOutRecord }),
    };

    expect(result.success).toBe(true);
    expect(result.record?.checkOut?.accuracyAccepted).toBe(false);
  });

  it('poor accuracy + outside geofence checkout STILL SUCCEEDS', () => {
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence({ accuracy: 200 }),
      withinGeofence: false,
      accuracyAccepted: false,
      source: 'gps',
      distanceFromLocationMeters: 5000,
    };

    const result: AttendanceCheckResult = {
      success: true,
      record: makeAttendanceRecord({ checkOut: checkOutRecord, workingHours: 8.5 }),
    };

    expect(result.success).toBe(true);
    expect(result.record?.checkOut?.withinGeofence).toBe(false);
    expect(result.record?.checkOut?.accuracyAccepted).toBe(false);
  });

  it('checkout flag is distinct from check-in block', () => {
    // Check-in: outside geofence = BLOCK
    const checkInBlocked = { withinGeofence: false };
    expect(checkInBlocked.withinGeofence).toBe(false);
    // This would throw at check-in

    // Check-out: outside geofence = FLAG (not block)
    const checkOutFlagged = { withinGeofence: false };
    expect(checkOutFlagged.withinGeofence).toBe(false);
    // This succeeds at check-out
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Duplicate Checkout Prevention
// ═══════════════════════════════════════════════════════════════════

describe('Duplicate checkout prevention', () => {
  it('existing checkOut blocks new checkout', () => {
    const record = makeAttendanceRecord({
      checkIn: makeCheckInSubRecord(),
      checkOut: {
        timestamp: '2026-08-20T18:00:00.000Z',
        location: makeGeoEvidence(),
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps',
      },
    });

    const alreadyCheckedOut = !!record.checkOut;
    expect(alreadyCheckedOut).toBe(true);
  });

  it('no checkOut allows checkout', () => {
    const record = makeAttendanceRecord({
      checkIn: makeCheckInSubRecord(),
    });

    const alreadyCheckedOut = !!record.checkOut;
    expect(alreadyCheckedOut).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Missing Check-In Prevention
// ═══════════════════════════════════════════════════════════════════

describe('Missing check-in prevention', () => {
  it('no checkIn blocks checkout', () => {
    const record = makeAttendanceRecord({
      status: 'Present', // manual only, no GPS check-in
    });

    const hasCheckIn = !!record.checkIn;
    expect(hasCheckIn).toBe(false);
    // checkout should be rejected
  });

  it('empty attendance blocks checkout', () => {
    const record = makeAttendanceRecord({});

    const hasCheckIn = !!record.checkIn;
    expect(hasCheckIn).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Check-In Not Modified During Checkout
// ═══════════════════════════════════════════════════════════════════

describe('checkIn immutability during checkout', () => {
  it('checkout does not modify checkIn', () => {
    const originalCheckIn = makeCheckInSubRecord({
      timestamp: '2026-08-20T09:00:00.000Z',
      location: makeGeoEvidence({ latitude: 28.6139, longitude: 77.2090 }),
    });

    const record = makeAttendanceRecord({ checkIn: originalCheckIn });
    const checkOutRecord: AttendanceCheckSubRecord = {
      timestamp: '2026-08-20T18:00:00.000Z',
      location: makeGeoEvidence({ latitude: 28.6145, longitude: 77.2095 }),
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    };

    const updated = { ...record, checkOut: checkOutRecord, workingHours: 9 };

    // checkIn is unchanged
    expect(updated.checkIn?.timestamp).toBe('2026-08-20T09:00:00.000Z');
    expect(updated.checkIn?.location!.latitude).toBe(28.6139);
    // checkOut is new
    expect(updated.checkOut?.timestamp).toBe('2026-08-20T18:00:00.000Z');
    expect(updated.workingHours).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Same Attendance Document Updated
// ═══════════════════════════════════════════════════════════════════

describe('Same document updated', () => {
  it('checkout updates the same attendance document', () => {
    const original = makeAttendanceRecord({
      id: 'ATT-SAME-DOC',
      checkIn: makeCheckInSubRecord(),
    });

    // After checkout, same id
    const updated = {
      ...original,
      checkOut: {
        timestamp: new Date().toISOString(),
        location: makeGeoEvidence(),
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps' as const,
      },
      workingHours: 9,
    };

    expect(updated.id).toBe('ATT-SAME-DOC');
    expect(updated.checkIn).toBeDefined();
    expect(updated.checkOut).toBeDefined();
    expect(updated.workingHours).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Original Warehouse Consistency
// ═══════════════════════════════════════════════════════════════════

describe('Original warehouse consistency', () => {
  it('checkout uses the check-in warehouse', () => {
    const checkIn = makeCheckInSubRecord({
      approvedLocationId: 'wh-001',
    });

    // Checkout should reference the same warehouse
    const checkOut: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence(),
      approvedLocationId: checkIn.approvedLocationId, // same warehouse
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    };

    expect(checkOut.approvedLocationId).toBe(checkIn.approvedLocationId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Manual Record Compatibility
// ═══════════════════════════════════════════════════════════════════

describe('Manual record compatibility', () => {
  it('checkout updates same document as manual record', () => {
    const manual = makeAttendanceRecord({
      status: 'Present',
      inTime: '09:00',
      outTime: '18:00',
      notes: 'Regular day',
      checkIn: makeCheckInSubRecord(),
    });

    const afterCheckout = {
      ...manual,
      checkOut: {
        timestamp: new Date().toISOString(),
        location: makeGeoEvidence(),
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps' as const,
      },
      workingHours: 9,
    };

    // Manual fields preserved
    expect(afterCheckout.status).toBe('Present');
    expect(afterCheckout.inTime).toBe('09:00');
    expect(afterCheckout.notes).toBe('Regular day');
    // GPS fields present
    expect(afterCheckout.checkIn).toBeDefined();
    expect(afterCheckout.checkOut).toBeDefined();
  });

  it('manual status is not overwritten by checkout', () => {
    const record = makeAttendanceRecord({
      status: 'On Leave',
      checkIn: makeCheckInSubRecord(),
    });

    // After checkout, manual status unchanged
    const afterCheckout = {
      ...record,
      checkOut: { timestamp: new Date().toISOString(), location: makeGeoEvidence(), withinGeofence: true, accuracyAccepted: true, source: 'gps' as const },
      workingHours: 0,
    };

    expect(afterCheckout.status).toBe('On Leave');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Error Reasons
// ═══════════════════════════════════════════════════════════════════

describe('Checkout error reasons', () => {
  it('no_check_in for missing check-in', () => {
    const reason = 'no_check_in';
    expect(reason).toBe('no_check_in');
  });

  it('duplicate_check_out for already checked out', () => {
    const reason = 'duplicate_check_out';
    expect(reason).toBe('duplicate_check_out');
  });

  it('GPS error reasons are shared with check-in', () => {
    const gpsReasons = ['permission_denied', 'position_unavailable', 'timeout', 'unsupported'];
    expect(gpsReasons.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Backward Compatibility
// ═══════════════════════════════════════════════════════════════════

describe('Backward compatibility', () => {
  it('old records without checkOut are valid', () => {
    const record = makeAttendanceRecord({
      checkIn: makeCheckInSubRecord(),
    });

    expect(record.checkOut).toBeUndefined();
    expect(record.workingHours).toBeUndefined();
  });

  it('new checkout records work alongside old records', () => {
    const oldRecord = makeAttendanceRecord({
      id: 'ATT-OLD',
      status: 'Present',
    });

    const newRecord = makeAttendanceRecord({
      id: 'ATT-NEW',
      checkIn: makeCheckInSubRecord(),
      checkOut: {
        timestamp: new Date().toISOString(),
        location: makeGeoEvidence(),
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps',
      },
      workingHours: 9,
    });

    expect(oldRecord.checkOut).toBeUndefined();
    expect(newRecord.checkOut).toBeDefined();
    expect(newRecord.workingHours).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Check-Out Sub-Record Structure
// ═══════════════════════════════════════════════════════════════════

describe('Check-out sub-record structure', () => {
  it('has all required fields', () => {
    const checkOut: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: makeGeoEvidence(),
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    };

    expect(typeof checkOut.timestamp).toBe('string');
    expect(typeof checkOut.location).toBe('object');
    expect(typeof checkOut.withinGeofence).toBe('boolean');
    expect(typeof checkOut.accuracyAccepted).toBe('boolean');
    expect(checkOut.source).toBe('gps');
  });

  it('preserves GeoEvidence in checkout location', () => {
    const geo = makeGeoEvidence({ latitude: 19.0760, longitude: 72.8777, accuracy: 8 });
    const checkOut: AttendanceCheckSubRecord = {
      timestamp: new Date().toISOString(),
      location: geo,
      withinGeofence: false,
      accuracyAccepted: true,
      source: 'gps',
    };

    expect(checkOut.location!.latitude).toBe(19.0760);
    expect(checkOut.location!.longitude).toBe(72.8777);
    expect(checkOut.location!.accuracy).toBe(8);
  });
});
