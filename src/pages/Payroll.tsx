/**
 * Payroll Page — Desktop Gold Standard (Phase 3 HR)
 *
 * Sources of truth:
 *   - DESKTOP_PAGE_STANDARD.md
 *   - Leads Workspace
 *
 * Reuses:
 *   - usePayroll, useSavePayroll, useDeletePayroll, MONTHS,
 *     PAYROLL_FORM_DEFAULT, type PayrollForm from features/hr/hooks/useHR.ts
 *   - useEmployees for employee lookup
 *   - fmtCurrency, fmtDate from lib/firestore
 *   - PAYMENT_MODES from config/company
 *   - PremiumKpi, WorkspaceHero, Pagination, UniversalCheckbox from shared UI
 *   - statusBadge from shared UI
 */
import { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fmtCurrency, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange, isDateRangeValue } from '../lib/dateFilters';
import { PAYMENT_MODES } from '../config/company';
import { usePermissions } from '../lib/permissions';
import { statusBadge } from '../components/ui/Badge';
import { useWarehouses } from '../features/warehouses/hooks/useWarehouses';
import { buildUserMap, buildWarehouseMap, resolveEmployeeWarehouseInfo } from '../lib/employeeDirectory';
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
  Plus, Trash2, DollarSign, Calendar, RefreshCw, Download,
  Eye, X, CheckCircle2, Clock,
} from 'lucide-react';
import { useEmployees } from '../features/employees/hooks/useEmployees';
import {
  usePayroll, useSavePayroll, useDeletePayroll, MONTHS,
  PAYROLL_FORM_DEFAULT, type PayrollForm,
} from '../features/hr/hooks/useHR';
import toast from 'react-hot-toast';

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
  { label: 'Paid', value: 'Paid' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Processing', value: 'Processing' },
];

// ── Helpers ───────────────────────────────────────────────────────────

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
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

export default function Payroll() {
  const perms = usePermissions();

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filters
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const deferredSearch = useDeferredValue(search);
  const [dateF, setDateF] = useState(() => searchParams.get('date') || '');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [monthF, setMonthF] = useState(() => searchParams.get('month') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('month');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  // ── Form / view / delete
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PayrollForm>({ ...PAYROLL_FORM_DEFAULT });
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'salary'>('overview');
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';
  const userClosedRef = useRef(false);

  // ── Queries
  const { data: payroll = [], isLoading, isError, refetch } = usePayroll();
  const { data: employees = [] } = useEmployees();
  const saveMut = useSavePayroll(editId, () => { setShowForm(false); setEditId(null); setForm({ ...PAYROLL_FORM_DEFAULT }); });
  const deleteMut = useDeletePayroll();

  // Phase 12: real, query-backed warehouse attribution for Payroll —
  // previously no Attendance/Payroll surface could answer "which warehouse
  // is this payroll record's employee attached to" at all.
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
    setParam('month', overrides.month ?? monthF);
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
    let list = [...(payroll as any[])];

    // KPI filter
    if (activeKpi === 'paid') list = list.filter(p => p.status === 'Paid');
    else if (activeKpi === 'pending') list = list.filter(p => p.status === 'Pending');
    else if (activeKpi === 'processing') list = list.filter(p => p.status === 'Processing');

    // Search filter
    const q = deferredSearch.toLowerCase();
    if (q) {
      list = list.filter(p =>
        [p.employee, p.employeeId, p.notes].some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }

    // Date filter
    if (dateF) {
      list = list.filter(p => isInDateRange(p.createdAt, isDateRangeValue(dateF) ? dateF : 'all', customFrom, customTo));
    }

    // Month filter
    if (monthF) list = list.filter(p => p.month === monthF);

    // Status filter (only if no active KPI)
    if (statusF && !activeKpi) list = list.filter(p => p.status === statusF);

    // Sort
    list.sort((a, b) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [payroll, deferredSearch, dateF, customFrom, customTo, monthF, statusF, activeKpi, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Stats / KPIs ────────────────────────────────────────────────
  const now = new Date();
  const currentMonth = MONTHS[now.getMonth()];

  const stats = useMemo(() => {
    const all = payroll as any[];
    return {
      total: all.length,
      paid: all.filter(p => p.status === 'Paid').length,
      pending: all.filter(p => p.status === 'Pending').length,
      processing: all.filter(p => p.status === 'Processing').length,
      thisMonth: all.filter(p => p.month === currentMonth).length,
      totalValue: all.reduce((sum: number, p: any) => sum + (Number(p.netSalary) || 0), 0),
    };
  }, [payroll, currentMonth]);

  const isTotalDefault = !activeKpi && !search && !dateF && !monthF && !statusF;

  function fmtCurrencyValue(value: number | string): string {
    const num = Number(value) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  }

  // ── Selection ───────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map(p => p.id)));
  }, [paginated]);

  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setDateF(''); setCustomFrom(''); setCustomTo('');
    setMonthF(''); setStatusF(''); setActiveKpi(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', date: '', from: '', to: '', month: '', status: '', kpi: '', page: 1 });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employeeId || !form.month) return toast.error('Employee & month required');
    saveMut.mutate(form);
  }

  function calcNet() {
    const n = (v: string) => Number(v) || 0;
    return n(form.basicSalary) + n(form.hra) + n(form.allowances) - n(form.deductions) - n(form.tds) - n(form.advance);
  }

  function openDetail(p: any) {
    setDetailTab('overview');
    setViewItem(p);
    userClosedRef.current = false;
    const next = new URLSearchParams(searchParams);
    next.set('open', p.id);
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

  function openEdit(p: any) {
    setForm({
      employeeId: p.employeeId || '', employee: p.employee || '',
      month: p.month || '', year: p.year || String(new Date().getFullYear()),
      basicSalary: String(p.basicSalary || ''), hra: String(p.hra || ''),
      allowances: String(p.allowances || ''), deductions: String(p.deductions || ''),
      tds: String(p.tds || ''), advance: String(p.advance || ''), netSalary: String(p.netSalary || ''),
      mode: p.mode || 'Bank Transfer', status: p.status || 'Paid', notes: p.notes || '',
    });
    setEditId(p.id);
    setShowForm(true);
  }

  // URL open param → open detail modal
  useEffect(() => {
    if (!openParam || isLoading || userClosedRef.current) return;
    const target = (payroll as any[]).find((p: any) => p.id === openParam);
    if (!target) return;
    setDetailTab('overview');
    setViewItem(target);
  }, [payroll, isLoading, openParam]);

  // URL create param → open form modal
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...PAYROLL_FORM_DEFAULT });
    setEditId(null);
    setShowForm(true);
  }, [createParam]);

  // ── Bulk actions ────────────────────────────────────────────────
  function exportSelected() {
    const rows = (payroll as any[]).filter(p => selected.has(p.id));
    if (!rows.length) return toast.error('No records selected');
    const csv = [
      ['Employee','Month','Year','Basic','HRA','Allowances','Deductions','TDS','Net Salary','Status'],
      ...rows.map((p: any) => [p.employee, p.month, p.year, p.basicSalary, p.hra, p.allowances, p.deductions, p.tds, p.netSalary, p.status].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'payroll.csv';
    a.click();
    toast.success(`Exported ${rows.length} records`);
    setSelected(new Set());
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
    for (const id of ids) {
      const rec = (payroll as any[]).find((p: any) => p.id === id);
      if (!rec) continue;
      await saveMut.mutateAsync({ ...rec, status: bulkStatus });
    }
    toast.success(`Updated ${ids.length} record${ids.length > 1 ? 's' : ''}`);
    setSelected(new Set());
    setBulkStatusOpen(false);
    setBulkStatus('');
  }

  // ── KPI Config ──────────────────────────────────────────────────
  const KPI_CONFIGS = [
    {
      key: '',
      label: 'TOTAL RECORDS',
      value: stats.total,
      icon: <DollarSign className="h-4 w-4" />,
      description: 'All payroll entries',
    },
    {
      key: 'paid',
      label: 'PAID',
      value: stats.paid,
      icon: <CheckCircle2 className="h-4 w-4" />,
      description: 'Successfully paid',
    },
    {
      key: 'pending',
      label: 'PENDING',
      value: stats.pending,
      icon: <Clock className="h-4 w-4" />,
      description: 'Awaiting payment',
    },
    {
      key: 'processing',
      label: 'PROCESSING',
      value: stats.processing,
      icon: <RefreshCw className="h-4 w-4" />,
      description: 'In process',
    },
    {
      key: 'thismonth',
      label: 'THIS MONTH',
      value: stats.thisMonth,
      icon: <Calendar className="h-4 w-4" />,
      description: `${currentMonth} records`,
    },
    {
      key: 'totalvalue',
      label: 'TOTAL VALUE',
      value: fmtCurrencyValue(stats.totalValue),
      icon: <DollarSign className="h-4 w-4" />,
      description: 'Sum of all salaries',
    },
  ];

  // ── Active filter pills count ───────────────────────────────────
  const activeFilterCount = (activeKpi ? 1 : 0) + (search ? 1 : 0) + (dateF ? 1 : 0) + (monthF ? 1 : 0) + (statusF ? 1 : 0);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Workspace Hero ─────────────────────────────────────────────── */}
      <WorkspaceHero
        title="Payroll"
        icon={<DollarSign className="h-6 w-6" />}
        breadcrumbs={['Home', 'HR', 'Payroll']}
        statusText={`${stats.total} records · ${stats.paid} paid`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => {
              const csv = [
                ['Employee','Month','Year','Basic','HRA','Allowances','Deductions','TDS','Net Salary','Status'],
                ...filtered.map((p: any) => [p.employee, p.month, p.year, p.basicSalary, p.hra, p.allowances, p.deductions, p.tds, p.netSalary, p.status].join(',')),
              ].join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              a.download = 'payroll.csv';
              a.click();
              toast.success('Exported');
            }}>
              Export
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />}
              onClick={() => { setForm({ ...PAYROLL_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
              Add Payroll
            </Button>
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
            onClick={k.key === 'totalvalue' ? undefined : () => {
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
              aria-label="Search payroll"
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
              aria-label="Month filter"
              value={monthF}
              onChange={e => { setMonthF(e.target.value); setPage(1); syncQueueParams({ month: e.target.value, page: 1 }); }}
              options={[{ label: 'All Months', value: '' }, ...MONTHS.map(m => ({ label: m, value: m }))]}
              className="w-[120px] h-8 py-1"
            />

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
              {monthF && !activeKpi && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                  {monthF}
                  <button onClick={() => { setMonthF(''); setPage(1); syncQueueParams({ month: '', page: 1 }); }}
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
              {perms.canEdit('payroll') && (
                <Button size="sm" variant="outline"
                  className="border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30"
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={() => { setBulkStatus(''); setBulkStatusOpen(true); }}>
                  Change Status
                </Button>
              )}
              {perms.canDelete('payroll') && (
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
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
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
                <Th sortable sorted={sortKey === 'month'} desc={sortDesc} onSort={() => sort('month')}
                  style={{ width: 120 }}>PERIOD</Th>
                <Th sortable sorted={sortKey === 'basicSalary'} desc={sortDesc} onSort={() => sort('basicSalary')}
                  style={{ width: 100 }}>BASIC</Th>
                <Th style={{ width: 100 }}>HRA</Th>
                <Th style={{ width: 100 }}>ALLOWANCES</Th>
                <Th sortable sorted={sortKey === 'netSalary'} desc={sortDesc} onSort={() => sort('netSalary')}
                  style={{ width: 110 }}>NET SALARY</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}
                  style={{ width: 110 }}>STATUS</Th>
                <Th style={{ width: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={9} rows={6} />
                ) : isError ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-[var(--color-text-disabled)]">
                        <DollarSign className="h-10 w-10" />
                        <p className="text-sm text-[var(--color-text-muted)]">Failed to load payroll records.</p>
                        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                      </div>
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        icon={<DollarSign className="h-9 w-9" />}
                        title={search || dateF || monthF || statusF || activeKpi ? 'No records match filters' : 'No payroll records yet'}
                        description={search || dateF || monthF || statusF || activeKpi ? undefined : 'Add your first payroll record to get started.'}
                        action={(!search && !dateF && !monthF && !statusF && !activeKpi) ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />}
                            onClick={() => { setForm({ ...PAYROLL_FORM_DEFAULT }); setEditId(null); setShowForm(true); }}>
                            Add Payroll
                          </Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((p: any) => (
                    <Tr key={p.id} selected={selected.has(p.id)}
                      data-record-id={p.id} role="button" tabIndex={0}
                      onClick={(e) => { if (!isRowOpenIgnored(e.target)) openDetail(p); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(p); } }}
                      className="group cursor-pointer outline-none transition-all duration-200 ease-out
                        hover:bg-[var(--color-table-row-hover)] focus-visible:bg-[var(--color-table-row-hover)]
                        focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                      <Td>
                        <span data-interactive onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(p.id)}
                            onChange={() => toggleSelect(p.id)}
                          />
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-xs font-bold shrink-0">
                            {(p.employee || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)] leading-tight">{p.employee || '—'}</p>
                            <p className="text-[12px] text-[var(--color-text-muted)] leading-tight">{p.employeeId}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-xs font-medium">{p.month} {p.year}</Td>
                      <Td className="text-xs">{fmtCurrency(p.basicSalary)}</Td>
                      <Td className="text-xs">{fmtCurrency(p.hra)}</Td>
                      <Td className="text-xs">{fmtCurrency(p.allowances)}</Td>
                      <Td className="font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(p.netSalary)}</Td>
                      <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(p.status || 'Paid')}</span></Td>
                      <Td>
                        <div data-action onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                          className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openDetail(p)}
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
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
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
            { key: 'salary' as const, label: 'Salary Breakdown' },
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
                      {statusBadge(viewItem.status || 'Paid')}
                    </div>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {viewItem.month} {viewItem.year}
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
                      <DetailCard title="Payroll Information">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <LeadField label="Period" value={`${viewItem.month} ${viewItem.year}`} />
                          <LeadField label="Status">{statusBadge(viewItem.status || 'Paid')}</LeadField>
                          <LeadField label="Payment Mode" value={viewItem.mode || <MutedValue />} />
                          <LeadField label="Net Salary">
                            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(viewItem.netSalary)}</span>
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
                          <Button variant="outline" size="sm" className="w-full justify-start"
                            icon={<DollarSign className="h-3.5 w-3.5" />}
                            onClick={() => { closeDetail(); openEdit(viewItem); }}>Edit Payroll</Button>
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

                {detailTab === 'salary' && (
                  <DetailCard title="Salary Breakdown">
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Basic Salary">
                          <span className="text-base font-semibold text-[var(--color-text)]">{fmtCurrency(viewItem.basicSalary)}</span>
                        </LeadField>
                        <LeadField label="HRA">
                          <span className="text-base font-semibold text-[var(--color-text)]">{fmtCurrency(viewItem.hra)}</span>
                        </LeadField>
                        <LeadField label="Allowances">
                          <span className="text-base font-semibold text-emerald-600">{fmtCurrency(viewItem.allowances)}</span>
                        </LeadField>
                        <LeadField label="Deductions">
                          <span className="text-base font-semibold text-red-500">{fmtCurrency(viewItem.deductions)}</span>
                        </LeadField>
                        <LeadField label="TDS">
                          <span className="text-base font-semibold text-red-500">{fmtCurrency(viewItem.tds)}</span>
                        </LeadField>
                        <LeadField label="Advance">
                          <span className="text-base font-semibold text-red-500">{fmtCurrency(viewItem.advance)}</span>
                        </LeadField>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
                        <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Net Salary</p>
                        <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">{fmtCurrency(viewItem.netSalary)}</p>
                      </div>
                    </div>
                  </DetailCard>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Create/Edit Modal ────────────────────────────────────────────── */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditId(null); setForm({ ...PAYROLL_FORM_DEFAULT }); }} title={editId ? 'Edit Payroll' : 'Add Payroll'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto">
          <FormSection title="Employee">
            <FormRow>
              <InputSelect label="Employee" required value={form.employeeId} onChange={e => {
                const emp = (employees as any[]).find((x: any) => x.id === e.target.value);
                setForm({ ...form, employeeId: e.target.value, employee: emp?.name || '', basicSalary: String(emp?.salary || '') });
              }} options={[{ label: 'Select Employee', value: '' }, ...(employees as any[]).map((e: any) => ({ label: e.name, value: e.id }))]} />
              <InputSelect label="Month" required value={form.month} onChange={e => setForm({ ...form, month: e.target.value })}
                options={[{ label: 'Select Month', value: '' }, ...MONTHS.map(m => ({ label: m, value: m }))]} />
            </FormRow>
            <FormRow>
              <Input label="Year" type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} />
              <InputSelect label="Payment Mode" value={form.mode || 'Bank Transfer'} onChange={e => setForm({ ...form, mode: e.target.value } as any)}
                options={PAYMENT_MODES.map(m => ({ label: m, value: m }))} />
            </FormRow>
          </FormSection>
          <FormSection title="Salary Components">
            <FormRow>
              <Input label="Basic Salary (₹)" type="number" value={form.basicSalary} onChange={e => setForm({ ...form, basicSalary: e.target.value })} />
              <Input label="HRA (₹)" type="number" value={form.hra} onChange={e => setForm({ ...form, hra: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="Other Allowances (₹)" type="number" value={form.allowances} onChange={e => setForm({ ...form, allowances: e.target.value })} />
              <Input label="Deductions (₹)" type="number" value={form.deductions} onChange={e => setForm({ ...form, deductions: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="TDS (₹)" type="number" value={form.tds} onChange={e => setForm({ ...form, tds: e.target.value })} />
              <Input label="Advance (₹)" type="number" value={form.advance} onChange={e => setForm({ ...form, advance: e.target.value })} />
            </FormRow>
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-center">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">Net Salary</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(calcNet())}</p>
            </div>
          </FormSection>
          <FormSection title="Payment">
            <FormRow>
              <InputSelect label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                options={['Paid', 'Pending', 'Processing'].map(s => ({ label: s, value: s }))} />
            </FormRow>
            <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
          </FormSection>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => { setShowForm(false); setEditId(null); setForm({ ...PAYROLL_FORM_DEFAULT }); }}>Cancel</Button>
            <Button type="submit" loading={saveMut.isPending}>{editId ? 'Update Payroll' : 'Save Payroll'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm ──────────────────────────────────────────────── */}
      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={() => delId && deleteMut.mutate(delId, { onSuccess: () => setDelId(null) })}
        loading={deleteMut.isPending} title="Delete Payroll" message="Delete this payroll record?" />

      {/* ── Bulk Delete Confirm ──────────────────────────────────────────── */}
      <ConfirmDialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)}
        onConfirm={bulkDelete}
        title="Delete Records"
        message={`Delete ${selected.size} selected payroll record${selected.size > 1 ? 's' : ''}?`} />

      {/* ── Bulk Status Change ───────────────────────────────────────────── */}
      <Modal open={bulkStatusOpen} onClose={() => { setBulkStatusOpen(false); setBulkStatus(''); }}
        title="Change Status" size="sm">
        <div className="space-y-4">
          <InputSelect label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={['Paid', 'Pending', 'Processing'].map(s => ({ label: s, value: s }))} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setBulkStatusOpen(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={confirmBulkStatus} disabled={!bulkStatus}>Update</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
