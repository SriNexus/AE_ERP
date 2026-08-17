/**
 * Commissioning — Commissioning List Page (Desktop Gold Standard)
 *
 * Matches Leads workspace layout exactly.
 * - WorkspaceHero, 6 PremiumKpi, Search + Filters, Table with checkboxes,
 *   Bulk actions (Export/Assign/Delete), Pagination, Detail Modal, Create Modal,
 *   URL sync, Loading/Empty states, Keyboard navigation.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Zap,
  Plus,
  RefreshCw,
  Search,
  FolderKanban,
  UserCheck,
  Calendar,
  Shield,
  Download,
  Users,
  Trash2,
  Eye,
  Clock,
  Activity,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../lib/firebase';
import { getAll, fmtDate, deleteDocById, resolveWriteCompanyId } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { createCommissioningRecord, reassignCommissioning } from '../lib/commissioningWorkflow';
import type { CommissioningRecord } from '../lib/commissioningWorkflow';
import { usePermissions } from '../lib/permissions';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SignatureCapture } from '../components/commissioning/SignatureCapture';

const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadCsv(rows: any[], filename: string) {
  const headers = ['ID', 'Project', 'Commissioned By', 'Generation (kWh)', 'Status', 'Warranty (mo)', 'Customer Signoff', 'Date'];
  const lines = rows.map((r) =>
    [r.id || '', r.projectName || r.projectId || '', r.commissionedByName || '', String(r.generationTestKwh || 0),
     r.isCompleted ? 'Completed' : 'Pending', String(r.warrantyMonths || ''), r.customerSignoff ? 'Yes' : 'No', fmtDate(r.commissionedDate) || '']
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
  { label: 'Completed', value: 'completed' },
  { label: 'Pending', value: 'pending' },
];

export default function Commissioning() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const user = useAppStore((s) => s.user);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ── Filter state ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [projectFilter, setProjectFilter] = useState(() => searchParams.get('projectId') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
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

  // ── Signature capture state ──
  const [signatureUrl, setSignatureUrl] = useState<string>('');
  const signatureUrlRef = useRef(signatureUrl);
  signatureUrlRef.current = signatureUrl;

  // ── Create form state ──
  const [form, setForm] = useState({
    projectId: '',
    generationTestKwh: '',
    customerName: '',
    warrantyStartDate: '',
    warrantyMonths: '60',
    notes: '',
  });

  // ── Queries ──
  const commissioningQuery = useQuery({
    queryKey: keys.commissioningRecordsAll,
    queryFn: () => getAll<CommissioningRecord>(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 15_000,
  });

  const projectsQuery = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 60_000,
  });

  const commissioningData = useMemo(() => (commissioningQuery.data || []) as CommissioningRecord[], [commissioningQuery.data]);
  const projects = useMemo(() => (projectsQuery.data || []) as any[], [projectsQuery.data]);
  const usersList = useMemo(() => (usersQuery.data || []) as any[], [usersQuery.data]);

  const projectMap = useMemo(() => {
    const map = new Map<string, any>();
    projects.forEach((p: any) => { map.set(p.id, p); map.set(p.projectId, p); });
    return map;
  }, [projects]);

  const assignableUsers = useMemo(() =>
    usersList.filter((u: any) => ['Admin', 'Manager', 'Engineer', 'Technician'].includes(u.role)),
    [usersList],
  );

  const pendingCommissioningProjects = useMemo(() =>
    projects.filter((p: any) => p.currentStage === 'Commissioning'),
    [projects],
  );

  // ── KPIs ──
  const kpis = useMemo(() => ({
    total: commissioningData.length,
    completed: commissioningData.filter((r) => r.isCompleted).length,
    pending: commissioningData.filter((r) => !r.isCompleted).length,
    avgGeneration: commissioningData.length > 0
      ? Math.round(commissioningData.reduce((s, r) => s + r.generationTestKwh, 0) / commissioningData.length)
      : 0,
    signoffs: commissioningData.filter((r) => r.customerSignoff).length,
    warrantyActive: commissioningData.filter((r) => r.warrantyMonths && r.warrantyMonths > 0).length,
  }), [commissioningData]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = commissioningData;

    if (activeKpi === 'completed') list = list.filter((r) => r.isCompleted);
    else if (activeKpi === 'pending') list = list.filter((r) => !r.isCompleted);
    else if (activeKpi === 'signoffs') list = list.filter((r) => r.customerSignoff);
    else if (activeKpi === 'warrantyActive') list = list.filter((r) => r.warrantyMonths && r.warrantyMonths > 0);

    const q = search.toLowerCase().trim();
    if (q) list = list.filter((r) =>
      r.projectName?.toLowerCase().includes(q) ||
      r.id?.toLowerCase().includes(q) ||
      r.commissionedByName?.toLowerCase().includes(q),
    );

    if (projectFilter) list = list.filter((r) => r.projectId === projectFilter);
    if (statusF === 'completed') list = list.filter((r) => r.isCompleted);
    else if (statusF === 'pending') list = list.filter((r) => !r.isCompleted);

    if (dateRange !== 'all') list = list.filter((r) => isInDateRange(r.createdAt, dateRange as any, customFrom, customTo));

    return list.sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);
  }, [commissioningData, search, projectFilter, statusF, activeKpi, dateRange, customFrom, customTo]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const isTotalDefault = !activeKpi && !search && !statusF && !projectFilter && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', projectFilter ? 'project' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: kpis.total, icon: <Activity className="h-4 w-4" />, desc: `${kpis.completed} completed` },
    { key: 'completed', label: 'COMPLETED', value: kpis.completed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Signed off' },
    { key: 'pending', label: 'PENDING', value: kpis.pending + pendingCommissioningProjects.length, icon: <Clock className="h-4 w-4" />, desc: 'Awaiting sign-off' },
    { key: '', label: 'AVG GENERATION', value: `${kpis.avgGeneration} kWh`, icon: <Zap className="h-4 w-4" />, desc: 'Per system' },
    { key: 'signoffs', label: 'SIGNOFFS', value: kpis.signoffs, icon: <Shield className="h-4 w-4" />, desc: 'Customer confirmed' },
    { key: 'warrantyActive', label: 'WARRANTY', value: kpis.warrantyActive, icon: <Calendar className="h-4 w-4" />, desc: 'Active warranty' },
  ], [kpis, pendingCommissioningProjects.length]);

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (input: {
      projectId: string;
      generationTestKwh: number;
      customerName?: string;
      warrantyStartDate?: string;
      warrantyMonths?: number;
      notes?: string;
    }) => {
      const project = projects.find((p: any) => p.id === input.projectId || p.projectId === input.projectId);
      const currentSignatureUrl = signatureUrlRef.current;
      return createCommissioningRecord({
        projectId: input.projectId,
        projectName: project?.projectId || input.projectId,
        generationTestKwh: input.generationTestKwh,
        commissionedByName: user?.name || 'System',
        customerName: input.customerName,
        customerSignoff: true,
        customerSignoffUrl: currentSignatureUrl,
        warrantyStartDate: input.warrantyStartDate,
        warrantyMonths: input.warrantyMonths,
        notes: input.notes,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.commissioningRecordsAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Commissioning completed successfully');
      setShowCreate(false);
      setForm({ projectId: '', generationTestKwh: '', customerName: '', warrantyStartDate: '', warrantyMonths: '60', notes: '' });
      setSignatureUrl('');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to complete commissioning'),
  });

  // ── Bulk actions ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map((id) => reassignCommissioning(id, userId, userName)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.commissioningRecordsAll }); toast.success(`Assigned ${selectedRows.size} records to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.COMMISSIONING_RECORDS, id))); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.commissioningRecordsAll }); toast.success(`Deleted ${selectedRows.size} records`); setDelId(null); setSelectedRows(new Set()); },
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
    setSearch(''); setProjectFilter(''); setStatusF(''); setActiveKpi(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
    setSearchParams({});
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    setSelectedRows((prev) => prev.size === paginated.length ? new Set() : new Set(paginated.map((r) => r.id)));
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = commissioningData.filter((r) => selectedRows.has(r.id));
    if (!rows.length) return toast.error('No records selected');
    downloadCsv(rows, `commissioning-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} record${rows.length > 1 ? 's' : ''}`);
  }

  // Row click / ID / View now open the full /commissioning/:id record
  // workspace page — the read-only commissioning detail modal was retired
  // (Commissioning Workspace Migration; the Commissioning stage's operational
  // workspace lives inside the Project Workspace, Stage 10).
  function openCommissioning(record: CommissioningRecord) {
    navigate(`/commissioning/${encodeURIComponent(record?.id || '')}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, record: CommissioningRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openCommissioning(record);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, record: CommissioningRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openCommissioning(record);
  }

  function statusBadge(record: CommissioningRecord) {
    if (record.isCompleted) return <Badge variant="success">Completed</Badge>;
    return <Badge variant="default">Pending</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<Zap className="h-4 w-4" />}
        breadcrumbs={['Home', 'Field Operations', 'Commissioning']} title="Commissioning"
        statusText="Field Operations" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => commissioningQuery.refetch()}>Refresh</Button>
            {perms.can('commissioning', 'create') && pendingCommissioningProjects.length > 0 && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>Create record</Button>
            )}
          </>
        }
      />

      {/* Pending Alert */}
      {pendingCommissioningProjects.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 px-3 py-2 text-xs">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-700 dark:text-amber-300 font-medium">
            {pendingCommissioningProjects.length} project{pendingCommissioningProjects.length !== 1 ? 's' : ''} ready for commissioning
          </span>
          {perms.can('commissioning', 'create') && (
            <button onClick={() => setShowCreate(true)} className="ml-auto text-xs text-amber-700 dark:text-amber-300 font-semibold hover:underline">
              Commission now
            </button>
          )}
        </div>
      )}

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi key={k.key || 'total'} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : k.key;
              if (k.key === '' && isTotalDefault) return;
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
                placeholder="Search commissioning records..." value={search}
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
            <UiSelect value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); syncParams({ status: e.target.value, page: '1' }); }} options={[{ label: 'All Status', value: '' }, { label: 'Completed', value: 'completed' }, { label: 'Pending', value: 'pending' }]} className="h-8 min-w-[110px] py-1" />
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
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} record{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedRows.size} record{selectedRows.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('commissioning') && (
                <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>
              )}
              {perms.canDelete('commissioning') && (
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
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible records" />
                </Th>
                <Th style={{ width: '14%', minWidth: 120 }}>ID</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Commissioned By</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>Generation Test</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>Status</Th>
                <Th style={{ width: '10%', minWidth: 80 }}>Warranty</Th>
                <Th style={{ width: '12%', minWidth: 100 }}>Date</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {commissioningQuery.isLoading ? <SkeletonRows cols={9} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={9} className="py-14 text-center">
                      <EmptyState icon={<Zap className="h-9 w-9" />}
                        title={search || projectFilter || activeKpi ? 'No records match filters' : 'No commissioning records yet'}
                        description={search || projectFilter || activeKpi ? undefined : 'Complete a QC check and commission the first project to get started.'} />
                    </td></tr>
                  ) : paginated.map((record) => {
                    const project = projectMap.get(record.projectId);
                    return (
                      <Tr key={record.id} selected={selectedRows.has(record.id)} data-record-id={record.id} role="button" tabIndex={0}
                        onClick={(e) => handleRowClick(e, record)} onKeyDown={(e) => handleRowKeyDown(e, record)}>
                        <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox checked={selectedRows.has(record.id)} onChange={() => toggleSelect(record.id)} ariaLabel={`Select record ${record.id}`} />
                        </Td>
                        <Td className="py-3"><span className="text-sm font-mono font-medium text-[var(--color-text)]">{record.id.slice(-8)}</span></Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <FolderKanban className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                            <span className="text-sm text-[var(--color-text-secondary)]">{record.projectName || project?.projectId || record.projectId}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <UserCheck className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                            <span className="text-sm text-[var(--color-text-secondary)]">{record.commissionedByName}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            <Zap className="h-3 w-3" />{record.generationTestKwh} kWh
                          </span>
                        </Td>
                        <Td className="py-3">{statusBadge(record)}</Td>
                        <Td className="py-3 text-sm text-[var(--color-text-secondary)]">{record.warrantyMonths ? `${record.warrantyMonths} mo` : '—'}</Td>
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{fmtDate(record.commissionedDate)}</Td>
                        <Td className="py-3" align="right">
                          <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); openCommissioning(record); }}>View</Button>
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
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign records" size="sm">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Assign to engineer
            <select className={`${input} mt-1`} value={bulkAssignId} onChange={(e) => {
              const u = assignableUsers.find((u: any) => u.id === e.target.value);
              setBulkAssignId(e.target.value);
              setBulkAssignName(u?.name || u?.email || '');
            }}>
              <option value="">Select user</option>
              {assignableUsers.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
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
        title="Delete records" message={`Are you sure you want to delete ${selectedRows.size} record${selectedRows.size > 1 ? 's' : ''}?`}
        loading={bulkDeleteMutation.isPending} />

      {/* CREATE COMMISSIONING MODAL */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setForm({ projectId: '', generationTestKwh: '', customerName: '', warrantyStartDate: '', warrantyMonths: '60', notes: '' }); setSignatureUrl(''); }} title="New Commissioning Record" size="lg">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Project *</label>
            <select className={`${input} mt-1`} value={form.projectId}
              onChange={(e) => {
                const project = projects.find((p: any) => p.id === e.target.value);
                setForm((f) => ({ ...f, projectId: e.target.value, customerName: project?.customerId || '' }));
              }}>
              <option value="">Select project</option>
              {pendingCommissioningProjects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.projectId || p.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Generation Test (kWh) *</label>
            <input type="number" min="0.1" step="0.1" value={form.generationTestKwh}
              onChange={(e) => setForm((f) => ({ ...f, generationTestKwh: e.target.value }))}
              placeholder="e.g. 5.2" className={`${input} mt-1`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Customer Name</label>
            <input type="text" value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              placeholder="Customer name for sign-off" className={`${input} mt-1`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Warranty Start</label>
              <input type="date" value={form.warrantyStartDate}
                onChange={(e) => setForm((f) => ({ ...f, warrantyStartDate: e.target.value }))}
                className={`${input} mt-1`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Warranty (months)</label>
              <input type="number" min="0" value={form.warrantyMonths}
                onChange={(e) => setForm((f) => ({ ...f, warrantyMonths: e.target.value }))}
                className={`${input} mt-1`} />
            </div>
          </div>
          <SignatureCapture
            companyId={resolveWriteCompanyId()}
            onUploadComplete={setSignatureUrl}
            onUploadError={(err) => toast.error(err?.message || 'Signature upload failed')}
          />
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes" rows={2}
              className={`${input} mt-1 resize-none`} />
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">⚠️ Commissioning is a single sign-off action and cannot be modified after creation.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowCreate(false); setForm({ projectId: '', generationTestKwh: '', customerName: '', warrantyStartDate: '', warrantyMonths: '60', notes: '' }); setSignatureUrl(''); }}>Cancel</Button>
            <Button size="sm" loading={createMutation.isPending}
              onClick={() => {
                if (!form.projectId) { toast.error('Please select a project'); return; }
                if (!form.generationTestKwh || parseFloat(form.generationTestKwh) <= 0) {
                  toast.error('Generation test reading must be > 0'); return;
                }
                if (!signatureUrl) { toast.error('Please upload customer signature'); return; }
                createMutation.mutate({
                  projectId: form.projectId,
                  generationTestKwh: parseFloat(form.generationTestKwh),
                  customerName: form.customerName || undefined,
                  warrantyStartDate: form.warrantyStartDate || undefined,
                  warrantyMonths: form.warrantyMonths ? parseInt(form.warrantyMonths) : undefined,
                  notes: form.notes || undefined,
                });
              }}>
              {createMutation.isPending ? 'Recording...' : 'Complete Commissioning'}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
