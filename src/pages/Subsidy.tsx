/**
 * Subsidy — Subsidy Application List Page
 *
 * Leads-parity implementation for Compliance module.
 * Reference: Leads (Sales → Leads) — gold standard for all module pages.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, Plus, Download, Trash2, Eye, RefreshCw,
  X, FolderKanban, Search,
  FileText, ListChecks, Activity,
  CheckCircle2, XCircle, DollarSign,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../lib/firebase';
import {
  getAll, deleteDocById, fmtDate, fmtCurrency,
} from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { logActivity } from '../lib/workflow';

import type { SubsidyApplication, SubsidyStatus } from '../lib/subsidyWorkflow';
import {
  useSubsidy,
  useCreateSubsidy,
} from '../features/subsidy/hooks/useSubsidy';

import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { cn } from '../utils/cn';

const PER_PAGE = 10;

const SUBSIDY_STATUSES: SubsidyStatus[] = [
  'Draft', 'Submitted', 'UnderReview', 'Approved', 'Disbursed', 'Rejected',
];

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderReview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Disbursed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const FORM0 = {
  projectId: '', projectName: '', schemeName: '', schemeType: '',
  applicationNumber: '', applicationDate: '', submittedDate: '',
  totalSanctionedAmount: '', notes: '',
};

function downloadCsv(rows: any[], filename: string) {
  const headers = ['Application No.', 'Project', 'Scheme', 'Status', 'Sanctioned Amount', 'Submitted Date', 'Notes'];
  const lines = rows.map((app) =>
    [
      app.applicationNumber || '', app.projectName || app.projectId || '',
      app.schemeName || '', app.status || '',
      app.totalSanctionedAmount || '', fmtDate(app.submittedDate) || '',
      (app.notes || '').replace(/\"/g, '""'),
    ].map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

export default function Subsidy() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const keys = queryKeys.forCompany(activeCompanyId);
  const createParam = searchParams.get('create') || '';

  // ── Queries ──
  const subsidyQuery = useSubsidy();
  const createMutation = useCreateSubsidy();

  const { data: projects = [] } = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const subsidyData = useMemo(() => (subsidyQuery.data || []) as SubsidyApplication[], [subsidyQuery.data]);

  // ── Filters ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [projectF, setProjectF] = useState(() => searchParams.get('project') || '');
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');

  // ── Table ──
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Form / view / delete ──
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [delId, setDelId] = useState<string | null>(null);

  // ── Bulk operations ──
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  // ── Stats ──
  const stats = useMemo(() => ({
    total: subsidyData.length,
    draft: subsidyData.filter((a) => a.status === 'Draft').length,
    submitted: subsidyData.filter((a) => a.status === 'Submitted').length,
    approved: subsidyData.filter((a) => a.status === 'Approved' || a.status === 'UnderReview').length,
    paid: subsidyData.filter((a) => a.status === 'Disbursed').length,
    rejected: subsidyData.filter((a) => a.status === 'Rejected').length,
  }), [subsidyData]);

  const totalSanctioned = useMemo(
    () => subsidyData.reduce((s, a) => s + (Number(a.totalSanctionedAmount) || 0), 0),
    [subsidyData],
  );

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = [...subsidyData];

    // KPI filter
    if (activeKpi) {
      if (activeKpi === 'Approved') {
        list = list.filter((a) => a.status === 'Approved' || a.status === 'UnderReview');
      } else if (activeKpi !== 'total') {
        list = list.filter((a) => a.status === activeKpi);
      }
    }

    // Search
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((a) =>
        [a.applicationNumber, a.schemeName, a.projectName, a.projectId, a.id]
          .some((v) => String(v || '').toLowerCase().includes(q)),
      );
    }

    // Status
    if (statusF) list = list.filter((a) => a.status === statusF);

    // Project
    if (projectF) list = list.filter((a) => (a.projectName || a.projectId) === projectF);

    // Date range
    if (dateRange !== 'all') list = list.filter((a) => isInDateRange(a.createdAt, dateRange as any, customFrom, customTo));

    // Sort
    list.sort((a, b) => {
      const cmp = String(a[sortKey as keyof SubsidyApplication] || '').localeCompare(
        String(b[sortKey as keyof SubsidyApplication] || ''),
      );
      return sortDesc ? -cmp : cmp;
    });

    return list;
  }, [subsidyData, activeKpi, search, statusF, projectF, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  // ── URL Sync helpers ──
  function syncQueueParams(nextState: {
    q?: string; status?: string; project?: string; date?: string;
    from?: string; to?: string; kpi?: string; page?: number; perPage?: number;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const status = nextState.status ?? statusF;
    const project = nextState.project ?? projectF;
    const date = nextState.date ?? dateRange;
    const from = nextState.from ?? customFrom;
    const to = nextState.to ?? customTo;
    const kpi = nextState.kpi ?? activeKpi;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;

    if (q) next.set('q', q); else next.delete('q');
    if (status) next.set('status', status); else next.delete('status');
    if (project) next.set('project', project); else next.delete('project');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    setSearchParams(next, { replace: true });
  }

  // ── Create form init ──
  useEffect(() => {
    if (createParam !== '1') return;
    setForm({ ...FORM0 });
    setShowForm(true);
  }, [createParam]);

  function closeForm() {
    setShowForm(false);
    setForm({ ...FORM0 });
    if (createParam === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }

  // ── Detail navigation — the retired detail/disbursement modals' invocation
  // paths now open the /subsidy/:id record workspace page (the operational
  // subsidy workflow lives inside the Project Workspace Stage 12 card). ──
  function openRecord(app: SubsidyApplication) {
    navigate(`/subsidy/${encodeURIComponent(app.id)}`);
  }

  // ── Mutations ──
  const del = useMutation({
    mutationFn: async (id: string) => {
      await deleteDocById(COLLECTIONS.SUBSIDY_APPLICATIONS, id);
      await logActivity('Subsidy', 'Deleted Application', id, {
        entityName: `Subsidy ${id}`,
        actionLabel: 'Deleted subsidy application',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.subsidyAll });
      toast.success('Deleted');
      setDelId(null);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => del.mutateAsync(id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.subsidyAll });
      toast.success('Deleted selected applications');
      setDelId(null);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const { transitionSubsidyStatus } = await import('../lib/subsidyWorkflow');
      await Promise.all(ids.map((id) =>
        transitionSubsidyStatus(id, status as SubsidyStatus, { note: 'Bulk status update' })
          .catch(() => {}),
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.subsidyAll });
      toast.success(`Status updated for ${selected.size} application${selected.size > 1 ? 's' : ''}`);
      setShowBulkStatus(false);
      setBulkStatus('');
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Selection ──
  const toggleSelect = useCallback((id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    }), []);
  const toggleAll = () =>
    setSelected((s) => (s.size === paginated.length ? new Set() : new Set(paginated.map((l: any) => l.id))));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  function sort(k: string) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  function clearAll() {
    setSearch(''); setStatusF(''); setProjectF('');
    setDateRange('all'); setCustomFrom(''); setCustomTo('');
    setActiveKpi(''); setPage(1);
    syncQueueParams({
      q: '', status: '', project: '', date: 'all',
      from: '', to: '', kpi: '', page: 1,
    });
  }

  function exportSelected() {
    const rows = subsidyData.filter((app) => selected.has(app.id));
    if (!rows.length) return toast.error('No applications selected');
    downloadCsv(rows, `subsidy-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} application${rows.length > 1 ? 's' : ''}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, app: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openRecord(app);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, app: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openRecord(app);
  }

  function handleCreateSubmit() {
    if (createMutation.isPending) return;
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.schemeName.trim()) return toast.error('Please select/enter a scheme name');
    if (!form.applicationNumber.trim()) return toast.error('Please enter application number');
    const project = (projects as any[]).find((p: any) => p.id === form.projectId || p.projectId === form.projectId);
    createMutation.mutate(
      {
        projectId: form.projectId,
        projectName: project?.projectId || form.projectId,
        schemeName: form.schemeName.trim(),
        schemeType: form.schemeType || undefined,
        applicationNumber: form.applicationNumber.trim(),
        applicationDate: form.applicationDate || undefined,
        submittedDate: form.submittedDate || undefined,
        totalSanctionedAmount: form.totalSanctionedAmount ? Number(form.totalSanctionedAmount) : undefined,
        notes: form.notes || undefined,
      },
      { onSuccess: () => closeForm() },
    );
  }

  // ── KPIs ──
  const isTotalDefault = !activeKpi && !search && !statusF && !projectF && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', projectF ? 'project' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = [
    { key: '', label: 'TOTAL', value: stats.total, icon: <Landmark className="h-4 w-4" />, desc: `₹${(totalSanctioned / 100000).toFixed(1)}L sanctioned` },
    { key: 'Draft', label: 'DRAFT', value: stats.draft, icon: <FileText className="h-4 w-4" />, desc: 'Not yet submitted' },
    { key: 'Submitted', label: 'SUBMITTED', value: stats.submitted, icon: <Activity className="h-4 w-4" />, desc: 'Under review' },
    { key: 'Approved', label: 'APPROVED', value: stats.approved, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Approved/Under Review' },
    { key: 'Disbursed', label: 'PAID', value: stats.paid, icon: <DollarSign className="h-4 w-4" />, desc: 'Amount disbursed' },
    { key: 'Rejected', label: 'REJECTED', value: stats.rejected, icon: <XCircle className="h-4 w-4" />, desc: 'Application rejected' },
  ];

  function statusBadgeSub(status: string) {
    return (
      <span className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
        STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      )}>
        {status === 'UnderReview' ? 'Under Review' : status}
      </span>
    );
  }

  const loading = subsidyQuery.isLoading;

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'This Week', value: 'this_week' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Custom', value: 'custom' },
  ];

  function handleDateChange(newDateRange: string) {
    setDateRange(newDateRange);
    setPage(1);
    if (newDateRange !== 'custom') { setCustomFrom(''); setCustomTo(''); }
    syncQueueParams({ date: newDateRange, from: '', to: '', page: 1 });
  }

  const statusOptions = [
    { label: 'All Statuses', value: '' },
    ...SUBSIDY_STATUSES.map((s) => ({
      label: s === 'UnderReview' ? 'Under Review' : s,
      value: s,
    })),
  ];

  const projectOptions = [
    { label: 'All Projects', value: '' },
    ...Array.from(new Set(subsidyData.map((a) => a.projectName || a.projectId).filter(Boolean))).map((name) => ({ label: name, value: name })),
  ];

  // ── Render ──
  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
        <div className="h-10 w-72 rounded-xl bg-[var(--color-bg-sunken)] animate-pulse" />
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[var(--color-bg-sunken)] animate-pulse" />
          ))}
        </div>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
          <Table>
            <thead>
              <tr>
                {Array.from({ length: 8 }).map((_, i) => (
                  <th key={i} className="px-4 py-2.5">
                    <div className="skeleton h-4 w-20" />
                  </th>
                ))}
              </tr>
            </thead>
            <SkeletonRows cols={8} rows={6} />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<Landmark className="h-4 w-4" />}
        breadcrumbs={['Home', 'Compliance', 'Subsidy']} title="Subsidy"
        statusText="Compliance" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => subsidyQuery.refetch()}>Refresh</Button>
            <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => downloadCsv(subsidyData, `subsidy-all-${new Date().toISOString().slice(0, 10)}.csv`)}>
              Export
            </Button>
            {perms.canCreate('subsidy') && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }}>
                New Application
              </Button>
            )}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : k.key;
              if (k.key === '' && isTotalDefault) return;
              setActiveKpi(nextKpi);
              setPage(1);
              syncQueueParams({ kpi: nextKpi, page: 1 });
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* SEARCH + FILTERS */}
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                placeholder="Search subsidy number, scheme, project..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              />
            </div>
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncQueueParams({ from: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncQueueParams({ to: e.target.value, date: 'custom', page: 1 }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={statusF} onChange={(e) => {
              const v = e.target.value;
              setStatusF(v);
              if (v && activeKpi && v !== activeKpi) {
                setActiveKpi('');
                setPage(1);
                syncQueueParams({ status: v, kpi: '', page: 1 });
              } else {
                setPage(1);
                syncQueueParams({ status: v, page: 1 });
              }
            }} options={statusOptions} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={projectF} onChange={(e) => { setProjectF(e.target.value); setPage(1); syncQueueParams({ project: e.target.value, page: 1 }); }} options={projectOptions} className="h-8 min-w-[120px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} application{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} application{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              {perms.canEdit('subsidy') && (
                <Button size="sm" variant="outline"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkStatus(true)}
                  className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                  Change Status
                </Button>
              )}
              {perms.canDelete('subsidy') && (
                <Button size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                  Delete
                </Button>
              )}
              <button onClick={() => setSelected(new Set())}
                className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* TABLE AREA */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible applications" />
                </Th>
                <Th sortable sorted={sortKey === 'applicationNumber'} desc={sortDesc} onSort={() => sort('applicationNumber')} style={{ width: '15%', minWidth: 130 }}>Application</Th>
                <Th sortable sorted={sortKey === 'projectName'} desc={sortDesc} onSort={() => sort('projectName')} style={{ width: '16%', minWidth: 140 }}>Project</Th>
                <Th sortable sorted={sortKey === 'schemeName'} desc={sortDesc} onSort={() => sort('schemeName')} style={{ width: '15%', minWidth: 130 }}>Scheme</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')} style={{ width: '12%', minWidth: 100 }}>Status</Th>
                <Th sortable sorted={sortKey === 'totalSanctionedAmount'} desc={sortDesc} onSort={() => sort('totalSanctionedAmount')} style={{ width: '12%', minWidth: 100 }}>Amount</Th>
                <Th sortable sorted={sortKey === 'submittedDate'} desc={sortDesc} onSort={() => sort('submittedDate')} style={{ width: '12%', minWidth: 100 }}>Submitted</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <EmptyState
                        icon={<Landmark className="h-9 w-9" />}
                        title={search || statusF || projectF || activeKpi ? 'No applications match filters' : 'No applications yet'}
                        description={search || statusF || projectF || activeKpi ? undefined : 'Create your first subsidy application to get started.'}
                        action={!search && !statusF && !projectF && !activeKpi && perms.canCreate('subsidy') ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }} className="mt-2">Create Your First Application</Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((app) => (
                    <Tr key={app.id} selected={selected.has(app.id)}
                      data-record-id={app.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRowClick(e, app)}
                      onKeyDown={(e) => handleRowKeyDown(e, app)}
                      className="transition-colors duration-150"
                    >
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selected.has(app.id)} onChange={() => toggleSelect(app.id)} ariaLabel={`Select ${app.applicationNumber}`} />
                      </Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3 w-3 text-[var(--color-text-muted)]" />
                          <span className="font-mono text-xs font-medium text-[var(--color-text)]">
                            {app.applicationNumber}
                          </span>
                        </div>
                      </Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <FolderKanban className="h-3 w-3 text-[var(--color-text-muted)]" />
                          <span className="text-xs text-[var(--color-text)]">
                            {app.projectName || app.projectId}
                          </span>
                        </div>
                      </Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <Landmark className="h-3 w-3 text-[var(--color-text-muted)]" />
                          <span className="text-xs text-[var(--color-text)]">{app.schemeName}</span>
                        </div>
                      </Td>
                      <Td className="py-3">{statusBadgeSub(app.status)}</Td>
                      <Td className="py-3">
                        <span className="text-xs font-medium text-[var(--color-text)]">
                          {app.totalSanctionedAmount ? fmtCurrency(app.totalSanctionedAmount) : '—'}
                        </span>
                      </Td>
                      <Td className="py-3">
                        <span className="text-xs text-[var(--color-text-muted)]">{fmtDate(app.submittedDate)}</span>
                      </Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openRecord(app); }}>View</Button>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        {filtered.length > perPage && (
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); syncQueueParams({ perPage: nextPerPage, page: 1 }); }} />
          </div>
        )}
      </Card>

      {/* ── Create Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">New Subsidy Application</h3>
              <button onClick={closeForm} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Project *</label>
                <select
                  value={form.projectId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const project = (projects as any[]).find((p: any) => p.id === pid || p.projectId === pid);
                    setForm((f) => ({ ...f, projectId: pid, projectName: project?.projectId || pid }));
                  }}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Select project</option>
                  {(projects as any[])
                    .filter((p: any) => ['NetMetering', 'Subsidy', 'Handover', 'Archived'].includes(p.currentStage))
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>{p.projectId || p.id}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Scheme Name *</label>
                <select
                  value={form.schemeName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((f) => ({
                      ...f, schemeName: val,
                      schemeType: val === 'PM Surya Ghar' ? 'Central' : val === 'State Scheme' ? 'State' : f.schemeType,
                    }));
                  }}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Select scheme</option>
                  <option value="PM Surya Ghar">PM Surya Ghar</option>
                  <option value="State Scheme">State Scheme</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              {form.schemeName === 'OTHER' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Custom Scheme Name</label>
                  <input
                    type="text"
                    value={form.schemeName === 'OTHER' ? '' : form.schemeName}
                    onChange={(e) => setForm((f) => ({ ...f, schemeName: e.target.value }))}
                    placeholder="Enter scheme name"
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Application Number *</label>
                <input
                  type="text"
                  value={form.applicationNumber}
                  onChange={(e) => setForm((f) => ({ ...f, applicationNumber: e.target.value }))}
                  placeholder="Scheme application reference number"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Application Date</label>
                <input
                  type="date"
                  value={form.applicationDate}
                  onChange={(e) => setForm((f) => ({ ...f, applicationDate: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Submitted Date (optional)</label>
                <input
                  type="date"
                  value={form.submittedDate}
                  onChange={(e) => setForm((f) => ({ ...f, submittedDate: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Sanctioned Amount</label>
                <input
                  type="number"
                  value={form.totalSanctionedAmount}
                  onChange={(e) => setForm((f) => ({ ...f, totalSanctionedAmount: e.target.value }))}
                  placeholder="Total approved subsidy amount"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional notes about the application"
                  rows={2}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={closeForm}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={createMutation.isPending}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Application'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Status Modal ── */}
      <Modal open={showBulkStatus} onClose={() => setShowBulkStatus(false)} title="Change Status" size="sm">
        <div className="space-y-3">
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            className="w-full h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          >
            <option value="">Select status...</option>
            {SUBSIDY_STATUSES.filter((s) => s !== 'Rejected').map((s) => (
              <option key={s} value={s}>{s === 'UnderReview' ? 'Under Review' : s}</option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowBulkStatus(false)}>Cancel</Button>
            <Button
              size="sm"
              loading={bulkStatusMutation.isPending}
              onClick={() => {
                if (!bulkStatus) return toast.error('Select a status');
                bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
              }}
            >
              Update
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={delId !== null}
        title="Delete Application"
        message={
          delId === '__bulk__'
            ? `Are you sure you want to delete ${selected.size} selected applications?`
            : 'Are you sure you want to delete this subsidy application?'
        }
        onConfirm={() => {
          if (delId === '__bulk__') bulkDeleteMutation.mutate(Array.from(selected));
          else if (delId) del.mutate(delId);
        }}
        onClose={() => setDelId(null)}
        loading={del.isPending || bulkDeleteMutation.isPending}
      />
    </div>
  );
}
