/**
 * Employees Page — Desktop Gold Standard (Phase 1 HR)
 *
 * Sources of truth:
 *   - DESKTOP_PAGE_STANDARD.md
 *   - Leads Workspace
 *
 * Reuses:
 *   - useEmployees, useSaveEmployee, useDeleteEmployee, exportEmployeesCSV,
 *     EMPLOYEE_FORM_DEFAULT, DEPT_OPTIONS, ROLE_OPTIONS, EMPLOYEE_STATUS_OPTIONS
 *     from features/employees/hooks/useEmployees.ts
 *   - INDIAN_STATES from config/company
 *   - fmtDate from lib/firestore
 *   - isInDateRange from lib/dateFilters
 *   - Status badges from components/ui/Badge
 *   - PremiumKpi, WorkspaceHero, Pagination, UniversalCheckbox, etc.
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtDate, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange, isDateRangeValue } from '../lib/dateFilters';
import { INDIAN_STATES } from '../config/company';
import { usePermissions } from '../lib/permissions';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import { buildUserMap, buildWarehouseMap, resolveEmployeeWarehouseInfo } from '../lib/employeeDirectory';
import { statusBadge, Badge } from '../components/ui/Badge';
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
import { Input, Select as InputSelect, Textarea, FormRow, FormSection } from '../components/ui/Input';
import {
  Plus, Trash2, Phone, Calendar, RefreshCw,
  Download, User, Users, Building2, UserCog, Mail,
  FileText, AlertTriangle, ListChecks, Eye, X,
} from 'lucide-react';
import {
  useEmployees, useSaveEmployee, useDeleteEmployee, exportEmployeesCSV,
  EMPLOYEE_FORM_DEFAULT, type EmployeeForm,
  DEPT_OPTIONS, ROLE_OPTIONS, EMPLOYEE_STATUS_OPTIONS,
} from '../features/employees/hooks/useEmployees';
import toast from 'react-hot-toast';

const PER_PAGE = 10;

const STATE_OPTS = [
  { label: 'Select State', value: '' },
  ...(INDIAN_STATES || []).map((s: string) => ({ label: s, value: s })),
];

// ── Helpers ───────────────────────────────────────────────────────────

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatCreatedDate(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB');
}

function daysAgoText(value: any): string {
  const date = toDateValue(value);
  if (!date) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function recencyDotClass(value: any): string {
  const date = toDateValue(value);
  if (!date) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function isNewJoiner(joinDate: any): boolean {
  const date = toDateValue(joinDate);
  if (!date) return false;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return date >= thirtyDaysAgo;
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

// ── DATE FILTER OPTIONS ───────────────────────────────────────────────

const DATE_OPTIONS = [
  { label: 'All dates', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
];

const STATUS_OPTIONS = [
  { label: 'All Status', value: '' },
  ...EMPLOYEE_STATUS_OPTIONS.map((s: any) => ({ label: s.value, value: s.value })),
];

// ── Main Page ─────────────────────────────────────────────────────────

export default function Employees() {
  const perms = usePermissions();

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [dateF, setDateF] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [deptF, setDeptF] = useState(() => searchParams.get('dept') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Form / view / delete
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeForm>({ ...EMPLOYEE_FORM_DEFAULT });
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [leadDetailsTab, setLeadDetailsTab] = useState<'overview' | 'personal' | 'job' | 'bank' | 'documents' | 'history'>('overview');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';
  const userClosedRef = useRef(false);

  // ── Queries
  const { data: employees = [], isLoading, isError, refetch } = useEmployees();
  const saveMut = useSaveEmployee(editId, closeForm);
  const deleteMut = useDeleteEmployee();
  const qc = useQueryClient();

  // Phase 12: Employee -> User -> Warehouse/Reporting-Manager join. Cache
  // key matches Users.tsx's own ['users'] query so both share one fetch.
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getAll(COLLECTIONS.USERS), staleTime: 30_000 });
  const { data: warehouses = [] } = useWarehouses();
  const usersById = useMemo(() => buildUserMap(users as any[]), [users]);
  const warehousesById = useMemo(() => buildWarehouseMap(warehouses as any[]), [warehouses]);
  const warehouseOptions = useMemo(() => [
    { label: 'No warehouse assigned', value: '' },
    ...(warehouses as any[]).map((w: any) => ({ label: w.name, value: w.id })),
  ], [warehouses]);
  const editingUserId = useMemo(() => (employees as any[]).find((e: any) => e.id === editId)?.userId || '', [employees, editId]);
  const managerOptions = useMemo(() => [
    { label: 'None (Top level)', value: '' },
    ...(users as any[]).filter((u: any) => u.id !== editingUserId).map((u: any) => ({ label: u.name, value: u.id })),
  ], [users, editingUserId]);

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
    setParam('dept', overrides.dept ?? deptF);
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
    let list = [...(employees as any[])];

    // KPI filter
    if (activeKpi === 'active') list = list.filter(e => e.status === 'Active');
    else if (activeKpi === 'onleave') list = list.filter(e => e.status === 'On Leave');
    else if (activeKpi === 'new') list = list.filter(e => isNewJoiner(e.joinDate));
    else if (activeKpi === 'inactive') list = list.filter(e => e.status === 'Inactive' || e.status === 'Terminated');
    else if (activeKpi === 'depts') {
      // Departments KPI — no additional filtering (all employees)
    }

    // Search filter
    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter(e =>
        [e.name, e.phone, e.email, e.designation, e.department, e.role]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }

    // Date filter
    if (dateF) {
      list = list.filter(e => isInDateRange(e.joinDate || e.createdAt, isDateRangeValue(dateF) ? dateF : 'all', customFrom, customTo));
    }

    // Department filter
    if (deptF) list = list.filter(e => e.department === deptF);

    // Status filter (only if no active KPI)
    if (statusF && !activeKpi) list = list.filter(e => e.status === statusF);

    // Sort
    list.sort((a, b) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [employees, deferredSearch, dateF, customFrom, customTo, deptF, statusF, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Computed ────────────────────────────────────────────────────
  const deptList = useMemo(
    () => Array.from(new Set((employees as any[]).map((e: any) => e.department).filter(Boolean))) as string[],
    [employees]
  );

  const stats = useMemo(() => {
    const emps = employees as any[];
    return {
      total: emps.length,
      active: emps.filter(e => e.status === 'Active').length,
      onLeave: emps.filter(e => e.status === 'On Leave').length,
      newJoiners: emps.filter(e => isNewJoiner(e.joinDate)).length,
      inactive: emps.filter(e => e.status === 'Inactive' || e.status === 'Terminated').length,
      departments: deptList.length,
    };
  }, [employees, deptList]);

  const isTotalDefault = !activeKpi && !search && !dateF && !deptF && !statusF;

  const viewItemWarehouseInfo = useMemo(
    () => resolveEmployeeWarehouseInfo(viewItem, usersById, warehousesById),
    [viewItem, usersById, warehousesById]
  );

  // ── Selection ───────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(e => e.id)));
  }, [paginated]);

  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setDateF(''); setCustomFrom(''); setCustomTo('');
    setDeptF(''); setStatusF(''); setActiveKpi(''); setPage(1);
    setSelected(new Set());
    syncQueueParams({ q: '', date: '', from: '', to: '', dept: '', status: '', kpi: '', page: 1 });
  }

  function closeForm() {
    setShowForm(false); setEditId(null); setForm({ ...EMPLOYEE_FORM_DEFAULT });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  function openEdit(e: any) {
    setViewItem(null);
    const warehouseInfo = resolveEmployeeWarehouseInfo(e, usersById, warehousesById);
    setForm({
      name: e.name || '', phone: e.phone || '', email: e.email || '',
      dob: e.dob?.split('T')[0] || '', gender: e.gender || 'Male',
      department: e.department || '', designation: e.designation || '', role: e.role || 'Sales',
      joinDate: e.joinDate?.split('T')[0] || '', salary: String(e.salary || ''),
      bankAccount: e.bankAccount || '', bankIfsc: e.bankIfsc || '', bankName: e.bankName || '',
      panNumber: e.panNumber || '', aadharNumber: e.aadharNumber || '',
      address: e.address || '', city: e.city || '', state: e.state || '',
      status: e.status || 'Active', emergencyContact: e.emergencyContact || '', emergencyPhone: e.emergencyPhone || '',
      warehouseId: warehouseInfo.warehouseId, managerId: warehouseInfo.managerId,
    });
    setEditId(e.id); setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.phone) return toast.error('Name & phone required');
    saveMut.mutate(form);
  }

  function openDetail(e: any) {
    setLeadDetailsTab('overview');
    setViewItem(e);
    userClosedRef.current = false;
    const next = new URLSearchParams(searchParams);
    next.set('open', e.id);
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
    const target = (employees as any[]).find((e: any) => e.id === openParam);
    if (!target) return;
    setLeadDetailsTab('overview');
    setViewItem(target);
  }, [employees, isLoading, openParam]);

  // URL create param → open form modal
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...EMPLOYEE_FORM_DEFAULT });
    setEditId(null);
    setShowForm(true);
  }, [createParam]);

  // ── Bulk actions ────────────────────────────────────────────────
  function exportSelected() {
    const rows = (employees as any[]).filter(e => selected.has(e.id));
    if (!rows.length) return toast.error('No employees selected');
    exportEmployeesCSV(rows);
    toast.success(`Exported ${rows.length} employee${rows.length > 1 ? 's' : ''}`);
    setSelected(new Set());
  }

  async function bulkDelete() {
    if (!selected.size) return;
    await Promise.all(Array.from(selected).map(id => deleteMut.mutateAsync(id)));
    toast.success(`Deleted ${selected.size} employee${selected.size > 1 ? 's' : ''}`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
  }

  async function confirmBulkAction(action: string) {
    if (!selected.size) return;
    const ids = Array.from(selected);
    if (action === 'status' && bulkStatus) {
      await Promise.all(ids.map(id => {
        const emp = (employees as any[]).find((e: any) => e.id === id);
        if (!emp) return;
        return saveMut.mutateAsync({ ...emp, status: bulkStatus });
      }));
      toast.success(`Updated ${ids.length} employee${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkStatusOpen(false);
      setBulkStatus('');
    }
  }

  // ── KPI Config ──────────────────────────────────────────────────
  const KPI_CONFIGS = [
    {
      key: '',
      label: 'TOTAL',
      value: stats.total,
      icon: <UserCog className="h-4 w-4" />,
      description: 'All employees',
    },
    {
      key: 'active',
      label: 'ACTIVE',
      value: stats.active,
      icon: <User className="h-4 w-4" />,
      description: 'Currently active',
    },
    {
      key: 'onleave',
      label: 'ON LEAVE',
      value: stats.onLeave,
      icon: <Calendar className="h-4 w-4" />,
      description: 'On leave',
    },
    {
      key: 'new',
      label: 'NEW JOINEES',
      value: stats.newJoiners,
      icon: <Users className="h-4 w-4" />,
      description: 'Joined in last 30 days',
    },
    {
      key: 'inactive',
      label: 'INACTIVE',
      value: stats.inactive,
      icon: <AlertTriangle className="h-4 w-4" />,
      description: 'Inactive or terminated',
    },
    {
      key: 'depts',
      label: 'DEPARTMENTS',
      value: stats.departments,
      icon: <Building2 className="h-4 w-4" />,
      description: 'Unique departments',
    },
  ];

  // ── Active filter pills ─────────────────────────────────────────
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateF ? 1 : 0) + (deptF ? 1 : 0) + (statusF ? 1 : 0);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Workspace Hero ─────────────────────────────────────────────── */}
      <WorkspaceHero
        title="Employees"
        icon={<UserCog className="h-6 w-6" />}
        breadcrumbs={['Home', 'HR', 'Employees']}
        statusText={`${stats.total} employee${stats.total > 1 ? 's' : ''} · ${stats.active} active`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportEmployeesCSV(filtered)}>
              Export
            </Button>
            {perms.canCreate('employees') && (
              <Button size="sm" data-tour="employees-create" icon={<Plus className="h-4 w-4" />}
                onClick={() => { setForm({ ...EMPLOYEE_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
                Add Employee
              </Button>
            )}
          </>
        }
      />

      {/* ── KPI Grid ──────────────────────────────────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_CONFIGS.map(k => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.description}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
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
              aria-label="Search employees"
              data-tour="employees-search"
              placeholder="Search name, phone, email, department..."
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
              aria-label="Department filter"
              value={deptF}
              onChange={e => { setDeptF(e.target.value); setPage(1); syncQueueParams({ dept: e.target.value, page: 1 }); }}
              options={[{ label: 'All Departments', value: '' }, ...deptList.map(d => ({ label: d, value: d }))]}
              className="w-[120px] h-8 py-1"
            />

            <Select
              aria-label="Status filter"
              value={activeKpi ? '' : statusF}
              onChange={e => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={STATUS_OPTIONS}
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
              {deptF && !activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {deptF}
                  <button onClick={() => { setDeptF(''); setPage(1); syncQueueParams({ dept: '', page: 1 }); }}
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
              {selected.size} employee{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}>
                Export CSV
              </Button>
              {perms.canEdit('employees') && (
                <Button size="sm" variant="outline"
                  className="border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  onClick={() => { setBulkStatus(''); setBulkStatusOpen(true); }}>
                  Change Status
                </Button>
              )}
              {perms.canDelete('employees') && (
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
          <div data-tour="employees-table" className="min-h-0 flex-1 overflow-auto scroll-pt-10">
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
                <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')}
                  style={{ minWidth: 200 }}>NAME</Th>
                <Th style={{ width: 120 }}>PHONE</Th>
                <Th sortable sorted={sortKey === 'department'} desc={sortDesc} onSort={() => sort('department')}
                  style={{ width: 140 }}>DEPARTMENT</Th>
                <Th style={{ width: 140 }}>DESIGNATION</Th>
                <Th sortable sorted={sortKey === 'role'} desc={sortDesc} onSort={() => sort('role')}
                  style={{ width: 100 }}>ROLE</Th>
                <Th sortable sorted={sortKey === 'salary'} desc={sortDesc} onSort={() => sort('salary')}
                  style={{ width: 120 }}>SALARY</Th>
                <Th sortable sorted={sortKey === 'joinDate'} desc={sortDesc} onSort={() => sort('joinDate')}
                  style={{ width: 100 }}>JOIN DATE</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={9} rows={6} />
                ) : isError ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-[var(--color-text-disabled)]">
                        <UserCog className="h-10 w-10" />
                        <p className="text-sm text-[var(--color-text-muted)]">Failed to load employees.</p>
                        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                      </div>
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<UserCog className="h-9 w-9" />}
                        title={search || dateF || deptF || statusF || activeKpi ? 'No employees match filters' : 'No employees yet'}
                        description={search || dateF || deptF || statusF || activeKpi ? undefined : 'Add your first employee to get started.'}
                        action={(!search && !dateF && !deptF && !statusF && !activeKpi && perms.canCreate('employees')) ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />}
                            onClick={() => { setForm({ ...EMPLOYEE_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
                            Add Employee
                          </Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((e: any) => (
                    <Tr key={e.id} data-tour="employees-row" selected={selected.has(e.id)}
                      data-record-id={e.id} role="button" tabIndex={0}
                      onClick={(ev) => { if (!isRowOpenIgnored(ev.target)) openDetail(e); }}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(e); } }}
                      className="group cursor-pointer outline-none transition-all duration-200 ease-out
                        hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)]
                        focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td>
                        <span data-interactive onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(e.id)}
                            onChange={() => toggleSelect(e.id)}
                          />
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-xs font-bold shrink-0">
                            {(e.name || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)] leading-tight">{e.name || '—'}</p>
                            <p className="text-[12px] text-[var(--color-text-muted)] leading-tight">{e.email || e.id}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {e.phone ? (
                          <a href={`tel:${e.phone}`} data-interactive onClick={(ev) => ev.stopPropagation()}
                            className="text-[var(--color-primary-text)] hover:underline flex items-center gap-1 text-xs font-medium">
                            <Phone className="h-3 w-3" />{e.phone}
                          </a>
                        ) : <EmptyCell />}
                      </Td>
                      <Td className="text-xs">{e.department || <EmptyCell />}</Td>
                      <Td className="text-xs">{e.designation || <EmptyCell />}</Td>
                      <Td><Badge variant="info">{e.role || '—'}</Badge></Td>
                      <Td className="text-xs font-semibold">{e.salary ? `₹${Number(e.salary).toLocaleString('en-IN')}` : <EmptyCell />}</Td>
                      <Td className="text-xs text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(e.joinDate)}`} />
                          {formatCreatedDate(e.joinDate) || <EmptyCell />}
                        </span>
                      </Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                          className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openDetail(e)}
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
          <div data-tour="employees-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={p => { setPage(p); syncQueueParams({ page: p }); }}
              onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* ── Detail View Modal ──────────────────────────────────────────── */}
      <Modal open={!!viewItem} onClose={closeDetail} size="2xl">
        {viewItem && (() => {
          const tabs = [
            { key: 'overview' as const, label: 'Overview' },
            { key: 'personal' as const, label: 'Personal' },
            { key: 'job' as const, label: 'Job & Pay' },
            { key: 'bank' as const, label: 'Bank Details' },
            { key: 'documents' as const, label: 'Documents' },
            { key: 'history' as const, label: 'History' },
          ];
          return (
            <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
              {/* Header */}
              <div className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                    {(viewItem.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{viewItem.name || 'Untitled'}</h2>
                      {statusBadge(viewItem.status || 'Active')}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" />
                        {viewItem.department || 'Department not assigned'}
                      </span>
                      <span>{viewItem.designation || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    {viewItem.phone ? (
                      <a href={`tel:${viewItem.phone}`}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                        <Phone className="h-3.5 w-3.5" /> Call
                      </a>
                    ) : null}
                    {viewItem.email ? (
                      <a href={`mailto:${viewItem.email}`}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-hover)]">
                        <Mail className="h-3.5 w-3.5" /> Email
                      </a>
                    ) : null}
                  </div>
                  <button onClick={closeDetail} aria-label="Close"
                    className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4 sm:grid-cols-3 lg:grid-cols-6">
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setLeadDetailsTab(tab.key)}
                    className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors ${
                      leadDetailsTab === tab.key
                        ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
                {leadDetailsTab === 'overview' && (
                  <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-5">
                      <DetailCard title="Employee Information">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <LeadField label="Phone">{viewItem.phone ? <a href={`tel:${viewItem.phone}`} className="text-[var(--color-primary-text)] hover:underline">{viewItem.phone}</a> : <MutedValue />}</LeadField>
                          <LeadField label="Email" value={viewItem.email || <MutedValue />} />
                          <LeadField label="Department" value={viewItem.department || <MutedValue />} />
                          <LeadField label="Designation" value={viewItem.designation || <MutedValue />} />
                          <LeadField label="Role"><Badge variant="info">{viewItem.role || '—'}</Badge></LeadField>
                          <LeadField label="Status">{statusBadge(viewItem.status || 'Active')}</LeadField>
                          <LeadField label="Warehouse" value={viewItemWarehouseInfo.warehouseName || <MutedValue>Not assigned</MutedValue>} />
                          <LeadField label="Reporting Manager" value={viewItemWarehouseInfo.managerName || <MutedValue>Top level</MutedValue>} />
                        </div>
                      </DetailCard>
                      {viewItem.address && (
                        <DetailCard title="Address">
                          <p className="text-sm text-[var(--color-text)]">{[viewItem.address, viewItem.city, viewItem.state].filter(Boolean).join(', ')}</p>
                        </DetailCard>
                      )}
                      <DetailCard title="Emergency Contact">
                        <LeadField label="Contact Person" value={viewItem.emergencyContact || <MutedValue />} />
                        <div className="mt-3"><LeadField label="Emergency Phone">{viewItem.emergencyPhone ? <a href={`tel:${viewItem.emergencyPhone}`} className="text-[var(--color-primary-text)] hover:underline">{viewItem.emergencyPhone}</a> : <MutedValue />}</LeadField></div>
                      </DetailCard>
                    </div>

                    <aside className="space-y-4">
                      <DetailCard title="Join Date">
                        <p className="font-semibold text-[var(--color-text)]">{fmtDate(viewItem.joinDate) || 'Not available'}</p>
                      </DetailCard>
                      <DetailCard title="Salary">
                        <p className="text-lg font-bold text-[var(--color-success-text)] tabular-nums">
                          {viewItem.salary ? `₹${Number(viewItem.salary).toLocaleString('en-IN')}` : '—'}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">Monthly</p>
                      </DetailCard>
                      <DetailCard title="Quick Actions">
                        <div className="space-y-2">
                          <Button variant="outline" size="sm" className="w-full justify-start"
                            icon={<UserCog className="h-3.5 w-3.5" />}
                            onClick={() => { closeDetail(); openEdit(viewItem); }}>Edit Employee</Button>
                          {viewItem.phone ? (
                            <a href={`tel:${viewItem.phone}`}
                              className="inline-flex w-full items-center justify-start gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                              <Phone className="h-3.5 w-3.5" /> Call
                            </a>
                          ) : null}
                          {viewItem.email ? (
                            <a href={`mailto:${viewItem.email}`}
                              className="inline-flex w-full items-center justify-start gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                              <Mail className="h-3.5 w-3.5" /> Send Email
                            </a>
                          ) : null}
                          <div className="border-t border-[var(--color-border-subtle)] pt-3">
                            <Button variant="danger" size="sm" className="w-full justify-start"
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                              onClick={() => { closeDetail(); setDelId(viewItem.id); }}>Delete Employee</Button>
                          </div>
                        </div>
                      </DetailCard>
                    </aside>
                  </div>
                )}

                {leadDetailsTab === 'personal' && (
                  <div className="pt-5">
                    <DetailCard title="Personal Information">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Date of Birth" value={fmtDate(viewItem.dob) || <MutedValue />} />
                        <LeadField label="Gender" value={viewItem.gender || <MutedValue />} />
                        <LeadField label="PAN Number" value={viewItem.panNumber || <MutedValue />} />
                        <LeadField label="Aadhar" value={viewItem.aadharNumber || <MutedValue />} />
                        {viewItem.emergencyContact && <LeadField label="Emergency Contact" value={viewItem.emergencyContact} />}
                        {viewItem.emergencyPhone && (
                          <LeadField label="Emergency Phone">{viewItem.emergencyPhone ? <a href={`tel:${viewItem.emergencyPhone}`} className="text-[var(--color-primary-text)] hover:underline">{viewItem.emergencyPhone}</a> : <MutedValue />}</LeadField>
                        )}
                      </div>
                    </DetailCard>
                  </div>
                )}

                {leadDetailsTab === 'job' && (
                  <div className="pt-5 space-y-5">
                    <DetailCard title="Job Information">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Join Date" value={fmtDate(viewItem.joinDate) || <MutedValue />} />
                        <LeadField label="Salary"><span className="text-base font-semibold text-[var(--color-success-text)]">{viewItem.salary ? `₹${Number(viewItem.salary).toLocaleString('en-IN')}` : <MutedValue />}</span></LeadField>
                        <LeadField label="Department" value={viewItem.department || <MutedValue />} />
                        <LeadField label="Designation" value={viewItem.designation || <MutedValue />} />
                        <LeadField label="Role"><Badge variant="info">{viewItem.role || '—'}</Badge></LeadField>
                        <LeadField label="Status">{statusBadge(viewItem.status || 'Active')}</LeadField>
                        <LeadField label="Warehouse" value={viewItemWarehouseInfo.warehouseName || <MutedValue>Not assigned</MutedValue>} />
                        <LeadField label="Reporting Manager" value={viewItemWarehouseInfo.managerName || <MutedValue>Top level</MutedValue>} />
                      </div>
                    </DetailCard>
                  </div>
                )}

                {leadDetailsTab === 'bank' && (
                  <div className="pt-5">
                    <DetailCard title="Bank Details">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Bank Name" value={viewItem.bankName || <MutedValue />} />
                        <LeadField label="Account Number" value={viewItem.bankAccount || <MutedValue />} />
                        <LeadField label="IFSC Code" value={viewItem.bankIfsc || <MutedValue />} />
                        <LeadField label="PAN Number" value={viewItem.panNumber || <MutedValue />} />
                        <LeadField label="Aadhar" value={viewItem.aadharNumber || <MutedValue />} />
                      </div>
                    </DetailCard>
                  </div>
                )}

                {leadDetailsTab === 'documents' && (
                  <div className="pt-5">
                    <DetailCard title="Documents">
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-8 text-center">
                        <FileText className="mx-auto h-8 w-8 text-[var(--color-text-disabled)]" />
                        <p className="mt-2 text-sm font-medium text-[var(--color-text)]">No documents attached</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Documents will appear here after they are added.</p>
                      </div>
                    </DetailCard>
                  </div>
                )}

                {leadDetailsTab === 'history' && (
                  <div className="pt-5">
                    <DetailCard title="History">
                      <p className="text-sm text-[var(--color-text-muted)]">No history recorded.</p>
                    </DetailCard>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Create/Edit Form Modal ──────────────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Employee' : 'Add Employee'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto">
          <FormSection title="Personal Info">
            <FormRow>
              <Input label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input label="Phone" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              <Input label="Date of Birth" type="date" value={form.dob} onChange={e => setForm({ ...form, dob: e.target.value })} />
            </FormRow>
            <InputSelect label="Gender" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}
              options={['Male', 'Female', 'Other'].map(g => ({ label: g, value: g }))} />
          </FormSection>
          <FormSection title="Job Info">
            <FormRow>
              <InputSelect label="Department" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                options={[{ label: 'Select Dept', value: '' }, ...DEPT_OPTIONS]} />
              <Input label="Designation" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Sales Executive" />
            </FormRow>
            <FormRow>
              <InputSelect label="Role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                options={ROLE_OPTIONS} />
              <Input label="Join Date" type="date" value={form.joinDate} onChange={e => setForm({ ...form, joinDate: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="Monthly Salary (₹)" type="number" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} />
              <InputSelect label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                options={EMPLOYEE_STATUS_OPTIONS} />
            </FormRow>
            <FormRow>
              <InputSelect label="Warehouse" value={form.warehouseId} onChange={e => setForm({ ...form, warehouseId: e.target.value })}
                options={warehouseOptions} />
              <InputSelect label="Reporting Manager" value={form.managerId} onChange={e => setForm({ ...form, managerId: e.target.value })}
                options={managerOptions} />
            </FormRow>
          </FormSection>
          <FormSection title="Bank & ID">
            <FormRow>
              <Input label="Bank Name" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} />
              <Input label="Account Number" value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="IFSC Code" value={form.bankIfsc} onChange={e => setForm({ ...form, bankIfsc: e.target.value })} />
              <Input label="PAN Number" value={form.panNumber} onChange={e => setForm({ ...form, panNumber: e.target.value.toUpperCase() })} />
            </FormRow>
            <Input label="Aadhar Number" value={form.aadharNumber} onChange={e => setForm({ ...form, aadharNumber: e.target.value })} />
          </FormSection>
          <FormSection title="Address & Emergency">
            <Textarea label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} />
            <FormRow>
              <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
              <InputSelect label="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} options={STATE_OPTS} />
            </FormRow>
            <FormRow>
              <Input label="Emergency Contact" value={form.emergencyContact} onChange={e => setForm({ ...form, emergencyContact: e.target.value })} />
              <Input label="Emergency Phone" value={form.emergencyPhone} onChange={e => setForm({ ...form, emergencyPhone: e.target.value })} />
            </FormRow>
          </FormSection>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update' : 'Add Employee'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && deleteMut.mutate(delId, { onSuccess: () => setDelId(null) })}
        loading={deleteMut.isPending} title="Delete Employee"
        message="Delete this employee permanently?" />

      {/* ── Bulk Delete Confirm ──────────────────────────────────────────── */}
      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}
        onConfirm={bulkDelete}
        title={`Delete ${selected.size} Employees`}
        message={`Are you sure you want to delete ${selected.size} employee${selected.size > 1 ? 's' : ''}?`} />

      {/* ── Bulk Status Change ───────────────────────────────────────────── */}
      <Modal open={bulkStatusOpen} onClose={() => { setBulkStatusOpen(false); setBulkStatus(''); }}
        title="Change Status" size="sm">
        <div className="space-y-4">
          <InputSelect label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={EMPLOYEE_STATUS_OPTIONS} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setBulkStatusOpen(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => confirmBulkAction('status')} disabled={!bulkStatus}>Update</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
