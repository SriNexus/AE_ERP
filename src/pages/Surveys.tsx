import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSameDay } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, CheckCircle2, ClipboardCheck, LayoutDashboard, Plus, Search, Wrench, XCircle,
  Calendar, Download, Users, Trash2, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { updateDocById, deleteDocById } from '../lib/firestore';
import { isInDateRange } from '../lib/dateFilters';
import { CalendarModal } from '../components/shared';
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
import type { ProjectRecord } from '../features/projects/types';
import type { SurveyRecord } from '../features/surveys/types';
import { useSurveyActions, useSurveys } from '../features/surveys/hooks/useSurveys';

const SURVEY_STATUS_OPTIONS = [
  { label: 'All Status', value: '' },
  { label: 'Scheduled', value: 'Scheduled' },
  { label: 'In Progress', value: 'InProgress' },
  { label: 'Completed', value: 'Completed' },
  { label: 'Rejected', value: 'Rejected' },
];

const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function downloadSurveysCsv(rows: any[], filename: string) {
  const headers = ['Survey ID', 'Project ID', 'Scheduled Date', 'Surveyor', 'Status', 'Notes'];
  const lines = rows.map((s) =>
    [s.surveyId || '', s.projectId || '', s.scheduledDate || '', s.surveyorId || '', s.status || '', (s.notes || '').replace(/"/g, '""')]
      .map((v) => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Surveys() {
  const perms = usePermissions();
  const navigate = useNavigate();
  const companyId = useAppStore((s) => s.activeCompanyId);
  const qc = useQueryClient();
  const { data: surveys = [], isLoading } = useSurveys();
  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.forCompany(companyId).projectsRoot,
    queryFn: () => getAll<ProjectRecord>(COLLECTIONS.PROJECTS),
  });
  const { data: users = [] } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
  });
  const actions = useSurveyActions();

  const [createOpen, setCreateOpen] = useState(false);
  const [projectId, setProjectId] = useState(new URLSearchParams(location.search).get('projectId') || '');
  const [surveyorId, setSurveyorId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // ── Survey popup retirement: the Project Workspace's "Work on This
  // Project" → Survey stage card (ProjectSurveyWorkspace.tsx) is now the
  // real operational home for Survey work — full view/edit/save/GPS/
  // report/submit/approve/reject, reusing the exact same
  // useSurveys()/useSurveyActions()/SurveyDetail/SurveyReportForm this page
  // used to open in a popup. Clicking a survey row now takes the user
  // there instead of opening that popup here. ──
  function openSurveyWorkspace(survey: SurveyRecord) {
    if (!survey.projectId) return toast.error('This survey has no linked project.');
    navigate(`/projects/${encodeURIComponent(survey.projectId)}`);
  }

  // ── KPI & filter state ──
  const [activeKpi, setActiveKpi] = useState('');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('');
  const [surveyorF, setSurveyorF] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ── Row selection state ──
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Calendar modal state ──
  const [calendarOpen, setCalendarOpen] = useState(false);

  // ── Bulk action state ──
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [bulkAssignName, setBulkAssignName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);

  const surveyors = (users as any[]).filter((u) => u.role === 'Surveyor');

  // ── Bulk action mutations ──
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, userId, userName }: { ids: string[]; userId: string; userName: string }) => {
      // Phase 6: assignedSurveyor must stay in sync with surveyorId — it's
      // the field projectVisibility.ts's PROJECT_ASSIGNMENT_FIELDS actually
      // scopes a Surveyor role's visibility by (not surveyorId). Updating
      // only surveyorId left the previous surveyor still able to see a
      // reassigned survey while the newly-assigned surveyor couldn't.
      await Promise.all(ids.map((id) => updateDocById(COLLECTIONS.SURVEYS, id, { surveyorId: userId, assignedSurveyor: userId })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surveys'] }); toast.success(`Assigned ${selectedRows.size} surveys to ${bulkAssignName}`); setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteDocById(COLLECTIONS.SURVEYS, id)));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['surveys'] }); toast.success(`Deleted ${selectedRows.size} surveys`); setDelId(null); setSelectedRows(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  const surveyStats = useMemo(() => {
    const all = surveys as SurveyRecord[];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      total: all.length,
      scheduled: all.filter((s) => s.status === 'Scheduled').length,
      inProgress: all.filter((s) => s.status === 'InProgress').length,
      completed: all.filter((s) => s.status === 'Completed').length,
      rejected: all.filter((s) => s.status === 'Rejected').length,
      scheduledToday: all.filter((s) => {
        try { return isSameDay(new Date(s.scheduledDate), today); } catch { return false; }
      }).length,
    };
  }, [surveys]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (surveys as SurveyRecord[]).filter((s) => {
      const matchesSearch = !q || s.surveyId.toLowerCase().includes(q) || s.projectId.toLowerCase().includes(q) || s.surveyorId.toLowerCase().includes(q);
      const matchesStatus = !statusF || s.status === statusF;
      const matchesSurveyor = !surveyorF || s.surveyorId === surveyorF;
      const matchesDate = !selectedDate || isSameDay(new Date(s.scheduledDate), selectedDate);
      const matchesKpi = !activeKpi || activeKpi === 'total' ||
        (activeKpi === 'scheduled' && s.status === 'Scheduled') ||
        (activeKpi === 'inProgress' && s.status === 'InProgress') ||
        (activeKpi === 'completed' && s.status === 'Completed') ||
        (activeKpi === 'rejected' && s.status === 'Rejected') ||
        (activeKpi === 'scheduledToday' && (() => { try { return isSameDay(new Date(s.scheduledDate), new Date()); } catch { return false; }})());
      const matchesDateRange = dateRange === 'all' || isInDateRange(s.scheduledDate, dateRange as any, customFrom, customTo);
      return matchesSearch && matchesStatus && matchesSurveyor && matchesDate && matchesDateRange && matchesKpi;
    });
  }, [surveys, search, statusF, surveyorF, selectedDate, dateRange, customFrom, customTo, activeKpi]);

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, page, perPage]);

  const events: CalendarEvent[] = useMemo(() =>
    surveys.map((s) => ({ id: s.id, title: s.surveyId, date: s.scheduledDate, description: `Project: ${s.projectId}`, status: s.status, assignee: s.surveyorId })),
    [surveys],
  );

  const isTotalDefault = !activeKpi && !search && !statusF && !surveyorF && !selectedDate && dateRange === 'all';
  const activeFilterCount = [search ? 'search' : '', statusF ? statusF : '', surveyorF ? 'surveyor' : '', activeKpi ? activeKpi : '', selectedDate ? 'date' : '', dateRange !== 'all' ? dateRange : ''].filter(Boolean).length;

  const KPI_TILES = useMemo(() => [
    { key: 'total', label: 'TOTAL', value: surveyStats.total, icon: <LayoutDashboard className="h-4 w-4" />, desc: `${surveyStats.scheduled} scheduled` },
    { key: 'scheduled', label: 'SCHEDULED', value: surveyStats.scheduled, icon: <Activity className="h-4 w-4" />, desc: 'Awaiting execution' },
    { key: 'inProgress', label: 'IN PROGRESS', value: surveyStats.inProgress, icon: <Wrench className="h-4 w-4" />, desc: 'Currently active' },
    { key: 'completed', label: 'COMPLETED', value: surveyStats.completed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Successfully completed' },
    { key: 'rejected', label: 'REJECTED', value: surveyStats.rejected, icon: <XCircle className="h-4 w-4" />, desc: 'Requires rework' },
    { key: 'scheduledToday', label: 'TODAY', value: surveyStats.scheduledToday, icon: <Clock className="h-4 w-4" />, desc: 'Scheduled for today' },
  ], [surveyStats]);

  const calendarStatusOptions = [{ label: 'All Status', value: '' }, { label: 'Scheduled', value: 'Scheduled' }, { label: 'In Progress', value: 'InProgress' }, { label: 'Completed', value: 'Completed' }, { label: 'Rejected', value: 'Rejected' }];
  const calendarAssigneeOptions = [{ label: 'All Surveyors', value: '' }, ...surveyors.map((u: any) => ({ label: u.name || u.email, value: u.id }))];

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
    setSearch(''); setStatusF(''); setSurveyorF(''); setActiveKpi(''); setSelectedDate(null); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setPage(1);
  }

  function toggleSelect(id: string) {
    setSelectedRows((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleAll() {
    setSelectedRows((prev) => prev.size === paginated.length ? new Set() : new Set(paginated.map((s) => s.id)));
  }

  const allSel = selectedRows.size === paginated.length && paginated.length > 0;

  function exportSelected() {
    const rows = (surveys as SurveyRecord[]).filter((s) => selectedRows.has(s.id));
    if (!rows.length) return toast.error('No surveys selected');
    downloadSurveysCsv(rows, `surveys-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} survey${rows.length > 1 ? 's' : ''}`);
  }

  function handleRowClick(e: React.MouseEvent<HTMLTableRowElement>, survey: SurveyRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(e.target)) return;
    openSurveyWorkspace(survey);
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, survey: SurveyRecord) {
    if (isRowOpenIgnored(e.target)) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openSurveyWorkspace(survey);
  }

  function statusBadge(status: string) {
    const variant = status === 'Completed' ? 'success' as const : status === 'Rejected' ? 'danger' as const : status === 'InProgress' ? 'warning' as const : 'info' as const;
    return <Badge variant={variant}>{status}</Badge>;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero className="gap-3" icon={<ClipboardCheck className="h-4 w-4" />}
        breadcrumbs={['Home', 'Field Operations', 'Surveys']} title="Surveys"
        statusText="Field Operations" statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => setCalendarOpen(true)}>Open Calendar</Button>
            {perms.canCreate('surveys') && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreateOpen(true)}>Schedule survey</Button>}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === 'total' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => { const nextKpi = activeKpi === k.key ? '' : (k.key === 'total' ? '' : k.key); setActiveKpi(nextKpi); setPage(1); }}
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
                placeholder="Search surveys, project, surveyor..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
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
            <UiSelect value={statusF} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusF(e.target.value); setPage(1); }} options={SURVEY_STATUS_OPTIONS} className="h-8 min-w-[120px] py-1" />
            <UiSelect value={surveyorF} onChange={(e) => { setSurveyorF(e.target.value); setPage(1); }} options={[{ label: 'All Surveyors', value: '' }, ...surveyors.map((u: any) => ({ label: u.name || u.email, value: u.id }))]} className="h-8 min-w-[130px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearFilters} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} survey{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        {/* BULK ACTION BAR */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-6 py-2.5">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selectedRows.size} survey{selectedRows.size > 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              {perms.canEdit('surveys') && (
                <Button size="sm" variant="outline" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setShowBulkAssign(true)}
                  className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:border-purple-700 dark:hover:bg-purple-900/30">Assign</Button>
              )}
              {perms.canDelete('surveys') && (
                <Button size="sm" variant="outline" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelId('__bulk__')}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">Delete</Button>
              )}
              <button onClick={() => setSelectedRows(new Set())} className="ml-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">✕ Clear</button>
            </div>
          </div>
        )}

        {/* TABLE AREA — full width, no embedded calendar */}
        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selectedRows.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible surveys" />
                </Th>
                <Th style={{ width: '18%', minWidth: 140 }}>Survey</Th>
                <Th style={{ width: '18%', minWidth: 140 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Scheduled</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Surveyor</Th>
                <Th style={{ width: '14%', minWidth: 110 }}>Status</Th>
                <Th align="right" style={{ width: 100, minWidth: 100 }}>Actions</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={7} />
                  : paginated.length === 0 ? (
                    <tr><td colSpan={7} className="py-14 text-center">
                      <EmptyState icon={<ClipboardCheck className="h-9 w-9" />}
                        title={search || statusF || activeKpi ? 'No surveys match filters' : 'No surveys yet'}
                        description={search || statusF || activeKpi ? undefined : 'Schedule your first survey to get started.'} />
                    </td></tr>
                  ) : paginated.map((survey: SurveyRecord) => (
                    <Tr key={survey.id} selected={selectedRows.has(survey.id)} data-record-id={survey.id} role="button" tabIndex={0}
                      onClick={(e) => handleRowClick(e, survey)} onKeyDown={(e) => handleRowKeyDown(e, survey)}>
                      <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                        <UniversalCheckbox checked={selectedRows.has(survey.id)} onChange={() => toggleSelect(survey.id)} ariaLabel={`Select ${survey.surveyId}`} />
                      </Td>
                      <Td className="py-3"><span className="text-sm font-medium text-[var(--color-text)]">{survey.surveyId}</span></Td>
                      <Td className="py-3"><span className="text-sm text-[var(--color-text-secondary)]">{survey.projectId}</span></Td>
                      <Td className="py-3"><span className="text-sm text-[var(--color-text-secondary)]">{new Date(survey.scheduledDate).toLocaleDateString()}</span></Td>
                      <Td className="py-3"><span className="text-sm text-[var(--color-text-secondary)]">{survey.surveyorId}</span></Td>
                      <Td className="py-3">{statusBadge(survey.status)}</Td>
                      <Td className="py-3" align="right">
                        <Button size="sm" variant="outline" icon={<ClipboardCheck className="h-3 w-3" />}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); openSurveyWorkspace(survey); }}>View</Button>
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

      {/* ERROR BANNER */}
      {error && <div className="rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">{error}</div>}

      {/* CALENDAR MODAL */}
      <CalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} events={events} title="Survey Calendar"
        statusOptions={calendarStatusOptions} assigneeOptions={calendarAssigneeOptions}
        onEventClick={(event) => {
          const survey = surveys.find((s) => s.id === event.id);
          setCalendarOpen(false);
          if (survey) openSurveyWorkspace(survey);
        }}
        onCreateEvent={() => { setCalendarOpen(false); setCreateOpen(true); }} />

      {/* BULK ASSIGN MODAL */}
      <Modal open={showBulkAssign} onClose={() => setShowBulkAssign(false)} title="Assign surveys" size="sm">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Assign to surveyor
            <select className={`${input} mt-1`} value={bulkAssignId} onChange={(e) => {
              const selectedUser = surveyors.find((u: any) => u.id === e.target.value);
              setBulkAssignId(e.target.value);
              setBulkAssignName(selectedUser?.name || selectedUser?.email || '');
            }}>
              <option value="">Select surveyor</option>
              {surveyors.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
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
        title="Delete surveys" message={`Are you sure you want to delete ${selectedRows.size} survey${selectedRows.size > 1 ? 's' : ''}? This cannot be undone.`}
        loading={bulkDeleteMutation.isPending} />

      {/* SCHEDULE SURVEY MODAL */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Schedule project survey" size="lg">
        <div className="space-y-4">
          <label className="block text-xs font-semibold">Project
            <select className={`${input} mt-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{(p as ProjectRecord).projectId}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Surveyor
            <select className={`${input} mt-1`} value={surveyorId} onChange={(e) => setSurveyorId(e.target.value)}>
              <option value="">Select surveyor</option>
              {surveyors.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold">Scheduled date and time
            <input className={`${input} mt-1`} type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
          </label>
          <label className="block text-xs font-semibold">Notes
            <textarea className={`${input} mt-1`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex justify-end">
            <Button loading={actions.schedule.isPending} onClick={() => actions.schedule.mutate({ projectId, surveyorId, scheduledDate, notes }, { onSuccess: () => { setCreateOpen(false); setError(''); }, onError: (e) => setError(e.message) })}>Schedule</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
