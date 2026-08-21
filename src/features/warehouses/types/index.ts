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

export const WAREHOUSE_STATUS_OPTIONS = [
  { label: 'Active',             value: 'Active' },
  { label: 'Inactive',           value: 'Inactive' },
  { label: 'Under Maintenance',  value: 'Under Maintenance' },
];
