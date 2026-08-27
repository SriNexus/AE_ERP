/**
 * Production fix regression tests — Warehouse/Company geo-fence
 * configuration must never silently save an incomplete location
 * (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md Finding F2).
 *
 * Prior to this fix: parseWarehouseGeo() silently converted invalid/blank
 * geo input to `undefined`, sanitizePayload() silently stripped `undefined`
 * fields from the write, and the save mutation showed an unconditional
 * "Warehouse updated" success toast — so an admin who mistyped or
 * partially filled in Latitude/Longitude/Geofence Radius believed the
 * location was configured when it wasn't.
 *
 * validateWarehouseGeoForm() is the new gate that must block the save
 * (not just leave the invalid field out) before that ever happens.
 */
import { describe, it, expect } from 'vitest';
import { validateWarehouseGeoForm, getGeoReadiness, getWarehouseFormDefault, WAREHOUSE_FORM_DEFAULT } from '../../features/warehouses/types';

describe('validateWarehouseGeoForm', () => {
  it('is valid (and not "attempted") when all three fields are blank — geo-attendance is opt-in per location', () => {
    const result = validateWarehouseGeoForm({ latitude: '', longitude: '', geofenceRadiusMeters: '' });
    expect(result.attempted).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('is valid when all three fields are present and correct', () => {
    const result = validateWarehouseGeoForm({ latitude: '18.5204', longitude: '73.8567', geofenceRadiusMeters: '200' });
    expect(result.attempted).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('the exact reported production scenario: latitude + longitude filled in, radius left blank -> BLOCKED, not silently accepted', () => {
    const result = validateWarehouseGeoForm({ latitude: '18.5204', longitude: '73.8567', geofenceRadiusMeters: '' });
    expect(result.attempted).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors.geofenceRadiusMeters).toBeTruthy();
    expect(result.errors.latitude).toBeUndefined();
    expect(result.errors.longitude).toBeUndefined();
  });

  it('rejects a mistyped (non-numeric / locale-comma) latitude instead of silently dropping it', () => {
    const result = validateWarehouseGeoForm({ latitude: '18,5204', longitude: '73.8567', geofenceRadiusMeters: '200' });
    expect(result.valid).toBe(false);
    expect(result.errors.latitude).toBeTruthy();
  });

  it('rejects out-of-range latitude/longitude', () => {
    expect(validateWarehouseGeoForm({ latitude: '91', longitude: '73.8567', geofenceRadiusMeters: '200' }).valid).toBe(false);
    expect(validateWarehouseGeoForm({ latitude: '18.5204', longitude: '-181', geofenceRadiusMeters: '200' }).valid).toBe(false);
  });

  it('rejects a zero or negative radius', () => {
    expect(validateWarehouseGeoForm({ latitude: '18.5204', longitude: '73.8567', geofenceRadiusMeters: '0' }).valid).toBe(false);
    expect(validateWarehouseGeoForm({ latitude: '18.5204', longitude: '73.8567', geofenceRadiusMeters: '-50' }).valid).toBe(false);
  });

  it('treats "started filling in just the radius" the same way — all three become required together', () => {
    const result = validateWarehouseGeoForm({ latitude: '', longitude: '', geofenceRadiusMeters: '200' });
    expect(result.attempted).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors.latitude).toBeTruthy();
    expect(result.errors.longitude).toBeTruthy();
  });
});

describe('getGeoReadiness', () => {
  it('reports ready when all three fields are valid and status is Active', () => {
    const readiness = getGeoReadiness({ latitude: 18.5204, longitude: 73.8567, geofenceRadiusMeters: 200, status: 'Active' });
    expect(readiness).toEqual({ ready: true, missing: [] });
  });

  it('reports not-ready with the exact missing field for the reported production scenario', () => {
    const readiness = getGeoReadiness({ latitude: 18.5204, longitude: 73.8567 });
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['Geofence Radius']);
  });

  it('reports not-ready with all three missing when nothing is configured', () => {
    const readiness = getGeoReadiness({});
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['Latitude', 'Longitude', 'Geofence Radius']);
  });

  it('reports not-ready for a fully-configured but Inactive location', () => {
    const readiness = getGeoReadiness({ latitude: 18.5204, longitude: 73.8567, geofenceRadiusMeters: 200, status: 'Inactive' });
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(['Active status']);
  });
});

describe('getWarehouseFormDefault — connects geofenceRadiusDefaultMeters to something real', () => {
  it('pre-fills the radius field from the company default when opening a NEW warehouse form', () => {
    const form = getWarehouseFormDefault(200);
    expect(form.geofenceRadiusMeters).toBe('200');
    expect(form.latitude).toBe(WAREHOUSE_FORM_DEFAULT.latitude); // still blank — not a runtime fallback, just a UI convenience
  });

  it('leaves the radius field blank when no default is configured', () => {
    expect(getWarehouseFormDefault(undefined).geofenceRadiusMeters).toBe('');
    expect(getWarehouseFormDefault(0).geofenceRadiusMeters).toBe('');
    expect(getWarehouseFormDefault(-5).geofenceRadiusMeters).toBe('');
  });
});
