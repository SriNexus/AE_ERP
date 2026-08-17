/**
 * ProjectHealthCard — Right Panel widget (Project Workspace Phase 2
 * Completion & Structure Fix mission). Visual pattern follows the
 * equivalent Customer Workspace health widget's structure (badge + metric
 * rows) exactly, driven by the Project-appropriate 3-tier
 * calculateProjectHealth() (see projectHealth.ts) — not a numeric score,
 * not a relabeled copy of Customer's own signals.
 */
import { HeartPulse, Clock, AlertTriangle, Layers } from 'lucide-react';
import { calculateProjectHealth } from '../../../services/projectHealth';
import { useProjectStage } from '../../../../../hooks/useProjectStage';
import type { ProjectRecord } from '../../../types';

interface Props {
  project: ProjectRecord;
}

const LEVEL_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  attention: 'Needs Attention',
  risk: 'At Risk',
};

const LEVEL_COLOR: Record<string, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  attention: 'text-amber-600 dark:text-amber-400',
  risk: 'text-red-600 dark:text-red-400',
};

const LEVEL_BG: Record<string, string> = {
  healthy: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
  attention: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
  risk: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
};

function fmtDays(d: number | null): string {
  if (d === null) return '—';
  if (d === 0) return 'Today';
  return `${d}d ago`;
}

export default function ProjectHealthCard({ project }: Props) {
  const { level, signals } = calculateProjectHealth(project);
  const { stages, completedCount } = useProjectStage(project);
  const percent = stages.length ? Math.round((completedCount / stages.length) * 100) : 0;

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Health</h3>

      <div className={['rounded-lg border p-3 mb-3', LEVEL_BG[level]].join(' ')}>
        <div className="flex items-center gap-2.5">
          <HeartPulse className={['h-5 w-5 shrink-0', LEVEL_COLOR[level]].join(' ')} />
          <div>
            <p className={['text-[12px] font-bold', LEVEL_COLOR[level]].join(' ')}>{LEVEL_LABEL[level]}</p>
            <p className="text-[9px] text-[var(--color-text-muted)]">
              {signals.isArchived ? 'Project archived' : 'Progress status'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><Layers className="h-3 w-3" />Progress</span>
          <span className="text-[11px] font-semibold text-[var(--color-text)]">{completedCount}/{stages.length} · {percent}%</span>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><Clock className="h-3 w-3" />Last Stage Change</span>
          <span className="text-[11px] font-semibold text-[var(--color-text)]">{fmtDays(signals.daysSinceLastStageChange)}</span>
        </div>
        {signals.hasAttentionStage && (
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Attention</span>
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Stage needs review</span>
          </div>
        )}
      </div>
    </div>
  );
}
