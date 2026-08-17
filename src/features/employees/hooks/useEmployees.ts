import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAll, fmtDate } from '../../../lib/firestore';
import {
  deleteProjectionWithEntity,
} from '../../../lib/entityProjection';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { ERP_ROLES } from '../../../config/company';
import { EmployeeDomainService } from '../../../services/EmployeeDomainService';
import toast from 'react-hot-toast';

const QK = ['employees'] as const;

export const EMPLOYEE_FORM_DEFAULT = {
  name: '', phone: '', email: '', dob: '', gender: 'Male',
  department: '', designation: '', role: 'Sales', joinDate: '',
  salary: '', bankAccount: '', bankIfsc: '', bankName: '',
  panNumber: '', aadharNumber: '', address: '', city: '', state: '',
  status: 'Active', emergencyContact: '', emergencyPhone: '',
  // Phase 12: User-domain fields, synced by EmployeeDomainService onto the
  // linked User record (Employee.userId) — not stored on Employee itself.
  warehouseId: '', managerId: '',
};
export type EmployeeForm = typeof EMPLOYEE_FORM_DEFAULT;

export const DEPT_OPTIONS = [
  'Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'IT', 'Admin', 'Procurement', 'Logistics',
].map(d => ({ label: d, value: d }));

export const ROLE_OPTIONS = ERP_ROLES.map(r => ({ label: r, value: r }));

export const EMPLOYEE_STATUS_OPTIONS = [
  'Active', 'Inactive', 'On Leave', 'Terminated',
].map(s => ({ label: s, value: s }));

export function createEmployeeProjection(id: string, payload: Record<string, unknown>) {
  return EmployeeDomainService.create({ ...payload, id });
}

export function useEmployees() {
  return useQuery({ queryKey: QK, queryFn: () => getAll(COLLECTIONS.EMPLOYEES), staleTime: 30_000 });
}

export function useSaveEmployee(editId: string | null, onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  return useMutation({
    mutationFn: async (data: EmployeeForm) => {
      const payload = { ...data, salary: Number(data.salary) || 0 };
      if (editId) {
        await EmployeeDomainService.update(editId, { ...payload, updatedBy: user.id });
      } else {
        await EmployeeDomainService.create({
          ...payload,
          companyId: activeCompanyId,
          createdBy: user.id,
        });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: QK }); toast.success(editId ? 'Employee updated' : 'Employee added'); onSuccess(); },
    onError:   (e: any) => toast.error(e.message),
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectionWithEntity(COLLECTIONS.EMPLOYEES, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: QK }); toast.success('Employee deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function exportEmployeesCSV(employees: any[]) {
  const rows = [
    ['ID', 'Name', 'Phone', 'Email', 'Department', 'Designation', 'Role', 'Join Date', 'Status'],
    ...employees.map((e: any) => [e.id, e.name, e.phone, e.email, e.department, e.designation, e.role, fmtDate(e.joinDate), e.status]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'employees.csv';
  a.click();
  toast.success('Exported!');
}
