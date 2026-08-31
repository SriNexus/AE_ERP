import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getAll, fmtDate, isRealCompanyId } from '../../../lib/firestore';
import {
  deleteProjectionWithEntity,
} from '../../../lib/entityProjection';
import { COLLECTIONS, db } from '../../../lib/firebase';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { ERP_ROLES } from '../../../config/company';
import { EmployeeDomainService } from '../../../services/EmployeeDomainService';
import { queryKeys } from '../../../lib/queryKeys';
import toast from 'react-hot-toast';

// Phase 10 (F-CACHE-01 sweep): routed through the existing
// queryKeys.forCompany() factory instead of the module-level, company-
// unscoped `const QK = ['employees']` this file previously used.

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

/**
 * Group Admin employee-list visibility (final completion pass): a Group
 * Admin's OWN `employees` record is linked to whichever company they were
 * promoted from (`grantGroupAdminForGroup()`'s `linkOrCreateForUser()` call
 * in `groupAdmin.ts` — a fixed, one-time `companyId`, never re-assigned).
 * When a DIFFERENT company within their group is the active context, the
 * normal `companyId`-scoped employees query correctly excludes that record
 * (an employee fundamentally belongs to one company) — but the Group Admin
 * conceptually oversees every company in their group, so their own entry
 * should still surface there for management (in particular, so they can be
 * reached via Employee → View → Register Face like anyone else).
 *
 * Deliberately a SECOND, narrowly-scoped, direct Firestore query — never
 * routed through `getAll()`/`applyAccessFilters()`, both of which apply a
 * hard `companyId === activeCompanyId` constraint that would filter this
 * exact record back out. Rules-provable without any `firestore.rules`
 * change: `employees` documents are already stamped with `groupId` by the
 * existing write-helper convention (`resolveWriteGroupId()`, applied inside
 * `createDocWithId()` for every non-excluded collection, `employees`
 * included), and `firestore.rules`' own `employees` read rule already
 * grants a GroupAdmin actor `groupAdminCanRead()` — same groupId, active
 * group — regardless of the document's own `companyId`. A non-GroupAdmin
 * viewer never reaches this branch at all: for them, `employees` reads stay
 * exactly as they were (`sameCompany()`-only, unchanged), so this does not
 * expose cross-company employee data to anyone not already authorized to
 * see it. Creates nothing — a pure, additional read merged into the result;
 * never a duplicate/synthetic employee identity.
 */
async function fetchOwnGroupAdminEmployeeRecords(groupId: string) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.EMPLOYEES),
    where('groupId', '==', groupId),
    where('role', '==', 'GroupAdmin'),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })
    .filter((e) => e.isDeleted !== true);
}

export function useEmployees() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const user = useCurrentUser();
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.employees,
    queryFn: async () => {
      const primary = await getAll(COLLECTIONS.EMPLOYEES);
      // Only for a GroupAdmin actor viewing one SPECIFIC company (not the
      // 'all'/'group' sentinels — 'group' view already returns every
      // groupId-matching employee, including the Group Admin's own record,
      // via companyScopedQuery()'s existing group-view branch; nothing to
      // merge there).
      if (user.role === 'GroupAdmin' && user.groupId && isRealCompanyId(activeCompanyId)) {
        const groupAdmins = await fetchOwnGroupAdminEmployeeRecords(user.groupId);
        if (groupAdmins.length > 0) {
          const byId = new Map(primary.map((e: any) => [e.id, e]));
          groupAdmins.forEach((ga) => byId.set(ga.id, ga));
          return Array.from(byId.values());
        }
      }
      return primary;
    },
    staleTime: 30_000,
  });
}

export function useSaveEmployee(editId: string | null, onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.employees }); toast.success(editId ? 'Employee updated' : 'Employee added'); onSuccess(); },
    onError:   (e: any) => toast.error(e.message),
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: (id: string) => deleteProjectionWithEntity(COLLECTIONS.EMPLOYEES, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.employees }); toast.success('Employee deleted'); },
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
