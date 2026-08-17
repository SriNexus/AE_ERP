import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, CheckCircle2, DraftingCompass, FileText, LayoutDashboard, Plus, RefreshCw, Search,
  Calendar, Download, Users, Trash2, XCircle,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import { updateDocById, deleteDocById } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { PermissionGate, CalendarModal } from '../components/shared';
import type { CalendarEvent } from '../components/shared/CalendarModal';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox, SkeletonRows, EmptyState, ConfirmDialog,
} from '../components/ui';
import { COLLECTIONS } from '../lib/firebase';
import { getAll } from '../lib/firestore';
import { queryKeys } from '../lib/queryKeys';
import { usePermissions } from '../lib/permissions';
import { useAppStore } from '../store/useAppStore';
import type { SurveyRecord } from '../features/surveys/types';
import type { DesignInput, EngineeringDesignRecord } from '../features/engineering/types';
import { useEngineeringActions, useEngineeringDesigns } from '../features/engineering/hooks/useEngineeringDesigns';
import { EngineeringDesignForm } from '../features/engineering/components/EngineeringDesignForm';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'Draft' },
  { label: 'In Review', value: 'InReview' },
  { label: 'Approved', value: 'Approved' },
  { label: 'Revised', value: 'Revised' },
  { label: 'Cancelled', value: 'Cancelled' },
];

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadDesignsCsv(rows: any[], filename: string) {
  const headers = ['Design ID', 'Project ID', 'Survey ID', 'Capacity (kW)', 'Designer', 'Status', 'Revision'];
  const lines = rows.map((d) =>
    [d.designId || '', d.projectId || '', d.surveyId || '', d.systemCapacityKw || '', d.designerId || '', d.status || '', `R${d.revisionNumber || 1}`]
      .map((v) => `"${v}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function EngineeringDesigns() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: designs = [], isLoading, error: queryError } = useEngineeringDesigns();
  const { data: surveys = [] } = useQuery({
    queryKey: queryKeys.forCompany(companyId).surveysAll,
    queryFn: () => getAll<SurveyRecord>(COLLECTIONS.SURVEYS),
  });
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<{ id: string; name?: string; email?: string; role?: string }>(COLLECTIONS.USERS),
  });
  const actions = useEngineeringActions();
  const perms = usePermissions();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [designerF, setDesignerF] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');

  // ── Engineering popup retirement: the Project Workspace's "Work on This
  // Project" → Engineering stage card (ProjectEngineeringWorkspace.tsx) is
  // now the real operational home for Engineering work — full view/edit/
  // submit/approve/revise, reusing the exact same useEngineeringDesigns()/
  // useEngineeringActions()/EngineeringDesignDetail this page used to open
  // in a popup. Clicking a design row now takes the user to that project's
  // Workspace instead. "Create design" (the
  // manual creation path, for a survey that hasn't auto-drafted one) stays
  // here — it is a legitimate global entry point, not the retired popup. ──
  function openDesignWorkspace(design: EngineeringDesignRecord) {
    if (!design.projectId) return toast.error('This design has no linked project.');
    navigate(`/projects/${encodeURIComponent(design.projectId)}`);
  }
  const [activeKpi, setActiveKpi] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  // ── Row selection state ──
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Calendar modal state ──
  const [calendarOpen, setCalendarOpen] = useState(false);

  // ── Bulk action state ──
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  // ── Bulk action mutations ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.ENGINEERING_DESIGNS, id, { designerId: userId })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['engineering-designs'] }); toast.success(`Assigned ${selectedRows.size} designs to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.ENGINEERING_DESIGNS, id)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['engineering-designs'] }); toast.success(`Deleted ${selectedRows.size} designs`); setDelId(null); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const approvedSurveys = surveys.filter(
    (survey) =>
      survey.approvalStatus === 'Approved' &&
      !designs.some((design) => design.surveyId === survey.id),
  );
  const designers = users.filter((user) => user.role === 'Engineer');
  const projectFilter = params.get('projectId') || '';

  const designStats = useMemo(() => {
    const all = designs as EngineeringDesignRecord[];
    return {
      total: all.length,
      draft: all.filter((d) => d.status === 'Draft').length,
      inReview: all.filter((d) => d.status === 'InReview').length,
      approved: all.filter((d) => d.status === 'Approved').length,
      revised: all.filter((d) => d.status === 'Revised').length,
      cancelled: all.filter((d) => d.status === 'Cancelled').length,
    };
  }, [designs]);

  const filtered = useMemo(
    () =>
      designs.filter((design) => {
        const text = `${design.designId} ${design.projectId} ${design.surveyId} ${design.designerId} ${design.inverterSpec}`.toLowerCase();
        const matchesProject = !projectFilter || design.projectId === projectFilter;
        const matchesStatus = !status || design.status === status;
        const matchesDesigner = !designerF || design.designerId === designerF;
        const matchesSearch = !search.trim() || text.includes(search.trim().toLowerCase());
        const matchesKpi =
          !activeKpi ||
          activeKpi === 'total' ||
          (activeKpi === 'draft' && design.status === 'Draft') ||
          (activeKpi === 'inReview' && design.status === 'InReview') ||
          (activeKpi === 'approved' && design.status === 'Approved') ||
          (activeKpi === 'revised' && design.status === 'Revised') ||
          (activeKpi === 'cancelled' && design.status === 'Cancelled');
        const matchesDateRange = dateRange === 'all' || isInDateRange(design.createdAt, dateRange as any, customFrom, customTo);
        return matchesProject && matchesStatus && matchesDesigner && matchesSearch && matchesDateRange && matchesKpi;
      }),
    [designs, projectFilter, search, status, designerF, dateRange, customFrom, customTo, activeKpi],
  );

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const isTotalDefault = !activeKpi && !search && !status && !designerF && !projectFilter && dateRange === 'all';
  const activeFilterCount = [
    search ? 'search' : '',
    status ? status : '',
    designerF ? 'designer' : '',
    activeKpi ? activeKpi : '',
    projectFilter ? 'project' : '',
    dateRange !== 'all' ? dateRange : '',
  ].filter(Boolean).length;

  const KPI_TILES = useMemo(
    () => [
      { key: 'total', label: 'TOTAL', value: designStats.total, icon: <LayoutDashboard className="h-4 w-4" />, desc: `${designStats.inReview} in review` },
      { key: 'draft', label: 'DRAFT', value: designStats.draft, icon: <FileText className="h-4 w-4" />, desc: 'In progress' },
      { key: 'inReview', label: 'IN REVIEW', value: designStats.inReview, icon: <Activity className="h-4 w-4" />, desc: 'Awaiting approval' },
      { key: 'approved', label: 'APPROVED', value: designStats.approved, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Ready for quotation' },
      { key: 'revised', label: 'REVISED', value: designStats.revised, icon: <RefreshCw className="h-4 w-4" />, desc: 'Changes requested' },
      { key: 'cancelled', label: 'CANCELLED', value: designStats.cancelled, icon: <XCircle className="h-4 w-4" />, desc: 'No longer active' },
    ],
    [designStats],
  );

  const events: CalendarEvent[] = useMemo(
    () =>
      designs.map((d) => ({
        id: d.id,
        title: d.designId,
        date: d.createdAt || new Date().toISOString(),
        description: `Project: ${d.projectId} · Capacity: ${d.systemCapacityKw}kW`,
        status: d.status,
        assignee: d.designerId,
      })),
    [designs],
  );

  const calendarStatusOptions = [
    { label: 'All Status', value: '' },
    { label: 'Draft', value: 'Draft' },
    { label: 'In Review', value: 'InReview' },
    { label: 'Approved', value: 'Approved' },
    { label: 'Revised', value: 'Revised' },
    { label: 'Cancelled', value: 'Cancelled' },
  ];

  const calendarAssigneeOptions = [
    { label: 'All Designers', value: '' },
    ...designers.map((u: any) => ({ label: u.name || u.email, value: u.id })),
  ];

  function save(input: DesignInput) {
    setError('');
    actions.create.mutate(input, {
      onSuccess: (design) => { setFormOpen(false); openDesignWorkspace(design); },
      onError: (failure) => setError(failure.message),
    });
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
    setSearch('');
    setStatus('');
    setDesignerF('');
    setActiveKpi('');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedRows((prev) =>
      prev.size === paginated.length ? new Set() : new Set(paginated.map((d) => d.id)),
    );
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = (designs as EngineeringDesignRecord[]).filter((d) => selectedRows.has(d.id));
    if (!rows.length) return toast.error('No designs selected');
    downloadDesignsCsv(rows, `designs-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} design${rows.length > 1 ? 's' : ''}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, design: EngineeringDesignRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openDesignWorkspace(design);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, design: EngineeringDesignRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openDesignWorkspace(design);
  }

  function statusBadge(status: string, revision?: number) {
    const variant =
      status === 'Approved' ? 'success' as const
        : status === 'Revised' ? 'warning' as const
          : status === 'Cancelled' ? 'danger' as const
            : status === 'InReview' ? 'info' as const
              : 'default' as const;
    return <Badge variant={variant}>{status}{revision ? ` · R${revision}` : ''}</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero
        className="gap-3"
        icon={<DraftingCompass className="h-4 w-4" />}
        breadcrumbs={['Home', 'Field Operations', 'Engineering Designs']}
        title="Engineering Designs"
        statusText="Field Operations"
        statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => setCalendarOpen(true)}>
              Open Calendar
            </Button>
            <PermissionGate module="engineering" action="create">
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFormOpen(true)}>
                Create design
              </Button>
            </PermissionGate>
          </>
        }
      />

      {/* ERROR BANNER */}
      {(error || queryError) && (
        <div className="rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">
          {error || (queryError as Error).message}
        </div>
      )}

      {/* KPI GRID — 6 columns */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.desc}
            active={k.key === 'total' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : (k.key === 'total' ? '' : k.key);
              setActiveKpi(nextKpi);
              setPage(1);
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* SEARCH + FILTERS */}
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                placeholder="Search designs, project, designer..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            {/* Status filter */}
            <UiSelect value={dateRange} onChange={(e) => handleDateChange(e.target.value)} options={DATE_OPTIONS} className="h-8 min-w-[110px] py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            <UiSelect value={status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatus(e.target.value); setPage(1); }} options={STATUS_OPTIONS} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={designerF} onChange={(e) => { setDesignerF(e.target.value); setPage(1); }} options={[{ label: 'All Designers', value: '' }, ...designers.map((u: any) => ({ label: u.name || u.email, value: u.id }))]} className="h-8 min-w-[130px] py-1" />

            {/* Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            {filtered.length} design{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selectedRows.size} design{selectedRows.size > 1 ? 's' : ''} selected
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button
                size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30"
              >
                Export CSV
              </Button>
              {perms.canEdit('engineering') && (
                <Button
                  size="sm" variant="outline"
                  icon={<Users className="h-3.5 w-3.5" />}
                  onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30"
                >
                  Assign
                </Button>
              )}
              {perms.canDelete('engineering') && (
                <Button
                  size="sm" variant="outline"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30"
                >
                  Delete
                </Button>
              )}
              <button
                onClick={() => setSelectedRows(new Set())}
                className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* DATA TABLE */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible designs" />
                </Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Design</Th>
                <Th style={{ width: '16%', minWidth: 130 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 110 }}>Survey</Th>
                <Th style={{ width: '12%', minWidth: 100 }}>Capacity</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Designer</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Status</Th>
                <Th align="right" style={{ width: 100, minWidth: 100 }}>Actions</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={8} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <EmptyState
                        icon={<DraftingCompass className="h-9 w-9" />}
                        title={search || status || activeKpi ? 'No designs match filters' : 'No designs yet'}
                        description={search || status || activeKpi ? undefined : 'Create your first engineering design to get started.'}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((design: EngineeringDesignRecord) => (
                    <Tr
                      key={design.id}
                      selected={selectedRows.has(design.id)}
                      data-record-id={design.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRowClick(e, design)}
                      onKeyDown={(e) => handleRowKeyDown(e, design)}
                    >
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selectedRows.has(design.id)} onChange={() => toggleSelect(design.id)} ariaLabel={`Select ${design.designId}`} />
                      </Td>
                      <Td className="py-3">
                        <span className="text-sm font-medium text-[var(--color-text)]">{design.designId}</span>
                      </Td>
                      <Td className="py-3">
                        <span className="text-sm text-[var(--color-text-secondary)]">{design.projectId}</span>
                      </Td>
                      <Td className="py-3">
                        <span className="text-sm text-[var(--color-text-secondary)]">{design.surveyId}</span>
                      </Td>
                      <Td className="py-3">
                        <span className="text-sm font-medium text-[var(--color-text)]">{design.systemCapacityKw} kW</span>
                      </Td>
                      <Td className="py-3">
                        <span className="text-sm text-[var(--color-text-secondary)]">{design.designerId}</span>
                      </Td>
                      <Td className="py-3">{statusBadge(design.status, design.revisionNumber)}</Td>
                      <Td className="py-3" align="right">
                        <Button
                          size="sm" variant="outline"
                          icon={<DraftingCompass className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDesignWorkspace(design); }}
                        >
                          View
                        </Button>
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
            <Pagination
              page={page}
              total={filtered.length}
              perPage={perPage}
              onChange={(nextPage) => setPage(nextPage)}
              onPerPageChange={(nextPerPage) => { setPerPage(nextPerPage); setPage(1); }}
            />
          </div>
        )}
      </Card>

      {/* CALENDAR MODAL */}
      <CalendarModal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        events={events}
        title="Engineering Design Calendar"
        statusOptions={calendarStatusOptions}
        assigneeOptions={calendarAssigneeOptions}
        onEventClick={(event) => {
          const design = designs.find((d) => d.id === event.id);
          setCalendarOpen(false);
          if (design) openDesignWorkspace(design);
        }}
        onCreateEvent={() => {
          setCalendarOpen(false);
          setFormOpen(true);
        }}
      />

      {/* BULK ASSIGN MODAL */}
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign designs" size="sm">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Assign to designer
            <select className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm mt-1" value={bulkAssignId} onChange={(e) => {
              const selectedUser = designers.find((u: any) => u.id === e.target.value);
              setBulkAssignId(e.target.value);
              setBulkAssignName(selectedUser?.name || selectedUser?.email || '');
            }}>
              <option value="">Select designer</option>
              {designers.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
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
        title="Delete designs" message={`Are you sure you want to delete ${selectedRows.size} design${selectedRows.size > 1 ? 's' : ''}? This cannot be undone.`}
        loading={bulkDeleteMutation.isPending} />

      {/* CREATE DESIGN MODAL — manual creation entry point for a survey that
          hasn't auto-drafted one yet. Revising/reviewing an EXISTING design
          now happens in its Project Workspace (see openDesignWorkspace
          above) — the same popup-retirement precedent Surveys.tsx already
          established: this page keeps only its creation modal. */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Create engineering design" size="xl">
        <EngineeringDesignForm
          surveys={approvedSurveys}
          designers={designers}
          initial={null}
          onCancel={() => setFormOpen(false)}
          onSubmit={save}
          loading={actions.create.isPending}
        />
      </Modal>
    </div>
  );
}
