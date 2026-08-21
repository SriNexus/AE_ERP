/**
 * Phase 14 — Attendance CSV Export Tests
 *
 * Tests the GPS-aware export transformation logic.
 * Uses global mocks for DOM APIs since the test environment is Node.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Global DOM mocks ────────────────────────────────────────
let capturedBlob: any = null;
const mockClick = vi.fn();
const originalURL = globalThis.URL;

beforeEach(() => {
  capturedBlob = null;
  mockClick.mockClear();

  // Mock document.createElement
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'a') {
        const el = {
          _href: '',
          _download: '',
          set href(v: string) { this._href = v; },
          get href() { return this._href; },
          set download(v: string) { this._download = v; },
          get download() { return this._download; },
          click: mockClick,
        };
        return el;
      }
      return {};
    },
  });

  // Mock URL methods without replacing the whole class
  URL.createObjectURL = ((blob: any) => {
    capturedBlob = blob;
    return 'blob:mock-url';
  }) as any;

  URL.revokeObjectURL = vi.fn() as any;

  // Mock toast
  vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Restore original URL methods
  URL.createObjectURL = originalURL.createObjectURL;
  URL.revokeObjectURL = originalURL.revokeObjectURL;
});

// ── Helper: import function ─────────────────────────────────
async function getExportFn() {
  const mod = await import('../../features/hr/hooks/useHR');
  return mod.exportAttendanceCSV;
}

// ── Helper: read captured CSV ───────────────────────────────
async function readCapturedCSV(): Promise<string[][]> {
  const text = await capturedBlob.text();
  return text.split('\n').map((row: string) => row.split(','));
}

// ── Helper: build a manual-only record ──────────────────────
function manualRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'ATT-MAN-001',
    employeeId: 'EMP-01',
    employee: 'Ravi Kumar',
    date: '2026-08-20',
    status: 'Present',
    inTime: '09:00',
    outTime: '18:00',
    notes: 'Regular day',
    ...overrides,
  };
}

// ── Helper: build a GPS record ──────────────────────────────
function gpsRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'ATT-GPS-001',
    employeeId: 'EMP-02',
    employee: 'Priya Sharma',
    date: '2026-08-20',
    checkIn: {
      timestamp: '2026-08-20T09:00:00.000Z',
      location: { latitude: 28.6139, longitude: 77.2090, accuracy: 10, capturedAt: '2026-08-20T09:00:00.000Z' },
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    },
    checkOut: {
      timestamp: '2026-08-20T18:00:00.000Z',
      location: { latitude: 28.6139, longitude: 77.2090, accuracy: 15, capturedAt: '2026-08-20T18:00:00.000Z' },
      withinGeofence: true,
      accuracyAccepted: true,
      source: 'gps',
    },
    computedStatus: 'Present',
    workingHours: 9,
    earlyExit: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Phase 14 — Attendance CSV Export', () => {
  it('A: manual-only record — original columns unchanged, GPS columns blank', async () => {
    const exportCSV = await getExportFn();
    exportCSV([manualRecord()]);
    const rows = await readCapturedCSV();

    // Header row
    expect(rows[0]).toEqual([
      'Date', 'Employee', 'Status', 'In Time', 'Out Time', 'Notes',
      'Check-In Time', 'Check-Out Time', 'GPS Status', 'Working Hours', 'Early Exit',
    ]);

    // Data row — original 6 columns identical to old export
    expect(rows[1][0]).toBe('2026-08-20');
    expect(rows[1][1]).toBe('Ravi Kumar');
    expect(rows[1][2]).toBe('Present');
    expect(rows[1][3]).toBe('09:00');
    expect(rows[1][4]).toBe('18:00');
    expect(rows[1][5]).toBe('Regular day');

    // GPS columns — blank for manual record
    expect(rows[1][6]).toBe('');  // Check-In Time
    expect(rows[1][7]).toBe('');  // Check-Out Time
    expect(rows[1][8]).toBe('Present');  // GPS Status = effective status = manual status
    expect(rows[1][9]).toBe('');  // Working Hours
    expect(rows[1][10]).toBe(''); // Early Exit
  });

  it('B: GPS check-in only — Check-In Time populated, Check-Out blank', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ checkOut: undefined, workingHours: undefined, earlyExit: undefined })]);
    const rows = await readCapturedCSV();

    // Check-In Time should be populated (formatted from ISO timestamp)
    expect(rows[1][6]).toMatch(/\d{2}:\d{2}/);
    // Check-Out Time should be blank
    expect(rows[1][7]).toBe('');
    // GPS Status = computedStatus
    expect(rows[1][8]).toBe('Present');
    // Working Hours blank
    expect(rows[1][9]).toBe('');
    // Early Exit blank (undefined)
    expect(rows[1][10]).toBe('');
  });

  it('C: complete GPS attendance — all columns populated', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord()]);
    const rows = await readCapturedCSV();

    expect(rows[1][6]).toMatch(/\d{2}:\d{2}/);  // Check-In Time
    expect(rows[1][7]).toMatch(/\d{2}:\d{2}/);  // Check-Out Time
    expect(rows[1][8]).toBe('Present');           // GPS Status
    expect(rows[1][9]).toBe('9.00');              // Working Hours
    expect(rows[1][10]).toBe('No');               // Early Exit
  });

  it('D: manual + GPS record — effective status precedence preserved', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ status: 'Present' })]);
    const rows = await readCapturedCSV();

    // Manual status wins
    expect(rows[1][2]).toBe('Present');   // Status column = manual
    expect(rows[1][8]).toBe('Present');   // GPS Status = effective = manual (wins)
  });

  it('E: Late + EarlyExit — GPS Status = Late, Early Exit = Yes', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ computedStatus: 'Late', earlyExit: true })]);
    const rows = await readCapturedCSV();

    expect(rows[1][8]).toBe('Late');      // GPS Status
    expect(rows[1][10]).toBe('Yes');      // Early Exit
  });

  it('F: WeeklyOff — computedStatus exported correctly', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ computedStatus: 'WeeklyOff', earlyExit: false })]);
    const rows = await readCapturedCSV();

    expect(rows[1][8]).toBe('WeeklyOff');
    expect(rows[1][10]).toBe('No');
  });

  it('G: missing optional GPS fields — old records do not crash', async () => {
    const exportCSV = await getExportFn();
    exportCSV([{ date: '2026-01-01', employee: 'Old Record', status: 'Absent' }]);
    const rows = await readCapturedCSV();

    expect(rows[1][0]).toBe('2026-01-01');
    expect(rows[1][6]).toBe('');
    expect(rows[1][7]).toBe('');
    expect(rows[1][8]).toBe('Absent');
    expect(rows[1][9]).toBe('');
    expect(rows[1][10]).toBe('');
  });

  it('H: column order — GPS columns come after original 6', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord()]);
    const rows = await readCapturedCSV();

    expect(rows[0]).toEqual([
      'Date', 'Employee', 'Status', 'In Time', 'Out Time', 'Notes',
      'Check-In Time', 'Check-Out Time', 'GPS Status', 'Working Hours', 'Early Exit',
    ]);
  });

  it('I: multiple records — mixed manual and GPS', async () => {
    const exportCSV = await getExportFn();
    exportCSV([
      manualRecord({ employee: 'Employee A' }),
      gpsRecord({ employee: 'Employee B', computedStatus: 'Late', earlyExit: true, workingHours: 7.5 }),
    ]);
    const rows = await readCapturedCSV();

    // Manual record
    expect(rows[1][1]).toBe('Employee A');
    expect(rows[1][8]).toBe('Present');
    expect(rows[1][9]).toBe('');

    // GPS record
    expect(rows[2][1]).toBe('Employee B');
    expect(rows[2][8]).toBe('Late');
    expect(rows[2][9]).toBe('7.50');
    expect(rows[2][10]).toBe('Yes');
  });

  it('J: manual status overrides computedStatus in GPS Status column', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ status: 'On Leave', computedStatus: 'Late' })]);
    const rows = await readCapturedCSV();

    expect(rows[1][2]).toBe('On Leave');
    expect(rows[1][8]).toBe('On Leave');
  });

  it('K: workingHours formatting — 2 decimal places', async () => {
    const exportCSV = await getExportFn();
    exportCSV([gpsRecord({ workingHours: 4.567 })]);
    const rows = await readCapturedCSV();

    expect(rows[1][9]).toBe('4.57');
  });

  it('L: no records — only header row', async () => {
    const exportCSV = await getExportFn();
    exportCSV([]);
    const rows = await readCapturedCSV();

    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('Date');
    expect(rows[0]).toContain('GPS Status');
  });
});
