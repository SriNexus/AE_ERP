/**
 * LeadHealthCard — Right panel widget showing lead health summary.
 * Displays Score, Pending Tasks, Last Contact, Open Follow-ups.
 *
 * Phase 1 — Business boundary enforced.
 * Removed: documentCount (belongs to Customer Workspace, not Lead Processing).
 */

interface Props {
  score: { score: number; band: string } | null;
  totalFollowups: number;
  daysSinceContact: string;
  callsMade: number;
  daysOpen: number;
}

const BAND_COLORS: Record<string, string> = {
  hot: 'text-emerald-500',
  warm: 'text-amber-500',
  cold: 'text-blue-400',
};

const BAND_BG: Record<string, string> = {
  hot: 'bg-emerald-50 dark:bg-emerald-900/20',
  warm: 'bg-amber-50 dark:bg-amber-900/20',
  cold: 'bg-blue-50 dark:bg-blue-900/20',
};

const BAND_BORDER: Record<string, string> = {
  hot: 'border-emerald-200 dark:border-emerald-800',
  warm: 'border-amber-200 dark:border-amber-800',
  cold: 'border-blue-200 dark:border-blue-800',
};

export default function LeadHealthCard({ score, totalFollowups, daysSinceContact, callsMade, daysOpen }: Props) {
  const band = score?.band || 'cold';

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Lead Metrics</h3>

      {/* Score Badge */}
      <div className={['rounded-lg border p-3 mb-3', BAND_BORDER[band], BAND_BG[band]].join(' ')}>
        <div className="flex items-center gap-3">
          <div className={['flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold ring-2 ring-white dark:ring-slate-800', BAND_COLORS[band], BAND_BG[band]].join(' ')}>
            {score?.score || '—'}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-[var(--color-text)]">{score ? `${score.band.toUpperCase()} (${score.score})` : 'Unscored'}</p>
            <p className="text-[9px] text-[var(--color-text-muted)]">Lead Score</p>
          </div>
        </div>
      </div>

      {/* Operational Metrics */}
      <div className="space-y-2">
        {[
          { label: 'Lead Age', value: `${daysOpen}d` },
          { label: 'Calls Attempted', value: String(callsMade) },
          { label: 'Last Contact', value: daysSinceContact || '—' },
          { label: 'Open Follow-ups', value: String(totalFollowups) },
        ].map((m, i) => (
          <div key={i} className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--color-text-muted)]">{m.label}</span>
            <span className="text-[11px] font-semibold text-[var(--color-text)]">{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
