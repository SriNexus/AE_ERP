/**
 * CustomerProjectTimelinePanel — B2C Customer Workspace, an operational
 * project-tracking interface (B2C Project Timeline & Workspace UX
 * Specification mission — full rewrite of the earlier horizontal
 * StageTimeline card).
 *
 * Two panels, always both present:
 *   LEFT  — a compact vertical rail of the real 13-stage lifecycle, showing
 *           only 3 stages at a time inside a fixed-height viewport with its
 *           OWN internal vertical scrolling (overflow-y-auto on the panel
 *           itself, never the page's scroll container) — every stage is
 *           reachable by scrolling; the selected stage is scrolled into the
 *           middle slot whenever the selection changes (row click, index
 *           rail jump, or the default re-settle) via the same
 *           resolveRailOffset math the old translateY viewport used, now
 *           driving the container's scrollTop. Tracking/selection only, no
 *           editing.
 *   RIGHT — everything actually known about the selected stage: for a
 *           completed stage, its own `project.stageHistory` entry (when,
 *           who, note); for the current stage, when it began (inferred from
 *           the immediately preceding completed entry — the engine doesn't
 *           log a separate "started at" for the in-progress stage); for an
 *           upcoming stage, just its description ("not reached yet"); plus
 *           whatever stage-specific field the project record actually
 *           carries (assigned surveyor/installer, linked quotation/order/
 *           dispatch counts) — never invented data. For stages the stage
 *           engine itself resolves a real ERP page for (`stage.href` — the
 *           same per-stage navigation Project Workspace's GenericStageDetail
 *           uses), the right panel offers an "Open in full workspace"
 *           action; stages without one simply omit it (the header's "Go to
 *           Project Workspace" button remains the overall entry point).
 *
 * Still reuses the exact same stage engine the real Project Workspace uses
 * — resolveProjectWorkspaceStages() (src/hooks/useProjectStage.ts) — not a
 * reimplementation. Before a Project exists, stages resolve against a
 * synthetic placeholder (every stage 'upcoming') exactly as before; the
 * section itself now stays mounted regardless (CustomerWorkspace.tsx no
 * longer hides "Work on This Customer" just because a Project exists), so
 * the explanatory notice below doubles as the empty state for a customer
 * who hasn't started a project yet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Fixed row height (px) for the 3-stage viewport — tall enough for a title
 * + one status line, short enough that 3 rows read as one compact rail. */
const ROW_HEIGHT = 64;
const VISIBLE_ROWS = 3;

const ROW_DOT_TONE: Record<StageCardStatus, string> = {
  completed: 'bg-[var(--color-success)]',
  current: 'bg-[var(--color-primary)]',
  attention: 'bg-[var(--color-warning)]',
  blocked: 'bg-[var(--color-danger)]',
  upcoming: 'bg-[var(--color-border)]',
};

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
 * surveyor/installer, linked record counts — informational only, never a
 * navigation link (see file comment). */
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

/** Clamped offset (px) so the selected row sits in the viewport's middle
 * slot whenever the stage list has room on both sides — at the very start
 * or end it naturally settles against that boundary instead (the "1 2 3" /
 * "8 9 10" examples from the spec) rather than leaving dead space. */
function resolveRailOffset(selectedIndex: number, total: number): number {
  const maxOffset = Math.max(0, (total - VISIBLE_ROWS) * ROW_HEIGHT);
  const rawOffset = (selectedIndex - 1) * ROW_HEIGHT;
  return Math.min(Math.max(rawOffset, 0), maxOffset);
}

function StatusLine({ status }: { status: StageCardStatus }) {
  const label = status === 'completed' ? 'Completed' : status === 'current' ? 'In Progress' : status === 'attention' ? 'Needs Attention' : 'Upcoming';
  return <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{label}</span>;
}

export default function CustomerProjectTimelinePanel({ project }: Props) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stages = useMemo(() => resolveProjectWorkspaceStages(project || PLACEHOLDER_PROJECT), [project]);
  const completedCount = useMemo(() => stages.filter((s) => s.status === 'completed').length, [stages]);
  const percent = stages.length ? Math.round((completedCount / stages.length) * 100) : 0;

  const defaultStageId = stages.find((s) => s.status === 'current')?.id || stages[0]?.id || null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultStageId);

  // Re-settle the default selection whenever the tracked project itself
  // changes (a different customer, or the project's own stage advancing) —
  // never leaves a stale selection pointing at a project that's moved on.
  useEffect(() => {
    setSelectedId(stages.find((s) => s.status === 'current')?.id || stages[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.currentStage]);

  const selectedIndex = Math.max(0, stages.findIndex((s) => s.id === selectedId));
  const selectedStage = stages[selectedIndex] || stages[0];
  const offset = resolveRailOffset(selectedIndex, stages.length);
  const detail = resolveStageDetail(selectedStage, project, stages);

  // Real internal scrolling: whenever the selection changes (row click,
  // index-rail jump, or the default re-settle), scroll the chosen stage
  // into the middle of the fixed-height viewport — the same resolveRailOffset
  // math the old translateY viewport used, now driving the container's own
  // scrollTop so the panel scrolls on its own, never the page.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: offset, behavior: 'smooth' });
  }, [offset]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Project Timeline</h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{completedCount}/{stages.length} stages · {percent}% complete</p>
        </div>
        {project && (
          <button
            type="button"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[var(--color-primary-hover)] hover:shadow-md transition-all"
          >
            Go to Project Workspace <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {!project && (
        <p className="px-4 pt-3 text-xs text-[var(--color-text-muted)]">
          This timeline becomes active once a Project is created for this customer (see "Work on This Customer" above).
        </p>
      )}

      <div className="flex gap-3 p-4">
        {/* LEFT — compact 3-stage viewport with its OWN internal vertical
            scrolling. Roughly 3 stages visible at a time (fixed 3-row
            height); every stage is reachable by scrolling inside this panel
            — never the page's scroll container. Selection (row click or the
            index rail beside it) scrolls the chosen stage into the middle
            slot via the scrollTo effect above. */}
        <div
          ref={scrollRef}
          aria-label="Project stages — scroll to see all stages"
          className="w-[192px] shrink-0 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]"
          style={{ height: VISIBLE_ROWS * ROW_HEIGHT }}
        >
          {stages.map((stage, idx) => {
            const selected = stage.id === selectedStage?.id;
            return (
              <button
                key={stage.id}
                type="button"
                aria-current={selected ? 'step' : undefined}
                onClick={() => setSelectedId(stage.id)}
                className={[
                  'flex w-full items-start gap-2.5 px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]',
                  // Selected row gets an inset accent bar + tint so the
                  // selected stage reads unmistakably against the
                  // completed/current/upcoming dot states.
                  selected ? 'bg-[var(--color-primary-light)] shadow-[inset_3px_0_0_0_var(--color-primary)]' : 'hover:bg-[var(--color-surface-hover)]',
                ].join(' ')}
                style={{ height: ROW_HEIGHT }}
              >
                <span className="flex shrink-0 flex-col items-center pt-4">
                  <span className={['h-2 w-2 shrink-0 rounded-full', ROW_DOT_TONE[stage.status || 'upcoming']].join(' ')} />
                  {idx < stages.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" />}
                </span>
                <span className="min-w-0 flex-1 pt-3.5">
                  <span className={['block truncate text-[12px] font-semibold', selected ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]'].join(' ')}>{stage.title}</span>
                  <StatusLine status={stage.status || 'upcoming'} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Direct-jump index — one small dot per stage, always fully visible
            and clickable regardless of the scroll viewport's current
            position. This is what lets the operator go straight from Stage 1
            to Stage 12 (or any other stage) in a single click instead of
            stepping through every stage in between; picking a dot selects
            the stage, and the scrollTo effect above re-centers the viewport
            on it — jump distance never matters. Matches the 3-row viewport's
            fixed height so the dots align with the rows they index. */}
        <div className="flex w-5 shrink-0 flex-col py-1" style={{ height: VISIBLE_ROWS * ROW_HEIGHT }} aria-label="Jump directly to any stage">
          {stages.map((stage) => {
            const selected = stage.id === selectedStage?.id;
            return (
              <button
                key={stage.id}
                type="button"
                aria-current={selected ? 'step' : undefined}
                title={stage.title}
                aria-label={`Jump to ${stage.title}`}
                onClick={() => setSelectedId(stage.id)}
                className="group flex w-full flex-1 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                <span className={[
                  'rounded-full transition-all',
                  selected ? 'h-2.5 w-2.5 bg-[var(--color-primary)]' : ['h-1.5 w-1.5 group-hover:scale-125', ROW_DOT_TONE[stage.status || 'upcoming']].join(' '),
                ].join(' ')} />
              </button>
            );
          })}
        </div>

        {/* RIGHT — the selected stage's real information, read-only */}
        <div className="min-w-0 flex-1">
          {selectedStage && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-[var(--color-text)]">{selectedStage.title}</h4>
                <Badge variant={resolveStageCardVariant(selectedStage.status)}>{selectedStage.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selectedStage.description}</p>

              <div className="mt-3 space-y-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3.5 py-3">
                {detail.when ? (
                  <>
                    <p className="text-[11.5px] text-[var(--color-text-secondary)]">
                      {selectedStage.status === 'completed' ? 'Completed' : 'In progress since'} <span className="font-medium text-[var(--color-text)]">{detail.when}</span>
                      {detail.changedBy && <> · {detail.changedBy}</>}
                    </p>
                    {detail.note && <p className="text-[11.5px] text-[var(--color-text-secondary)]">{detail.note}</p>}
                  </>
                ) : (
                  <p className="text-[11.5px] text-[var(--color-text-muted)]">Not reached yet.</p>
                )}
                {detail.extra && <p className="text-[11.5px] text-[var(--color-text-secondary)]">{detail.extra}</p>}
              </div>

              {/* Per-stage action — reuse the stage engine's own href (the
                  same navigation Project Workspace's GenericStageDetail uses)
                  so selecting a stage surfaces the real entry point into that
                  stage's existing ERP page. Never invented: stages the engine
                  resolves no page for simply omit this. Only rendered when a
                  real Project exists — the placeholder state has no projectId
                  to anchor a filter, so these links would be meaningless
                  before a Project is created. */}
              {project && selectedStage.href && (
                <a
                  href={selectedStage.href}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
                >
                  Open in full workspace <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
