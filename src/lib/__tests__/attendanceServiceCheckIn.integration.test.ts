/**
 * AttendanceService.checkIn() — direct invocation tests.
 *
 * Unlike attendanceCheckIn.test.ts (which only exercises fixture/shape
 * logic), these tests call the REAL AttendanceService.checkIn() with all
 * of its Firestore/store/settings dependencies mocked — this is the exact
 * code path that produced the real-world failure:
 *   "GPS accuracy is too low to check in here (±149m, need ±50m or better)"
 *
 * Goals:
 * - Prove geofence and accuracy are evaluated independently (never merged).
 * - Prove the accuracy-rejection message matches the real production string.
 * - Prove Warehouse → Company → error location-resolution precedence.
 * - Prove cross-company warehouses are rejected (never trusted).
 * - Prove stale location evidence is rejected.
 * - Prove a successful check-in persists the expected document shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GeoEvidence } from '../../lib/geo';

// ── Mock firebase/firestore (used by getTodayAttendance + the upsert) ──
const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: (...args: any[]) => mockGetDocs(...args),
  query: vi.fn(),
  where: vi.fn(),
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  doc: vi.fn((_db: any, col: string, id: string) => ({ id, path: `${col}/${id}` })),
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
  COLLECTIONS: { ATTENDANCE: 'attendance', WAREHOUSES: 'warehouses', COMPANIES: 'companies' },
}));

// ── Mock lib/firestore (getOne resolves Warehouse/Company fixtures) ────
const mockGetOne = vi.fn();
const mockCreateDocWithId = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/firestore', () => ({
  getOne: (...args: any[]) => mockGetOne(...args),
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  genId: { generic: vi.fn(() => 'ATT-GEN-001') },
  resolveWriteGroupId: vi.fn(() => 'group-001'),
}));

// ── Mock the current-user store ─────────────────────────────────────
const mockUser: Record<string, unknown> = {
  id: 'emp-001',
  name: 'Aarav Kumar',
  companyId: 'company-demo-neozy',
  warehouseId: 'wh-001',
};
vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: mockUser, activeCompanyId: 'company-demo-neozy' })) },
}));

// ── Mock Settings (company policy thresholds) ───────────────────────
const mockLoadSettings = vi.fn();
vi.mock('../../features/settings/services/settingsService', () => ({
  loadSettings: (...args: any[]) => mockLoadSettings(...args),
}));

// Warehouse at the exact "work location" — Delhi coordinates used throughout the suite.
const WORK_LOCATION = { latitude: 28.6139, longitude: 77.209 };

function makeGeoEvidence(overrides?: Partial<GeoEvidence>): GeoEvidence {
  return {
    latitude: WORK_LOCATION.latitude,
    longitude: WORK_LOCATION.longitude,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AttendanceService.checkIn() — real invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.warehouseId = 'wh-001';
    mockUser.companyId = 'company-demo-neozy';
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] }); // no existing record today
    mockLoadSettings.mockResolvedValue({
      geofenceRadiusDefaultMeters: 200,
      gpsAccuracyThresholdMeters: 50,
      gracePeriodMinutes: 15,
      shiftStartTime: '09:00',
      shiftEndTime: '18:00',
      halfDayThresholdHours: 4,
      staleLocationMaxAgeSeconds: 300,
      checkInMethod: 'gps',
      weeklyOffDays: [0],
    });
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        return Promise.resolve({
          id: 'wh-001',
          companyId: 'company-demo-neozy',
          name: 'Main Warehouse',
          latitude: WORK_LOCATION.latitude,
          longitude: WORK_LOCATION.longitude,
          geofenceRadiusMeters: 100,
        });
      }
      return Promise.resolve(null);
    });
  });

  it('succeeds and persists a new attendance document when inside the geofence with good accuracy', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    const result = await AttendanceService.checkIn(location);

    expect(result.success).toBe(true);
    expect(mockCreateDocWithId).toHaveBeenCalledTimes(1);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.withinGeofence).toBe(true);
    expect(newDoc.checkIn.accuracyAccepted).toBe(true);
    expect(newDoc.checkIn.approvedLocationId).toBe('wh-001');
  });

  it('production-fix regression: reproduces the reported ±116m accuracy / distance ~20m case and now SUCCEEDS', async () => {
    // Root cause reproduction (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md
    // and the production-fix task): the OLD implementation rejected any
    // check-in with accuracy > gpsAccuracyThresholdMeters (default 50m)
    // regardless of distance, so a legitimately-nearby employee with a
    // noisy GPS chip (±116m accuracy is common indoors/urban) was always
    // rejected. The fix folds accuracy into the geofence decision as
    // uncertainty instead of a second independent gate — accuracy below
    // the ceiling (150m default) no longer blocks a nearby check-in.
    const { AttendanceService } = await import('../../services/AttendanceService');
    // ~20m from the work location, ±116m reported accuracy — well within
    // the 100m configured radius even before accounting for accuracy.
    const nearby = { latitude: WORK_LOCATION.latitude + 0.00018, longitude: WORK_LOCATION.longitude };
    const location = makeGeoEvidence({ latitude: nearby.latitude, longitude: nearby.longitude, accuracy: 116 });

    const result = await AttendanceService.checkIn(location);

    expect(result.success).toBe(true);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.withinGeofence).toBe(true);
    expect(newDoc.checkIn.accuracyAccepted).toBe(true); // usable (below ceiling), not "met the strict target"
    expect(['high', 'medium', 'low']).toContain(newDoc.checkIn.geoConfidence);
  });

  it('accepts a check-in with accuracy up to (but not over) the configured ceiling, when otherwise inside the geofence', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    // Exactly at the work location (distance = 0m) with accuracy just
    // under the default 150m ceiling — the OLD code rejected this purely
    // on accuracy (default threshold was 50m); the NEW model folds it in
    // as uncertainty and accepts (distance 0 <= radius regardless of accuracy).
    const location = makeGeoEvidence({ latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, accuracy: 149 });

    const result = await AttendanceService.checkIn(location);

    expect(result.success).toBe(true);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.withinGeofence).toBe(true);
    expect(newDoc.checkIn.geoConfidence).toBe('medium'); // best-estimate point inside, uncertainty circle extends past the boundary
  });

  it('rejects with gps_unusable when accuracy exceeds the hard ceiling, regardless of distance', async () => {
    const { AttendanceService, AttendanceCheckError } = await import('../../services/AttendanceService');
    // Exactly at the work location (distance = 0m) but accuracy beyond the
    // default 150m ceiling — a reading this poor provides no useful signal
    // for any reasonably-sized geofence and must still be rejected outright.
    const location = makeGeoEvidence({ latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, accuracy: 480 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'gps_unusable',
      message: expect.stringContaining('±480m'),
    });
    // Blocked attempt — no Firestore write at all (audit §29.2).
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    void AttendanceCheckError;
  });

  it('rejects with outside_geofence when accuracy is fine but the point is too far away', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    // ~1,148km away (New Delhi -> Mumbai), accuracy is excellent.
    const location = makeGeoEvidence({ latitude: 19.076, longitude: 72.8777, accuracy: 5 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'outside_geofence',
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('rejects with stale_location when capturedAt is older than staleLocationMaxAgeSeconds', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const location = makeGeoEvidence({ accuracy: 10, capturedAt: tenMinutesAgo }); // default max age is 300s = 5min

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'stale_location',
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('accepts a location just inside staleLocationMaxAgeSeconds', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const justUnderFiveMinutesAgo = new Date(Date.now() - 200 * 1000).toISOString(); // 200s < 300s default
    const location = makeGeoEvidence({ accuracy: 10, capturedAt: justUnderFiveMinutesAgo });

    const result = await AttendanceService.checkIn(location);
    expect(result.success).toBe(true);
  });

  it('falls back to Company attendance location when the assigned Warehouse has no valid geo', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        // Warehouse exists but has no geo configured at all.
        return Promise.resolve({ id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse' });
      }
      if (col === 'companies' && id === 'company-demo-neozy') {
        return Promise.resolve({
          id: 'company-demo-neozy',
          name: 'Neozy Demo Co',
          latitude: WORK_LOCATION.latitude,
          longitude: WORK_LOCATION.longitude,
          geofenceRadiusMeters: 500,
        });
      }
      return Promise.resolve(null);
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });
    const result = await AttendanceService.checkIn(location);

    expect(result.success).toBe(true);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.approvedLocationId).toBe('company-demo-neozy');
  });

  it('rejects with no_assigned_location when neither Warehouse nor Company has valid geo', async () => {
    mockGetOne.mockResolvedValue(null);

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'no_assigned_location',
    });
  });

  it('rejects a Warehouse belonging to a different company — never crosses tenant boundaries', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        return Promise.resolve({
          id: 'wh-001',
          companyId: 'OTHER-COMPANY', // does not match user's companyId
          name: 'Foreign Warehouse',
          latitude: WORK_LOCATION.latitude,
          longitude: WORK_LOCATION.longitude,
          geofenceRadiusMeters: 100,
        });
      }
      return Promise.resolve(null); // no company fallback either
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'no_assigned_location',
    });
  });

  it('rejects duplicate check-in with the existing check-in time in the message', async () => {
    const existingTimestamp = '2026-08-21T04:00:00.000Z';
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'ATT-EXISTING',
          data: () => ({
            id: 'ATT-EXISTING',
            companyId: 'company-demo-neozy',
            employeeId: 'emp-001',
            employee: 'Aarav Kumar',
            date: '2026-08-21',
            checkIn: { timestamp: existingTimestamp, location: makeGeoEvidence(), withinGeofence: true, accuracyAccepted: true, source: 'gps' },
          }),
        },
      ],
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'duplicate_check_in',
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('merges checkIn onto an existing manual-only record instead of overwriting it', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'ATT-MANUAL',
          data: () => ({
            id: 'ATT-MANUAL',
            companyId: 'company-demo-neozy',
            employeeId: 'emp-001',
            employee: 'Aarav Kumar',
            date: '2026-08-21',
            status: 'Present', // HR pre-marked, no checkIn yet
          }),
        },
      ],
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });
    const result = await AttendanceService.checkIn(location);

    expect(result.success).toBe(true);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    // The manual status must survive the merge (never overwritten by GPS check-in).
    expect(result.record?.status).toBe('Present');

    // Phase 9 (DI-02 sweep): the wh-001 fixture has no address/source field,
    // so checkInRecord.approvedLocationAddress/approvedLocationSource are
    // undefined — this is exactly the raw, unsanitized updateDoc() call a
    // real Firestore client would reject outright. Prove the actual payload
    // passed to updateDoc() never contains an undefined-valued key (the key
    // must be ABSENT, not present-with-undefined) — a superficial
    // "was updateDoc called" assertion would not catch this.
    const [, writtenPayload] = mockUpdateDoc.mock.calls[0];
    const checkIn = writtenPayload.checkIn;
    expect(checkIn).toBeDefined();
    for (const [key, value] of Object.entries(checkIn)) {
      expect(value, `checkIn.${key} must not be undefined`).not.toBeUndefined();
    }
    expect('approvedLocationAddress' in checkIn).toBe(false);
    // Legitimate populated fields still pass through unchanged.
    expect(checkIn.approvedLocationId).toBe('wh-001');
    expect(checkIn.withinGeofence).toBe(true);
  });

  it('a Warehouse WITH an address/source still passes those fields through unchanged after sanitization', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        return Promise.resolve({
          id: 'wh-001',
          companyId: 'company-demo-neozy',
          name: 'Main Warehouse',
          address: '123 Test Street',
          latitude: WORK_LOCATION.latitude,
          longitude: WORK_LOCATION.longitude,
          geofenceRadiusMeters: 100,
        });
      }
      return Promise.resolve(null);
    });
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{ id: 'ATT-MANUAL', data: () => ({ id: 'ATT-MANUAL', companyId: 'company-demo-neozy', employeeId: 'emp-001', employee: 'Aarav Kumar', date: '2026-08-21', status: 'Present' }) }],
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.checkIn(makeGeoEvidence({ accuracy: 15 }));

    expect(result.success).toBe(true);
    const [, writtenPayload] = mockUpdateDoc.mock.calls[0];
    expect(writtenPayload.checkIn.approvedLocationAddress).toBe('123 Test Street');
    expect(writtenPayload.checkIn.approvedLocationName).toBe('Main Warehouse');
  });

  it('throws not_authenticated when no user is signed in', async () => {
    const { useAppStore } = await import('../../store/useAppStore');
    (useAppStore.getState as any).mockReturnValueOnce({ user: null, activeCompanyId: null });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'not_authenticated',
    });
  });

  // ── Production fix: specific location-resolution failure reasons ────
  // (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md Finding F1) —
  // "location added successfully, attendance still doesn't work" must now
  // surface a SPECIFIC, actionable reason instead of one generic message.

  it('rejects with location_incomplete (not no_assigned_location) when the Warehouse has SOME but not all geo fields — the exact reported production bug', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        // Admin set Latitude + Longitude but left Geofence Radius blank —
        // the exact reported scenario.
        return Promise.resolve({
          id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse',
          latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude,
        });
      }
      return Promise.resolve(null); // no company fallback either
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'location_incomplete',
      message: expect.stringContaining('Geofence Radius'),
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('rejects with location_inactive when the assigned Warehouse is fully configured but not Active', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        return Promise.resolve({
          id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse',
          latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude,
          geofenceRadiusMeters: 100, status: 'Inactive',
        });
      }
      return Promise.resolve(null);
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'location_inactive',
      message: expect.stringContaining('Main Warehouse'),
    });
  });

  it('does NOT report location_incomplete for a warehouse with zero geo fields at all — falls through to Company instead', async () => {
    // A plain warehouse never intended for geo-attendance must not block
    // the Company fallback just because it exists and is assigned.
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') {
        return Promise.resolve({ id: 'wh-001', companyId: 'company-demo-neozy', name: 'Plain Warehouse' });
      }
      if (col === 'companies' && id === 'company-demo-neozy') {
        return Promise.resolve({
          id: 'company-demo-neozy', name: 'Neozy Demo Co',
          latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, geofenceRadiusMeters: 500,
        });
      }
      return Promise.resolve(null);
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.checkIn(makeGeoEvidence({ accuracy: 15 }));

    expect(result.success).toBe(true);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.approvedLocationId).toBe('company-demo-neozy');
  });

  it('rejects with invalid_coordinates when the captured GPS reading is out of range', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ latitude: 999, accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'invalid_coordinates',
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('rejects with location_inconsistent when readingSpreadMeters exceeds the configured maximum', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15, readingSpreadMeters: 999 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'location_inconsistent',
    });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('rejects with persistence_failed (distinct from a validation rejection) when the Firestore write itself throws', async () => {
    mockCreateDocWithId.mockRejectedValueOnce(new Error('network unavailable'));

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'persistence_failed',
      message: expect.stringContaining('verified'),
    });
  });
});
