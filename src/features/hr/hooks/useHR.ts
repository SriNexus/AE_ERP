// features/hr/hooks/useHR.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, createDocWithId, deleteDocById, genId, fmtDate,
} from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser } from '../../../store/useAppStore';
import toast from 'react-hot-toast';

// ── Attendance ────────────────────────────────────────────────

// Retained for the Bulk Status Change tool and the Status filter — both
// operate on the legacy `status` field of already-created records. Manual
// Attendance itself is no longer a form (see ManualAttendancePanel.tsx /
// AttendanceService.markAttendance() — a one-click self-service action with
// no employee/date/time/status input).
export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Half Day', 'Holiday', 'On Leave'];

export function useAttendance() {
  return useQuery({ queryKey: ['attendance'], queryFn: () => getAll(COLLECTIONS.ATTENDANCE), staleTime: 30_000 });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.ATTENDANCE, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['attendance'] }); toast.success('Record deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

// ── Effective value helpers (Phase 9 precedence: manual field wins when
// present, otherwise fall back to the GPS/manual_admin checkIn/checkOut
// sub-record). Shared by exportAttendanceCSV and every attendance list/card
// view so a record created via the Manual Attendance form (which now writes
// checkIn/checkOut + computedStatus, not status/inTime/outTime) displays
// exactly like a GPS-verified record. ──
export function effectiveAttendanceStatus(a: any): string {
  return a.status || a.computedStatus || '';
}

export function effectiveInTime(a: any): string {
  return a.inTime || formatTimestampForCSV(a.checkIn?.timestamp);
}

export function effectiveOutTime(a: any): string {
  return a.outTime || formatTimestampForCSV(a.checkOut?.timestamp);
}

function formatTimestampForCSV(ts?: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

function csvEscape(val: unknown): string {
  const s = val == null ? '' : String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Phase 14 — GPS-aware CSV export.
 *
 * Original columns (Date, Employee, Status, In Time, Out Time, Notes)
 * remain exactly as-is for backward compatibility with manual-only records.
 * GPS-derived columns (Check-In Time, Check-Out Time, GPS Status,
 * Working Hours, Early Exit) are appended and blank for manual-only rows.
 *
 * Effective status rule (Phase 9): manual status wins when present,
 * otherwise computedStatus.
 */
export function exportAttendanceCSV(records: any[]) {
  const headers = [
    'Date', 'Employee', 'Status', 'In Time', 'Out Time', 'Notes',
    'Check-In Time', 'Check-Out Time', 'GPS Status', 'Working Hours', 'Early Exit',
  ];

  const rows = records.map((a: any) => {
    // ── Original manual columns (unchanged) ──
    const base = [a.date, a.employee, a.status, a.inTime, a.outTime, a.notes];

    // ── GPS-derived columns (Phase 14) ──
    const checkInTime = formatTimestampForCSV(a.checkIn?.timestamp);
    const checkOutTime = formatTimestampForCSV(a.checkOut?.timestamp);

    // Effective status: manual status wins per Phase 9 precedence
    const effectiveStatus = effectiveAttendanceStatus(a);
    const workingHours = a.workingHours != null ? Number(a.workingHours).toFixed(2) : '';
    const earlyExit = a.earlyExit === true ? 'Yes' : a.earlyExit === false ? 'No' : '';

    return [...base, checkInTime, checkOutTime, effectiveStatus, workingHours, earlyExit];
  });

  const csvContent = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'attendance.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success('Exported!');
}

// ── Payroll ───────────────────────────────────────────────────

export const PAYROLL_FORM_DEFAULT = {
  employeeId: '', employee: '', month: '', year: new Date().getFullYear().toString(),
  basicSalary: '', hra: '', allowances: '', deductions: '', tds: '', advance: '', netSalary: '',
  mode: 'Bank Transfer', status: 'Paid', notes: '',
};
export type PayrollForm = typeof PAYROLL_FORM_DEFAULT;

export function usePayroll() {
  return useQuery({ queryKey: ['payroll'], queryFn: () => getAll(COLLECTIONS.PAYROLL), staleTime: 60_000 });
}

export function useSavePayroll(editId: string | null, onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();
  return useMutation({
    mutationFn: async (data: PayrollForm) => {
      const nums = (v: string) => Number(v) || 0;
      const net = nums(data.basicSalary) + nums(data.hra) + nums(data.allowances)
                - nums(data.deductions) - nums(data.tds) - nums(data.advance);
      const payload = {
        ...data,
        basicSalary: nums(data.basicSalary), hra: nums(data.hra),
        allowances: nums(data.allowances), deductions: nums(data.deductions),
        tds: nums(data.tds), advance: nums(data.advance),
        netSalary: net > 0 ? net : 0,
      };
      if (editId) {
        await createDocWithId(COLLECTIONS.PAYROLL, editId, payload); // overwrite
      } else {
        const id = genId.generic('PAY');
        await createDocWithId(COLLECTIONS.PAYROLL, id, { ...payload, id, createdBy: user.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll'] });
      toast.success(editId ? 'Payroll updated' : 'Payroll saved');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeletePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.PAYROLL, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['payroll'] }); toast.success('Record deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
