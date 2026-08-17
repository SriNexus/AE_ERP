import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import { Button, Select, statusBadge } from '../../ui';
import { useTasks } from '../../../hooks/useTasks';
import type { Task, TaskStatus } from '../../../types';
import { MobileHomeCard, MobileHomeEmptyState, MobileHomeSkeletonRows } from './MobileHomeCard';

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === 'Done' || task.status === 'Cancelled') return false;
  const due = new Date(`${task.dueDate}T23:59:59`);
  return due.getTime() < Date.now();
}

function sortOpenTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const overdueDelta = Number(isOverdue(b)) - Number(isOverdue(a));
    if (overdueDelta) return overdueDelta;
    const dueDelta = String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'));
    if (dueDelta) return dueDelta;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

export function MobileTasksCard() {
  const navigate = useNavigate();
  const { allTasks, changeStatus, loading, error } = useTasks();

  const openTasks = useMemo(
    () => allTasks.filter((task) => task.status !== 'Done' && task.status !== 'Cancelled'),
    [allTasks]
  );
  const visibleTasks = useMemo(() => sortOpenTasks(openTasks).slice(0, 5), [openTasks]);

  return (
    <MobileHomeCard
      title="Tasks"
      bodyClassName="p-0"
      actions={
        <>
          <Button
            size="xs"
            variant="outline"
            icon={<Plus className="h-3.5 w-3.5" />}
            className="min-h-8 px-2"
            onClick={() => navigate('/create')}
          >
            Add Task
          </Button>
          <Button size="xs" variant="ghost" className="min-h-8 px-2" onClick={() => navigate('/tasks')}>
            View All
          </Button>
        </>
      }
    >
      {error && (
        <div className="m-3 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-xs text-[var(--color-danger-text)]">
          {error}
        </div>
      )}
      {loading ? (
        <div className="px-3"><MobileHomeSkeletonRows count={5} /></div>
      ) : visibleTasks.length === 0 ? (
        <MobileHomeEmptyState
          icon={<ListTodo className="h-5 w-5" />}
          title="No open tasks"
          description="New assignments and follow-ups will appear here."
        />
      ) : (
        <div className="divide-y divide-[var(--color-border-subtle)] px-3">
          {visibleTasks.map((task) => (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/tasks/${task.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/tasks/${task.id}`);
                }
              }}
              className="flex min-h-[68px] items-center gap-3 py-3 text-left transition-colors active:scale-[0.99]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-sunken)] text-[var(--color-primary)] ring-1 ring-[var(--color-border)]">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{task.title}</p>
                  {statusBadge(task.priority)}
                </div>
                <p className={isOverdue(task) ? 'mt-0.5 truncate text-xs font-semibold text-[var(--color-danger-text)]' : 'mt-0.5 truncate text-xs text-[var(--color-text-muted)]'}>
                  {task.dueDate ? `Due ${task.dueDate}` : 'No due date'} · {task.assignedToName || 'Unassigned'}
                </p>
              </div>
              <Select
                aria-label="Task status"
                value={task.status}
                options={['Open', 'In Progress', 'Done', 'Cancelled'].map((value) => ({ label: value, value }))}
                className="w-[92px] text-xs"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => void changeStatus(task.id, event.target.value as TaskStatus)}
              />
            </div>
          ))}
        </div>
      )}
    </MobileHomeCard>
  );
}
