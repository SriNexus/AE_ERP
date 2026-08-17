import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Eye, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ConfirmDialog, Modal, Select } from '../../ui';
import { CreateTaskModal } from '../../tasks/CreateTaskModal';
import { useTasks } from '../../../hooks/useTasks';
import { COLLECTIONS } from '../../../lib/firebase';
import { fmtDate, getAll } from '../../../lib/firestore';
import type { Task, TaskStatus } from '../../../types';
import { cn } from '../../../utils/cn';

const STATUS_OPTIONS = ['All', 'Open', 'In Progress', 'Done', 'Cancelled'];
const PRIORITY_OPTIONS = ['All', 'Low', 'Medium', 'High', 'Urgent'];
const DATE_OPTIONS = [
  { label: 'All dates', value: 'all' },
  { label: 'Due today', value: 'today' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Next 7 days', value: 'week' },
  { label: 'No due date', value: 'none' },
];

type Mode = 'records' | 'create';
type TaskFormPayload = Parameters<ReturnType<typeof useTasks>['createTask']>[0];
type Filters = {
  search: string;
  status: string;
  priority: string;
  assignee: string;
  date: string;
};

export const MOBILE_TASK_DATE_OPTIONS = DATE_OPTIONS;
export const MOBILE_TASK_STATUS_OPTIONS = STATUS_OPTIONS;
export const MOBILE_TASK_PRIORITY_OPTIONS = PRIORITY_OPTIONS;

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

function priorityVariant(priority: Task['priority']) {
  if (priority === 'Urgent') return 'danger' as const;
  if (priority === 'High') return 'warning' as const;
  if (priority === 'Low') return 'gray' as const;
  return 'info' as const;
}

function filterTasks(tasks: Task[], filters: Filters, creatorNameFor: (task: Task) => string) {
  const term = filters.search.trim().toLowerCase();
  return tasks
    .filter((task) => {
      if (filters.status !== 'All' && task.status !== filters.status) return false;
      if (filters.priority !== 'All' && task.priority !== filters.priority) return false;
      if (filters.assignee !== 'All' && task.assignedToName !== filters.assignee) return false;
      if (filters.date === 'today' && !isDueToday(task)) return false;
      if (filters.date === 'overdue' && !isOverdue(task)) return false;
      if (filters.date === 'week' && !isDueThisWeek(task)) return false;
      if (filters.date === 'none' && task.dueDate) return false;
      if (!term) return true;
      return [task.title, task.description, task.assignedToName, creatorNameFor(task), task.entityName]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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

export function MobileTaskWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { allTasks, createTask, updateTask, deleteTask, changeStatus, loading, error } = useTasks();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (mode === 'create') setModalOpen(true);
  }, [mode]);

  const creatorNameFor = useMemo(() => {
    const userMap = new Map((users as any[]).map((user) => [user.id, user.name || user.email || user.id]));
    return (task: Task) => userMap.get(task.createdBy) || task.createdBy || 'System';
  }, [users]);

  const filters = useMemo<Filters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || 'All',
    priority: params.get('priority') || 'All',
    assignee: params.get('assignee') || 'All',
    date: params.get('date') || 'all',
  }), [params]);

  const filteredTasks = useMemo(
    () => filterTasks(allTasks, filters, creatorNameFor),
    [allTasks, creatorNameFor, filters],
  );

  useEffect(() => {
    setSelected((current) => {
      const available = new Set(allTasks.map((task) => task.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [allTasks]);

  const selectedRows = useMemo(
    () => allTasks.filter((task) => selected.has(task.id)),
    [allTasks, selected],
  );

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submitTask(payload: TaskFormPayload) {
    if (editingTask) {
      await updateTask(editingTask.id, payload);
      setEditingTask(null);
      return;
    }
    await createTask(payload);
  }

  function exportRows(rows: Task[]) {
    if (!rows.length) return toast.error('No tasks selected');
    downloadTasksCsv(rows, creatorNameFor, `tasks-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} task${rows.length > 1 ? 's' : ''}`);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((task) => deleteTask(task.id)));
    toast.success(`Deleted ${selectedRows.length} task${selectedRows.length > 1 ? 's' : ''}`);
    setSelected(new Set());
    setDeleteOpen(false);
  }

  // Dedicated create mode — renders only the modal, closes via browser back
  if (mode === 'create') {
    return (
      <TaskDialogs
        modalOpen={modalOpen}
        setModalOpen={(open) => {
          setModalOpen(open);
          if (!open) {
            // Go back to previous page. Fallback to home if no history.
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/', { replace: true });
            }
          }
        }}
        editingTask={editingTask}
        setEditingTask={setEditingTask}
        submitTask={submitTask}
        deleteOpen={deleteOpen}
        setDeleteOpen={setDeleteOpen}
        deleteSelected={deleteSelected}
        deleteCount={selectedRows.length}
      />
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <div className="px-1 pt-1">
        <h1 className="text-lg font-bold text-[var(--color-text)]">Records</h1>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Home module tasks</p>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">
              {selected.size} selected
            </span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>
              Export
            </Button>
            <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            >
              Clear
            </button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading && <p className="px-1 py-6 text-sm text-[var(--color-text-muted)]">Loading tasks...</p>}
        {!loading && filteredTasks.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No tasks match the current filters.
          </Card>
        )}
        {!loading && filteredTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            creatorName={creatorNameFor(task)}
            selected={selected.has(task.id)}
            onSelect={() => toggleSelect(task.id)}
            onView={() => setViewTask(task)}
            onStatusChange={(status) => void changeStatus(task.id, status)}
          />
        ))}
      </div>

      <Modal open={!!viewTask} onClose={() => setViewTask(null)} title={viewTask?.title || 'Task'} size="full">
        {viewTask && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={priorityVariant(viewTask.priority)}>{viewTask.priority}</Badge>
              <Badge variant={viewTask.status === 'Done' ? 'success' : viewTask.status === 'Cancelled' ? 'danger' : 'info'}>{viewTask.status}</Badge>
            </div>
            <Detail label="Assigned To" value={viewTask.assignedToName || 'Unassigned'} />
            <Detail label="Created By" value={creatorNameFor(viewTask)} />
            <Detail label="Due Date" value={viewTask.dueDate ? fmtDate(viewTask.dueDate) : 'No due date'} />
            <Detail label="Linked Entity" value={viewTask.entityName || viewTask.entityType || 'None'} />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{viewTask.description || 'No description provided.'}</p>
            </div>
          </div>
        )}
      </Modal>

      <TaskDialogs
        modalOpen={modalOpen}
        setModalOpen={setModalOpen}
        editingTask={editingTask}
        setEditingTask={setEditingTask}
        submitTask={submitTask}
        deleteOpen={deleteOpen}
        setDeleteOpen={setDeleteOpen}
        deleteSelected={deleteSelected}
        deleteCount={selectedRows.length}
      />
    </div>
  );
}

function TaskCard({
  task,
  creatorName,
  selected,
  onSelect,
  onView,
  onStatusChange,
}: {
  task: Task;
  creatorName: string;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onStatusChange: (status: TaskStatus) => void;
}) {
  return (
    <Card className={cn('rounded-xl p-3', isOverdue(task) && 'border-l-4 border-l-red-500')}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-indigo-600"
          aria-label={`Select ${task.title}`}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start gap-2">
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-bold text-[var(--color-text)]">{task.title || 'Untitled Task'}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {task.assignedToName || 'Unassigned'} · Created by {creatorName}
              </p>
            </button>
            <button
              type="button"
              onClick={onView}
              aria-label={`View ${task.title}`}
              className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)]"
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Badge variant={priorityVariant(task.priority)}>{task.priority}</Badge>
            <span className={cn('text-xs font-semibold', isOverdue(task) ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-muted)]')}>
              {task.dueDate ? fmtDate(task.dueDate) : 'No due date'}
            </span>
          </div>

          <Select
            aria-label={`Status for ${task.title}`}
            value={task.status}
            options={['Open', 'In Progress', 'Done', 'Cancelled'].map((value) => ({ label: value, value }))}
            onChange={(event) => onStatusChange(event.target.value as TaskStatus)}
          />
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

function TaskDialogs({
  modalOpen,
  setModalOpen,
  editingTask,
  setEditingTask,
  submitTask,
  deleteOpen,
  setDeleteOpen,
  deleteSelected,
  deleteCount,
}: {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  editingTask: Task | null;
  setEditingTask: (task: Task | null) => void;
  submitTask: (payload: TaskFormPayload) => Promise<void>;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  deleteSelected: () => Promise<void>;
  deleteCount: number;
}) {
  return (
    <>
      <CreateTaskModal
        open={modalOpen}
        task={editingTask}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
        onSubmit={submitTask}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        title="Delete Tasks"
        message={`Cancel and hide ${deleteCount} selected task${deleteCount > 1 ? 's' : ''}?`}
      />
    </>
  );
}

export default MobileTaskWorkspace;
