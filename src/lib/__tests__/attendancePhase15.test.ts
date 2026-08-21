/**
 * Phase 15 — Attendance Audit Logs + Security Hardening Tests
 *
 * Tests:
 * - correctAttendance() validation and behavior
 * - AuditActionType includes 'attendance_correction' and 'geofence_violation'
 * - Correction reason validation (mandatory, non-empty)
 * - GPS-only correction path (manual records rejected)
 * - Audit logging sequence
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditActionType } from '../../lib/auditLogger';

// ── Mock Firestore ──────────────────────────────────────────
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  updateDoc: (...args: any[]) => mockUpdateDoc(...args),
  doc: vi.fn((_db: any, _col: string, id: string) => ({ id, path: `${_col}/${id}` })),
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
  COLLECTIONS: { ATTENDANCE: 'attendance', AUDIT_LOGS: 'audit_logs' },
}));

vi.mock('../../lib/firestore', () => ({
  getOne: vi.fn(),
  createDocWithId: vi.fn(),
  genId: { generic: vi.fn(() => 'GEN-ID-001') },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      user: { id: 'admin-001', role: 'Admin', companyId: 'COMPANY-A', email: 'admin@test.com' },
      activeCompanyId: 'COMPANY-A',
    })),
  },
}));

vi.mock('../../lib/permissions', () => ({
  usePermissions: vi.fn(() => ({
    canEdit: vi.fn(() => true),
    canCreate: vi.fn(() => true),
    canDelete: vi.fn(() => true),
  })),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Tests ───────────────────────────────────────────────────

describe('Phase 15 — AuditActionType extension', () => {
  it('AuditActionType includes attendance_correction', () => {
    // Type-level check: the type should accept these string literals
    const validActions: AuditActionType[] = [
      'attendance_correction',
      'geofence_violation',
    ];
    expect(validActions).toContain('attendance_correction');
    expect(validActions).toContain('geofence_violation');
  });
});

describe('Phase 15 — correctAttendance() validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty correction reason', async () => {
    const { getOne } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue({
      id: 'ATT-001',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      checkIn: { timestamp: '2026-08-20T09:00:00Z', withinGeofence: true, accuracyAccepted: true, source: 'gps', location: {} },
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    await expect(
      AttendanceService.correctAttendance('ATT-001', { reason: '' }),
    ).rejects.toThrow('correction reason is required');
  });

  it('rejects whitespace-only correction reason', async () => {
    const { getOne } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue({
      id: 'ATT-001',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      checkIn: { timestamp: '2026-08-20T09:00:00Z', withinGeofence: true, accuracyAccepted: true, source: 'gps', location: {} },
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    await expect(
      AttendanceService.correctAttendance('ATT-001', { reason: '   ' }),
    ).rejects.toThrow('correction reason is required');
  });

  it('rejects manual-only records (no checkIn/checkOut)', async () => {
    const { getOne } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue({
      id: 'ATT-MANUAL',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      status: 'Present',
      inTime: '09:00',
      outTime: '18:00',
      // No checkIn or checkOut
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    await expect(
      AttendanceService.correctAttendance('ATT-MANUAL', { reason: 'Fix time' }),
    ).rejects.toThrow('manual attendance record');
  });

  it('rejects non-existent record', async () => {
    const { getOne } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue(null);

    const { AttendanceService } = await import('../../services/AttendanceService');
    await expect(
      AttendanceService.correctAttendance('ATT-NONE', { reason: 'Fix' }),
    ).rejects.toThrow('not found');
  });

  it('successful correction with valid reason writes update + audit log', async () => {
    const { getOne, createDocWithId } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue({
      id: 'ATT-001',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      checkIn: {
        timestamp: '2026-08-20T09:00:00Z',
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps',
        location: { latitude: 28.6139, longitude: 77.2090, accuracy: 10, capturedAt: '2026-08-20T09:00:00Z' },
      },
    });
    (createDocWithId as any).mockResolvedValue(undefined);

    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.correctAttendance('ATT-001', {
      reason: 'GPS showed wrong location due to device error',
    });

    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record!.correction).toBeDefined();
    expect(result.record!.correction!.reason).toBe('GPS showed wrong location due to device error');
    expect(result.record!.correction!.correctedBy).toBe('admin-001');
    expect(result.record!.correction!.previousValues).toHaveProperty('checkIn');

    // Audit log should have been written
    expect(createDocWithId).toHaveBeenCalled();
  });

  it('correction preserves existing checkIn when no override provided', async () => {
    const { getOne } = await import('../../lib/firestore');
    const originalCheckIn = {
      timestamp: '2026-08-20T09:00:00Z',
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
      location: { latitude: 28.6139, longitude: 77.2090, accuracy: 10, capturedAt: '2026-08-20T09:00:00Z' },
    };
    (getOne as any).mockResolvedValue({
      id: 'ATT-001',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      checkIn: originalCheckIn,
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.correctAttendance('ATT-001', {
      reason: 'Location was correct, noting for records',
    });

    expect(result.success).toBe(true);
    // checkIn should be preserved unchanged
    expect(result.record!.checkIn).toEqual(originalCheckIn);
  });

  it('correction with checkIn override merges the override', async () => {
    const { getOne } = await import('../../lib/firestore');
    (getOne as any).mockResolvedValue({
      id: 'ATT-001',
      employeeId: 'EMP-01',
      companyId: 'COMPANY-A',
      date: '2026-08-20',
      checkIn: {
        timestamp: '2026-08-20T09:00:00Z',
        withinGeofence: true,
        accuracyAccepted: true,
        source: 'gps',
        location: { latitude: 28.6139, longitude: 77.2090, accuracy: 10, capturedAt: '2026-08-20T09:00:00Z' },
      },
    });

    const { AttendanceService } = await import('../../services/AttendanceService');
    const result = await AttendanceService.correctAttendance('ATT-001', {
      reason: 'Check-in time was 09:05, not 09:00',
      checkIn: { timestamp: '2026-08-20T09:05:00Z' },
    });

    expect(result.success).toBe(true);
    expect(result.record!.checkIn!.timestamp).toBe('2026-08-20T09:05:00Z');
  });
});
