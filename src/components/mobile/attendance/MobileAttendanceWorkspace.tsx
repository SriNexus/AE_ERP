/**
 * MobileAttendanceWorkspace — Mobile Attendance module
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
 *   - useAttendance, useMarkAttendance, useDeleteAttendance, exportAttendanceCSV,
 *     ATTENDANCE_FORM_DEFAULT, ATTENDANCE_STATUSES from features/hr/hooks/useHR.ts
 *   - useEmployees for employee lookup
 *   - fmtDate from lib/firestore
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Input, Modal,
 *     Pagination, Select, Textarea) from ../../ui
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar, Clock, Download, Mail, Phone, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  useAttendance, useMarkAttendance, useDeleteAttendance, exportAttendanceCSV,
  ATTENDANCE_FORM_DEFAULT, ATTENDANCE_STATUSES, type AttendanceForm,
} from '../../../features/hr/hooks/useHR';
import { useEmployees } from '../../../features/employees/hooks/useEmployees';

import { usePermissions } from '../../../lib/permissions';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 15;
const ALL = 'All';

type AttendanceRecord = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type AttendanceFilters = {
  search: string;
  status: string;
  date: string;
};

function filterAttendance(records: AttendanceRecord[], filters: AttendanceFilters) {
  const term = filters.search.trim().toLowerCase();
  return records
    .filter((a) => {
      if (filters.status !== ALL && a.status !== filters.status) return false;
      if (filters.date && filters.date !== 'all') {
        const today = new Date().toISOString().split('T')[0];
        if (filters.date === 'today' && a.date !== today) return false;
        if (filters.date !== 'today' && a.date !== filters.date) return false;
      }
      if (!term) return true;
      return [a.employee, a.employeeId, a.notes]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = a.date || '';
      const bTime = b.date || '';
      return bTime.localeCompare(aTime);
    });
}

function downloadAttendanceCsv(rows: AttendanceRecord[], filename: string) {
  const headers = ['Employee', 'Employee ID', 'Date', 'Status', 'In Time', 'Out Time', 'Notes'];
  const lines = rows.map((a) =>
    [a.employee || '', a.employeeId || '', a.date || '', a.status || '', a.inTime || '', a.outTime || '', a.notes || '']
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MobileAttendanceWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { data: attendance = [], isLoading, isError, refetch } = useAttendance();
  const { data: employees = [] } = useEmployees();
  const deleteMut = useDeleteAttendance();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [form, setForm] = useState<AttendanceForm>({ ...ATTENDANCE_FORM_DEFAULT });
  const [viewRecord, setViewRecord] = useState<AttendanceRecord | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingRecord(null);
    setForm({ ...ATTENDANCE_FORM_DEFAULT, date: new Date().toISOString().split('T')[0] });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const canEdit = perms.can('attendance', 'create');
  const canDelete = perms.can('attendance', 'delete');
  const canExport = perms.can('attendance', 'export');

  const saveMut = useMarkAttendance(() => {
    setFormOpen(false);
    setEditingRecord(null);
    setForm({ ...ATTENDANCE_FORM_DEFAULT });
    setDirty(false);
    void qc.invalidateQueries({ queryKey: ['attendance'] });
  });

  const filters = useMemo<AttendanceFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || new Date().toISOString().split('T')[0],
  }), [params]);

  const filteredRecords = useMemo(() => filterAttendance(attendance as AttendanceRecord[], filters), [attendance, filters]);
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);
  const selectedRows = useMemo(() => (attendance as AttendanceRecord[]).filter((a) => selected.has(a.id)), [attendance, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRecords.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((attendance as AttendanceRecord[]).map((a) => a.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [attendance]);

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

  function requestCloseForm() {
    if (dirty) { setConfirmClose(true); return; }
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingRecord(null);
    setForm({ ...ATTENDANCE_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') { navigate('/app', { replace: true }); return; }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function updateForm(patch: Partial<AttendanceForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitAttendance(event: React.FormEvent) {
    event.preventDefault();
    if (!form.employeeId || !form.date) return toast.error('Employee & date required');
    saveMut.mutate(form);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((a) => deleteMut.mutateAsync(a.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: AttendanceRecord[]) {
    if (!rows.length) return toast.error('No records selected');
    downloadAttendanceCsv(rows, `attendance-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} record${rows.length > 1 ? 's' : ''}`);
  }

  if (mode === 'create') {
    return (
      <AttendanceDialogs
        formOpen={formOpen}
        form={form}
        editingRecord={editingRecord}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        employees={employees as any[]}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitAttendance}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-attendance-header" className="text-xl font-bold text-[var(--color-text)]">Attendance</h1>
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
          <Calendar className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load attendance</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load attendance data.</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">Retry</button>
        </div>
      )}

      <div className="space-y-3" data-tour="attendance-table">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <AttendanceSkeletonCard key={index} />)}
        {!isLoading && !isError && filteredRecords.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No attendance records match the current filters.
          </Card>
        )}
        {!isLoading && !isError && paginatedRecords.map((a) => (
          <AttendanceCard
            key={a.id}
            record={a}
            employee={((employees as any[]).find((e: any) => e.id === a.employeeId))}
            selected={selected.has(a.id)}
            onSelect={() => toggleSelect(a.id)}
            onView={() => setViewRecord(a)}
          />
        ))}
      </div>

      {!isLoading && !isError && filteredRecords.length > 0 && (
        <div data-tour="attendance-pagination">
          <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <AttendanceViewModal
        record={viewRecord}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setViewRecord(null)}
        onEdit={(a) => { setViewRecord(null); /* edit not directly supported for attendance */ }}
        onDelete={(a) => { setSelected(new Set([a.id])); setViewRecord(null); setDeleteOpen(true); }}
      />

      <AttendanceDialogs
        formOpen={formOpen}
        form={form}
        editingRecord={editingRecord}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        employees={employees as any[]}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitAttendance}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={deleteMut.isPending}
        title="Delete Records"
        message={`Delete ${selectedRows.length} selected attendance record${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

/* ── Attendance Card ─────────────────────────────────────────── */

function AttendanceCard({ record, employee, selected, onSelect, onView }: {
  record: AttendanceRecord;
  employee: any;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const empName = record.employee || employee?.name || record.employeeId || '—';
  const isLate = record.status === 'Late';
  const isAbsent = record.status === 'Absent';
  return (
    <Card data-tour="attendance-row" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      isAbsent && 'border-l-4 border-l-red-500',
      isLate && 'border-l-4 border-l-amber-500',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${empName}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{empName}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{record.date || '—'}</p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            {record.inTime && (
              <p className="truncate"><Clock className="inline h-3 w-3 mr-0.5" />{record.inTime}{record.outTime ? ` - ${record.outTime}` : ''}</p>
            )}
            {record.notes && <p className="truncate italic">{record.notes}</p>}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(record.status || 'Present')}
            {employee?.department ? <Badge variant="gray">{employee.department}</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={employee?.phone ? `tel:${employee.phone}` : undefined} aria-label="Call"
            className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !employee?.phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={employee?.email ? `mailto:${employee.email}` : undefined} aria-label="Email"
            className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !employee?.email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

/* ── Skeleton Card ─────────────────────────────────────────── */

function AttendanceSkeletonCard() {
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

/* ── Attendance Dialogs (Create form) ─────────────────────── */

function AttendanceDialogs({ formOpen, form, editingRecord, saving, dirty, confirmClose, employees, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: AttendanceForm;
  editingRecord: AttendanceRecord | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  employees: any[];
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<AttendanceForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title="Mark Attendance" size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Select label="Employee *" required value={form.employeeId}
            onChange={(event) => {
              const emp = employees.find((e: any) => e.id === event.target.value);
              onChange({ employeeId: event.target.value, employee: emp?.name || '' });
            }}
            options={[
              { label: 'Select Employee', value: '' },
              ...employees
                .filter((e: any) => e.status !== 'Terminated' && e.status !== 'Inactive')
                .map((e: any) => ({ label: e.name, value: e.id })),
            ]} />
          <Input label="Date *" type="date" required value={form.date} onChange={(event) => onChange({ date: event.target.value })} />
          <Select label="Status" value={form.status} onChange={(event) => onChange({ status: event.target.value })}
            options={ATTENDANCE_STATUSES.map(s => ({ label: s, value: s }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="In Time" type="time" value={form.inTime} onChange={(event) => onChange({ inTime: event.target.value })} />
            <Input label="Out Time" type="time" value={form.outTime} onChange={(event) => onChange({ outTime: event.target.value })} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={2} />
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>Mark Attendance</Button>
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

/* ── Attendance View Modal ─────────────────────────────────── */

function AttendanceViewModal({ record, canEdit, canDelete, onClose, onEdit, onDelete }: {
  record: AttendanceRecord | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (a: AttendanceRecord) => void;
  onDelete: (a: AttendanceRecord) => void;
}) {
  if (!record) return null;
  return (
    <Modal open={!!record} onClose={onClose} title={record.employee || 'Attendance Record'} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(record.status || 'Present')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Employee" value={record.employee || '—'} />
            <Detail label="Date" value={record.date || '—'} />
          </div>
        </section>

        <Section title="Timing">
          <Detail label="In Time" value={record.inTime || 'Not recorded'} />
          <Detail label="Out Time" value={record.outTime || 'Not recorded'} />
        </Section>

        <Section title="Notes">
          <p className="text-sm text-[var(--color-text-secondary)]">{record.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title="Attendance Timeline" entries={record.activityLog || []} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(record)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

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

export { MobileAttendanceWorkspace };
