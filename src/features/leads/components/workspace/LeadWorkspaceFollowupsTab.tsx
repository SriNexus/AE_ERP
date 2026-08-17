/**
 * FollowupsTab — Follow-ups tab content.
 * Shows Overdue, Upcoming, and Completed follow-ups.
 * UI only — mock/activity data driven, no persistence.
 * Phase 1 Polish — Better section spacing, card design, visual hierarchy.
 */
import { Calendar, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface FollowupEntry {
  id: string;
  date: string;
  type: string;
  desc: string;
  userName?: string;
}

interface Props {
  activities: FollowupEntry[];
  nextDate?: string;
  isOverdue: boolean;
}

export default function FollowupsTab({ activities, nextDate, isOverdue }: Props) {
  const followups = activities.filter(a => a.type === 'Follow-up');
  const upcoming = nextDate && !isOverdue ? [{ id: 'next', date: nextDate, desc: 'Scheduled follow-up', type: 'Upcoming', userName: '—' }] : [];
  const overdue = nextDate && isOverdue ? [{ id: 'over', date: nextDate, desc: 'Overdue follow-up', type: 'Overdue', userName: '—' }] : [];
  const completed = followups.slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Overdue Section */}
      {overdue.length > 0 && (
        <div className="rounded-2xl border-2 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            </div>
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Overdue</h3>
          </div>
          <div className="space-y-2.5">
            {overdue.map(f => (
              <div key={f.id} className="flex items-center justify-between rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3.5">
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300">{f.desc}</p>
                  <p className="text-[10px] text-red-500 mt-0.5">Due: {f.date}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                  <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Section */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <Calendar className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Upcoming</h3>
        </div>
        {upcoming.length > 0 ? (
          <div className="space-y-2.5">
            {upcoming.map(f => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-3.5 transition-colors hover:border-[var(--color-border)]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-900/20">
                  <Calendar className="h-4 w-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-text)]">{f.desc}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{f.date}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-600 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  <Clock className="h-2.5 w-2.5" /> Pending
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Calendar className="h-8 w-8 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No upcoming follow-ups</p>
          </div>
        )}
      </div>

      {/* Completed Section */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Completed</h3>
          {completed.length > 0 && (
            <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{completed.length} total</span>
          )}
        </div>
        {completed.length > 0 ? (
          <div className="space-y-2">
            {completed.map((f, idx) => (
              <div key={f.id || idx} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-3.5 transition-colors hover:border-[var(--color-border)]">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--color-text-secondary)]">{f.desc}</p>
                  <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] mt-0.5">
                    <span>{f.userName || 'System'}</span>
                    <span>·</span>
                    <span>{f.date}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No completed follow-ups</p>
          </div>
        )}
      </div>
    </div>
  );
}
