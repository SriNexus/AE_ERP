import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Download, Eye, ListTodo, Pencil, Plus, Trash2, X, ListChecks } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
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
  statusBadge,
} from '../components/ui';
import { CreateTaskModal } from '../components/tasks/CreateTaskModal';
import { fmtDate, fmtDateTime, getAll } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { useTask, useTasks } from '../hooks/useTasks';
import type { Task, TaskPriority, TaskStatus } from '../types';
import { cn } from '../utils/cn';
import toast from 'react-hot-toast';

const PER_PAGE = 10;

const STATUS_OPTIONS = ['All', 'Open', 'In Progress', 'Done', 'Cancelled'];
const PRIORITY_OPTIONS = ['All', 'Low', 'Medium', 'High', 'Urgent'];
const DATE_OPTIONS = [
  { label: 'All dates', value: 'all' },
  { label: 'Due today', value: 'today' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Next 7 days', value: 'week' },
  { label: 'No due date', value: 'none' },
];
const SORTABLE_COLUMNS = new Set(['title', 'assignedToName', 'createdBy', 'priority', 'status', 'dueDate', 'createdAt']);

type SortKey = 'title' | 'assignedToName' | 'createdBy' | 'priority' | 'status' | 'dueDate' | 'createdAt';

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === 'Done' || task.status === 'Cancelled') return false;
  return new Date(`${task.dueDate}T23:59:59`).getTime() < Date.now();
}

function isDueToday(task: Task): boolean {
  if (!task.dueDate) return false;
  return task.dueDate === new Date().toISOString().slice(0, 10);
}

function isDueThisWeek(task: Task): boolean {
  if (!task.dueDate) return false;
  const due = new Date(`${task.dueDate}T12:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return due >= today && due <= today + 7 * 86400000;
}

function entityPath(task: Task): string {
  if (task.entityType === 'Lead') return '/leads';
  if (task.entityType === 'Customer') return '/customers';
  if (task.entityType === 'Order') return '/orders';
  return '';
}

function priorityBadge(priority: TaskPriority) {
  if (priority === 'Urgent') return <Badge variant="danger">{priority}</Badge>;
  if (priority === 'High') return <Badge variant="warning">{priority}</Badge>;
  if (priority === 'Low') return <Badge variant="gray">{priority}</Badge>;
  return <Badge variant="info">{priority}</Badge>;
}

function compareTasks(a: Task, b: Task, key: SortKey, desc: boolean): number {
  const aValue = String(a[key] || '').toLowerCase();
  const bValue = String(b[key] || '').toLowerCase();
  const result = aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
  return desc ? -result : result;
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

function EmptyCell({ children = '-' }: { children?: ReactNode }) {
  return <span className="text-[var(--color-text-disabled)]">{children}</span>;
}

function recencyDotClass(value: any): string {
  if (!value) return 'bg-[var(--color-text-disabled)]';
  const date = new Date(value);
  if (isNaN(date.getTime())) return 'bg-[var(--color-text-disabled)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const created = new Date(date); created.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
  if (days === 0) return 'bg-emerald-500';
  if (days <= 7) return 'bg-blue-500';
  if (days <= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function CreatedDateCell({ value }: { value: any }) {
  const formatted = fmtDate(value);
  if (!formatted) return <EmptyCell />;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${recencyDotClass(value)}`} aria-hidden="true" />
      {formatted}
    </span>
  );
}

function downloadTasksCsv(rows: Task[], creatorNameFor: (task: Task) => string, filename: string) {
  const headers = ['Title', 'Assigned To', 'Created By', 'Priority', 'Status', 'Due Date', 'Created Date', 'Linked Entity'];
  const lines = rows.map(task =>
    [
      task.title || '',
      task.assignedToName || '',
      creatorNameFor(task),
      task.priority || '',
      task.status || '',
      task.dueDate || '',
      fmtDate(task.createdAt) || '',
      task.entityName || '',
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setParam(params: URLSearchParams, key: string, value: string, defaultValue = 'All') {
  if (!value || value === defaultValue) params.delete(key);
  else params.set(key, value);
}

function TaskDetailsPage({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const { task, loading, error, updateTask, changeStatus, deleteTask } = useTask(taskId);
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updating, setUpdating] = useState(false);
  const creatorName = useMemo(() => {
    if (!task) return 'System';
    const creator = (users as any[]).find((user) => user.id === task.createdBy);
    return creator?.name || creator?.email || task.createdBy || 'System';
  }, [task, users]);

  async function markComplete() {
    setUpdating(true);
    try {
      await changeStatus('Done');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-5">
      <WorkspaceHero
        title={task?.title || 'Task Details'}
        subtitle={task ? `${task.id} · Last updated ${fmtDateTime(task.updatedAt || task.createdAt)}` : 'Loading task details'}
        breadcrumbs={['Home', 'Tasks', task?.title || 'Task Details']}
        icon={<ListTodo className="h-6 w-6" />}
        actions={task && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/tasks')}>Back to Tasks</Button>
          </div>
        )}
      />

      {error && <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{error}</div>}
      {loading && <Card><div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton h-10" />)}</div></Card>}
      {!loading && !task && (
        <Card>
          <EmptyState icon={<ListTodo className="h-9 w-9" />} title="Task not found" description="The task may have been deleted or you may not have access." action={<Button onClick={() => navigate('/tasks')}>Open Tasks</Button>} />
        </Card>
      )}

      {task && (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card>
              <CardHeader>
                <h3 className="font-semibold text-[var(--color-text)] text-sm">Overview</h3>
                <div className="flex items-center gap-2">
                  {statusBadge(task.status)}
                  {priorityBadge(task.priority)}
                </div>
              </CardHeader>
              <div className="p-5 space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Description</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{task.description || 'No description provided.'}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Detail label="Assigned To" value={task.assignedToName || 'Unassigned'} />
                  <Detail label="Created By" value={creatorName} />
                  <Detail label="Due Date" value={task.dueDate ? fmtDate(task.dueDate) : 'No due date'} danger={isOverdue(task)} />
                </div>
                {task.entityId && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Entity</p>
                    <button
                      className="mt-1 text-sm font-semibold text-[var(--color-primary)] hover:underline"
                      onClick={() => navigate(entityPath(task), { state: { entityId: task.entityId } })}
                    >
                      {task.entityName || task.entityType || task.entityId}
                    </button>
                  </div>
                )}
              </div>
            </Card>

            <aside className="space-y-4">
              <Card>
                <CardHeader><h3 className="font-semibold text-[var(--color-text)] text-sm">Quick Actions</h3></CardHeader>
                <div className="p-5 space-y-2">
                  <Button variant="outline" size="sm" className="w-full justify-start" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>Edit Task</Button>
                  {task.status !== 'Done' && <Button loading={updating} size="sm" className="w-full justify-start" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={markComplete}>Mark Complete</Button>}
                  <div className="border-t border-[var(--color-border-subtle)] pt-3">
                    <Button variant="danger" size="sm" className="w-full justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>Delete Task</Button>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader><h3 className="font-semibold text-[var(--color-text)] text-sm">Timeline</h3></CardHeader>
                <div className="p-5 space-y-3">
                  <TimelineItem label="Created" value={fmtDateTime(task.createdAt)} />
                  <TimelineItem label="Updated" value={fmtDateTime(task.updatedAt)} />
                  {task.status === 'Done' && <TimelineItem label="Completed" value={fmtDateTime(task.updatedAt)} />}
                  {task.isDeleted && <TimelineItem label="Deleted" value={fmtDateTime(task.deletedAt)} />}
                </div>
              </Card>
            </aside>
          </div>

          <Card>
            <CardHeader>
              <h3 className="font-semibold text-[var(--color-text)] text-sm">Comments</h3>
              <Badge variant="gray">Not configured</Badge>
            </CardHeader>
            <div className="p-5">
              <p className="text-sm text-[var(--color-text-muted)]">Task comments are not available in the current data model.</p>
            </div>
          </Card>

          <CreateTaskModal open={editing} task={task} onClose={() => setEditing(false)} onSubmit={async (payload) => { await updateTask(payload); }} />
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => void deleteTask().then(() => navigate('/tasks'))}
            title="Delete Task"
            message={`Cancel and hide "${task.title}"?`}
          />
        </>
      )}
    </div>
  );
}



function Detail({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={danger ? 'mt-1 text-sm font-semibold text-[var(--color-danger-text)]' : 'mt-1 text-sm font-semibold text-[var(--color-text)]'}>{value}</p>
    </div>
  );
}

function TimelineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{value}</p>
      </div>
    </div>
  );
}

export default function Tasks() {
  const { id } = useParams();
  if (id) return <TaskDetailsPage taskId={id} />;
  return <TaskListPage />;
}

function TaskListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { allTasks, createTask, updateTask, deleteTask, changeStatus, loading, error } = useTasks();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [taskDetailsTab, setTaskDetailsTab] = useState<'overview' | 'timeline' | 'comments'>('overview');
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(params.get('q') || '');
  const [page, setPage] = useState(Number(params.get('page') || 1));
  const [perPage, setPerPage] = useState(Number(params.get('perPage') || PER_PAGE));
  const [sortKey, setSortKey] = useState<SortKey>((params.get('sort') as SortKey) || 'createdAt');
  const [sortDesc, setSortDesc] = useState(params.get('dir') !== 'asc');

  const search = params.get('q') || '';
  const status = params.get('status') || 'All';
  const priority = params.get('priority') || 'All';
  const assignee = params.get('assignee') || 'All';
  const date = params.get('date') || 'all';
  const activeKpi = params.get('kpi') || '';

  // Compute active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (status !== 'All') count++;
    if (priority !== 'All') count++;
    if (assignee !== 'All') count++;
    if (date !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, status, priority, assignee, date, activeKpi]);

  useEffect(() => {
    const nextParams = new URLSearchParams(location.search);
    const nextSearch = nextParams.get('q') || '';
    if (nextSearch !== searchDraft) setSearchDraft(nextSearch);

    const nextPage = Math.max(1, Number(nextParams.get('page') || 1));
    if (nextPage !== page) setPage(nextPage);

    const nextPerPage = Math.max(1, Number(nextParams.get('perPage') || PER_PAGE));
    if (nextPerPage !== perPage) setPerPage(nextPerPage);

    const rawSort = nextParams.get('sort');
    const nextSortKey = SORTABLE_COLUMNS.has(rawSort || '') ? rawSort as SortKey : 'createdAt';
    if (nextSortKey !== sortKey) setSortKey(nextSortKey);

    const nextSortDesc = nextParams.get('dir') !== 'asc';
    if (nextSortDesc !== sortDesc) setSortDesc(nextSortDesc);
  }, [location.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((params.get('q') || '') === searchDraft.trim()) return;
      const next = new URLSearchParams(params);
      setParam(next, 'q', searchDraft.trim(), '');
      next.delete('page');
      setParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [params, searchDraft, setParams]);

  const assigneeOptions = useMemo(() => {
    const names = Array.from(new Set(allTasks.map((task) => task.assignedToName).filter(Boolean))).sort();
    return ['All', ...names];
  }, [allTasks]);

  const creatorNameFor = useMemo(() => {
    const userMap = new Map((users as any[]).map((user) => [user.id, user.name || user.email || user.id]));
    return (task: Task) => userMap.get(task.createdBy) || task.createdBy || 'System';
  }, [users]);

  const kpis = useMemo(() => ({
    total: allTasks.length,
    open: allTasks.filter((task) => task.status === 'Open').length,
    inProgress: allTasks.filter((task) => task.status === 'In Progress').length,
    completed: allTasks.filter((task) => task.status === 'Done').length,
    overdue: allTasks.filter(isOverdue).length,
  }), [allTasks]);

  // Total KPI active by default when no filters/search/KPI are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && status === 'All' && priority === 'All' && assignee === 'All' && date === 'all';
  }, [activeKpi, search, status, priority, assignee, date]);

  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (activeKpi === 'open' && task.status !== 'Open') return false;
      if (activeKpi === 'inProgress' && task.status !== 'In Progress') return false;
      if (activeKpi === 'completed' && task.status !== 'Done') return false;
      if (activeKpi === 'overdue' && !isOverdue(task)) return false;
      if (status !== 'All' && task.status !== status) return false;
      if (priority !== 'All' && task.priority !== priority) return false;
      if (assignee !== 'All' && task.assignedToName !== assignee) return false;
      if (date === 'today' && !isDueToday(task)) return false;
      if (date === 'overdue' && !isOverdue(task)) return false;
      if (date === 'week' && !isDueThisWeek(task)) return false;
      if (date === 'none' && task.dueDate) return false;
      if (!term) return true;
      return [task.title, task.description, task.assignedToName, creatorNameFor(task), task.entityName].some((value) => String(value || '').toLowerCase().includes(term));
    }).sort((a, b) => {
      if (sortKey !== 'createdBy') return compareTasks(a, b, sortKey, sortDesc);
      const result = creatorNameFor(a).localeCompare(creatorNameFor(b), undefined, { numeric: true, sensitivity: 'base' });
      return sortDesc ? -result : result;
    });
  }, [activeKpi, allTasks, assignee, creatorNameFor, date, priority, search, sortDesc, sortKey, status]);

  const pagedTasks = useMemo(() => filteredTasks.slice((page - 1) * perPage, page * perPage), [filteredTasks, page, perPage]);
  const lastUpdated = useMemo(() => {
    const latest = allTasks.map((task) => task.updatedAt || task.createdAt).filter(Boolean).sort().at(-1);
    return latest ? fmtDateTime(latest) : 'No sync yet';
  }, [allTasks]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTasks.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [filteredTasks.length, page, perPage]);

  useEffect(() => {
    setSelected((current) => {
      const visibleIds = new Set(filteredTasks.map((task) => task.id));
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredTasks]);

  function updateFilter(key: string, value: string, defaultValue = 'All') {
    const next = new URLSearchParams(params);
    setParam(next, key, value, defaultValue);
    next.delete('page');
    setParams(next, { replace: true });
  }

  function updateKpi(nextKpi: string) {
    const next = new URLSearchParams(params);
    if (nextKpi) next.set('kpi', nextKpi);
    else next.delete('kpi');
    next.delete('page');
    setPage(1);
    setParams(next, { replace: true });
  }

  function clearAll() {
    const next = new URLSearchParams(params);
    ['q', 'status', 'priority', 'assignee', 'date', 'kpi', 'page'].forEach((key) => next.delete(key));
    setSearchDraft('');
    setPage(1);
    setSelected(new Set());
    setParams(next, { replace: true });
  }

  const toggleSelect = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) => current.size === pagedTasks.length ? new Set() : new Set(pagedTasks.map((task) => task.id)));

  const allSel = selected.size === pagedTasks.length && pagedTasks.length > 0;

  function exportSelected() {
    const rows = allTasks.filter((task) => selected.has(task.id));
    if (!rows.length) return toast.error('No tasks selected');
    downloadTasksCsv(rows, creatorNameFor, `tasks-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} task${rows.length > 1 ? 's' : ''}`);
  }

  async function bulkChangeStatus() {
    if (!bulkStatus) return toast.error('Select a status');
    await Promise.all(Array.from(selected).map((id) => changeStatus(id, bulkStatus)));
    toast.success(`Status updated for ${selected.size} task${selected.size > 1 ? 's' : ''}`);
    setBulkStatus('');
    setBulkStatusOpen(false);
    setSelected(new Set());
  }

  async function bulkDelete() {
    await Promise.all(Array.from(selected).map((id) => deleteTask(id)));
    toast.success(`Deleted ${selected.size} task${selected.size > 1 ? 's' : ''}`);
    setBulkDeleteOpen(false);
    setSelected(new Set());
  }

  function openTaskDetails(task: Task) {
    setTaskDetailsTab('overview');
    setViewTask(task);
  }

  function closeTaskDetails() {
    setViewTask(null);
  }

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, task: Task) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(event.target)) return;
    openTaskDetails(task);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage === 1) next.delete('page');
    else next.set('page', String(nextPage));
    setParams(next, { replace: true });
  }

  function changePerPage(nextPerPage: number) {
    setPerPage(nextPerPage);
    setPage(1);
    const next = new URLSearchParams(params);
    next.set('perPage', String(nextPerPage));
    next.delete('page');
    setParams(next, { replace: true });
  }

  function sortBy(key: SortKey) {
    const desc = sortKey === key ? !sortDesc : key === 'createdAt';
    setSortKey(key);
    setSortDesc(desc);
    const next = new URLSearchParams(params);
    next.set('sort', key);
    next.set('dir', desc ? 'desc' : 'asc');
    setParams(next, { replace: true });
  }

  async function submitTask(payload: Parameters<typeof createTask>[0]) {
    if (editingTask) {
      await updateTask(editingTask.id, payload);
      setEditingTask(null);
      return;
    }
    await createTask(payload);
  }

  const KPI_CONFIGS = [
    { key: '', label: 'Total Tasks', icon: <ListTodo className="h-4 w-4" />, value: kpis.total, description: `${kpis.total} total tasks` },
    { key: 'open', label: 'Open', icon: <ListTodo className="h-4 w-4" />, value: kpis.open, description: 'Awaiting execution' },
    { key: 'inProgress', label: 'In Progress', icon: <CheckCircle2 className="h-4 w-4" />, value: kpis.inProgress, description: 'Currently active' },
    { key: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-4 w-4" />, value: kpis.completed, description: 'Completed successfully' },
    { key: 'overdue', label: 'Overdue', icon: <AlertCircle className="h-4 w-4" />, value: kpis.overdue, description: kpis.overdue > 0 ? 'Require immediate attention' : 'No overdue tasks' },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Tasks"
        icon={<ListTodo className="h-6 w-6" />}
        breadcrumbs={['Home', 'Tasks']}
        statusText={`Last updated ${lastUpdated} · Realtime Connected`}
        statusDotColor="var(--color-success)"
        className="gap-3"
        actions={
          <>

            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
              Create Task
            </Button>
          </>
        }
      />

      {/* ── Premium Clickable KPI Cards ────────────────────── */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-5">
        {KPI_CONFIGS.map((cfg) => (
          <PremiumKpi
            key={cfg.key}
            label={cfg.label}
            value={cfg.value}
            icon={cfg.icon}
            description={cfg.description}
            onClick={() => updateKpi(activeKpi === cfg.key ? '' : cfg.key)}
            active={cfg.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === cfg.key}
          />
        ))}
      </div>

      {/* ── Premium Elevated Table Card ────────────────────── */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        {/* ── Card Header with Search + Filters + Pills ────── */}
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              aria-label="Search tasks"
              placeholder="Search title, assignee, entity..."
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select
              aria-label="Date"
              value={date}
              options={DATE_OPTIONS}
              onChange={(event) => updateFilter('date', event.target.value, 'all')}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Status"
              value={status}
              options={STATUS_OPTIONS.map((value) => ({ label: value, value }))}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Priority"
              value={priority}
              options={PRIORITY_OPTIONS.map((value) => ({ label: value, value }))}
              onChange={(event) => updateFilter('priority', event.target.value)}
              className="w-[110px] h-8 py-1"
            />
            <Select
              aria-label="Assignee"
              value={assignee}
              options={assigneeOptions.map((value) => ({ label: value, value }))}
              onChange={(event) => updateFilter('assignee', event.target.value)}
              className="w-[120px] h-8 py-1"
            />
            {/* Active filter pills + Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {KPI_CONFIGS.find((c) => c.key === activeKpi)?.label || activeKpi}
                    <button type="button" onClick={() => updateKpi('')} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>
                )}
                {status !== 'All' && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{status}</span>
                )}
                {priority !== 'All' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{priority}</span>
                )}
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors">
                  <X className="h-2.5 w-2.5" />
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            </div>
          </div>
        </CardHeader>

        {/* ── Bulk action bar ───────────────────────────────── */}
        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">
              {selected.size} task{selected.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={exportSelected}
                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">
                Export CSV
              </Button>
              <Button size="sm" variant="outline"
                icon={<ListChecks className="h-3.5 w-3.5" />}
                onClick={() => setBulkStatusOpen(true)}
                className="text-indigo-600 border-indigo-300 hover:bg-indigo-50 dark:border-indigo-700 dark:hover:bg-indigo-900/30">
                Change Status
              </Button>
              <Button size="sm" variant="outline"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setBulkDeleteOpen(true)}
                className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30">
                Delete
              </Button>
              <button onClick={() => setSelected(new Set())}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">
                ✕ Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Error Banner ──────────────────────────────────── */}
        {error && (
          <div className="mx-6 mt-3 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
            {error}
          </div>
        )}

        {/* ── Filter + Table Area + Pagination (unified) ───── */}
        <div className="px-6 flex-1 flex flex-col min-h-0">
          {/* ── Premium Universal Table ─────────────────────── */}
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                  <UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible tasks" />
                </Th>
                <Th sortable sorted={sortKey === 'title'} desc={sortDesc} onSort={() => sortBy('title')} style={{ width: '34%', minWidth: 200 }}>TASK TITLE</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>ASSIGNED TO</Th>
                <Th style={{ width: '12%', minWidth: 130 }}>CREATED BY</Th>
                <Th style={{ width: 80, minWidth: 80 }}>PRIORITY</Th>
                <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sortBy('status')} style={{ width: 120, minWidth: 120 }}>STATUS</Th>
                <Th sortable sorted={sortKey === 'dueDate'} desc={sortDesc} onSort={() => sortBy('dueDate')} style={{ width: 90, minWidth: 90 }}>DUE</Th>
                <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sortBy('createdAt')} style={{ width: 90, minWidth: 90 }}>CREATED</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {loading
                  ? <SkeletonRows cols={9} />
                  : pagedTasks.length === 0
                    ? (
                      <tr>
                        <td colSpan={9} className="py-14 text-center">
                          <EmptyState
                            icon={<ListTodo className="h-9 w-9" />}
                            title={search || status !== 'All' || priority !== 'All' || assignee !== 'All' || date !== 'all' || activeKpi ? 'No tasks match filters' : 'No tasks yet'}
                            description={search || status !== 'All' || priority !== 'All' || assignee !== 'All' || date !== 'all' || activeKpi ? undefined : 'Create your first task to get started.'}
                            action={!search && status === 'All' && priority === 'All' && assignee === 'All' && date === 'all' && !activeKpi ? (
                              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)} className="mt-2">Create Your First Task</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )
                    : pagedTasks.map((task) => (
                      <Tr key={task.id}
                        selected={selected.has(task.id)}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => handleRowClick(event, task)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openTaskDetails(task);
                          }
                        }}
                        className={`transition-colors duration-150 ${isOverdue(task) && !selected.has(task.id) ? 'bg-[rgba(239,68,68,0.04)] border-l-[3px] border-l-[var(--color-danger)]' : ''}`}
                      >
                        {/* Checkbox */}
                        <Td className="py-3" onClick={(event) => event.stopPropagation()}>
                          <UniversalCheckbox checked={selected.has(task.id)} onChange={() => toggleSelect(task.id)} ariaLabel={`Select ${task.title}`} />
                        </Td>

                        {/* Task Title + Avatar */}
                        <Td className="py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary-text)] flex items-center justify-center text-[11px] font-bold">
                              {(task.title || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-[var(--color-text)] leading-tight">{task.title || '—'}</span>
                                {isOverdue(task) && <span title="Task overdue"><AlertCircle className="h-3 w-3 shrink-0 text-[var(--color-danger)]" /></span>}
                              </div>
                              <span className="text-[12px] text-[var(--color-text-muted)] leading-tight">
                                {task.assignedToName ? `Assigned to ${task.assignedToName}` : <EmptyCell />}
                                {task.entityName && <> · {task.entityName}</>}
                              </span>
                            </div>
                          </div>
                        </Td>

                        {/* Assigned To */}
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)] whitespace-nowrap">
                          {task.assignedToName || <span className="inline-flex items-center rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">Unassigned</span>}
                        </Td>

                        {/* Created By */}
                        <Td className="py-3 text-[13px] text-[var(--color-text-secondary)] whitespace-nowrap">
                          <span className="truncate max-w-[150px] inline-block">{creatorNameFor(task)}</span>
                        </Td>

                        {/* Priority */}
                        <Td className="py-3">
                          <span data-interactive onClick={(e) => e.stopPropagation()}>{priorityBadge(task.priority)}</span>
                        </Td>

                        {/* Status (inline dropdown) */}
                        <Td className="py-3" onClick={(event) => event.stopPropagation()}>
                          <select
                            aria-label={`Status for ${task.title}`}
                            value={task.status}
                            onChange={(event) => void changeStatus(task.id, event.target.value as TaskStatus)}
                            onClick={(event) => event.stopPropagation()}
                            data-interactive
                            className={[
                              'h-[34px] w-[120px] rounded-md border px-2 text-xs font-semibold outline-none transition-colors cursor-pointer text-center',
                              'focus:ring-2 focus:ring-[var(--color-focus-ring)]',
                              task.status === 'Open' ? 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700' : '',
                              task.status === 'In Progress' ? 'border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700' : '',
                              task.status === 'Done' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' : '',
                              task.status === 'Cancelled' ? 'border-gray-300 bg-gray-50 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-600' : '',
                            ].join(' ')}
                          >
                            {['Open', 'In Progress', 'Done', 'Cancelled'].map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </Td>

                        {/* Due Date */}
                        <Td className="py-3">
                          {task.dueDate ? (
                            <span className={cn(
                              'text-xs whitespace-nowrap',
                              isOverdue(task) ? 'font-semibold text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]',
                            )}>
                              {isOverdue(task) && <AlertCircle className="h-3 w-3 inline mr-1 -mt-0.5" />}
                              {fmtDate(task.dueDate)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--color-text-disabled)]">—</span>
                          )}
                        </Td>

                        {/* Created Date */}
                        <Td className="py-3">
                          <CreatedDateCell value={task.createdAt} />
                        </Td>

                        {/* Actions: View only (row click opens modal) */}
                        <Td className="py-3" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end">
                            <Button size="xs" variant="outline" onClick={() => openTaskDetails(task)} className="shrink-0">
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              View
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    ))
                }
              </Tbody>
            </Table>
          </div>

          {/* ── Premium Pagination (inside table block) ────── */}
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination
              page={page}
              total={filteredTasks.length}
              perPage={perPage}
              onChange={changePage}
              onPerPageChange={changePerPage}
            />
          </div>
        </div>
      </Card>

      {/* ── Task Details Modal ──────────────────────────────── */}
      <Modal open={!!viewTask} onClose={closeTaskDetails} size="2xl">
        {viewTask && (() => {
          const tabs = [
            { key: 'overview', label: 'Overview' },
            { key: 'timeline', label: 'Timeline' },
            { key: 'comments', label: 'Comments' },
          ] as const;
          const creatorName = creatorNameFor(viewTask);
          return (
            <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
              <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                    {(viewTask.title || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{viewTask.title || 'Untitled Task'}</h2>
                      {statusBadge(viewTask.status)}
                      {priorityBadge(viewTask.priority)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      <span>Assigned: {viewTask.assignedToName || 'Unassigned'}</span>
                      <span>Created by: {creatorName}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-start gap-2" data-action>
                  <button onClick={closeTaskDetails} className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]" aria-label="Close task details">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              <nav className="shrink-0 grid grid-cols-3 gap-1 border-b border-[var(--color-border-subtle)] py-4">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setTaskDetailsTab(tab.key)}
                    className={[
                      'rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors',
                      taskDetailsTab === tab.key
                        ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                    ].join(' ')}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="min-h-0 flex-1 overflow-y-auto transition-opacity duration-150">
                {taskDetailsTab === 'overview' && (
                  <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-5">
                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Task Information</h3>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Detail label="Assigned To" value={viewTask.assignedToName || 'Unassigned'} />
                          <Detail label="Created By" value={creatorName} />
                          <Detail label="Priority" value={viewTask.priority} />
                          <Detail label="Due Date" value={viewTask.dueDate ? fmtDate(viewTask.dueDate) : 'No due date'} danger={isOverdue(viewTask)} />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</h3>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-secondary)]">
                          {viewTask.description || 'No description provided.'}
                        </p>
                      </div>

                      {viewTask.entityId && (
                        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Entity</h3>
                          <button
                            type="button"
                            className="mt-3 text-sm font-semibold text-[var(--color-primary)] hover:underline"
                            onClick={() => navigate(entityPath(viewTask), { state: { entityId: viewTask.entityId } })}
                          >
                            {viewTask.entityName || viewTask.entityType || viewTask.entityId}
                          </button>
                        </div>
                      )}
                    </div>

                    <aside className="space-y-4">
                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Created</h3>
                        <div className="mt-3 space-y-1">
                          <p className="font-semibold text-[var(--color-text)]">{fmtDate(viewTask.createdAt) || 'Not available'}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{fmtDateTime(viewTask.createdAt) || 'Time not available'}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
                        <div className="mt-3 space-y-2">
                          <Button variant="outline" size="sm" className="w-full justify-start" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { closeTaskDetails(); setEditingTask(viewTask); setModalOpen(true); }}>Edit Task</Button>
                          {viewTask.status !== 'Done' && (
                            <Button size="sm" className="w-full justify-start" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => {
                              void changeStatus(viewTask.id, 'Done').then(() => setViewTask({ ...viewTask, status: 'Done' }));
                            }}>Mark Complete</Button>
                          )}
                          <div className="border-t border-[var(--color-border-subtle)] pt-3">
                            <Button variant="danger" size="sm" className="w-full justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { closeTaskDetails(); setDeleteTarget(viewTask); }}>Delete Task</Button>
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                )}

                {taskDetailsTab === 'timeline' && (
                  <div className="pt-5">
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Timeline</h3>
                      <div className="mt-3 space-y-3">
                        <TimelineItem label="Created" value={fmtDateTime(viewTask.createdAt)} />
                        <TimelineItem label="Updated" value={fmtDateTime(viewTask.updatedAt)} />
                        {viewTask.status === 'Done' && <TimelineItem label="Completed" value={fmtDateTime(viewTask.updatedAt)} />}
                        {viewTask.isDeleted && <TimelineItem label="Deleted" value={fmtDateTime(viewTask.deletedAt)} />}
                      </div>
                    </div>
                  </div>
                )}

                {taskDetailsTab === 'comments' && (
                  <div className="pt-5">
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Comments</h3>
                      <p className="mt-3 text-sm text-[var(--color-text-muted)]">Task comments are not available in the current data model.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <CreateTaskModal
        open={modalOpen}
        task={editingTask}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
        onSubmit={submitTask}
      />

      <Modal open={bulkStatusOpen} onClose={() => { setBulkStatusOpen(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} task{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select
            label="New Status"
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value as TaskStatus)}
            options={[{ label: 'Select Status...', value: '' }, ...(['Open', 'In Progress', 'Done', 'Cancelled'] as TaskStatus[]).map((value) => ({ label: value, value }))]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setBulkStatusOpen(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => void bulkChangeStatus()}>Update {selected.size} Tasks</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={() => void bulkDelete()}
        title="Delete Tasks"
        message={`Cancel and hide ${selected.size} selected task${selected.size > 1 ? 's' : ''}?`}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteTask(deleteTarget.id).then(() => setDeleteTarget(null));
        }}
        title="Delete Task"
        message={`Cancel and hide "${deleteTarget?.title || 'this task'}"?`}
      />
    </div>
  );
}
