import type { BaseRecord } from '../../../types';

export interface Warehouse extends BaseRecord {
  name:          string;
  code:          string;
  address?:      string;
  city?:         string;
  state?:        string;
  pincode?:      string;
  managerName?:  string;
  managerPhone?: string;
  capacity?:     string;
  status:        string;
  notes?:        string;
  // Geo-fence fields (Phase 6 — optional, backward-compatible)
  latitude?:                number;
  longitude?:               number;
  geofenceRadiusMeters?:    number;
}export const WAREHOUSE_FORM_DEFAULT = {
  name: '', code: '', address: '', city: '', state: '',
  pincode: '', managerName: '', managerPhone: '', capacity: '', status: 'Active', notes: '',
  latitude: '', longitude: '', geofenceRadiusMeters: '',
};

export type WarehouseForm = typeof WAREHOUSE_FORM_DEFAULT;

/**
 * Same as WAREHOUSE_FORM_DEFAULT, but with the Geofence Radius pre-filled
 * from the company's AttendanceSettings.geofenceRadiusDefaultMeters when
 * opening the "Add Warehouse" form — connects that setting to something
 * real (§16/§20 of the production-fix brief) without making radius an
 * automatic runtime fallback (it remains a required, admin-confirmed
 * per-location value; this only saves the admin from typing the company's
 * usual radius by hand every time).
 */
export function getWarehouseFormDefault(defaultGeofenceRadiusMeters?: number): WarehouseForm {
  return {
    ...WAREHOUSE_FORM_DEFAULT,
    geofenceRadiusMeters: typeof defaultGeofenceRadiusMeters === 'number' && defaultGeofenceRadiusMeters > 0
      ? String(defaultGeofenceRadiusMeters)
      : '',
  };
}

/** Parse a warehouse's geo fields into the form's string representation. */
export function warehouseGeoToForm(w: { latitude?: number; longitude?: number; geofenceRadiusMeters?: number }) {
  return {
    latitude: typeof w.latitude === 'number' ? String(w.latitude) : '',
    longitude: typeof w.longitude === 'number' ? String(w.longitude) : '',
    geofenceRadiusMeters: typeof w.geofenceRadiusMeters === 'number' ? String(w.geofenceRadiusMeters) : '',
  };
}

/** Parse warehouse geo fields from a string form into validated numbers (or undefined). */
export function parseWarehouseGeo(form: { latitude: string; longitude: string; geofenceRadiusMeters: string }) {
  const lat = form.latitude.trim() === '' ? undefined : Number(form.latitude);
  const lng = form.longitude.trim() === '' ? undefined : Number(form.longitude);
  const radius = form.geofenceRadiusMeters.trim() === '' ? undefined : Number(form.geofenceRadiusMeters);
  const validLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : undefined;
  const validLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : undefined;
  const validRadius = typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : undefined;
  return {
    latitude: validLat,
    longitude: validLng,
    geofenceRadiusMeters: validRadius,
  };
}

/**
 * Production fix (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md
 * Finding F2): validate the geo-fence fields as a GROUP before save,
 * instead of letting `parseWarehouseGeo()`'s silent-to-`undefined`
 * conversion (invalid/blank input) reach `sanitizePayload()` — which
 * would silently drop the field from the write with no error shown,
 * leaving an admin believing they configured geo-attendance when they
 * didn't.
 *
 * Geo-fencing is opt-in per location: leaving all three fields blank is a
 * valid, non-error "not configuring this yet" state. The moment ANY of the
 * three is filled in, all three become required together (mirrors
 * AttendanceService's `hasValidGeo()` atomic-three-fields rule exactly —
 * a location that's "half-configured" must never be presentable as saved).
 */
export interface WarehouseGeoValidation {
  /** True if the admin has started filling in geo-fence fields at all. */
  attempted: boolean;
  /** True if the geo-fence configuration (if attempted) is complete and valid. */
  valid: boolean;
  errors: { latitude?: string; longitude?: string; geofenceRadiusMeters?: string };
}

export function validateWarehouseGeoForm(form: { latitude: string; longitude: string; geofenceRadiusMeters: string }): WarehouseGeoValidation {
  const latRaw = form.latitude.trim();
  const lngRaw = form.longitude.trim();
  const radiusRaw = form.geofenceRadiusMeters.trim();
  const attempted = latRaw !== '' || lngRaw !== '' || radiusRaw !== '';

  if (!attempted) {
    return { attempted: false, valid: true, errors: {} };
  }

  const errors: WarehouseGeoValidation['errors'] = {};

  if (latRaw === '') {
    errors.latitude = 'Required to enable geo-attendance';
  } else {
    const lat = Number(latRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.latitude = 'Enter a valid latitude (-90 to 90)';
  }

  if (lngRaw === '') {
    errors.longitude = 'Required to enable geo-attendance';
  } else {
    const lng = Number(lngRaw);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.longitude = 'Enter a valid longitude (-180 to 180)';
  }

  if (radiusRaw === '') {
    errors.geofenceRadiusMeters = 'Required to enable geo-attendance';
  } else {
    const radius = Number(radiusRaw);
    if (!Number.isFinite(radius) || radius <= 0) errors.geofenceRadiusMeters = 'Enter a radius greater than 0';
  }

  return { attempted: true, valid: Object.keys(errors).length === 0, errors };
}

/** Readiness of an already-saved location for geo-attendance — used by the
 * "Location Configuration Preview" badge shown on the edit form/list. */
export interface GeoReadiness {
  ready: boolean;
  missing: string[];
}

export function getGeoReadiness(w: { latitude?: number; longitude?: number; geofenceRadiusMeters?: number; status?: string }): GeoReadiness {
  const missing: string[] = [];
  if (typeof w.latitude !== 'number' || !Number.isFinite(w.latitude)) missing.push('Latitude');
  if (typeof w.longitude !== 'number' || !Number.isFinite(w.longitude)) missing.push('Longitude');
  if (typeof w.geofenceRadiusMeters !== 'number' || !Number.isFinite(w.geofenceRadiusMeters) || w.geofenceRadiusMeters <= 0) missing.push('Geofence Radius');
  if (missing.length === 0 && w.status && w.status !== 'Active') missing.push('Active status');
  return { ready: missing.length === 0, missing };
}

export const WAREHOUSE_STATUS_OPTIONS = [
  { label: 'Active',             value: 'Active' },
  { label: 'Inactive',           value: 'Inactive' },
  { label: 'Under Maintenance',  value: 'Under Maintenance' },
];
