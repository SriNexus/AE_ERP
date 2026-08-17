// features/hr/hooks/useHR.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, createDocWithId, deleteDocById, genId, fmtDate,
} from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser } from '../../../store/useAppStore';
import toast from 'react-hot-toast';

// ── Attendance ────────────────────────────────────────────────

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Half Day', 'Holiday', 'On Leave'];

export const ATTENDANCE_FORM_DEFAULT = {
  employeeId: '', employee: '', date: new Date().toISOString().split('T')[0],
  status: 'Present', inTime: '', outTime: '', notes: '',
};
export type AttendanceForm = typeof ATTENDANCE_FORM_DEFAULT;

export function useAttendance() {
  return useQuery({ queryKey: ['attendance'], queryFn: () => getAll(COLLECTIONS.ATTENDANCE), staleTime: 30_000 });
}

export function useMarkAttendance(onSuccess: () => void) {
  const qc   = useQueryClient();
  const user = useCurrentUser();
  return useMutation({
    mutationFn: async (data: AttendanceForm) => {
      const id = genId.generic('ATT');
      await createDocWithId(COLLECTIONS.ATTENDANCE, id, { ...data, id, createdBy: user.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Attendance marked');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.ATTENDANCE, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['attendance'] }); toast.success('Record deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function exportAttendanceCSV(records: any[]) {
  const rows = [
    ['Date', 'Employee', 'Status', 'In Time', 'Out Time', 'Notes'],
    ...records.map((a: any) => [a.date, a.employee, a.status, a.inTime, a.outTime, a.notes]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'attendance.csv';
  a.click();
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
