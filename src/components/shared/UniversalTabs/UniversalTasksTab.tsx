/**
 * UniversalTasksTab — Linked tasks viewer with add/complete/escalation
 *
 * Phase 0B: Uses TaskEngine for data and TaskEngineAPI operations.
 * Shows tasks linked to the current entity, with add task capability,
 * complete task action, and escalation level badges.
 *
 * Props: UniversalTabProps (entityId, entityType, companyId, permissions, record, caseId)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Clock, ListTodo, Plus, X } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import { Button } from '../../ui/Button';
import { taskEngine } from '../../../engines/TaskEngine';
import type { TaskRecord } from '../../../types';
import type { UniversalTabProps } from '../../../types';

// ── Escalation badge colors ─────────────────────────────────

const ESCALATION_COLORS: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  3: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  4: 'bg-rose-200 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

// ── Add Task Form ───────────────────────────────────────────

function AddTaskForm({
  entityId,
  entityType,
  companyId,
  caseId,
  onTaskAdded,
  onCancel,
}: {
  entityId: string;
  entityType: string;
  companyId: string;
  caseId?: string;
  onTaskAdded: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskRecord['priority']>('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError('');

    try {
      await taskEngine.createTask({
        title: title.trim(),
        assigneeId: '',
        assigneeName: '',
        priority,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        linkedEntityId: entityId,
        linkedEntityType: entityType,
        caseId,
        companyId,
      });
      setTitle('');
      onTaskAdded();
    } catch (err: any) {
      setError(err.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }, [title, priority, entityId, entityType, caseId, companyId, onTaskAdded]);

  return (
    <form onSubmit={handleSubmit} className="p-4 rounded-xl bg-[var(--color-bg-sunken)] border border-[var(--color-border-subtle)] space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
          autoFocus
          disabled={saving}
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskRecord['priority'])}
          className="px-2 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40"
          disabled={saving}
        >
          <option value="low">Low</option>
          <option value="medium">Med</option>
          <option value="high">High</option>
          <option value="critical">Crit</option>
        </select>
      </div>

      {error && (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving || !title.trim()}>
          {saving ? 'Adding...' : 'Add Task'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Main Component ──────────────────────────────────────────

export function UniversalTasksTab({
  entityId,
  entityType,
  companyId,
  permissions,
  caseId,
}: UniversalTabProps) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!entityId || !entityType) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await taskEngine.getTasksForEntity(entityId, entityType, companyId);
      setTasks(results);
    } catch (err: any) {
      // Fallback: if the engine throws (e.g., Firestore not configured),
      // silently show empty state
      setTasks([]);
      if (err.message && !err.message.includes('not configured')) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, companyId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleComplete = useCallback(async (taskId: string) => {
    try {
      await taskEngine.completeTask(taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'completed' as const } : t)),
      );
    } catch {
      // Silently fail
    }
  }, []);

  const handleRefresh = useCallback(() => {
    fetchTasks();
  }, [fetchTasks]);

  const canCreate = permissions.canCreate !== false;
  const sortedTasks = useMemo(() => {
    const active = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    const done = tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled');
    return [
      ...active.sort((a, b) => {
        // Sort by escalation level desc, then by priority
        if (a.escalationLevel !== b.escalationLevel) return b.escalationLevel - a.escalationLevel;
        const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (prioOrder[a.priority] ?? 99) - (prioOrder[b.priority] ?? 99);
      }),
      ...done.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()),
    ];
  }, [tasks]);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] p-4 text-sm text-[var(--color-danger-text)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <ListTodo className="h-4 w-4" />
          <span>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
          {tasks.some((t) => t.escalationLevel > 0) && (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{tasks.filter((t) => t.escalationLevel > 0).length} escalated</span>
            </span>
          )}
        </div>

        {canCreate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setShowAddForm(true)}
          >
            Add task
          </Button>
        )}
      </div>

      {/* Add task form */}
      {showAddForm && (
        <div className="px-6 py-3 border-b border-[var(--color-border-subtle)]">
          <AddTaskForm
            entityId={entityId}
            entityType={entityType}
            companyId={companyId}
            caseId={caseId}
            onTaskAdded={handleRefresh}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-6">
        {sortedTasks.length === 0 ? (
          <EmptyState
            title="No tasks linked to this record"
            description={canCreate ? 'Add a task to track what needs to be done.' : undefined}
            compact
          />
        ) : (
          <div className="space-y-2">
            {sortedTasks.map((task) => {
              const isDone = task.status === 'completed' || task.status === 'cancelled';
              return (
                <div
                  key={task.id}
                  className={cn(
                    'group flex items-start gap-3 p-3 rounded-xl border border-[var(--color-border-subtle)] transition-all duration-150',
                    isDone
                      ? 'bg-[var(--color-bg-sunken)]/50 opacity-60'
                      : 'bg-[var(--color-surface)] hover:border-[var(--color-border)]',
                  )}
                >
                  {/* Complete button */}
                  {!isDone && permissions.canEdit !== false ? (
                    <button
                      type="button"
                      onClick={() => handleComplete(task.id)}
                      className="mt-0.5 shrink-0 text-[var(--color-text-muted)] hover:text-emerald-500 transition-colors"
                      title="Mark as completed"
                    >
                      <Circle className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="mt-0.5 shrink-0">
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <X className="h-4 w-4 text-[var(--color-text-muted)]" />
                      )}
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          isDone ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]',
                        )}
                      >
                        {task.title}
                      </span>

                      {/* Priority badge */}
                      <span className={cn(
                        'text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                        PRIORITY_COLORS[task.priority] || '',
                      )}>
                        {task.priority}
                      </span>

                      {/* Escalation badge */}
                      {task.escalationLevel > 0 && (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded-md inline-flex items-center gap-1',
                          ESCALATION_COLORS[task.escalationLevel] || '',
                        )}>
                          <AlertCircle className="h-3 w-3" />
                          L{task.escalationLevel}
                        </span>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--color-text-muted)]">
                      {task.assigneeName && (
                        <span>{task.assigneeName}</span>
                      )}
                      {task.dueDate && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(task.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {task.createdAt && (
                        <span>
                          Created {new Date(task.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalTasksTab;
