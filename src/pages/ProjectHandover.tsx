/**
 * ProjectHandover.tsx — Desktop Project Handover page (Desktop Gold Standard)
 *
 * Matches Leads workspace layout exactly.
 * - WorkspaceHero, 6 PremiumKpi, Search + Filters, Table with checkboxes,
 *   Bulk actions (Export/Assign/Delete), Pagination, Detail Modal, Create Modal,
 *   Status transitions, Timeline, URL sync, Loading/Empty states, Keyboard navigation.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  FileText,
  Handshake,
  Plus,
  RefreshCw,
  Search,
  X,
  FolderKanban,
  UserCheck,
  Calendar,
  Download,
  Users,
  Trash2,
  Eye,
  Activity,
} from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../lib/firebase';
import { getAll, deleteDocById, fmtDate } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { useCreateHandover, useProjectHandovers } from '../features/project-handover/hooks/useProjectHandover';
import type { HandoverCreateInput, HandoverRecord } from '../lib/projectHandoverWorkflow';
import { reassignHandoverEngineer } from '../lib/projectHandoverWorkflow';
import { usePermissions } from '../lib/permissions';
import { useProjects } from '../features/projects/hooks/useProjects';
import { useCustomers } from '../features/customers/hooks/useCustomers';
import { resolveProjectCustomerName } from '../features/projects/utils/projectDisplay';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadCsv(rows: any[], filename: string) {
  const headers = ['Handover ID', 'Customer', 'Project', 'Date', 'Engineer', 'Status', 'Notes'];
  const lines = rows.map((r) =>
    [r.handoverNumber || r.id || '', r.customerName || '', r.projectName || '', fmtDate(r.handoverDate) || '',
     r.assignedEngineerName || '', r.status || '', (r.notes || '').replace(/"/g, '""')]
      .map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const HANDOVER_STATUSES: { label: string; value: string }[] = [
  { label: 'All Statuses', value: '' },
  { label: 'Draft', value: 'Draft' },
  { label: 'Scheduled', value: 'Scheduled' },
  { label: 'Completed', value: 'Completed' },
  { label: 'Cancelled', value: 'Cancelled' },
];

function statusBadge(status: string) {
  const variant = status === 'Completed' ? 'success' as const
    : status === 'Scheduled' ? 'warning' as const
    : status === 'Cancelled' ? 'danger' as const
    : 'default' as const;
  return <Badge variant={variant}>{status}</Badge>;
}

export default function ProjectHandover() {
  const perms = usePermissions();
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // ── Filter state ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
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

  // ── Modal state ──
  const [showForm, setShowForm] = useState(false);

  // ── Bulk action state ──
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  // ── Create form state ──
  const [form, setForm] = useState<HandoverCreateInput>({
    projectId: '',
    projectName: '',
    customerId: '',
    customerName: '',
    handoverDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  // ── Queries ──
  const { data: handovers = [], isLoading, refetch } = useProjectHandovers();
  const { data: projects = [] } = useProjects();
  const { data: customers = [] } = useCustomers();
  const createMut = useCreateHandover();

  // ── Users for bulk assign ──
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 60_000,
  });

  // Actually fix: need to import getAll directly above
  // Fixed: already imported from firestore but not getAll for users
  // Let me use a safe approach

  // ── Data ──
  const handoverList = useMemo(() => (handovers || []) as HandoverRecord[], [handovers]);

  const eligibleProjects = useMemo(() =>
    (projects as any[]).filter((p: any) =>
      ['NetMetering', 'Subsidy', 'Handover'].includes(p.currentStage)
    ), [projects]);

  const assignableUsers = useMemo(() =>
    (users as any[]).filter((u: any) => ['Admin', 'Manager', 'Engineer', 'Technician'].includes(u.role)),
    [users]);

  // ── KPIs ──
  const stats = useMemo(() => ({
    total: handoverList.length,
    completed: handoverList.filter((h) => h.status === 'Completed').length,
    scheduled: handoverList.filter((h) => h.status === 'Scheduled').length,
    draft: handoverList.filter((h) => h.status === 'Draft').length,
    cancelled: handoverList.filter((h) => h.status === 'Cancelled').length,
    pendingHandover: handoverList.filter((h) => h.status !== 'Completed' && h.status !== 'Cancelled').length,
  }), [handoverList]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = handoverList;

    if (activeKpi === 'completed') list = list.filter((h) => h.status === 'Completed');
    else if (activeKpi === 'scheduled') list = list.filter((h) => h.status === 'Scheduled');
    else if (activeKpi === 'draft') list = list.filter((h) => h.status === 'Draft');
    else if (activeKpi === 'cancelled') list = list.filter((h) => h.status === 'Cancelled');
    else if (activeKpi === 'pending') list = list.filter((h) => h.status !== 'Completed' && h.status !== 'Cancelled');

    const q = search.toLowerCase().trim();
    if (q) list = list.filter((h) =>
      [h.id, h.handoverNumber, h.customerName, h.projectName, h.assignedEngineerName]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );

    if (statusF) list = list.filter((h) => h.status === statusF);
    if (engineerF) list = list.filter((h) => h.assignedEngineer === engineerF || h.assignedEngineerName === engineerF);

    if (dateRange !== 'all') list = list.filter((h) => isInDateRange(h.createdAt, dateRange as any, customFrom, customTo));

    return list.sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);
  }, [handoverList, search, statusF, engineerF, activeKpi, dateRange, customFrom, customTo]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const isTotalDefault = !activeKpi && !search && !statusF && !engineerF && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', engineerF ? 'engineer' : '', activeKpi ? activeKpi : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: '', label: 'TOTAL', value: stats.total, icon: <Activity className="h-4 w-4" />, desc: `${stats.completed} completed` },
    { key: 'completed', label: 'COMPLETED', value: stats.completed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Fully handed over' },
    { key: 'scheduled', label: 'SCHEDULED', value: stats.scheduled, icon: <Calendar className="h-4 w-4" />, desc: 'Handover scheduled' },
    { key: 'draft', label: 'DRAFT', value: stats.draft, icon: <FileText className="h-4 w-4" />, desc: 'Awaiting schedule' },
    { key: 'pending', label: 'PENDING', value: stats.pendingHandover, icon: <Clock className="h-4 w-4" />, desc: 'Not yet completed' },
    { key: 'cancelled', label: 'CANCELLED', value: stats.cancelled, icon: <X className="h-4 w-4" />, desc: 'Cancelled' },
  ], [stats]);

  // ── Form helpers ──
  function resetForm() {
    setForm({
      projectId: '',
      projectName: '',
      customerId: '',
      customerName: '',
      handoverDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
  }

  function handleProjectSelect(projectId: string) {
    const project = (projects as any[]).find((p: any) => p.id === projectId);
    setForm({
      ...form,
      projectId,
      projectName: project?.projectId || project?.name || projectId,
      customerId: project?.customerId || '',
      customerName: resolveProjectCustomerName(project, customers as Array<Record<string, unknown>>),
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createMut.isPending) return;
    if (!form.projectId) return toast.error('Please select a project');
    if (!form.customerName) return toast.error('Customer name is required');
    if (!form.handoverDate) return toast.error('Handover date is required');
    createMut.mutate(form, { onSuccess: () => { setShowForm(false); resetForm(); } });
  }

  // ── Bulk actions ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map((id) => reassignHandoverEngineer(id, userId, userName)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.projectHandovers }); toast.success(`Assigned ${selectedRows.size} handover(s) to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => { await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.PROJECT_HANDOVERS, id))); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.projectHandovers }); toast.success(`Deleted ${selectedRows.size} handover(s)`); setDelId(null); setSelectedRows(new Set()); },
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
    setSearch(''); setStatusF(''); setEngineerF(''); setActiveKpi(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
    setSearchParams({});
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    setSelectedRows((prev) => prev.size === paginated.length ? new Set() : new Set(paginated.map((h) => h.id)));
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = handoverList.filter((h) => selectedRows.has(h.id));
    if (!rows.length) return toast.error('No handovers selected');
    downloadCsv(rows, `handover-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} handover(s)`);
  }

  // Row click / View opens the real handover workspace route — the detail
  // modal was retired when the Handover stage moved into the Project
  // Workspace (see ProjectHandoverWorkspace.tsx).
  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, record: HandoverRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    navigate(`/handovers/${encodeURIComponent(record.id)}`);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, record: HandoverRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    navigate(`/handovers/${encodeURIComponent(record.id)}`);
  }

  // ── Render ──
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<Handshake className="h-4 w-4" />}
        breadcrumbs={['Home', 'Field Operations', 'Project Handover']} title="Project Handover"
        statusText="Field Operations" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>Refresh</Button>
            {perms.canEdit('projects') && eligibleProjects.length > 0 && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { resetForm(); setShowForm(true); }}>Create handover</Button>
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
                placeholder="Search handovers, customer, project..." value={search}
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
            <UiSelect value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); syncParams({ status: e.target.value, page: '1' }); }} options={HANDOVER_STATUSES} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={engineerF} onChange={(e) => { setEngineerF(e.target.value); setPage(1); syncParams({ engineer: e.target.value, page: '1' }); }} options={[{ label: 'All Engineers', value: '' }, ...assignableUsers.map((u: any) => ({ label: u.name || u.email, value: u.id }))]} className="h-8 min-w-[130px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} handover{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedRows.size} handover{selectedRows.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('projects') && (
                <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>
              )}
              {perms.canDelete('projects') && (
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
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible handovers" />
                </Th>
                <Th style={{ width: '14%', minWidth: 120 }}>HDO ID</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Customer</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Project</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>Date</Th>
                <Th style={{ width: '12%', minWidth: 120 }}>Engineer</Th>
                <Th style={{ width: '10%', minWidth: 100 }}>Status</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={8} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={8} className="py-14 text-center">
                      <EmptyState icon={<Handshake className="h-9 w-9" />}
                        title={search || statusF || activeKpi ? 'No handovers match filters' : 'No handovers yet'}
                        description={search || statusF || activeKpi ? undefined : 'Create a handover record to get started.'} />
                    </td></tr>
                  ) : paginated.map((h) => (
                    <Tr key={h.id} selected={selectedRows.has(h.id)} data-record-id={h.id} role="button" tabIndex={0}
                      onClick={(e) => handleRowClick(e, h)} onKeyDown={(e) => handleRowKeyDown(e, h)}>
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selectedRows.has(h.id)} onChange={() => toggleSelect(h.id)} ariaLabel={`Select handover ${h.handoverNumber}`} />
                      </Td>
                      <Td className="py-3"><span className="text-sm font-mono font-medium text-[var(--color-text)]">{h.handoverNumber}</span></Td>
                      <Td className="py-3"><span className="text-sm font-medium text-[var(--color-text)]">{h.customerName}</span></Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <FolderKanban className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                          <span className="text-sm text-[var(--color-text-secondary)]">{h.projectName}</span>
                        </div>
                      </Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{h.handoverDate ? fmtDate(h.handoverDate) : '—'}</Td>
                      <Td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <UserCheck className="h-3 w-3 text-[var(--color-text-muted)] shrink-0" />
                          <span className="text-sm text-[var(--color-text-secondary)]">{h.assignedEngineerName || '—'}</span>
                        </div>
                      </Td>
                      <Td className="py-3">{statusBadge(h.status)}</Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate(`/handovers/${encodeURIComponent(h.id)}`); }}>View</Button>
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
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign handovers" size="sm">
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
        title="Delete handovers" message={`Are you sure you want to delete ${selectedRows.size} handover${selectedRows.size > 1 ? 's' : ''}?`}
        loading={bulkDeleteMutation.isPending} />

      {/* CREATE HANDOVER MODAL */}
      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title="New Handover Record" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-xs font-semibold">Project *
            <select className={`${input} mt-1`} value={form.projectId} onChange={(e) => handleProjectSelect(e.target.value)}>
              <option value="">Select project...</option>
              {eligibleProjects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.projectId || p.name || p.id} — {p.customerName || p.customer || ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold">Customer Name *
            <input type="text" className={`${input} mt-1`} required value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold">Handover Date *
              <input type="date" className={`${input} mt-1`} required value={form.handoverDate}
                onChange={(e) => setForm({ ...form, handoverDate: e.target.value })} />
            </label>
            <label className="block text-xs font-semibold">Scheduled Date
              <input type="date" className={`${input} mt-1`} value={form.scheduledDate || ''}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-semibold">Assigned Engineer
            <input type="text" className={`${input} mt-1`} placeholder="Engineer name"
              value={form.assignedEngineerName || ''}
              onChange={(e) => setForm({ ...form, assignedEngineerName: e.target.value, assignedEngineer: e.target.value })} />
          </label>
          <label className="block text-xs font-semibold">Notes
            <textarea className={`${input} mt-1 resize-none`} rows={2} value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" loading={createMut.isPending}>Create Handover</Button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
