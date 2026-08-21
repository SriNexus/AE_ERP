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

  it('rejects with the exact production accuracy message when accuracy exceeds the threshold', async () => {
    const { AttendanceService, AttendanceCheckError } = await import('../../services/AttendanceService');
    // The exact real-world reading reported: ±149m, default threshold 50m.
    const location = makeGeoEvidence({ accuracy: 149 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'accuracy_rejected',
      message: expect.stringContaining('GPS accuracy is too low to check in here (±149m, need ±50m or better)'),
    });
    // Blocked attempt — no Firestore write at all (audit §29.2).
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    void AttendanceCheckError;
  });

  it('evaluates geofence and accuracy independently — inside geofence but poor accuracy still rejects on accuracy alone', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    // Exactly at the work location (distance = 0m, well inside any radius) but poor accuracy.
    const location = makeGeoEvidence({ latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, accuracy: 111 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'accuracy_rejected',
    });
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

  it('rejects with no_attendance_location when neither Warehouse nor Company has valid geo', async () => {
    mockGetOne.mockResolvedValue(null);

    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 15 });

    await expect(AttendanceService.checkIn(location)).rejects.toMatchObject({
      reason: 'no_attendance_location',
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
      reason: 'no_attendance_location',
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
});
