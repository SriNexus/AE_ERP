/**
 * CustomerRecentActivity — Right Panel widget (Phase 4). Reads
 * customer.activityLog[] — no new collection, no fabricated entries.
 * Visual pattern follows LeadWorkspace.tsx's own "Recent Activity" widget
 * (newest first, compact rows, "+N more"), adapted to the Right Panel's
 * width. Unlike the Left Panel's Activity-tab context (Phase 3, which
 * excludes Notes since Notes has its own tab there), this is a general
 * persistent feed and intentionally includes every activityLog entry type —
 * mirroring Lead's own Recent Activity widget, which is likewise unfiltered.
 */
import { Activity } from 'lucide-react';

const CAP = 8;

/** Pure — newest-first, capped. Exported for unit testing. */
export function deriveRecentActivity(customer: any, cap: number = CAP): { entries: any[]; totalCount: number } {
  const all = ((customer?.activityLog || []) as any[])
    .slice()
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return { entries: all.slice(0, cap), totalCount: all.length };
}

function fmtWhen(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function CustomerRecentActivity({ customer }: { customer: any }) {
  const { entries, totalCount } = deriveRecentActivity(customer);

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recent Activity</h3>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry: any, idx: number) => (
            <div key={entry.id || idx} className="flex items-start gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-[var(--color-text)]">{entry.actionLabel || entry.desc || entry.type || 'Activity'}</p>
                <p className="text-[9px] text-[var(--color-text-muted)]">{fmtWhen(entry.date)}{entry.userName ? ` · ${entry.userName}` : ''}</p>
              </div>
            </div>
          ))}
          {totalCount > entries.length && (
            <p className="text-[10px] font-medium text-[var(--color-text-muted)] mt-1">+{totalCount - entries.length} more entries</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Activity className="h-5 w-5 text-[var(--color-text-disabled)]" />
          <p className="text-[11px] text-[var(--color-text-muted)]">No activity yet</p>
        </div>
      )}
    </div>
  );
}
