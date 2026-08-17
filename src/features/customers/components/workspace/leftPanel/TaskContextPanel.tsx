/**
 * TaskContextPanel — Left Panel's Tasks-tab context (Phase 3).
 *
 * Reuses `taskEngine.getTasksForEntity()` — the exact same function
 * `UniversalTasksTab` calls — no new domain service. `UniversalTasksTab`
 * keeps its fetch in local component state (not a shared cache), so this is
 * a second invocation of the same existing function, not a new one; it is
 * tab-gated (`enabled: active`) so it only runs while the Tasks tab is open,
 * not on every tab switch. Documented as a known, low-cost duplication in
 * the Phase 3 report rather than left unstated.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ListTodo, Clock } from 'lucide-react';
import { taskEngine } from '../../../../../engines/TaskEngine';

interface Props {
  customerId: string;
  companyId: string;
  active: boolean;
}

export interface TaskSummary {
  total: number;
  open: any[];
  escalated: any[];
  upcoming: any[];
}

/** Pure task-summarization logic — unit-testable without rendering. */
export function summarizeTasks(tasks: any[]): TaskSummary {
  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const escalated = open.filter((t) => t.escalationLevel > 0);
  const upcoming = [...open]
    .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime())
    .slice(0, 3);
  return { total: tasks.length, open, escalated, upcoming };
}

export default function TaskContextPanel({ customerId, companyId, active }: Props) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['customer-left-panel-tasks', customerId],
    queryFn: () => taskEngine.getTasksForEntity(customerId, 'customers', companyId),
    enabled: active && !!customerId,
  });

  if (isLoading) {
    return <div className="h-24 rounded-xl bg-[var(--color-bg-sunken)] animate-pulse" />;
  }

  const { total, open, escalated, upcoming } = summarizeTasks(tasks);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <ListTodo className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Task Summary</h4>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span><strong className="text-sm">{open.length}</strong> open</span>
          <span><strong className="text-sm">{total}</strong> total</span>
          {escalated.length > 0 && (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <AlertCircle className="h-3 w-3" />{escalated.length} escalated
            </span>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] px-1">Upcoming</p>
          {upcoming.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5">
              <p className="text-xs font-medium text-[var(--color-text)] truncate">{t.title}</p>
              {t.dueDate && (
                <p className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1 mt-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {new Date(t.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
