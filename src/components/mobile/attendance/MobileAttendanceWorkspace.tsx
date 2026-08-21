/**
 * MobileAttendanceWorkspace — Mobile Attendance module
 *
 * Architecture matches MobileLeadWorkspace:
 *   - No inline KPI/Search/Filters (handled by MobileTopBar at module level)
 *   - Filters read from URL params
 *   - Card-based list matching LeadCard pattern
 *   - Full-screen detail modal with Section/Detail components
 *   - Shared ConfirmDialog for deletes
 *
 * Manual Attendance is a one-click self-service action (ManualAttendancePanel
 * + AttendanceService.markAttendance()), not a form — mirrors the desktop
 * Attendance page's "Attendance Actions" row (Manual + Geo, side by side).
 *
 * Reuses:
 *   - useAttendance, useDeleteAttendance, exportAttendanceCSV,
 *     effectiveAttendanceStatus/InTime/OutTime from features/hr/hooks/useHR.ts
 *   - useEmployees for employee lookup
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Modal,
 *     Pagination) from ../../ui
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Calendar, Clock, Download, Mail, Phone, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Modal, Pagination, statusBadge } from '../../ui';
import {
  useAttendance, useDeleteAttendance, exportAttendanceCSV,
  effectiveAttendanceStatus, effectiveInTime, effectiveOutTime,
} from '../../../features/hr/hooks/useHR';
import { useEmployees } from '../../../features/employees/hooks/useEmployees';

import { usePermissions } from '../../../lib/permissions';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import CheckInPanel from '../../../components/attendance/CheckInPanel';
import ManualAttendancePanel from '../../../components/attendance/ManualAttendancePanel';
import { AttendanceService } from '../../../services/AttendanceService';
import { computeDashboardKPIs } from '../../../features/attendance/services/dashboardKPIs';
import { formatDistanceMeters } from '../../../lib/geo';

const PER_PAGE = 15;
const ALL = 'All';

type AttendanceRecord = Record<string, any> & { id: string };
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

export default function MobileAttendanceWorkspace() {
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const { data: attendance = [], isLoading, isError, refetch } = useAttendance();
  const { data: employees = [] } = useEmployees();
  const deleteMut = useDeleteAttendance();

  // Phase 7: self-service check-in — today's attendance for the current user
  const { data: todayAttendance } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => AttendanceService.getTodayAttendanceForCurrentUser(),
    staleTime: 30_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewRecord, setViewRecord] = useState<AttendanceRecord | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Phase 13: GPS attendance KPIs derived from existing records
  const gpsKPIs = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return computeDashboardKPIs(attendance as any[], (employees as any[]).length, todayStr);
  }, [attendance, employees]);

  const canEdit = perms.can('attendance', 'create');
  const canDelete = perms.can('attendance', 'delete');
  const canExport = perms.can('attendance', 'export');

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

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-attendance-header" className="text-xl font-bold text-[var(--color-text)]">Attendance</h1>
      </div>

      {/* Attendance Actions: Manual (no GPS) + Geo (self-service GPS),
          equivalent size/hierarchy, side by side. */}
      <div className="px-1" data-tour="attendance-actions">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Attendance Actions
        </p>
        <div className="grid grid-cols-1 gap-2">
          <ManualAttendancePanel todayRecord={todayAttendance} isLoading={isLoading} />
          <CheckInPanel todayRecord={todayAttendance} isLoading={isLoading} />
        </div>
      </div>

      {/* Phase 13: GPS Attendance Dashboard KPIs */}
      <div className="px-1 grid grid-cols-2 gap-2">
        <Card className="rounded-xl p-3">
          <div className="text-xs font-medium text-[var(--color-text-muted)]">GPS Check-In</div>
          <div className="text-lg font-bold text-[var(--color-text)]">{gpsKPIs.checkedInGPS}</div>
        </Card>
        <Card className="rounded-xl p-3">
          <div className="text-xs font-medium text-[var(--color-text-muted)]">Late (GPS)</div>
          <div className="text-lg font-bold text-amber-600">{gpsKPIs.lateGPS}</div>
        </Card>
        <Card className="rounded-xl p-3">
          <div className="text-xs font-medium text-[var(--color-text-muted)]">Early Exit</div>
          <div className="text-lg font-bold text-orange-600">{gpsKPIs.earlyExitCount}</div>
        </Card>
        <Card className="rounded-xl p-3">
          <div className="text-xs font-medium text-[var(--color-text-muted)]">Missing Today</div>
          <div className="text-lg font-bold text-rose-600">{gpsKPIs.missingToday}</div>
        </Card>
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
  const status = effectiveAttendanceStatus(record);
  const isLate = status === 'Late';
  const isAbsent = status === 'Absent';
  const inTime = effectiveInTime(record);
  const outTime = effectiveOutTime(record);
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
            {inTime && (
              <p className="truncate"><Clock className="inline h-3 w-3 mr-0.5" />{inTime}{outTime ? ` - ${outTime}` : ''}</p>
            )}
            {record.notes && <p className="truncate italic">{record.notes}</p>}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(status || 'Present')}
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
            {statusBadge(effectiveAttendanceStatus(record) || 'Present')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Employee" value={record.employee || '—'} />
            <Detail label="Date" value={record.date || '—'} />
          </div>
        </section>

        <Section title="Timing">
          <Detail label="In Time" value={effectiveInTime(record) || 'Not recorded'} />
          <Detail label="Out Time" value={effectiveOutTime(record) || 'Not recorded'} />
          <Detail
            label="Distance"
            value={
              formatDistanceMeters(record.checkOut?.distanceFromLocationMeters ?? record.checkIn?.distanceFromLocationMeters)
              || 'Not recorded'
            }
          />
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
