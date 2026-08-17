import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ClipboardCheck, Plus, RefreshCw, Search,
  XCircle, FolderKanban, UserCheck, Download, Users, Trash2,
  LayoutDashboard, Activity, Wrench, Clock, Eye,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../lib/firebase';
import { getAll, fmtDate, updateDocById, deleteDocById } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { createQCCheck, DEFAULT_QC_CHECKLIST, normalizeQCRecord, type QCRecord } from '../lib/qcWorkflow';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { cn } from '../utils/cn';

const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadQcCsv(rows: any[], filename: string) {
  const headers = ['QC ID', 'Project ID', 'Inspector', 'Status', 'Pass Rate', 'Passed', 'Failed', 'Total Items', 'Created'];
  const lines = rows.map((q) =>
    [q.id || '', q.projectId || '', q.inspectorName || '', q.status || '',
     q.totalItems > 0 ? `${Math.round((q.passedCount || 0) / q.totalItems * 100)}%` : '0%',
     String(q.passedCount || 0), String(q.failedCount || 0), String(q.totalItems || 0), fmtDate(q.createdAt) || '']
      .map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const STATUS_OPTIONS = [
  { label: 'All Status', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Passed', value: 'passed' },
  { label: 'Failed', value: 'failed' },
];

export default function QC() {
  const perms = usePermissions();
  const qcClient = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const user = useAppStore((s) => s.user);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ── Filter state ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [projectFilter, setProjectFilter] = useState(() => searchParams.get('projectId') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(10);

  // ── Date filter state ──
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ── Row selection state ──
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Modal state ──
  const [showCreate, setShowCreate] = useState(false);

  // ── Bulk action state ──
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  // ── Create QC form state ──
  const [createForm, setCreateForm] = useState({ projectId: '', installationId: '' });

  // ── Queries ──
  const qcQuery = useQuery({
    queryKey: keys.qcChecksAll,
    queryFn: () => getAll<QCRecord>(COLLECTIONS.QC_CHECKS),
    staleTime: 15_000,
  });

  const projectsQuery = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const installationsQuery = useQuery({
    queryKey: keys.installationsAll,
    queryFn: () => getAll<any>(COLLECTIONS.INSTALLATIONS),
    staleTime: 60_000,
  });

  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 60_000,
  });

  const qcData = useMemo(() => ((qcQuery.data || []) as QCRecord[]).map(normalizeQCRecord), [qcQuery.data]);
  const projects = (projectsQuery.data || []) as any[];
  const installations = (installationsQuery.data || []) as any[];

  const projectMap = useMemo(() => {
    const map = new Map<string, any>();
    projects.forEach((p: any) => { map.set(p.id, p); map.set(p.projectId, p); });
    return map;
  }, [projects]);

  const inspectors = (users as any[]).filter((u) => ['Admin', 'Manager', 'Inspector', 'Engineer'].includes(u.role));

  // ── KPIs ──
  const kpis = useMemo(() => ({
    total: qcData.length,
    pending: qcData.filter((q) => q.status === 'pending').length,
    inProgress: qcData.filter((q) => q.status === 'in_progress').length,
    passed: qcData.filter((q) => q.status === 'passed').length,
    failed: qcData.filter((q) => q.status === 'failed').length,
    passRate: qcData.length > 0 ? Math.round(qcData.filter((q) => q.status === 'passed').length / qcData.length * 100) : 0,
  }), [qcData]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = qcData;

    if (activeKpi === 'pending') list = list.filter((q) => q.status === 'pending');
    else if (activeKpi === 'inProgress') list = list.filter((q) => q.status === 'in_progress');
    else if (activeKpi === 'passed') list = list.filter((q) => q.status === 'passed');
    else if (activeKpi === 'failed') list = list.filter((q) => q.status === 'failed');

    const q = search.toLowerCase().trim();
    if (q) list = list.filter((qc) => qc.inspectorName?.toLowerCase().includes(q) || qc.projectId?.toLowerCase().includes(q) || qc.id?.toLowerCase().includes(q));

    if (statusF) list = list.filter((qc) => qc.status === statusF);
    if (projectFilter) list = list.filter((qc) => qc.projectId === projectFilter);

    if (dateRange !== 'all') list = list.filter((q) => isInDateRange(q.createdAt, dateRange as any, customFrom, customTo));

    return list.sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);
  }, [qcData, search, statusF, projectFilter, activeKpi, dateRange, customFrom, customTo]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const isTotalDefault = !activeKpi && !search && !statusF && !projectFilter && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', projectFilter ? 'project' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: kpis.total, icon: <LayoutDashboard className="h-4 w-4" />, desc: `${kpis.passRate}% pass rate` },
    { key: 'pending', label: 'PENDING', value: kpis.pending, icon: <Clock className="h-4 w-4" />, desc: 'Awaiting inspection' },
    { key: 'inProgress', label: 'IN PROGRESS', value: kpis.inProgress, icon: <Activity className="h-4 w-4" />, desc: 'Currently inspecting' },
    { key: 'passed', label: 'PASSED', value: kpis.passed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Quality approved' },
    { key: 'failed', label: 'FAILED', value: kpis.failed, icon: <XCircle className="h-4 w-4" />, desc: 'Requires rework' },
    { key: 'passRate', label: 'PASS RATE', value: `${kpis.passRate}%`, icon: <Wrench className="h-4 w-4" />, desc: 'Overall pass rate' },
  ], [kpis]);

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (input: { projectId: string; installationId?: string; installationName?: string }) =>
      createQCCheck({ ...input, inspectorId: user?.id || 'system', inspectorName: user?.name || 'System' }),
    onSuccess: () => { void qcClient.invalidateQueries({ queryKey: keys.qcChecksAll }); toast.success('QC check created'); setShowCreate(false); setCreateForm({ projectId: '', installationId: '' }); },
    onError: (err: any) => toast.error(err?.message || 'Failed to create QC check'),
  });

  // ── Bulk actions ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.QC_CHECKS, id, { inspectorId: userId, inspectorName: userName })));
    },
    onSuccess: () => { qcClient.invalidateQueries({ queryKey: keys.qcChecksAll }); toast.success(`Assigned ${selectedRows.size} QC checks to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.QC_CHECKS, id))); },
    onSuccess: () => { qcClient.invalidateQueries({ queryKey: keys.qcChecksAll }); toast.success(`Deleted ${selectedRows.size} QC checks`); setDelId(null); setSelectedRows(new Set()); },
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
    setSearch(''); setStatusF(''); setProjectFilter(''); setActiveKpi(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
    setSearchParams({});
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    setSelectedRows((prev) => prev.size === paginated.length ? new Set() : new Set(paginated.map((q) => q.id)));
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = qcData.filter((q) => selectedRows.has(q.id));
    if (!rows.length) return toast.error('No QC checks selected');
    downloadQcCsv(rows, `qc-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} QC check${rows.length > 1 ? 's' : ''}`);
  }

  // Row click / ID / View now open the full /qc/:id record workspace page —
  // the QC detail modal was retired (QC Workspace Migration; the QC stage's
  // operational workspace lives inside the Project Workspace, Stage 9).
  function openQc(qc: QCRecord) {
    navigate(`/qc/${encodeURIComponent(qc?.id || '')}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, qc: QCRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openQc(qc);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, qc: QCRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openQc(qc);
  }

  function statusBadge(status: string) {
    const variant = status === 'passed' ? 'success' as const : status === 'failed' ? 'danger' as const : status === 'in_progress' ? 'warning' as const : 'default' as const;
    return <Badge variant={variant}>{status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<ClipboardCheck className="h-4 w-4" />}
        breadcrumbs={['Home', 'Field Operations', 'Quality Checks']} title="Quality Checks"
        statusText="Field Operations" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => qcQuery.refetch()}>Refresh</Button>
            {perms.can('qc', 'create') && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>Create QC check</Button>
            )}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : (k.key === 'passRate' ? '' : k.key);
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
                placeholder="Search QC checks, inspector, project..." value={search}
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
            <UiSelect value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); syncParams({ status: e.target.value, page: '1' }); }} options={STATUS_OPTIONS} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); syncParams({ projectId: e.target.value, page: '1' }); }}
              options={[{ label: 'All Projects', value: '' }, ...projects.map((p: any) => ({ label: p.projectId || p.id, value: p.id }))]} className="h-8 min-w-[130px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} QC check{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedRows.size} QC check{selectedRows.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('qc') && (
                <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>
              )}
              {perms.canDelete('qc') && (
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
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible QC checks" />
                </Th>
                <Th style={{ width: '14%', minWidth: 120 }}>QC ID</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Inspector</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>Status</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Pass Rate</Th>
                <Th style={{ width: '12%', minWidth: 100 }}>Created</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {qcQuery.isLoading ? <SkeletonRows cols={8} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={8} className="py-14 text-center">
                      <EmptyState icon={<ClipboardCheck className="h-9 w-9" />}
                        title={search || statusF || projectFilter || activeKpi ? 'No QC checks match filters' : 'No QC checks yet'}
                        description={search || statusF || projectFilter || activeKpi ? undefined : 'Create the first QC check to get started.'} />
                    </td></tr>
                  ) : paginated.map((qc) => {
                    const project = projectMap.get(qc.projectId);
                    const totalItems = qc.totalItems || qc.checklistItems.length;
                    const passRate = totalItems > 0 ? Math.round((qc.passedCount || 0) / totalItems * 100) : 0;
                    return (
                      <Tr key={qc.id} selected={selectedRows.has(qc.id)} data-record-id={qc.id} role="button" tabIndex={0}
                        onClick={(e) => handleRowClick(e, qc)} onKeyDown={(e) => handleRowKeyDown(e, qc)}>
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selectedRows.has(qc.id)} onChange={() => toggleSelect(qc.id)} ariaLabel={`Select QC ${qc.id}`} />
                        </Td>
                        <Td className="py-3"><span className="text-sm font-mono font-medium text-[var(--color-text)]">{qc.id.slice(-8)}</span></Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <FolderKanban className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                            <span className="text-sm text-[var(--color-text-secondary)]">{project?.projectId || qc.projectId}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <UserCheck className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                            <span className="text-sm text-[var(--color-text-secondary)]">{qc.inspectorName}</span>
                          </div>
                        </Td>
                        <Td className="py-3">{statusBadge(qc.status)}</Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-[var(--color-bg-sunken)]">
                              <div className={cn('h-full rounded-full', passRate >= 80 ? 'bg-emerald-500' : passRate >= 50 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${passRate}%` }} />
                            </div>
                            <span className="text-[10px] text-[var(--color-text-muted)]">{passRate}%</span>
                          </div>
                        </Td>
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{fmtDate(qc.createdAt)}</Td>
                        <Td className="py-3" align="right">
                          <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); openQc(qc); }}>View</Button>
                        </Td>
                      </Tr>
                    );
                  })}
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
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign QC checks" size="sm">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Assign to inspector
            <select className={`${input} mt-1`} value={bulkAssignId} onChange={(e) => {
              const selectedUser = inspectors.find((u: any) => u.id === e.target.value);
              setBulkAssignId(e.target.value);
              setBulkAssignName(selectedUser?.name || selectedUser?.email || '');
            }}>
              <option value="">Select inspector</option>
              {inspectors.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
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
        title="Delete QC checks" message={`Are you sure you want to delete ${selectedRows.size} QC check${selectedRows.size > 1 ? 's' : ''}?`}
        loading={bulkDeleteMutation.isPending} />

      {/* CREATE QC MODAL */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateForm({ projectId: '', installationId: '' }); }} title="New Quality Check" size="lg">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Project
            <select className={`${input} mt-1`} value={createForm.projectId} onChange={(e) => setCreateForm((f) => ({ ...f, projectId: e.target.value }))}>
              <option value="">Select project</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.projectId || p.id}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Installation (optional)
            <select className={`${input} mt-1`} value={createForm.installationId} onChange={(e) => setCreateForm((f) => ({ ...f, installationId: e.target.value }))}>
              <option value="">No specific installation</option>
              {installations.filter((inst: any) => !createForm.projectId || inst.projectId === createForm.projectId).map((inst: any) => (
                <option key={inst.id} value={inst.id}>{projectMap.get(inst.projectId)?.projectId || inst.projectId || inst.id}</option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-[var(--color-text-muted)]">QC will be initialized with the standard {DEFAULT_QC_CHECKLIST.length}-item inspection checklist.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowCreate(false); setCreateForm({ projectId: '', installationId: '' }); }}>Cancel</Button>
            <Button size="sm" loading={createMutation.isPending}
              onClick={() => {
                if (!createForm.projectId) { toast.error('Please select a project'); return; }
                createMutation.mutate({
                  projectId: createForm.projectId,
                  installationId: createForm.installationId || undefined,
                  installationName: createForm.installationId
                    ? (() => {
                        const inst = installations.find((i: any) => i.id === createForm.installationId);
                        return inst ? (projectMap.get(inst.projectId)?.projectId || inst.projectId) : undefined;
                      })()
                    : undefined,
                });
              }}>Create QC Check</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
