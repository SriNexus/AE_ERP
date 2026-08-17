/**
 * MobileEmployeesWorkspace — Mobile Employees module
 *
 * Architecture matches MobileLeadWorkspace:
 *   - No inline KPI/Search/Filters (handled by MobileTopBar at module level)
 *   - Filters read from URL params
 *   - Card-based list matching LeadCard pattern
 *   - Full-screen detail modal with Section/Detail components
 *   - Shared ConfirmDialog for deletes
 *   - Dirty state tracking + confirm close on forms
 *   - mode prop for 'records' | 'create'
 *
 * Reuses:
 *   - useEmployees, useSaveEmployee, useDeleteEmployee, exportEmployeesCSV
 *     EMPLOYEE_FORM_DEFAULT, DEPT_OPTIONS, ROLE_OPTIONS, EMPLOYEE_STATUS_OPTIONS
 *     from features/employees/hooks/useEmployees.ts
 *   - INDIAN_STATES from config/company
 *   - fmtDate from lib/firestore
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Input, Modal,
 *     Pagination, Select, Textarea, statusBadge) from ../../ui
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download, Edit2, Eye, Mail, Phone, Trash2, UserCog,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  useEmployees, useSaveEmployee, useDeleteEmployee, exportEmployeesCSV,
  EMPLOYEE_FORM_DEFAULT, type EmployeeForm,
  DEPT_OPTIONS, ROLE_OPTIONS, EMPLOYEE_STATUS_OPTIONS,
} from '../../../features/employees/hooks/useEmployees';
import { useWarehouses } from '../../../features/warehouses/hooks/useWarehouses';
import { buildUserMap, buildWarehouseMap, resolveEmployeeWarehouseInfo, type EmployeeWarehouseInfo } from '../../../lib/employeeDirectory';
import { fmtDate, getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { usePermissions } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 15;
const ALL = 'All';
const INDIAN_STATE_OPTS = [
  { label: 'Select State', value: '' },
  ...['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
      'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
      'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
      'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
      'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
  ].map(s => ({ label: s, value: s })),
];

type Employee = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type EmployeeFilters = {
  search: string;
  status: string;
  dept: string;
};

function employeeTitle(emp: Employee) {
  return emp.name || 'Untitled Employee';
}

function filterEmployees(employees: Employee[], filters: EmployeeFilters) {
  const term = filters.search.trim().toLowerCase();
  return employees
    .filter((emp) => {
      if (filters.status !== ALL && emp.status !== filters.status) return false;
      if (filters.dept !== ALL && emp.department !== filters.dept) return false;
      if (!term) return true;
      return [emp.name, emp.phone, emp.email, emp.designation, emp.department, emp.role]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt || 0).getTime() || 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt || 0).getTime() || 0;
      return bTime - aTime;
    });
}

function downloadEmployeesCsv(rows: Employee[], filename: string) {
  const headers = ['Name', 'Phone', 'Email', 'Department', 'Designation', 'Role', 'Status'];
  const lines = rows.map((emp) =>
    [emp.name || '', emp.phone || '', emp.email || '', emp.department || '', emp.designation || '', emp.role || '', emp.status || '']
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileEmployeesWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { data: employees = [], isLoading, isError, refetch } = useEmployees();
  const deleteEmp = useDeleteEmployee();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>({ ...EMPLOYEE_FORM_DEFAULT });
  const [viewEmp, setViewEmp] = useState<Employee | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  // Phase 12: Employee -> User -> Warehouse/Reporting-Manager join, matching
  // Employees.tsx (desktop) exactly — same shared cache key, no separate
  // mobile-only logic.
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: warehouses = [] } = useWarehouses();
  const usersById = useMemo(() => buildUserMap(users as any[]), [users]);
  const warehousesById = useMemo(() => buildWarehouseMap(warehouses as any[]), [warehouses]);
  const warehouseOptions = useMemo(() => [
    { label: 'No warehouse assigned', value: '' },
    ...(warehouses as any[]).map((w: any) => ({ label: w.name, value: w.id })),
  ], [warehouses]);
  const managerOptions = useMemo(() => [
    { label: 'None (Top level)', value: '' },
    ...(users as any[]).filter((u: any) => u.id !== editingEmp?.userId).map((u: any) => ({ label: u.name, value: u.id })),
  ], [users, editingEmp]);

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingEmp(null);
    setForm({ ...EMPLOYEE_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const canEdit = perms.can('employees', 'edit');
  const canDelete = perms.can('employees', 'delete');
  const canExport = perms.can('employees', 'export');

  const saveEmp = useSaveEmployee(editingEmp?.id || null, () => {
    setFormOpen(false);
    setEditingEmp(null);
    setForm({ ...EMPLOYEE_FORM_DEFAULT });
    setDirty(false);
    void qc.invalidateQueries({ queryKey: ['employees'] });
  });

  const filters = useMemo<EmployeeFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    dept: params.get('dept') || ALL,
  }), [params]);

  const filteredEmployees = useMemo(() => filterEmployees(employees as Employee[], filters), [employees, filters]);
  const paginatedEmployees = useMemo(() => filteredEmployees.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredEmployees, page]);
  const selectedRows = useMemo(() => (employees as Employee[]).filter((emp) => selected.has(emp.id)), [employees, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredEmployees.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredEmployees.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((employees as Employee[]).map((emp) => emp.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [employees]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openEdit(emp: Employee) {
    setEditingEmp(emp);
    const warehouseInfo = resolveEmployeeWarehouseInfo(emp, usersById, warehousesById);
    setForm({
      name: emp.name || '', phone: emp.phone || '', email: emp.email || '',
      dob: emp.dob?.split('T')[0] || '', gender: emp.gender || 'Male',
      department: emp.department || '', designation: emp.designation || '', role: emp.role || 'Sales',
      joinDate: emp.joinDate?.split('T')[0] || '', salary: String(emp.salary || ''),
      bankAccount: emp.bankAccount || '', bankIfsc: emp.bankIfsc || '', bankName: emp.bankName || '',
      panNumber: emp.panNumber || '', aadharNumber: emp.aadharNumber || '',
      address: emp.address || '', city: emp.city || '', state: emp.state || '',
      status: emp.status || 'Active', emergencyContact: emp.emergencyContact || '', emergencyPhone: emp.emergencyPhone || '',
      warehouseId: warehouseInfo.warehouseId, managerId: warehouseInfo.managerId,
    });
    setDirty(false);
    setFormOpen(true);
  }

  function requestCloseForm() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingEmp(null);
    setForm({ ...EMPLOYEE_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') {
      navigate('/app', { replace: true });
      return;
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function updateForm(patch: Partial<EmployeeForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitEmployee(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name || !form.phone) return toast.error('Name & phone required');
    saveEmp.mutate(form);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((emp) => deleteEmp.mutateAsync(emp.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: Employee[]) {
    if (!rows.length) return toast.error('No employees selected');
    downloadEmployeesCsv(rows, `employees-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} employee${rows.length > 1 ? 's' : ''}`);
  }

  if (mode === 'create') {
    return (
      <EmployeeDialogs
        formOpen={formOpen}
        form={form}
        editingEmp={editingEmp}
        saving={saveEmp.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        warehouseOptions={warehouseOptions}
        managerOptions={managerOptions}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitEmployee}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-employees-header" className="text-xl font-bold text-[var(--color-text)]">Employees</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            {canExport && <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <UserCog className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load employees</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load employee data.</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">Retry</button>
        </div>
      )}

      <div className="space-y-3" data-tour="employees-table">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <EmployeeSkeletonCard key={index} />)}
        {!isLoading && !isError && filteredEmployees.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No employees match the current filters.
          </Card>
        )}
        {!isLoading && !isError && paginatedEmployees.map((emp) => (
          <EmployeeCard
            key={emp.id}
            employee={emp}
            selected={selected.has(emp.id)}
            onSelect={() => toggleSelect(emp.id)}
            onView={() => setViewEmp(emp)}
          />
        ))}
      </div>

      {!isLoading && !isError && filteredEmployees.length > 0 && (
        <div data-tour="employees-pagination">
          <Pagination page={page} total={filteredEmployees.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <EmployeeViewModal
        employee={viewEmp}
        warehouseInfo={resolveEmployeeWarehouseInfo(viewEmp, usersById, warehousesById)}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setViewEmp(null)}
        onEdit={(emp) => { setViewEmp(null); openEdit(emp); }}
        onDelete={(emp) => { setSelected(new Set([emp.id])); setViewEmp(null); setDeleteOpen(true); }}
      />

      <EmployeeDialogs
        formOpen={formOpen}
        form={form}
        editingEmp={editingEmp}
        saving={saveEmp.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        warehouseOptions={warehouseOptions}
        managerOptions={managerOptions}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitEmployee}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={deleteEmp.isPending}
        title="Delete Employees"
        message={`Delete ${selectedRows.length} selected employee${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

/* ── Employee Card ─────────────────────────────────────────── */

function EmployeeCard({ employee, selected, onSelect, onView }: {
  employee: Employee;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  return (
    <Card data-tour="employees-row" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      employee.status === 'Inactive' && 'opacity-75',
      employee.status === 'Terminated' && 'border-l-4 border-l-red-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${employeeTitle(employee)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{employeeTitle(employee)}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">
            {[employee.designation, employee.department].filter(Boolean).join(' · ') || '—'}
          </p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{employee.phone || 'Phone not available'}</p>
            <p className="truncate">{employee.email || 'Email not available'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(employee.status || 'Active')}
            {employee.role ? <Badge variant="info">{employee.role}</Badge> : null}
            {employee.salary ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">₹{Number(employee.salary).toLocaleString('en-IN')}</span> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={employee.phone ? `tel:${employee.phone}` : undefined} aria-label="Call employee"
            className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !employee.phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={employee.email ? `mailto:${employee.email}` : undefined} aria-label="Email employee"
            className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !employee.email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

/* ── Skeleton Card ─────────────────────────────────────────── */

function EmployeeSkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

/* ── Employee Dialogs (Create/Edit form) ───────────────────── */

function EmployeeDialogs({ formOpen, form, editingEmp, saving, dirty, confirmClose, warehouseOptions, managerOptions, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: EmployeeForm;
  editingEmp: Employee | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  warehouseOptions: { label: string; value: string }[];
  managerOptions: { label: string; value: string }[];
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<EmployeeForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingEmp ? 'Edit Employee' : 'Create Employee'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Personal Info</p>
            <Input label="Full Name *" required value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Phone *" required value={form.phone} onChange={(event) => onChange({ phone: event.target.value })} />
              <Input label="Email" type="email" value={form.email} onChange={(event) => onChange({ email: event.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Date of Birth" type="date" value={form.dob} onChange={(event) => onChange({ dob: event.target.value })} />
              <Select label="Gender" value={form.gender} onChange={(event) => onChange({ gender: event.target.value })}
                options={['Male', 'Female', 'Other'].map(g => ({ label: g, value: g }))} />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Job Info</p>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Department" value={form.department} onChange={(event) => onChange({ department: event.target.value })}
                options={[{ label: 'Select Dept', value: '' }, ...DEPT_OPTIONS]} />
              <Input label="Designation" value={form.designation} onChange={(event) => onChange({ designation: event.target.value })} placeholder="e.g. Sales Executive" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select label="Role" value={form.role} onChange={(event) => onChange({ role: event.target.value })} options={ROLE_OPTIONS} />
              <Input label="Join Date" type="date" value={form.joinDate} onChange={(event) => onChange({ joinDate: event.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Monthly Salary (₹)" type="number" value={form.salary} onChange={(event) => onChange({ salary: event.target.value })} />
              <Select label="Status" value={form.status} onChange={(event) => onChange({ status: event.target.value })} options={EMPLOYEE_STATUS_OPTIONS} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Select label="Warehouse" value={form.warehouseId} onChange={(event) => onChange({ warehouseId: event.target.value })} options={warehouseOptions} />
              <Select label="Reporting Manager" value={form.managerId} onChange={(event) => onChange({ managerId: event.target.value })} options={managerOptions} />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Bank & ID</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Bank Name" value={form.bankName} onChange={(event) => onChange({ bankName: event.target.value })} />
              <Input label="Account Number" value={form.bankAccount} onChange={(event) => onChange({ bankAccount: event.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="IFSC Code" value={form.bankIfsc} onChange={(event) => onChange({ bankIfsc: event.target.value })} />
              <Input label="PAN Number" value={form.panNumber} onChange={(event) => onChange({ panNumber: event.target.value.toUpperCase() })} />
            </div>
            <div className="mt-3">
              <Input label="Aadhar Number" value={form.aadharNumber} onChange={(event) => onChange({ aadharNumber: event.target.value })} />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Address & Emergency</p>
            <Textarea label="Address" value={form.address} onChange={(event) => onChange({ address: event.target.value })} rows={2} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="City" value={form.city} onChange={(event) => onChange({ city: event.target.value })} />
              <Select label="State" value={form.state} onChange={(event) => onChange({ state: event.target.value })} options={INDIAN_STATE_OPTS} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Emergency Contact" value={form.emergencyContact} onChange={(event) => onChange({ emergencyContact: event.target.value })} />
              <Input label="Emergency Phone" value={form.emergencyPhone} onChange={(event) => onChange({ emergencyPhone: event.target.value })} />
            </div>
          </div>

          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editingEmp ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmClose}
        onClose={onKeepEditing}
        onConfirm={onDiscard}
        title="Discard Changes"
        message="Close this form and discard unsaved changes?"
      />
    </>
  );
}

/* ── Employee View Modal ───────────────────────────────────── */

function EmployeeViewModal({ employee, warehouseInfo, canEdit, canDelete, onClose, onEdit, onDelete }: {
  employee: Employee | null;
  warehouseInfo: EmployeeWarehouseInfo;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
}) {
  if (!employee) return null;
  return (
    <Modal open={!!employee} onClose={onClose} title={employeeTitle(employee)} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            {statusBadge(employee.status || 'Active')}
            {employee.role ? <Badge variant="info">{employee.role}</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Department" value={employee.department || 'Not assigned'} />
            <Detail label="Designation" value={employee.designation || 'Not assigned'} />
          </div>
        </section>

        <Section title="Personal Information">
          <Detail label="Full Name" value={employee.name || 'Not available'} />
          <Detail label="Date of Birth" value={fmtDate(employee.dob) || 'Not available'} />
          <Detail label="Gender" value={employee.gender || 'Not available'} />
          <Detail label="Phone" value={employee.phone || 'Not available'} />
          <Detail label="Email" value={employee.email || 'Not available'} />
        </Section>

        <Section title="Job & Pay">
          <Detail label="Department" value={employee.department || 'Not available'} />
          <Detail label="Designation" value={employee.designation || 'Not available'} />
          <Detail label="Join Date" value={fmtDate(employee.joinDate) || 'Not available'} />
          <Detail label="Salary" value={employee.salary ? `₹${Number(employee.salary).toLocaleString('en-IN')}/month` : 'Not available'} />
          <Detail label="Warehouse" value={warehouseInfo.warehouseName || 'Not assigned'} />
          <Detail label="Reporting Manager" value={warehouseInfo.managerName || 'Top level'} />
        </Section>

        <Section title="Bank Details">
          <Detail label="Bank Name" value={employee.bankName || 'Not available'} />
          <Detail label="Account Number" value={employee.bankAccount || 'Not available'} />
          <Detail label="IFSC Code" value={employee.bankIfsc || 'Not available'} />
          <Detail label="PAN Number" value={employee.panNumber || 'Not available'} />
          <Detail label="Aadhar" value={employee.aadharNumber || 'Not available'} />
        </Section>

        <Section title="Address">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {[employee.address, employee.city, employee.state].filter(Boolean).join(', ') || 'Not available'}
          </p>
        </Section>

        <Section title="Emergency Contact">
          <Detail label="Contact Person" value={employee.emergencyContact || 'Not available'} />
          <Detail label="Emergency Phone" value={employee.emergencyPhone || 'Not available'} />
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${employeeTitle(employee)} Timeline`} entries={employee.activityLog || []} />
        </Section>

        <Section title="History">
          <p className="text-sm text-[var(--color-text-muted)]">No history recorded.</p>
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {employee.phone ? <a className={linkButtonClass} href={`tel:${employee.phone}`}><Phone className="h-4 w-4" />Call</a> : null}
          {employee.email ? <a className={linkButtonClass} href={`mailto:${employee.email}`}><Mail className="h-4 w-4" />Email</a> : null}
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(employee)}>Edit</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(employee)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export default MobileEmployeesWorkspace;
