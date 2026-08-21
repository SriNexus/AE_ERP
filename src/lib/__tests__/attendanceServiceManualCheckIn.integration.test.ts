/**
 * AttendanceService.markAttendance() — direct invocation tests.
 *
 * Manual Attendance is a one-click, no-GPS self-service action — NOT an
 * admin-targeting form. There is no employeeId/date/time input: the current
 * user, the current instant, and whether this call is a Check In or a
 * Check Out are all derived automatically from the logged-in identity and
 * today's existing attendance state.
 *
 * Mirrors attendanceServiceCheckIn.integration.test.ts's mocking pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockGetOne = vi.fn();
const mockCreateDocWithId = vi.fn().mockResolvedValue(undefined);
const mockResolveWriteGroupId = vi.fn((..._args: any[]) => 'group-csgpl');
vi.mock('../../lib/firestore', () => ({
  getOne: (...args: any[]) => mockGetOne(...args),
  createDocWithId: (...args: any[]) => mockCreateDocWithId(...args),
  genId: { generic: vi.fn(() => 'ATT-GEN-001') },
  resolveWriteGroupId: (...args: any[]) => mockResolveWriteGroupId(...args),
}));

const mockUser: Record<string, unknown> = {
  id: 'ga-001',
  name: 'Group Admin',
  role: 'GroupAdmin',
  companyId: 'company-demo-neozy',
};
vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({ user: mockUser, activeCompanyId: 'company-demo-neozy' })) },
}));

const mockLoadSettings = vi.fn();
vi.mock('../../features/settings/services/settingsService', () => ({
  loadSettings: (...args: any[]) => mockLoadSettings(...args),
}));

function seedNoRecordToday() {
  mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
}

function seedCheckedInToday(checkInTimestamp: string) {
  mockGetDocs.mockResolvedValue({
    empty: false,
    docs: [{
      id: 'ATT-TODAY',
      data: () => ({
        id: 'ATT-TODAY',
        employeeId: 'ga-001',
        employee: 'Group Admin',
        date: '2026-08-21',
        companyId: 'company-demo-neozy',
        checkIn: { timestamp: checkInTimestamp, source: 'manual_admin', withinGeofence: false, accuracyAccepted: false },
      }),
    }],
  });
}

function seedCompletedToday() {
  mockGetDocs.mockResolvedValue({
    empty: false,
    docs: [{
      id: 'ATT-DONE',
      data: () => ({
        id: 'ATT-DONE',
        employeeId: 'ga-001',
        employee: 'Group Admin',
        date: '2026-08-21',
        checkIn: { timestamp: '2026-08-21T09:00:00.000Z', source: 'manual_admin', withinGeofence: false, accuracyAccepted: false },
        checkOut: { timestamp: '2026-08-21T18:00:00.000Z', source: 'manual_admin', withinGeofence: false, accuracyAccepted: false },
      }),
    }],
  });
}

describe('AttendanceService.markAttendance() — self-service, no employeeId/date/time input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.id = 'ga-001';
    mockUser.name = 'Group Admin';
    mockUser.role = 'GroupAdmin';
    mockUser.companyId = 'company-demo-neozy';
    seedNoRecordToday();
    mockResolveWriteGroupId.mockReturnValue('group-csgpl');
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
  });

  it('first call of the day performs Check In, identity derived from the session (not a parameter)', async () => {
    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.markAttendance();

    expect(result.success).toBe(true);
    expect(result.action).toBe('checkIn');
    expect(mockCreateDocWithId).toHaveBeenCalledTimes(1);
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    // Identity comes only from resolveCurrentUser() — never an argument.
    expect(newDoc.employeeId).toBe('ga-001');
    expect(newDoc.employee).toBe('Group Admin');
    expect(newDoc.companyId).toBe('company-demo-neozy');
    expect(newDoc.groupId).toBe('group-csgpl');
    expect(newDoc.checkIn.source).toBe('manual_admin');
    expect(newDoc.checkIn.location).toBeUndefined();
  });

  it('the recorded timestamp is the actual current instant, not a constructed date+time', async () => {
    const before = Date.now();
    const { AttendanceService } = await import('../../services/AttendanceService');
    await AttendanceService.markAttendance();
    const after = Date.now();

    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    const recordedMs = new Date(newDoc.checkIn.timestamp).getTime();
    expect(recordedMs).toBeGreaterThanOrEqual(before);
    expect(recordedMs).toBeLessThanOrEqual(after);
  });

  it('second call of the day (already checked in) performs Check Out', async () => {
    seedCheckedInToday('2026-08-21T09:00:00.000Z');
    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.markAttendance();

    expect(result.success).toBe(true);
    expect(result.action).toBe('checkOut');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, updateData] = mockUpdateDoc.mock.calls[0];
    expect(updateData.checkOut.source).toBe('manual_admin');
    expect(typeof updateData.workingHours).toBe('number');
    expect(typeof updateData.computedStatus).toBe('string');
  });

  it('third call of the day (already checked in AND out) is refused — no third action', async () => {
    seedCompletedToday();
    const { AttendanceService } = await import('../../services/AttendanceService');
    await expect(AttendanceService.markAttendance()).rejects.toMatchObject({ reason: 'already_completed' });
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('merges Check In onto an existing manual (status-only, pre-Phase-6) record instead of duplicating it', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'ATT-EXISTING-MANUAL',
        data: () => ({
          id: 'ATT-EXISTING-MANUAL',
          employeeId: 'ga-001',
          employee: 'Group Admin',
          date: '2026-08-21',
          status: 'Present',
        }),
      }],
    });
    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.markAttendance();
    expect(result.success).toBe(true);
    expect(result.action).toBe('checkIn');
    expect(mockCreateDocWithId).not.toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('working hours reflect the true elapsed duration between check-in and check-out', async () => {
    const checkInIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
    seedCheckedInToday(checkInIso);
    const { AttendanceService } = await import('../../services/AttendanceService');
    await AttendanceService.markAttendance();
    const [, updateData] = mockUpdateDoc.mock.calls[0];
    expect(updateData.workingHours).toBeCloseTo(3, 0);
  });

  it('a different Group Admin only ever affects their own identity, never another employeeId', async () => {
    mockUser.id = 'ga-002';
    mockUser.name = 'Second Group Admin';
    const { AttendanceService } = await import('../../services/AttendanceService');
    await AttendanceService.markAttendance();
    const [, , newDoc] = mockCreateDocWithId.mock.calls[0];
    expect(newDoc.employeeId).toBe('ga-002');
    expect(newDoc.employeeId).not.toBe('ga-001');
  });

  describe('GroupAdmin read-provability (getTodayAttendance groupId constraint)', () => {
    it('adds a groupId where-clause to the duplicate-check query for a GroupAdmin actor', async () => {
      const { where } = await import('firebase/firestore');
      const { AttendanceService } = await import('../../services/AttendanceService');
      await AttendanceService.markAttendance();
      expect(where).toHaveBeenCalledWith('groupId', '==', 'group-csgpl');
    });

    it('does NOT add a groupId constraint for a plain Admin actor (unconditional read grant already covers them)', async () => {
      mockUser.role = 'Admin';
      const { where } = await import('firebase/firestore');
      const { AttendanceService } = await import('../../services/AttendanceService');
      await AttendanceService.markAttendance();
      const groupIdCalls = (where as any).mock.calls.filter((c: any[]) => c[0] === 'groupId');
      expect(groupIdCalls.length).toBe(0);
    });
  });
});
