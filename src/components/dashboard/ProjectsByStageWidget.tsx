/**
 * ProjectsByStageWidget — Projects grouped by lifecycle stage.
 *
 * Redesign pass: light touch only — this panel already matched the target
 * aesthetic. Padding/gap brought in line with the new spacing scale used
 * across the dashboard. Hooks, permissions, data and navigation unchanged.
 */

import { ArrowRight, FolderKanban } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useProjects } from '../../features/projects/hooks/useProjects';
import { projectStageLabel } from '../../features/projects/utils/projectDisplay';
import { buildProjectsByStage } from '../../lib/dashboardAggregation';
import { usePermissions } from '../../lib/permissions';
import { useAppStore } from '../../store/useAppStore';

export function ProjectsByStageWidget() {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const permissionReady = useAppStore((state) => state.permissionCache.ready);
  const canViewProjects = permissionReady && permissions.canView('projects');
  const { data: projects = [], isLoading } = useProjects({ enabled: canViewProjects });
  const data = buildProjectsByStage(projects);
  const total = data.reduce((sum, point) => sum + point.count, 0);
  const max = Math.max(1, ...data.map((point) => point.count));

  if (!permissionReady || !canViewProjects) return null;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="projects-by-stage-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[var(--color-primary-light)] p-2 text-[var(--color-primary-text)]"><FolderKanban className="h-4 w-4" /></div>
          <div>
            <h3 id="projects-by-stage-title" className="text-sm font-bold text-[var(--color-text)]">Projects by Stage</h3>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{isLoading ? 'Loading visible projects…' : `${total} visible project${total === 1 ? '' : 's'}`}</p>
          </div>
        </div>
        <button type="button" onClick={() => navigate('/projects')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 -mr-2 text-xs font-semibold text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] hover:underline">
          All projects <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="grid animate-pulse gap-2 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-10 rounded-lg bg-[var(--color-bg-sunken)]" />)}
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2" aria-label="Visible projects grouped by lifecycle stage">
          {data.map((point) => (
            <button
              key={point.stage}
              type="button"
              onClick={() => navigate(`/projects?stage=${encodeURIComponent(point.stage)}`)}
              className="group rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              aria-label={`${projectStageLabel(point.stage)}: ${point.count} projects`}
            >
              <span className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)]">{projectStageLabel(point.stage)}</span><span className="font-bold tabular-nums text-[var(--color-text)]">{point.count}</span></span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-sunken)]"><span className="block h-full rounded-full bg-[var(--color-primary)] transition-[width]" style={{ width: `${(point.count / max) * 100}%` }} /></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
