/**
 * TaskPanel — Shows leads/tasks assigned to current user.
 * Phase P1: Full semantic token compliance on themed surfaces/text.
 * VALID palette: indigo brand pigments, rose/amber/emerald urgency dots.
 *
 * Redesign pass: icon-badge header (matches every other dashboard panel),
 * row spacing/typography polish, refined empty state. Props, sort logic
 * and navigation targets are unchanged.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, ChevronRight, User } from 'lucide-react';
import { statusBadge } from '../ui/Badge';
import { ageDays } from '../../lib/firestore';

interface TaskPanelProps {
  tasks: any[];
  loading?: boolean;
}

function SkeletonTask() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      <div className="h-6 w-6 rounded bg-[var(--color-bg-sunken)] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-28 rounded bg-[var(--color-bg-sunken)]" />
        <div className="h-2 w-16 rounded bg-[var(--color-bg-sunken)] opacity-60" />
      </div>
    </div>
  );
}

const STATUS_URGENCY: Record<string, number> = {
  'New': 3, 'Follow-up': 2, 'Qualified': 1,
};

export const TaskPanel = React.memo(function TaskPanel({ tasks, loading }: TaskPanelProps) {
  const navigate = useNavigate();

  const sorted = React.useMemo(() =>
    [...tasks].sort((a, b) =>
      (STATUS_URGENCY[b.status] ?? 0) - (STATUS_URGENCY[a.status] ?? 0)
    ), [tasks]);

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-[var(--color-primary-light)] p-1.5 text-[var(--color-primary-text)]">
            <CheckSquare className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-[var(--color-text)]">My Tasks</h3>
        </div>
        {/* VALID: indigo badge is fixed primary brand pigment count indicator */}
        {!loading && tasks.length > 0 && (
          <span className="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold px-2 py-0.5 rounded-full ring-1 ring-indigo-200 dark:ring-indigo-800/60">
            {tasks.length}
          </span>
        )}
      </div>

      <div className="p-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-2"><SkeletonTask /></div>
            ))
          : sorted.length === 0
          ? (
            <div className="flex flex-col items-center gap-1.5 py-10">
              {/* Empty state icon: text-disabled (decorative, no entity to render) */}
              <User className="h-7 w-7 text-[var(--color-text-disabled)]" />
              <p className="text-xs text-[var(--color-text-muted)]">No tasks assigned to you</p>
            </div>
          )
          : sorted.map((task) => (
              <button
                key={task.id}
                onClick={() => navigate('/leads')}
                className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] w-full text-left group transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {/* VALID: rose/amber/emerald are fixed 3-tier urgency pigments (traffic light) */}
                <div className={[
                  'h-2 w-2 rounded-full shrink-0 mt-0.5',
                  ageDays(task.createdAt) > 3 ? 'bg-rose-400' : ageDays(task.createdAt) > 1 ? 'bg-amber-400' : 'bg-emerald-400',
                ].join(' ')} />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                    {task.name ?? '—'}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                    {task.company ?? task.city ?? 'No company'} · {ageDays(task.createdAt)}d old
                  </p>
                </div>

                {statusBadge(task.status ?? 'New')}

                {/* Chevron: decorative navigation affordance — text-disabled */}
                <ChevronRight className="h-3 w-3 text-[var(--color-text-disabled)] shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </button>
            ))
        }

        {/* VALID: indigo-600 is primary brand link color */}
        {!loading && sorted.length > 0 && (
          <button
            onClick={() => navigate('/leads')}
            className="flex items-center justify-center gap-1 w-full mt-1 py-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-semibold transition-colors"
          >
            View all leads <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
});
