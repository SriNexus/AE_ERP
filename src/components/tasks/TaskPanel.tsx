import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ListTodo, Plus } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Select, statusBadge } from '../ui';
import { CreateTaskModal } from './CreateTaskModal';
import { useTasks } from '../../hooks/useTasks';
import type { Task, TaskStatus } from '../../types';

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

type TaskPanelProps = {
  variant?: 'default' | 'mobile' | 'dashboard';
};

export function TaskPanel({ variant = 'default' }: TaskPanelProps) {
  const navigate = useNavigate();
  const { allTasks, createTask, changeStatus, loading, error } = useTasks();
  const [modalOpen, setModalOpen] = useState(false);
  const openTasks = useMemo(() => allTasks.filter((task) => task.status !== 'Done' && task.status !== 'Cancelled'), [allTasks]);
  const visibleTasks = useMemo(() => sortOpenTasks(openTasks).slice(0, 8), [openTasks]);

  const mobile = variant === 'mobile';
  const dashboard = variant === 'dashboard';

  return (
    <>
      <Card onClick={() => navigate('/tasks')} className={dashboard ? 'flex h-full min-h-0 cursor-pointer flex-col overflow-hidden shadow-[var(--shadow-enterprise-surface)] ring-1 ring-[var(--color-border)] transition-all duration-200 hover:shadow-[var(--shadow-enterprise-elevated)] hover:ring-[var(--color-border-strong)]' : 'cursor-pointer'}>
        <CardHeader className={mobile ? 'px-4 py-3' : dashboard ? 'px-5 py-4' : undefined}>
          <div className="flex items-center gap-3">
            <CardTitle>Tasks</CardTitle>
            {!loading && <span className={['inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-extrabold leading-none tracking-wider', openTasks.length ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]' : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] ring-1 ring-[var(--color-border)]'].join(' ')}>{openTasks.length}</span>}
          </div>
          <div className={mobile ? 'flex items-center gap-1.5' : 'flex items-center gap-2.5'}>
            <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={(event) => { event.stopPropagation(); setModalOpen(true); }} className="font-semibold shadow-[var(--shadow-enterprise-control)]">Add Task</Button>
            <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); navigate('/tasks'); }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-xs">View All →</Button>
          </div>
        </CardHeader>
        <CardBody className={mobile ? 'space-y-2 px-3 py-3' : dashboard ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4 scrollbar-thin [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)] [&::-webkit-scrollbar-track]:bg-transparent' : 'space-y-3'}>
          {error && <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{error}</div>}
          {loading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-12 w-full rounded-lg" />)}</div>}
          {!loading && visibleTasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={<ListTodo className="h-8 w-8" />} title="No open tasks" description="New assignments will appear here." />
            </div>
          )}
          {!loading && visibleTasks.map((task) => (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/tasks/${task.id}`);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  navigate(`/tasks/${task.id}`);
                }
              }}
              className={['flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 text-left transition-all duration-200', dashboard ? 'shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[var(--shadow-enterprise-row)] hover:border-[var(--color-border-strong)] hover:-translate-y-0.5 active:translate-y-0' : 'hover:bg-[var(--color-surface-hover)]'].join(' ')}
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 self-start text-[var(--color-text-muted)]" />
              <div className="min-w-0 flex-1">
                <div className={mobile ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{task.title}</p>
                  {statusBadge(task.priority)}
                </div>
                <p className={['mt-0.5 text-xs', isOverdue(task) ? 'font-semibold text-[var(--color-danger-text)]' : 'text-[var(--color-text-muted)]'].join(' ')}>
                  <span className={isOverdue(task) ? 'font-bold' : ''}>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'}</span>
                  <span className="mx-1 text-[var(--color-text-disabled)]">·</span>
                  <span>{task.assignedToName}</span>
                </p>
              </div>
              <Select
                aria-label="Task status"
                value={task.status}
                options={['Open', 'In Progress', 'Done', 'Cancelled'].map((value) => ({ label: value, value }))}
                className={mobile ? 'w-24 text-xs' : 'w-[100px] text-xs'}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => void changeStatus(task.id, event.target.value as TaskStatus)}
              />
            </div>
          ))}
        </CardBody>
      </Card>
      <CreateTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(payload) => createTask(payload)}
      />
    </>
  );
}
