/**
 * CustomerProjectTimelinePanel — B2C Customer Workspace project tracker.
 *
 * Final Customer Details polish: this section shows ONLY the project's
 * CURRENT stage and its known details — not the full 13-stage lifecycle.
 * The Customer Details page is not a lifecycle viewer; the complete stage
 * history lives in the Project Workspace ("Go to Project Workspace").
 *
 * Still reuses the exact stage engine the real Project Workspace uses —
 * resolveProjectWorkspaceStages() (src/hooks/useProjectStage.ts) — and the
 * pure resolveStageDetail() helper (unchanged, still exported/tested). Before
 * a Project exists, stages resolve against a synthetic placeholder and the
 * section renders its "not started yet" notice.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge';
import { resolveStageCardVariant, type StageCardStatus } from '../../../../components/shared/StageCard';
import { resolveProjectWorkspaceStages, type ProjectWorkspaceStage } from '../../../../hooks/useProjectStage';
import { fmtDate } from '../../../../lib/firestore';
import type { ProjectRecord } from '../../../projects/types';

interface Props {
  project: ProjectRecord | null;
}

const PLACEHOLDER_PROJECT = { id: '', currentStage: 'New', stageHistory: [] } as unknown as ProjectRecord;

interface StageDetail {
  when: string | null;
  changedBy: string | null;
  note: string | null;
  extra: string | null;
}

/** Pure — resolves exactly what's known about ONE stage from the real
 * project record. Never invents data: a completed stage shows its own
 * stageHistory entry; the current stage's "since" is inferred from the
 * immediately preceding completed entry (or the project's own createdAt for
 * the very first stage); an upcoming stage returns all-null (rendered as
 * "Not reached yet" by the caller). `extra` surfaces the one or two
 * genuinely-stage-specific fields the project record carries — assigned
 * surveyor/installer, linked record counts — informational only. */
export function resolveStageDetail(
  stage: ProjectWorkspaceStage,
  project: ProjectRecord | null,
  allStages: ProjectWorkspaceStage[]
): StageDetail {
  if (!project) return { when: null, changedBy: null, note: null, extra: null };

  const historyEntry = (project.stageHistory || []).find((entry) => entry.stage === stage.projectStage);
  let when: string | null = null;
  let changedBy: string | null = null;
  let note: string | null = null;

  if (historyEntry) {
    when = fmtDate(historyEntry.changedAt);
    changedBy = historyEntry.changedBy || null;
    note = historyEntry.note || null;
  } else if (stage.status === 'current') {
    const idx = allStages.findIndex((s) => s.id === stage.id);
    const prevStage = idx > 0 ? allStages[idx - 1] : null;
    const prevEntry = prevStage ? (project.stageHistory || []).find((entry) => entry.stage === prevStage.projectStage) : null;
    when = fmtDate(prevEntry?.changedAt || project.createdAt);
  }

  let extra: string | null = null;
  if (stage.projectStage === 'Survey' && project.assignedSurveyor) extra = `Surveyor: ${project.assignedSurveyor}`;
  else if (stage.projectStage === 'Installation' && project.assignedInstaller) extra = `Installer: ${project.assignedInstaller}`;
  else if (stage.projectStage === 'Quotation' && (project.linkedQuotationIds || []).length) extra = `${project.linkedQuotationIds.length} linked quotation${project.linkedQuotationIds.length === 1 ? '' : 's'}`;
  else if (stage.projectStage === 'Order' && (project.linkedOrderIds || []).length) extra = `${project.linkedOrderIds.length} linked order${project.linkedOrderIds.length === 1 ? '' : 's'}`;
  else if (stage.projectStage === 'Dispatch' && (project.linkedDispatchIds || []).length) extra = `${project.linkedDispatchIds.length} linked dispatch${project.linkedDispatchIds.length === 1 ? '' : 's'}`;

  return { when, changedBy, note, extra };
}

const STATUS_LABEL: Record<StageCardStatus, string> = {
  completed: 'Completed',
  current: 'In Progress',
  attention: 'Needs Attention',
  blocked: 'Blocked',
  upcoming: 'Upcoming',
};

export default function CustomerProjectTimelinePanel({ project }: Props) {
  const navigate = useNavigate();
  const stages = useMemo(() => resolveProjectWorkspaceStages(project || PLACEHOLDER_PROJECT), [project]);
  const completedCount = useMemo(() => stages.filter((s) => s.status === 'completed').length, [stages]);
  const percent = stages.length ? Math.round((completedCount / stages.length) * 100) : 0;

  // Only the current stage matters on this page — the one in progress, or the
  // first not-yet-completed stage, or (all done) the last stage.
  const currentStage = useMemo(
    () =>
      stages.find((s) => s.status === 'current') ||
      stages.find((s) => s.status !== 'completed') ||
      stages[stages.length - 1] ||
      null,
    [stages],
  );
  const detail = currentStage ? resolveStageDetail(currentStage, project, stages) : null;
  const status: StageCardStatus = (currentStage?.status as StageCardStatus) || 'upcoming';
  // Current stage's position in the lifecycle (1-based) + how far along that
  // puts the project — both derived from the existing stage list, no new data.
  const currentIndex = currentStage ? stages.findIndex((s) => s.id === currentStage.id) : -1;
  const currentPosition = currentIndex >= 0 ? currentIndex + 1 : Math.min(completedCount + 1, stages.length || 1);
  const positionPercent = stages.length ? Math.round((currentPosition / stages.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      {/* Header — "Go to Project Workspace" on the LEFT, title on the RIGHT.
          Always visible whenever this section is (the button only when a real
          Project exists to navigate to). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
        {project ? (
          <button
            type="button"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[var(--color-primary-hover)] hover:shadow-md transition-all"
          >
            Go to Project Workspace <ArrowUpRight className="h-3 w-3" />
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <div className="min-w-0 text-right">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Project Timeline</h3>
          {/* Desktop keeps this line; on mobile the same numbers live in the
              compact dashboard below, so it's hidden to avoid repeating them. */}
          <p className="mt-0.5 hidden text-[11px] text-[var(--color-text-muted)] lg:block">{completedCount}/{stages.length} stages · {percent}% complete</p>
        </div>
      </div>

      {!project && (
        <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
          This timeline becomes active once a Project is created for this customer (see "Work on This Customer" above).
        </p>
      )}

      {project && currentStage && (
        <>
          {/* ── DESKTOP — finalized, unchanged ─────────────────────────── */}
          <div className="hidden p-4 lg:block">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Current Stage</p>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="min-w-0 break-words text-sm font-bold text-[var(--color-text)]">{currentStage.title}</h4>
              <Badge variant={resolveStageCardVariant(status)}>{STATUS_LABEL[status]}</Badge>
            </div>
            {currentStage.description && (
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{currentStage.description}</p>
            )}

            <div className="mt-3 space-y-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3.5 py-3">
              {detail?.when ? (
                <>
                  <p className="text-[11.5px] text-[var(--color-text-secondary)]">
                    {status === 'completed' ? 'Completed' : 'In progress since'}{' '}
                    <span className="font-medium text-[var(--color-text)]">{detail.when}</span>
                    {detail.changedBy && <> · {detail.changedBy}</>}
                  </p>
                  {detail.note && <p className="text-[11.5px] text-[var(--color-text-secondary)]">{detail.note}</p>}
                </>
              ) : (
                <p className="text-[11.5px] text-[var(--color-text-muted)]">Not reached yet.</p>
              )}
              {detail?.extra && <p className="text-[11.5px] text-[var(--color-text-secondary)]">{detail.extra}</p>}
            </div>

            {currentStage.href && (
              <a
                href={currentStage.href}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
              >
                Open current stage in full workspace <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {/* ── MOBILE — compact "current stage" mini dashboard ─────────
              At a glance: position (6/14) · progress (43%) · stage name ·
              status · Open Stage. Same tokens/Badge as the rest of the page;
              still focused on the current stage only, not a stage list. ── */}
          <div className="p-4 lg:hidden">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Current Stage</p>
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
              {/* metrics row: position · percent · progress bar */}
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <span className="shrink-0 text-[var(--color-text)]">
                  {currentPosition}<span className="text-[var(--color-text-muted)]"> / {stages.length}</span>
                </span>
                <span className="text-[var(--color-text-disabled)]">·</span>
                <span className="shrink-0 text-[var(--color-text-secondary)]">{positionPercent}%</span>
                <span className="ml-0.5 h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                  <span className="block h-full rounded-full bg-[var(--color-primary)] transition-all duration-500 ease-out" style={{ width: `${positionPercent}%` }} />
                </span>
              </div>

              {/* stage name · status · Open Stage */}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <h4 className="min-w-0 break-words text-sm font-bold text-[var(--color-text)]">{currentStage.title}</h4>
                <Badge variant={resolveStageCardVariant(status)}>{STATUS_LABEL[status]}</Badge>
                {currentStage.href && (
                  <a
                    href={currentStage.href}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
                  >
                    Open Stage <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
