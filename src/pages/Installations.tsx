import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HardHat, RefreshCw, Search, Download, Users, Trash2,
  AlertTriangle, CheckCircle2, Clock, LayoutDashboard, Activity, Wrench,
  Eye, User, Building2,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { getAll, fmtDate, deleteDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import {
  stageLabel, calculateCompletion, isInstallationDelayed, delayDays,
  isValidInstallation, INSTALLATION_STAGES, assignEngineer,
} from '../lib/installationEngine';
import { cn } from '../utils/cn';

const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadInstallationsCsv(rows: any[], filename: string) {
  const headers = ['Name', 'Phone', 'City', 'Partner', 'Stage', 'Engineer', 'Scheduled', 'Progress', 'Delay (Days)', 'Status'];
  const lines = rows.map((l) =>
    [l.name || '', l.phone || '', l.city || '', l._partnerName || '', stageLabel(l.installationStatus) || '', l.assignedEngineerName || '', fmtDate(l.scheduledDate) || '', `${l._completionPct || 0}%`, String(l._delayDays || 0), l._delayed ? 'Delayed' : 'On Track']
      .map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-indigo-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold tabular-nums text-[var(--color-text-muted)]">{pct}%</span>
    </div>
  );
}

function DelayBadge({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
      days <= 7 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
        days <= 30 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    )}>
      <AlertTriangle className="h-3 w-3" /> {days}d
    </span>
  );
}

const STAGE_OPTIONS = [
  { label: 'All Stages', value: '' },
  ...INSTALLATION_STAGES.map((s) => ({ label: stageLabel(s), value: s })),
];

const STATUS_OPTIONS = [
  { label: 'All Status', value: '' },
  { label: 'Delayed', value: 'delayed' },
  { label: 'On Track', value: 'ontrack' },
];

export default function Installations() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const qc = useQueryClient();
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ── Queries ──
  const { data: leads = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: partners = [] } = useQuery({
    queryKey: ['channel_partners_dropdown', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: projects = [] } = useQuery({
    queryKey: companyKeys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
    enabled: Boolean(activeCompanyId),
  });

  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 60_000,
  });

  // ── Filter state ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [stageF, setStageF] = useState(() => searchParams.get('stage') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('delay') || '');
  const [engineerF, setEngineerF] = useState(() => searchParams.get('engineer') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(10);

  // ── Date filter state ──
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ── Row selection state ──
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Bulk action state ──
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  const engineers = (users as any[]).filter((u) => ['Engineer', 'Installer', 'Technician'].includes(u.role));

  // ── Filter active installations ──
  const installations = useMemo(() => {
    return (leads as any[])
      .filter((l: any) => isValidInstallation(l))
      .map((l: any) => {
        const delayed = isInstallationDelayed(l.installationStatus, l.expectedCompletionDate, l.scheduledDate);
        const project = l.projectId ? projects.find((p: any) => p.id === l.projectId || p.projectId === l.projectId) : undefined;
        return {
          ...l,
          _stageLabel: stageLabel(l.installationStatus),
          _completionPct: calculateCompletion(l.installationStatus),
          _delayed: delayed,
          _delayDays: delayed ? delayDays(l.installationStatus, l.expectedCompletionDate, l.scheduledDate) : 0,
          _partnerName: l.partnerName || partners.find((p: any) => p.id === l.partnerId)?.firmName || '—',
          _projectName: project?.projectId || l.projectName || '—',
        };
      })
      .sort((a: any, b: any) => {
        if (a._delayed !== b._delayed) return a._delayed ? -1 : 1;
        const da = a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
        const db = b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
        return db - da;
      });
  }, [leads, partners, projects]);

  // ── KPIs ──
  const kpis = useMemo(() => ({
    total: installations.length,
    active: installations.filter((l: any) => l.installationStatus !== 'completed').length,
    delayed: installations.filter((l: any) => l._delayed).length,
    completed: installations.filter((l: any) => l.installationStatus === 'completed').length,
    inProgress: installations.filter((l: any) => {
      const s = l.installationStatus;
      return s === 'installation_started' || s === 'installation_in_progress' || s === 'quality_inspection';
    }).length,
    delayedCritical: installations.filter((l: any) => l._delayed && l._delayDays > 30).length,
  }), [installations]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = [...installations];

    // KPI filter
    if (activeKpi === 'active') list = list.filter((l: any) => l.installationStatus !== 'completed');
    else if (activeKpi === 'delayed') list = list.filter((l: any) => l._delayed);
    else if (activeKpi === 'completed') list = list.filter((l: any) => l.installationStatus === 'completed');
    else if (activeKpi === 'inProgress') list = list.filter((l: any) => {
      const s = l.installationStatus;
      return s === 'installation_started' || s === 'installation_in_progress' || s === 'quality_inspection';
    });
    else if (activeKpi === 'delayedCritical') list = list.filter((l: any) => l._delayed && l._delayDays > 30);

    // Search
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((l: any) =>
        [l.name, l.phone, l.city, l._partnerName, l.assignedEngineerName]
          .some((v: any) => String(v || '').toLowerCase().includes(q)),
      );
    }

    // Stage filter
    if (stageF) list = list.filter((l: any) => l.installationStatus === stageF);

    // Status filter (delay)
    if (statusF === 'delayed') list = list.filter((l: any) => l._delayed);
    else if (statusF === 'ontrack') list = list.filter((l: any) => !l._delayed && l.installationStatus !== 'completed');

    // Engineer filter
    if (engineerF) list = list.filter((l: any) => l.assignedEngineerId === engineerF || l.assignedEngineerName === engineerF);

    // Date range filter
    if (dateRange !== 'all') list = list.filter((l: any) => isInDateRange(l.createdAt, dateRange as any, customFrom, customTo));

    return list;
  }, [installations, search, stageF, statusF, engineerF, dateRange, customFrom, customTo, activeKpi]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const isTotalDefault = !activeKpi && !search && !stageF && !statusF && !engineerF && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', stageF ? stageF : '', statusF ? statusF : '', engineerF ? 'engineer' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: kpis.total, icon: <LayoutDashboard className="h-4 w-4" />, desc: `${installations.length} total projects` },
    { key: 'active', label: 'ACTIVE', value: kpis.active, icon: <Activity className="h-4 w-4" />, desc: 'In progress' },
    { key: 'inProgress', label: 'IN PROGRESS', value: kpis.inProgress, icon: <Wrench className="h-4 w-4" />, desc: 'On-site work' },
    { key: 'completed', label: 'COMPLETED', value: kpis.completed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Successfully completed' },
    { key: 'delayed', label: 'DELAYED', value: kpis.delayed, icon: <Clock className="h-4 w-4" />, desc: 'Past deadline' },
    { key: 'delayedCritical', label: 'CRITICAL', value: kpis.delayedCritical, icon: <AlertTriangle className="h-4 w-4" />, desc: 'Over 30 days delayed' },
  ], [kpis, installations.length]);

  // ── Bulk actions ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map((id) => assignEngineer(id, userId, userName)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: companyKeys.leadsAll }); toast.success(`Assigned ${selectedRows.size} installations to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.LEADS, id)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: companyKeys.leadsAll }); toast.success(`Deleted ${selectedRows.size} installations`); setDelId(null); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  function syncParams(next: Record<string, string>) {
    const p = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); });
    setSearchParams(p, { replace: true });
  }

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
  }

  function clearFilters() {
    setSearch(''); setStageF(''); setStatusF(''); setEngineerF(''); setActiveKpi(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
    setSearchParams({});
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    setSelectedRows((prev) => prev.size === paginated.length ? new Set() : new Set(paginated.map((l) => l.id)));
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = installations.filter((l: any) => selectedRows.has(l.id));
    if (!rows.length) return toast.error('No installations selected');
    downloadInstallationsCsv(rows, `installations-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} installation${rows.length > 1 ? 's' : ''}`);
  }

  // Row click / ID / View now open the full /installations/:id record
  // workspace page — the read-only installation detail modal was retired
  // (Installation Workspace Migration; the Installation stage's operational
  // workspace lives inside the Project Workspace, Stage 8).
  function openInstallation(installation: any) {
    navigate(`/installations/${encodeURIComponent(installation?.id || '')}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, installation: any) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openInstallation(installation);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, installation: any) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openInstallation(installation);
  }

  function stageBadge(status: string) {
    const variant = status === 'completed' ? 'success' as const : status === 'quality_inspection' ? 'warning' as const : 'info' as const;
    return <Badge variant={variant}>{stageLabel(status)}</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<HardHat className="h-4 w-4" />}
        breadcrumbs={['Home', 'Operations', 'Installations']} title="Installations"
        statusText="Field Operations" statusDotColor="bg-[var(--color-success)]"
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : k.key;
              setActiveKpi(nextKpi);
              setPage(1);
              syncParams({ kpi: nextKpi, page: '1' });
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
                placeholder="Search installations, partner, engineer..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncParams({ q: e.target.value, page: '1' }); }}
              />
            </div>
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); syncParams({ from: e.target.value, date: 'custom', page: '1' }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); syncParams({ to: e.target.value, date: 'custom', page: '1' }); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={stageF} onChange={(e) => { setStageF(e.target.value); setPage(1); syncParams({ stage: e.target.value, page: '1' }); }} options={STAGE_OPTIONS} className="h-8 min-w-[130px] py-1" />
            <UiSelect value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); syncParams({ delay: e.target.value, page: '1' }); }} options={STATUS_OPTIONS} className="h-8 min-w-[110px] py-1" />
            <UiSelect value={engineerF} onChange={(e) => { setEngineerF(e.target.value); setPage(1); syncParams({ engineer: e.target.value, page: '1' }); }} options={[{ label: 'All Engineers', value: '' }, ...engineers.map((u: any) => ({ label: u.name || u.email, value: u.id }))]} className="h-8 min-w-[130px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} installation{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedRows.size} installation{selectedRows.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('installations') && (
                <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>
              )}
              {perms.canDelete('installations') && (
                <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>
              )}
              <button onClick={() => setSelectedRows(new Set())} className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* TABLE AREA */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible installations" />
                </Th>
                <Th style={{ width: '18%', minWidth: 160 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 130 }}>Stage</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>Engineer</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>Scheduled</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>Progress</Th>
                <Th style={{ width: '12%', minWidth: 120 }}>Partner</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>Delay</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={9} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center">
                      <EmptyState icon={<HardHat className="h-9 w-9" />}
                        title={search || stageF || statusF || activeKpi ? 'No installations match filters' : 'No installations yet'}
                        description={search || stageF || statusF || activeKpi ? undefined : 'Installations appear once a lead progresses to installation stage.'} />
                    </td></tr>
                  ) : paginated.map((inst: any) => (
                    <Tr key={inst.id} selected={selectedRows.has(inst.id)} data-record-id={inst.id} role="button" tabIndex={0}
                      onClick={(e) => handleRowClick(e, inst)} onKeyDown={(e) => handleRowKeyDown(e, inst)}>
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selectedRows.has(inst.id)} onChange={() => toggleSelect(inst.id)} ariaLabel={`Select ${inst.name}`} />
                      </Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                            {(inst.name || '?')[0].toUpperCase()}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{inst.name || '—'}</span>
                            <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">{inst.city || inst.phone || ''}</span>
                          </div>
                        </div>
                      </Td>
                      <Td className="py-3">{stageBadge(inst.installationStatus)}</Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)]">
                          <User className="h-3 w-3 text-[var(--color-text-muted)]" />
                          {inst.assignedEngineerName || '—'}
                        </div>
                      </Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{inst.scheduledDate ? fmtDate(inst.scheduledDate) : '—'}</Td>
                      <Td className="py-3"><ProgressBar pct={inst._completionPct} /></Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 text-[var(--color-text-muted)]" />
                          {inst._partnerName}
                        </div>
                      </Td>
                      <Td className="py-3">{inst._delayed ? <DelayBadge days={inst._delayDays} /> : <span className="text-[10px] text-[var(--color-text-muted)]">—</span>}</Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openInstallation(inst); }}>View</Button>
                      </Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        {filtered.length > perPage && (
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage}
              onChange={(nextPage) => setPage(nextPage)}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); }} />
          </div>
        )}
      </Card>

      {/* BULK ASSIGN MODAL */}
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign installations" size="sm">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Assign to engineer
            <select className={`${input} mt-1`} value={bulkAssignId} onChange={(e) => {
              const selectedUser = engineers.find((u: any) => u.id === e.target.value);
              setBulkAssignId(e.target.value);
              setBulkAssignName(selectedUser?.name || selectedUser?.email || '');
            }}>
              <option value="">Select engineer</option>
              {engineers.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulkAssign(false)}>Cancel</Button>
            <Button size="sm" loading={bulkAssignMutation.isPending}
              onClick={() => bulkAssignMutation.mutate({ ids: Array.from(selectedRows), userId: bulkAssignId, userName: bulkAssignName })}>Assign</Button>
          </div>
        </div>
      </Modal>

      {/* CONFIRM DELETE */}
      <ConfirmDialog open={Boolean(delId)} onClose={() => setDelId(null)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedRows))}
        title="Delete installations" message={`Are you sure you want to delete ${selectedRows.size} installation${selectedRows.size > 1 ? 's' : ''}? This cannot be undone.`}
        loading={bulkDeleteMutation.isPending} />
    </div>
  );
}
