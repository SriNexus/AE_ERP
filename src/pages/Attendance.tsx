/**
 * Attendance Page — Desktop Gold Standard (Phase 2 HR)
 *
 * Sources of truth:
 *   - DESKTOP_PAGE_STANDARD.md
 *   - Leads Workspace
 *
 * Reuses:
 *   - useAttendance, useMarkAttendance, useDeleteAttendance, exportAttendanceCSV,
 *     ATTENDANCE_FORM_DEFAULT, ATTENDANCE_STATUSES from features/hr/hooks/useHR.ts
 *   - useEmployees for employee lookup
 *   - PremiumKpi, WorkspaceHero, Pagination, UniversalCheckbox from shared UI
 *   - statusBadge from shared UI
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createDocWithId, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange, isDateRangeValue } from '../lib/dateFilters';
import { usePermissions } from '../lib/permissions';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import { buildUserMap, buildWarehouseMap, resolveEmployeeWarehouseInfo } from '../lib/employeeDirectory';
import { statusBadge } from '../components/ui/Badge';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Input, Select as InputSelect } from '../components/ui/Input';
import {
  Trash2, Calendar, RefreshCw, Download, Eye, Clock, X, User, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { useEmployees } from '../features/employees/hooks/useEmployees';
import {
  useAttendance, useDeleteAttendance, exportAttendanceCSV,
  ATTENDANCE_STATUSES,
  effectiveAttendanceStatus, effectiveInTime, effectiveOutTime,
} from '../features/hr/hooks/useHR';
import toast from 'react-hot-toast';
import CheckInPanel from '../components/attendance/CheckInPanel';
import ManualAttendancePanel from '../components/attendance/ManualAttendancePanel';
import { AttendanceService } from '../services/AttendanceService';
import { computeDashboardKPIs } from '../features/attendance/services/dashboardKPIs';
import { formatDistanceMeters } from '../lib/geo';

const PER_PAGE = 10;

// ── Date filter options ───────────────────────────────────────────────

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

const STATUS_FILTER_OPTIONS = [
  { label: 'All Status', value: '' },
  ...ATTENDANCE_STATUSES.map(s => ({ label: s, value: s })),
];

// ── Helpers ───────────────────────────────────────────────────────────

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateValue(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB');
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function EmptyCell({ children = '—' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

function MutedValue({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>;
}

function LeadField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value ?? <MutedValue />}</div>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function Attendance() {
  const perms = usePermissions();
  const qc = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [dateF, setDateF] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('date');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  // ── View / delete
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'activity' | 'history'>('overview');
  // Phase 15: Admin GPS correction
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const openParam = searchParams.get('open') || '';
  const userClosedRef = useRef(false);

  // ── Queries
  const { data: attendance = [], isLoading, isError, refetch } = useAttendance();
  const { data: employees = [] } = useEmployees();
  const deleteMut = useDeleteAttendance();

  // Phase 7: self-service check-in — today's attendance for the current user
  const { data: todayAttendance } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => AttendanceService.getTodayAttendanceForCurrentUser(),
    staleTime: 30_000,
  });

  // Phase 12: real, query-backed warehouse attribution for Attendance —
  // previously no Attendance/Payroll surface could answer "which warehouse
  // is this employee attending from" at all.
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: warehouses = [] } = useWarehouses();
  const usersById = useMemo(() => buildUserMap(users as any[]), [users]);
  const warehousesById = useMemo(() => buildWarehouseMap(warehouses as any[]), [warehouses]);
  const employeesById = useMemo(() => new Map((employees as any[]).map((e: any) => [e.id, e])), [employees]);
  const viewItemWarehouseName = useMemo(() => {
    const employee = viewItem ? employeesById.get(viewItem.employeeId) : null;
    return resolveEmployeeWarehouseInfo(employee, usersById, warehousesById).warehouseName;
  }, [viewItem, employeesById, usersById, warehousesById]);

  // ── URL sync ────────────────────────────────────────────────────
  function syncQueueParams(overrides: Record<string, string | number | undefined | null>) {
    const next = new URLSearchParams(searchParams);
    function setParam(k: string, v: string | number | undefined | null) {
      if (v && v !== '' && v !== 0) next.set(k, String(v));
      else next.delete(k);
    }
    setParam('q', overrides.q ?? search);
    setParam('date', overrides.date ?? dateF);
    setParam('from', overrides.from ?? customFrom);
    setParam('to', overrides.to ?? customTo);
    setParam('status', overrides.status ?? statusF);
    setParam('kpi', overrides.kpi ?? activeKpi);
    setParam('page', overrides.hasOwnProperty('page') ? overrides.page : page);
    setParam('perPage', overrides.hasOwnProperty('perPage') ? overrides.perPage : perPage);
    if ('open' in overrides) {
      setParam('open', overrides.open);
    }
    setSearchParams(next, { replace: !('open' in overrides) });
  }

  // ── Filtering + sorting ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...(attendance as any[])];

    // KPI filter
    if (activeKpi === 'present') list = list.filter(a => a.status === 'Present');
    else if (activeKpi === 'absent') list = list.filter(a => a.status === 'Absent');
    else if (activeKpi === 'late') list = list.filter(a => a.status === 'Late');
    else if (activeKpi === 'onleave') list = list.filter(a => a.status === 'On Leave');
    else if (activeKpi === 'total') {
      // Total — no additional filter
    }

    // Search filter
    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter(a =>
        [a.employee, a.employeeId, a.notes].some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }

    // Date filter
    if (dateF) {
      list = list.filter(a => isInDateRange(a.date || a.createdAt, isDateRangeValue(dateF) ? dateF : 'all', customFrom, customTo));
    }

    // Status filter (only if no active KPI)
    if (statusF && !activeKpi) list = list.filter(a => a.status === statusF);

    // Sort
    list.sort((a, b) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [attendance, deferredSearch, dateF, customFrom, customTo, statusF, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Stats / KPIs ────────────────────────────────────────────────
  const allRecords = attendance as any[];
  const empCount = useMemo(() => {
    const unique = new Set(allRecords.map((a: any) => a.employeeId).filter(Boolean));
    return unique.size;
  }, [allRecords]);

  // Stats based on current date filter
  const stats = useMemo(() => {
    const filteredByDate = dateF
      ? allRecords.filter(a => isInDateRange(a.date || a.createdAt, isDateRangeValue(dateF) ? dateF : 'all', customFrom, customTo))
      : allRecords;
    const present = filteredByDate.filter(a => a.status === 'Present').length;
    const total = filteredByDate.length;
    return {
      present,
      absent: filteredByDate.filter(a => a.status === 'Absent').length,
      late: filteredByDate.filter(a => a.status === 'Late').length,
      onLeave: filteredByDate.filter(a => a.status === 'On Leave').length,
      attendancePct: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  }, [allRecords, dateF, customFrom, customTo]);

  // ── Phase 13: GPS Attendance KPIs ─────────────────────────────
  // Derived from existing useAttendance() records — no second query needed.
  // Reads computedStatus/earlyExit directly (Rule Engine is source of truth).
  const gpsKPIs = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return computeDashboardKPIs(allRecords, empCount, todayStr);
  }, [allRecords, empCount]);

  const isTotalDefault = !activeKpi && !search && !dateF && !statusF;

  // ── Selection ───────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(a => a.id)));
  }, [paginated]);

  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setDateF(''); setCustomFrom(''); setCustomTo('');
    setStatusF(''); setActiveKpi(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', date: '', from: '', to: '', status: '', kpi: '', page: 1 });
  }

  function openDetail(a: any) {
    setDetailTab('overview');
    setViewItem(a);
    userClosedRef.current = false;
    const next = new URLSearchParams(searchParams);
    next.set('open', a.id);
    setSearchParams(next, { replace: true });
  }

  function closeDetail() {
    setViewItem(null);
    userClosedRef.current = true;
    if (openParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
    }
  }

  // URL open param → open detail modal
  useEffect(() => {
    if (!openParam || isLoading || userClosedRef.current) return;
    const target = (attendance as any[]).find((a: any) => a.id === openParam);
    if (!target) return;
    setDetailTab('overview');
    setViewItem(target);
  }, [attendance, isLoading, openParam]);

  // ── Bulk actions ────────────────────────────────────────────────
  function exportSelected() {
    const rows = (attendance as any[]).filter(a => selected.has(a.id));
    if (!rows.length) return toast.error('No records selected');
    exportAttendanceCSV(rows);
    toast.success(`Exported ${rows.length} records`);
    setSelected(new Set());
  }

  // Phase 15: Admin GPS correction
  async function handleCorrection() {
    if (!viewItem || !correctionReason.trim()) return;
    setCorrectionLoading(true);
    try {
      const result = await AttendanceService.correctAttendance(viewItem.id, {
        reason: correctionReason.trim(),
      });
      if (result.success) {
        toast.success('GPS record corrected');
        if (result.error) {
          // Audit log failed — distinct warning
          toast(result.error, { icon: '⚠️' });
        }
        setShowCorrectionForm(false);
        setCorrectionReason('');
        refetch();
      }
    } catch (err: any) {
      toast.error(err.message || 'Correction failed');
    } finally {
      setCorrectionLoading(false);
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.all(ids.map(id => deleteMut.mutateAsync(id)));
    toast.success(`Deleted ${ids.length} record${ids.length > 1 ? 's' : ''}`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
  }

  async function confirmBulkStatus() {
    if (!selected.size || !bulkStatus) return;
    const ids = Array.from(selected);
    await Promise.all(ids.map(async (id) => {
      const rec = (attendance as any[]).find((a: any) => a.id === id);
      if (!rec) return;
      await createDocWithId(COLLECTIONS.ATTENDANCE, id, { ...rec, status: bulkStatus });
    }));
    qc.invalidateQueries({ queryKey: ['attendance'] });
    toast.success(`Updated ${ids.length} record${ids.length > 1 ? 's' : ''}`);
    setSelected(new Set());
    setBulkStatusOpen(false);
    setBulkStatus('');
  }

  // ── KPI Config ──────────────────────────────────────────────────
  const KPI_CONFIGS = [
    {
      key: 'total',
      label: 'TOTAL RECORDS',
      value: allRecords.length,
      icon: <Calendar className="h-4 w-4" />,
      description: 'All attendance records',
    },
    {
      key: 'present',
      label: 'PRESENT',
      value: stats.present,
      icon: <CheckCircle2 className="h-4 w-4" />,
      description: 'Marked present',
    },
    {
      key: 'absent',
      label: 'ABSENT',
      value: stats.absent,
      icon: <X className="h-4 w-4" />,
      description: 'Marked absent',
    },
    {
      key: 'late',
      label: 'LATE',
      value: stats.late,
      icon: <Clock className="h-4 w-4" />,
      description: 'Marked late',
    },
    {
      key: 'onleave',
      label: 'ON LEAVE',
      value: stats.onLeave,
      icon: <User className="h-4 w-4" />,
      description: 'On leave',
    },
    {
      key: 'attendancePct',
      label: 'ATTENDANCE %',
      value: `${stats.attendancePct}%`,
      icon: <AlertTriangle className="h-4 w-4" />,
      description: 'Present / Total',
    },
    // ── Phase 13: GPS Attendance KPIs ──────────────────────
    {
      key: 'checkedInGPS',
      label: 'CHECKED IN (GPS)',
      value: gpsKPIs.checkedInGPS,
      icon: <CheckCircle2 className="h-4 w-4" />,
      description: 'Self-service check-in today',
    },
    {
      key: 'lateGPS',
      label: 'LATE (GPS)',
      value: gpsKPIs.lateGPS,
      icon: <Clock className="h-4 w-4" />,
      description: 'Late via GPS rule engine',
    },
    {
      key: 'earlyExit',
      label: 'EARLY EXIT',
      value: gpsKPIs.earlyExitCount,
      icon: <AlertTriangle className="h-4 w-4" />,
      description: 'Left before shift end',
    },
    {
      key: 'missingToday',
      label: 'MISSING TODAY',
      value: gpsKPIs.missingToday,
      icon: <X className="h-4 w-4" />,
      description: 'No attendance record today',
    },
  ];

  // ── Active filter pills count ───────────────────────────────────
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateF ? 1 : 0) + (statusF ? 1 : 0);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Workspace Hero ─────────────────────────────────────────────── */}
      <WorkspaceHero
        title="Attendance"
        icon={<Calendar className="h-6 w-6" />}
        breadcrumbs={['Home', 'HR', 'Attendance']}
        statusText={`${allRecords.length} records · ${stats.present} present`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportAttendanceCSV(filtered)}>
              Export
            </Button>
          </>
        }
      />

      {/* ── Attendance Actions: Manual (no GPS) + Geo (self-service GPS),
           equivalent size/hierarchy, side by side — not a giant standalone
           section above the KPIs. ──────────────────────────────────── */}
      <div data-tour="attendance-actions">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Attendance Actions
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <ManualAttendancePanel todayRecord={todayAttendance} isLoading={isLoading} />
          <CheckInPanel todayRecord={todayAttendance} isLoading={isLoading} />
        </div>
      </div>

      {/* ── KPI Grid ──────────────────────────────────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {KPI_CONFIGS.map(k => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.description}
            active={k.key === 'total' ? (activeKpi === 'total' || isTotalDefault) : activeKpi === k.key}
            onClick={k.key === 'attendancePct' ? undefined : () => {
              const next = activeKpi === k.key ? '' : k.key;
              setActiveKpi(next); setPage(1);
              syncQueueParams({ kpi: next, page: 1 });
            }}
          />
        ))}
      </div>

      {/* ── Card ──────────────────────────────────────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)]">
        {/* ── CardHeader: Search + Filters ─────────────────────────────── */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <input
              aria-label="Search attendance"
              data-tour="attendance-search"
              placeholder="Search employee, employee ID, notes..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)]
                bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)]
                placeholder:text-[var(--color-text-muted)] outline-none transition-colors
                focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />

            <Select
              aria-label="Date filter"
              value={dateF}
              onChange={e => {
                const v = e.target.value;
                setDateF(v); setPage(1);
                if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); }
                syncQueueParams({ date: v, from: v === 'custom' ? customFrom : '', to: v === 'custom' ? customTo : '', page: 1 });
              }}
              options={DATE_OPTIONS}
              className="w-[110px] h-8 py-1"
            />

            {dateF === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
                <span className="text-xs text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-[130px]" />
              </div>
            )}

            <Select
              aria-label="Status filter"
              value={activeKpi ? '' : statusF}
              onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={STATUS_FILTER_OPTIONS}
              className="w-[110px] h-8 py-1"
            />

            {/* Green status dot */}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>

          {/* Active filter pills */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-text)]">
                  {KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}
                  <button onClick={() => { setActiveKpi(''); setPage(1); syncQueueParams({ kpi: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {search && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  S: {search.length > 20 ? search.slice(0, 20) + '…' : search}
                  <button onClick={() => { setSearch(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {dateF && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {DATE_OPTIONS.find(d => d.value === dateF)?.label || dateF}
                  <button onClick={() => { setDateF(''); setCustomFrom(''); setCustomTo(''); setPage(1); syncQueueParams({ date: '', from: '', to: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              {statusF && !activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {statusF}
                  <button onClick={() => { setStatusF(''); setPage(1); syncQueueParams({ status: '', page: 1 }); }}
                    className="ml-0.5 hover:opacity-70">✕</button>
                </span>
              )}
              <button onClick={clearAll}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
          )}
        </CardHeader>

        {/* ── Bulk action bar ───────────────────────────────────────────── */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} record{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}>
                Export CSV
              </Button>
              {perms.canEdit('attendance') && (
                <Button size="sm" variant="outline"
                  className="border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30"
                  icon={<Clock className="h-3.5 w-3.5" />}
                  onClick={() => { setBulkStatus(''); setBulkStatusOpen(true); }}>
                  Change Status
                </Button>
              )}
              {perms.canDelete('attendance') && (
                <Button size="sm" variant="outline"
                  className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setBulkDeleteOpen(true)}>
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Table ─────────────────────────────────────────────────────── */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div data-tour="attendance-table" className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44 }}>
                  <UniversalCheckbox
                    checked={allSel}
                    indeterminate={selected.size > 0 && !allSel}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </Th>
                <Th sortable sorted={sortKey === 'employee'} desc={sortDesc} onSort={() => sort('employee')}
                  style={{ minWidth: 200 }}>EMPLOYEE</Th>
                <Th sortable sorted={sortKey === 'date'} desc={sortDesc} onSort={() => sort('date')}
                  style={{ width: 110 }}>DATE</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}
                  style={{ width: 110 }}>STATUS</Th>
                <Th style={{ width: 100 }}>IN TIME</Th>
                <Th style={{ width: 100 }}>OUT TIME</Th>
                <Th style={{ width: 90 }}>DISTANCE</Th>
                <Th sortable sorted={sortKey === 'notes'} desc={sortDesc} onSort={() => sort('notes')}
                  style={{ minWidth: 140 }}>NOTES</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={9} rows={6} />
                ) : isError ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-[var(--color-text-disabled)]">
                        <Calendar className="h-10 w-10" />
                        <p className="text-sm text-[var(--color-text-muted)]">Failed to load attendance records.</p>
                        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                      </div>
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<Calendar className="h-9 w-9" />}
                        title={search || dateF || statusF || activeKpi ? 'No records match filters' : 'No attendance records yet'}
                        description={search || dateF || statusF || activeKpi ? undefined : 'Use Manual Attendance or Geo Attendance above to mark your first record.'}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((a: any) => (
                    <Tr key={a.id} data-tour="attendance-row" selected={selected.has(a.id)}
                      data-record-id={a.id} role="button" tabIndex={0}
                      onClick={(e) => { if (!isRowOpenIgnored(e.target)) openDetail(a); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(a); } }}
                      className="group cursor-pointer outline-none transition-all duration-200 ease-out
                        hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)]
                        focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td>
                        <span data-interactive onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(a.id)}
                            onChange={() => toggleSelect(a.id)}
                          />
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-xs font-bold shrink-0">
                            {(a.employee || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)] leading-tight">{a.employee || '—'}</p>
                            <p className="text-[12px] text-[var(--color-text-muted)] leading-tight">{a.employeeId}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-xs">{formatDateValue(a.date) || a.date || <EmptyCell />}</Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(effectiveAttendanceStatus(a) || 'Present')}</span></Td>
                      <Td className="text-xs">
                        {effectiveInTime(a) ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-[var(--color-text-muted)]" />{effectiveInTime(a)}
                          </span>
                        ) : <EmptyCell />}
                      </Td>
                      <Td className="text-xs">
                        {effectiveOutTime(a) ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3 text-[var(--color-text-muted)]" />{effectiveOutTime(a)}
                          </span>
                        ) : <EmptyCell />}
                      </Td>
                      <Td className="text-xs">
                        {(() => {
                          // Prefer checkout's distance (the day's final GPS
                          // evidence); fall back to check-in's. Manual-only
                          // records (no checkIn/checkOut at all) have neither
                          // — never fabricate a distance for those.
                          const label = formatDistanceMeters(
                            a.checkOut?.distanceFromLocationMeters ?? a.checkIn?.distanceFromLocationMeters,
                          );
                          return label
                            ? <span className="text-[var(--color-text-muted)]">{label}</span>
                            : <EmptyCell />;
                        })()}
                      </Td>
                      <Td className="text-xs text-[var(--color-text-muted)] max-w-[160px] truncate">{a.notes || <EmptyCell />}</Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                          className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openDetail(a)}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)]
                              bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)]
                              shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out
                              hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)]
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
          <div data-tour="attendance-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={p => { setPage(p); syncQueueParams({ page: p }); }}
              onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* ── Detail View Modal ───────────────────────────────────────────── */}
      <Modal open={!!viewItem} onClose={closeDetail} size="2xl">
        {viewItem && (() => {
          const tabs = [
            { key: 'overview' as const, label: 'Overview' },
            { key: 'activity' as const, label: 'Activity' },
          ];
          return (
            <div className="flex h-[70vh] max-h-[700px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
              {/* Header */}
              <div className="shrink-0 flex flex-col gap-4 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-18 w-18 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-2xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]"
                    style={{ height: 72, width: 72 }}>
                    {(viewItem.employee || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{viewItem.employee || 'Untitled'}</h2>
                      {statusBadge(effectiveAttendanceStatus(viewItem) || 'Present')}
                    </div>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateValue(viewItem.date) || viewItem.date || '—'}
                      </span>
                      <span className="ml-3">{viewItem.employeeId}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <button onClick={closeDetail} aria-label="Close"
                    className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      detailTab === tab.key
                        ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pt-4">
                {detailTab === 'overview' && (
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-5">
                      <DetailCard title="Attendance Details">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <LeadField label="Date" value={formatDateValue(viewItem.date) || viewItem.date || <MutedValue />} />
                          <LeadField label="Status">{statusBadge(effectiveAttendanceStatus(viewItem) || 'Present')}</LeadField>
                          <LeadField label="In Time">
                            {effectiveInTime(viewItem) ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-[var(--color-primary-text)]" />{effectiveInTime(viewItem)}</span> : <MutedValue />}
                          </LeadField>
                          <LeadField label="Out Time">
                            {effectiveOutTime(viewItem) ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-[var(--color-primary-text)]" />{effectiveOutTime(viewItem)}</span> : <MutedValue />}
                          </LeadField>
                          <LeadField label="Warehouse" value={viewItemWarehouseName || <MutedValue>Not assigned</MutedValue>} />
                        </div>
                      </DetailCard>
                      {viewItem.notes && (
                        <DetailCard title="Notes">
                          <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">{viewItem.notes}</p>
                        </DetailCard>
                      )}
                    </div>
                    <aside className="space-y-4">
                      <DetailCard title="Quick Actions">
                        <div className="space-y-2">
                          {(viewItem.checkIn || viewItem.checkOut) && perms.canEdit('attendance') && (
                            <Button variant="outline" size="sm" className="w-full justify-start"
                              icon={<AlertTriangle className="h-3.5 w-3.5" />}
                              onClick={() => { setShowCorrectionForm(true); }}>
                              Correct GPS Record
                            </Button>
                          )}
                          <div className="border-t border-[var(--color-border-subtle)] pt-3">
                            <Button variant="danger" size="sm" className="w-full justify-start"
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => { closeDetail(); setDelId(viewItem.id); }}>Delete Record</Button>
                          </div>
                        </div>
                      </DetailCard>
                    </aside>
                  </div>
                )}

                {detailTab === 'activity' && (
                  <DetailCard title="Activity">
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                      <Calendar className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No activity recorded</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Activity logs will appear here.</p>
                    </div>
                  </DetailCard>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && deleteMut.mutate(delId, { onSuccess: () => setDelId(null) })}
        loading={deleteMut.isPending} title="Delete Record"
        message="Delete this attendance record?" />

      {/* ── Bulk Delete Confirm ──────────────────────────────────────────── */}
      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}
        onConfirm={bulkDelete}
        title="Delete Records"
        message={`Delete ${selected.size} selected attendance record${selected.size > 1 ? 's' : ''}?`} />

      {/* ── Bulk Status Change ───────────────────────────────────────────── */}
      <Modal open={bulkStatusOpen} onClose={() => { setBulkStatusOpen(false); setBulkStatus(''); }}
        title="Change Status" size="sm">
        <div className="space-y-4">
          <InputSelect label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={ATTENDANCE_STATUSES.map(s => ({ label: s, value: s }))} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setBulkStatusOpen(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={confirmBulkStatus} disabled={!bulkStatus}>Update</Button>
          </div>
        </div>
      </Modal>

      {/* Phase 15: Admin GPS Correction Modal */}
      <Modal open={showCorrectionForm} onClose={() => { setShowCorrectionForm(false); setCorrectionReason(''); }}
        title="Correct GPS Record" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            This corrects the GPS-verified attendance evidence for <strong>{viewItem?.employee}</strong> on <strong>{viewItem?.date}</strong>.
            {viewItem?.checkIn && <span className="block mt-1">Check-In: {new Date(viewItem.checkIn.timestamp).toLocaleString()}</span>}
            {viewItem?.checkOut && <span className="block">Check-Out: {new Date(viewItem.checkOut.timestamp).toLocaleString()}</span>}
          </p>
          <Input
            label="Correction Reason (required)"
            value={correctionReason}
            onChange={e => setCorrectionReason(e.target.value)}
            placeholder="Explain why this correction is needed..."
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowCorrectionForm(false); setCorrectionReason(''); }}>Cancel</Button>
            <Button onClick={handleCorrection} disabled={!correctionReason.trim() || correctionLoading}>
              {correctionLoading ? 'Saving...' : 'Confirm Correction'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
