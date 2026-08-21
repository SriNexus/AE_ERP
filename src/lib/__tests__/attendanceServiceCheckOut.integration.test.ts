/**
 * AttendanceService.checkOut() — direct invocation tests.
 *
 * Mirrors attendanceServiceCheckIn.integration.test.ts's mocking setup.
 * Primary purpose: prove the documented asymmetry actually holds in the
 * real code path — checkout must FLAG (not BLOCK) on outside-geofence or
 * poor-accuracy, per Master Plan Phase 8's explicit design decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GeoEvidence } from '../../lib/geo';

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

const mockGetOne = vi.fn();
vi.mock('../../lib/firestore', () => ({
  getOne: (...args: any[]) => mockGetOne(...args),
  createDocWithId: vi.fn().mockResolvedValue(undefined),
  genId: { generic: vi.fn(() => 'ATT-GEN-001') },
}));

const mockUser: Record<string, unknown> = {
  id: 'emp-001',
  name: 'Aarav Kumar',
  companyId: 'company-demo-neozy',
  warehouseId: 'wh-001',
};
vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: mockUser, activeCompanyId: 'company-demo-neozy' })) },
}));

const mockLoadSettings = vi.fn();
vi.mock('../../features/settings/services/settingsService', () => ({
  loadSettings: (...args: any[]) => mockLoadSettings(...args),
}));

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

function existingCheckedInRecord(overrides?: Record<string, unknown>) {
  return {
    empty: false,
    docs: [
      {
        id: 'ATT-TODAY',
        data: () => ({
          id: 'ATT-TODAY',
          companyId: 'company-demo-neozy',
          employeeId: 'emp-001',
          employee: 'Aarav Kumar',
          date: '2026-08-21',
          checkIn: {
            timestamp: '2026-08-21T03:30:00.000Z', // 09:00 IST
            location: makeGeoEvidence(),
            approvedLocationId: 'wh-001',
            withinGeofence: true,
            accuracyAccepted: true,
            source: 'gps',
          },
          ...overrides,
        }),
      },
    ],
  };
}

describe('AttendanceService.checkOut() — real invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('succeeds and computes workingHours from checkIn to checkOut', async () => {
    mockGetDocs.mockResolvedValue(existingCheckedInRecord());
    const { AttendanceService } = await import('../../services/AttendanceService');

    const result = await AttendanceService.checkOut(makeGeoEvidence({ accuracy: 12 }));

    expect(result.success).toBe(true);
    expect(typeof result.record?.workingHours).toBe('number');
    expect(result.record!.workingHours!).toBeGreaterThan(0);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('SUCCEEDS (does not block) when outside the geofence, but flags withinGeofence=false', async () => {
    mockGetDocs.mockResolvedValue(existingCheckedInRecord());
    const { AttendanceService } = await import('../../services/AttendanceService');
    // Far from the warehouse (Mumbai vs. Delhi).
    const location = makeGeoEvidence({ latitude: 19.076, longitude: 72.8777, accuracy: 10 });

    const result = await AttendanceService.checkOut(location);

    expect(result.success).toBe(true);
    expect(result.record?.checkOut?.withinGeofence).toBe(false);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('SUCCEEDS (does not block) when accuracy is poor, but flags accuracyAccepted=false', async () => {
    mockGetDocs.mockResolvedValue(existingCheckedInRecord());
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence({ accuracy: 149 }); // the exact real-world reading

    const result = await AttendanceService.checkOut(location);

    expect(result.success).toBe(true);
    expect(result.record?.checkOut?.accuracyAccepted).toBe(false);
  });

  it('rejects with no_check_in when the employee has not checked in today', async () => {
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    const { AttendanceService } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkOut(makeGeoEvidence())).rejects.toMatchObject({
      reason: 'no_check_in',
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects with duplicate_check_out when already checked out today', async () => {
    mockGetDocs.mockResolvedValue(
      existingCheckedInRecord({
        checkOut: {
          timestamp: '2026-08-21T12:00:00.000Z',
          location: makeGeoEvidence(),
          withinGeofence: true,
          accuracyAccepted: true,
          source: 'gps',
        },
      }),
    );
    const { AttendanceService } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkOut(makeGeoEvidence())).rejects.toMatchObject({
      reason: 'duplicate_check_out',
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
