/**
 * Face Attendance + DeepFace Master Plan, Phase 8 — `AttendanceService`
 * biometric-verified check-in/check-out tests.
 *
 * Mirrors `attendanceServiceCheckIn.integration.test.ts`'s own established
 * mocking convention exactly (mock `firebase/firestore`, `lib/firebase`,
 * `lib/firestore`'s `getOne`, `useAppStore`, Settings) — calling the REAL
 * `AttendanceService.checkIn()`/`checkOut()` with every dependency mocked,
 * proving the actual Phase 8 code path: `validateBiometricVerificationClaim()`
 * re-reads `biometric_face_references/{caller's own id}` via `getOne` (the
 * SAME client-SDK dependency already mocked here) and independently
 * confirms the claimed `verificationId` before any write proceeds.
 *
 * Covers the AttendanceService-side half of the Phase 8 test matrix:
 * successful biometric check-in/out, revoked/no-enrollment rejection,
 * forged/mismatched/stale claim rejection (no attendance write on any of
 * these), GPS still fully validated on the biometric path, existing
 * GPS-only behavior unchanged, and identity never taken from the client
 * (the reference lookup is always keyed by the caller's OWN resolved
 * identity, never a request-supplied id).
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
  COLLECTIONS: {
    ATTENDANCE: 'attendance',
    WAREHOUSES: 'warehouses',
    COMPANIES: 'companies',
    BIOMETRIC_FACE_REFERENCES: 'biometric_face_references',
  },
}));

// ── Mock lib/firestore (getOne resolves Warehouse/Company/BiometricRef fixtures) ──
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

const WORK_LOCATION = { latitude: 28.6139, longitude: 77.209 };
const NOW_ISO = new Date().toISOString();

function makeGeoEvidence(overrides?: Partial<GeoEvidence>): GeoEvidence {
  return {
    latitude: WORK_LOCATION.latitude,
    longitude: WORK_LOCATION.longitude,
    accuracy: 15,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function biometricReferenceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-001',
    userId: 'emp-001',
    companyId: 'company-demo-neozy',
    status: 'active',
    lastVerifiedAt: NOW_ISO,
    ...overrides,
  };
}

describe('AttendanceService — Phase 8 biometric-verified check-in/check-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.id = 'emp-001';
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
          id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse',
          latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, geofenceRadiusMeters: 100,
        });
      }
      if (col === 'biometric_face_references' && id === 'emp-001') {
        return Promise.resolve(biometricReferenceFixture());
      }
      return Promise.resolve(null);
    });
  });

  // ── 1. Successful biometric check-in ────────────────────────────────
  it('1. succeeds and persists source:"biometric" + biometricVerificationId when the claim matches the caller\'s own fresh lastVerifiedAt', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence();

    const result = await AttendanceService.checkIn(location, { verificationId: NOW_ISO });

    expect(result.success).toBe(true);
    expect(mockCreateDocWithId).toHaveBeenCalledTimes(1);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.source).toBe('biometric');
    expect(newDoc.checkIn.biometricVerificationId).toBe(NOW_ISO);
    // GPS is STILL fully captured/validated on the biometric path (§12) —
    // never skipped just because a biometric claim was supplied.
    expect(newDoc.checkIn.withinGeofence).toBe(true);
    expect(newDoc.checkIn.accuracyAccepted).toBe(true);
  });

  // ── 2. Successful biometric check-out ───────────────────────────────
  it('2. checkOut() succeeds with source:"biometric" when the claim is valid', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'att-001',
        data: () => ({
          id: 'att-001', employeeId: 'emp-001', companyId: 'company-demo-neozy', date: '2026-08-27',
          checkIn: { timestamp: new Date(Date.now() - 3600_000).toISOString(), source: 'gps', withinGeofence: true, accuracyAccepted: true, approvedLocationId: 'wh-001' },
        }),
      }],
    });
    const { AttendanceService } = await import('../../services/AttendanceService');
    const location = makeGeoEvidence();

    const result = await AttendanceService.checkOut(location, { verificationId: NOW_ISO });

    expect(result.success).toBe(true);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, updatePayload] = mockUpdateDoc.mock.calls[0];
    expect(updatePayload.checkOut.source).toBe('biometric');
    expect(updatePayload.checkOut.biometricVerificationId).toBe(NOW_ISO);
  });

  // ── 8. Revoked / no enrolled reference ──────────────────────────────
  it('8a. rejects the biometric claim (no write) when the caller has no biometric reference at all', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') return Promise.resolve({ id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse', latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, geofenceRadiusMeters: 100 });
      return Promise.resolve(null); // no biometric_face_references doc
    });
    const { AttendanceService, AttendanceCheckError } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkIn(makeGeoEvidence(), { verificationId: NOW_ISO }))
      .rejects.toBeInstanceOf(AttendanceCheckError);
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('8b. rejects the biometric claim (no write) when the reference is revoked', async () => {
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') return Promise.resolve({ id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse', latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, geofenceRadiusMeters: 100 });
      if (col === 'biometric_face_references' && id === 'emp-001') return Promise.resolve(biometricReferenceFixture({ status: 'revoked' }));
      return Promise.resolve(null);
    });
    const { AttendanceService } = await import('../../services/AttendanceService');

    const result = AttendanceService.checkIn(makeGeoEvidence(), { verificationId: NOW_ISO });
    await expect(result).rejects.toMatchObject({ reason: 'biometric_verification_invalid' });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  // ── 14 / 20. Forged/mismatched claim → no write, no identity trusted ──
  it('14a. rejects a forged verificationId that does not match the server-stamped lastVerifiedAt — no attendance write occurs', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkIn(makeGeoEvidence(), { verificationId: 'not-the-real-timestamp' }))
      .rejects.toMatchObject({ reason: 'biometric_verification_invalid' });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('14b. rejects an empty/missing verificationId outright, before any Firestore read', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkIn(makeGeoEvidence(), { verificationId: '' }))
      .rejects.toMatchObject({ reason: 'biometric_verification_invalid' });
    expect(mockGetOne).not.toHaveBeenCalledWith('biometric_face_references', expect.anything());
  });

  it('14c. rejects a stale claim — a genuinely-passed verification older than the freshness window cannot power a check-in hours later (anti-replay)', async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    mockGetOne.mockImplementation((col: string, id: string) => {
      if (col === 'warehouses' && id === 'wh-001') return Promise.resolve({ id: 'wh-001', companyId: 'company-demo-neozy', name: 'Main Warehouse', latitude: WORK_LOCATION.latitude, longitude: WORK_LOCATION.longitude, geofenceRadiusMeters: 100 });
      if (col === 'biometric_face_references' && id === 'emp-001') return Promise.resolve(biometricReferenceFixture({ lastVerifiedAt: staleTimestamp }));
      return Promise.resolve(null);
    });
    const { AttendanceService } = await import('../../services/AttendanceService');

    // Claims the exact (matching) but STALE timestamp.
    await expect(AttendanceService.checkIn(makeGeoEvidence(), { verificationId: staleTimestamp }))
      .rejects.toMatchObject({ reason: 'biometric_verification_invalid' });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });

  it('20. identity is never taken from the biometric claim itself — the reference lookup is always keyed by the caller\'s OWN resolved identity (useAppStore), never any client-supplied id', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    await AttendanceService.checkIn(makeGeoEvidence(), { verificationId: NOW_ISO });

    // Every biometric_face_references lookup must have used the resolved
    // current user's id ('emp-001') — the BiometricVerificationClaim type
    // itself carries no employeeId/userId field at all for a caller to
    // even attempt supplying one.
    const biometricLookups = mockGetOne.mock.calls.filter(([col]) => col === 'biometric_face_references');
    expect(biometricLookups.length).toBeGreaterThan(0);
    for (const [, id] of biometricLookups) {
      expect(id).toBe('emp-001');
    }
  });

  // ── 17. Existing GPS-only behavior remains completely unchanged ─────
  it('17. checkIn(location) with NO biometric argument behaves exactly as before Phase 8 — source:"gps", no biometricVerificationId field, no biometric reference ever read', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.checkIn(makeGeoEvidence());

    expect(result.success).toBe(true);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.checkIn.source).toBe('gps');
    expect('biometricVerificationId' in newDoc.checkIn).toBe(false);
    expect(mockGetOne).not.toHaveBeenCalledWith('biometric_face_references', expect.anything());
  });

  // ── 16. Duplicate protection unaffected — same guard, unchanged ─────
  it('16. a biometric check-in is still rejected as a duplicate if one already exists today — the pre-existing guard is untouched, biometric claim does not bypass it', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'att-001',
        data: () => ({ id: 'att-001', employeeId: 'emp-001', companyId: 'company-demo-neozy', date: '2026-08-27', checkIn: { timestamp: NOW_ISO, source: 'gps', withinGeofence: true, accuracyAccepted: true } }),
      }],
    });
    const { AttendanceService } = await import('../../services/AttendanceService');

    await expect(AttendanceService.checkIn(makeGeoEvidence(), { verificationId: NOW_ISO }))
      .rejects.toMatchObject({ reason: 'duplicate_check_in' });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
  });
});
