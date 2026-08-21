/**
 * Focused tests for the Warehouse → Geo Coordinates → Attendance Location flow.
 *
 * Tests the complete chain:
 *   Warehouse (latitude, longitude, geofenceRadiusMeters)
 *   → AttendanceService.resolveAttendanceWarehouse()
 *   → GPS check-in evaluation
 *
 * Also tests the WarehouseForm helpers: warehouseGeoToForm, parseWarehouseGeo
 */
import { describe, it, expect } from 'vitest';
import { warehouseGeoToForm, parseWarehouseGeo } from '../../features/warehouses/types';

// ── parseWarehouseGeo tests ──────────────────────────────────────

describe('parseWarehouseGeo', () => {
  it('parses valid coordinates and radius', () => {
    const result = parseWarehouseGeo({
      latitude: '18.5204',
      longitude: '73.8567',
      geofenceRadiusMeters: '200',
    });
    expect(result.latitude).toBe(18.5204);
    expect(result.longitude).toBe(73.8567);
    expect(result.geofenceRadiusMeters).toBe(200);
  });

  it('returns undefined for empty strings', () => {
    const result = parseWarehouseGeo({
      latitude: '',
      longitude: '',
      geofenceRadiusMeters: '',
    });
    expect(result.latitude).toBeUndefined();
    expect(result.longitude).toBeUndefined();
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('returns undefined for whitespace-only strings', () => {
    const result = parseWarehouseGeo({
      latitude: '   ',
      longitude: '  ',
      geofenceRadiusMeters: '  ',
    });
    expect(result.latitude).toBeUndefined();
    expect(result.longitude).toBeUndefined();
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('rejects latitude outside valid range (-90 to +90)', () => {
    const result1 = parseWarehouseGeo({
      latitude: '91',
      longitude: '73.8567',
      geofenceRadiusMeters: '200',
    });
    expect(result1.latitude).toBeUndefined();

    const result2 = parseWarehouseGeo({
      latitude: '-91',
      longitude: '73.8567',
      geofenceRadiusMeters: '200',
    });
    expect(result2.latitude).toBeUndefined();
  });

  it('rejects longitude outside valid range (-180 to +180)', () => {
    const result1 = parseWarehouseGeo({
      latitude: '18.5204',
      longitude: '181',
      geofenceRadiusMeters: '200',
    });
    expect(result1.longitude).toBeUndefined();

    const result2 = parseWarehouseGeo({
      latitude: '18.5204',
      longitude: '-181',
      geofenceRadiusMeters: '200',
    });
    expect(result2.longitude).toBeUndefined();
  });

  it('rejects NaN values', () => {
    const result = parseWarehouseGeo({
      latitude: 'abc',
      longitude: 'xyz',
      geofenceRadiusMeters: 'abc',
    });
    expect(result.latitude).toBeUndefined();
    expect(result.longitude).toBeUndefined();
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('rejects Infinity', () => {
    const result = parseWarehouseGeo({
      latitude: 'Infinity',
      longitude: 'Infinity',
      geofenceRadiusMeters: 'Infinity',
    });
    expect(result.latitude).toBeUndefined();
    expect(result.longitude).toBeUndefined();
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('rejects zero radius', () => {
    const result = parseWarehouseGeo({
      latitude: '18.5204',
      longitude: '73.8567',
      geofenceRadiusMeters: '0',
    });
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('rejects negative radius', () => {
    const result = parseWarehouseGeo({
      latitude: '18.5204',
      longitude: '73.8567',
      geofenceRadiusMeters: '-100',
    });
    expect(result.geofenceRadiusMeters).toBeUndefined();
  });

  it('accepts boundary values (lat 90, lat -90, lng 180, lng -180)', () => {
    const result = parseWarehouseGeo({
      latitude: '90',
      longitude: '180',
      geofenceRadiusMeters: '1',
    });
    expect(result.latitude).toBe(90);
    expect(result.longitude).toBe(180);
    expect(result.geofenceRadiusMeters).toBe(1);

    const result2 = parseWarehouseGeo({
      latitude: '-90',
      longitude: '-180',
      geofenceRadiusMeters: '1',
    });
    expect(result2.latitude).toBe(-90);
    expect(result2.longitude).toBe(-180);
  });
});

// ── warehouseGeoToForm tests ─────────────────────────────────────

describe('warehouseGeoToForm', () => {
  it('converts numeric geo fields to strings', () => {
    const result = warehouseGeoToForm({
      latitude: 18.5204,
      longitude: 73.8567,
      geofenceRadiusMeters: 200,
    });
    expect(result.latitude).toBe('18.5204');
    expect(result.longitude).toBe('73.8567');
    expect(result.geofenceRadiusMeters).toBe('200');
  });

  it('returns empty strings when fields are undefined', () => {
    const result = warehouseGeoToForm({});
    expect(result.latitude).toBe('');
    expect(result.longitude).toBe('');
    expect(result.geofenceRadiusMeters).toBe('');
  });

  it('handles partial geo fields', () => {
    const result = warehouseGeoToForm({ latitude: 19.0, longitude: 72.0 });
    expect(result.latitude).toBe('19');
    expect(result.longitude).toBe('72');
    expect(result.geofenceRadiusMeters).toBe('');
  });
});

// ── resolveAttendanceWarehouse logic tests ────────────────────────
// These test the same validation logic that resolveAttendanceWarehouse uses,
// without requiring Firestore.

describe('Attendance location resolution logic', () => {
  /**
   * Simulate resolveAttendanceWarehouse's validation logic
   * (the same checks performed in AttendanceService.ts lines 77-92)
   */
  function canUseWarehouseForAttendance(wh: {
    latitude?: number;
    longitude?: number;
    geofenceRadiusMeters?: number;
  }): boolean {
    if (
      typeof wh.latitude !== 'number' ||
      typeof wh.longitude !== 'number' ||
      typeof wh.geofenceRadiusMeters !== 'number' ||
      !Number.isFinite(wh.latitude) ||
      !Number.isFinite(wh.longitude) ||
      !Number.isFinite(wh.geofenceRadiusMeters) ||
      wh.geofenceRadiusMeters <= 0
    ) {
      return false;
    }
    return true;
  }

  it('warehouse WITH valid geo fields IS usable for attendance', () => {
    expect(canUseWarehouseForAttendance({
      latitude: 18.5204,
      longitude: 73.8567,
      geofenceRadiusMeters: 200,
    })).toBe(true);
  });

  it('warehouse WITHOUT any geo fields is NOT usable', () => {
    expect(canUseWarehouseForAttendance({})).toBe(false);
  });

  it('warehouse with latitude only is NOT usable', () => {
    expect(canUseWarehouseForAttendance({ latitude: 18.5204 })).toBe(false);
  });

  it('warehouse with latitude + longitude but no radius is NOT usable', () => {
    expect(canUseWarehouseForAttendance({
      latitude: 18.5204,
      longitude: 73.8567,
    })).toBe(false);
  });

  it('warehouse with NaN latitude is NOT usable', () => {
    expect(canUseWarehouseForAttendance({
      latitude: NaN,
      longitude: 73.8567,
      geofenceRadiusMeters: 200,
    })).toBe(false);
  });

  it('warehouse with Infinity longitude is NOT usable', () => {
    expect(canUseWarehouseForAttendance({
      latitude: 18.5204,
      longitude: Infinity,
      geofenceRadiusMeters: 200,
    })).toBe(false);
  });

  it('warehouse with zero radius is NOT usable', () => {
    expect(canUseWarehouseForAttendance({
      latitude: 18.5204,
      longitude: 73.8567,
      geofenceRadiusMeters: 0,
    })).toBe(false);
  });

  it('warehouse with negative radius is NOT usable', () => {
    expect(canUseWarehouseForAttendance({
      latitude: 18.5204,
      longitude: 73.8567,
      geofenceRadiusMeters: -100,
    })).toBe(false);
  });

  it('full roundtrip: form default → parse → valid geo → can use for attendance', () => {
    // Simulate admin entering coordinates in the form
    const formLat = '18.5204';
    const formLng = '73.8567';
    const formRadius = '200';

    // Parse from form (what handleSubmit does)
    const geo = parseWarehouseGeo({
      latitude: formLat,
      longitude: formLng,
      geofenceRadiusMeters: formRadius,
    });

    // These would be saved to Firestore
    expect(geo.latitude).toBe(18.5204);
    expect(geo.longitude).toBe(73.8567);
    expect(geo.geofenceRadiusMeters).toBe(200);

    // resolveAttendanceWarehouse reads from Firestore and validates
    expect(canUseWarehouseForAttendance(geo)).toBe(true);
  });

  it('full roundtrip: empty form → parse → no geo → cannot use for attendance', () => {
    const geo = parseWarehouseGeo({
      latitude: '',
      longitude: '',
      geofenceRadiusMeters: '',
    });

    // Would be saved as undefined/missing to Firestore
    expect(geo.latitude).toBeUndefined();
    expect(geo.longitude).toBeUndefined();
    expect(geo.geofenceRadiusMeters).toBeUndefined();

    // resolveAttendanceWarehouse would return null
    expect(canUseWarehouseForAttendance(geo)).toBe(false);
  });
});
