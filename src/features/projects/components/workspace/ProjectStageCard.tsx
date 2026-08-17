/**
 * ProjectStageCard — the universal shell every one of the 13 "Work on This
 * Project" lifecycle cards renders through (Project Workspace Stage
 * Lifecycle mission — Universal 13-Stage Card Architecture pass). This is
 * the reusable foundation the remaining 12 stages will plug into later, so
 * its dimensions/spacing/typography are deliberately made to MATCH the
 * established Customer Workspace stage card
 * (CustomerB2BWorkflowPipeline.tsx's own StageCard) exactly, not estimated:
 * same connector rail (state-tinted dot + link line), same illustration
 * strip (w-[13%], min 52px/max 76px, self-stretch, p-0.5, object-contain),
 * same rounded-xl/border/border-l-[3px] accent/shadow-sm/hover-lift card
 * shell, same p-4 content padding, same header row anatomy (title + badge
 * on the left, the stage's one real action in the top-right slot), same
 * 13px-bold title typography.
 *
 * Illustrations: every one of the 13 stages now has real art — Quotation/
 * Order/Dispatch reuse Customer Workspace's own existing PNGs verbatim
 * (same concept, same asset); Commissioning reuses Customer Workspace's
 * project.png (solar panel + sun — a plant going live) and Subsidy reuses
 * registration.png (document + government building + % badge — a
 * government scheme). The remaining 8 (Survey/Engineering/Procurement/
 * Installation/QC/Net Metering/Handover/AMC) got new PNGs in the SAME
 * duotone-line-art + one colored circular badge visual language, composed
 * from existing Lucide icon path data (not hand-drawn from scratch, not a
 * different style) — see src/assets/customer-workspace/*.png. A stage
 * without an illustration falls back to the icon tile below (kept for
 * robustness, not expected to be hit for any of the current 13).
 *
 * The one addition Customer's own card doesn't need: an expand/collapse
 * control, since 13 stages can never all render open at once the way
 * Customer's 5 always-open cards do — ChevronDown (collapsed) /
 * ChevronUp (expanded), always the header's last element after the stage
 * action, if any.
 *
 * States: upcoming stages are visible but disabled ("not available yet" —
 * cannot expand), current gets the strongest visual hierarchy (primary
 * accent + ring), completed/attention stay reviewable/expandable. Only the
 * expanded stage renders its body — ProjectWorkOnThisProject.tsx is
 * responsible for keeping exactly one expanded at a time.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge';
import { resolveStageCardVariant, type StageCardStatus } from '../../../../components/shared/StageCard';

const STATUS_TEXT: Record<StageCardStatus, string> = {
  completed: 'Completed',
  current: 'In Progress',
  upcoming: 'Not Available Yet',
  blocked: 'Blocked',
  attention: 'Needs Attention',
};

const NODE_TONE: Record<StageCardStatus, string> = {
  completed: 'bg-[var(--color-success)]',
  current: 'bg-[var(--color-primary)]',
  attention: 'bg-amber-500',
  blocked: 'bg-[var(--color-danger)]',
  upcoming: 'bg-[var(--color-border)]',
};

const ACCENT_TONE: Record<StageCardStatus, string> = {
  completed: 'border-l-[var(--color-success)]',
  current: 'border-l-[var(--color-primary)]',
  attention: 'border-l-amber-500',
  blocked: 'border-l-[var(--color-danger)]',
  upcoming: 'border-l-[var(--color-border)]',
};

const ICON_TONE: Record<StageCardStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  current: 'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]',
  attention: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  blocked: 'bg-[var(--color-danger-light)] text-[var(--color-danger-text)]',
  upcoming: 'bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]',
};

interface Props {
  index: number;
  title: string;
  description?: string;
  /** A concise, real-data completion/status line (e.g. "Completed by Rahul
   * Sharma · 5 Aug 2026") shown in the collapsed row INSTEAD of description
   * when provided — never a full report dump on the card itself. */
  summary?: ReactNode;
  status: StageCardStatus;
  icon: LucideIcon;
  /** Illustration PNG (matching Customer/Lead Workspace's own stage
   * illustration language) — takes over the icon slot when provided.
   * Falls back to the Lucide icon tile when no suitable illustration
   * exists yet for this stage. */
  illustration?: string;
  /** The stage's one real header action (e.g. "Schedule Survey") — same
   * top-right slot Customer Workspace's CreateActionButton permanently
   * occupies. Omitted (not just hidden) when the stage has no action that
   * makes sense in its current state, per "only surface meaningful
   * actions." */
  action?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /** Suppresses the connector line below the final card. */
  last?: boolean;
  children?: ReactNode;
}

export default function ProjectStageCard({ index, title, description, summary, status, icon: Icon, illustration, action, expanded, onToggle, last, children }: Props) {
  const disabled = status === 'upcoming';

  return (
    <div className="flex gap-3">
      {/* Connector rail — same state-tinted-dot-and-line language as
          Customer Workspace's own stage pipeline, so 13 stages read as one
          connected lifecycle, not 13 unrelated boxes. */}
      <div className="flex shrink-0 flex-col items-center">
        <span className={['mt-[18px] h-2.5 w-2.5 shrink-0 rounded-full transition-colors', NODE_TONE[status]].join(' ')} />
        {!last && <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" />}
      </div>

      <div
        className={[
          'mb-1 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-l-[3px] bg-[var(--color-surface)] shadow-sm transition-all duration-200',
          status === 'current' ? 'ring-1 ring-[var(--color-primary)]' : '',
          ACCENT_TONE[status],
          'border-[var(--color-border)]',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {/* Illustration strip — exact same footprint/treatment as Customer
            Workspace's own stage cards (CustomerB2BWorkflowPipeline.tsx):
            w-[13%], min 52px/max 76px, self-stretch, p-0.5, object-contain.
            Shown only while collapsed — Customer's own cards never need to
            hide it (they're always open), but 13 stages can't afford a
            permanent illustration tax on the one stage actually being
            worked in, so it disappears the moment a card expands, handing
            that width straight to the real workspace content below. */}
        {!expanded && (
          <div className="w-[13%] min-w-[52px] max-w-[76px] shrink-0 self-stretch p-0.5">
            {illustration && !disabled ? (
              <div className="flex h-full w-full items-center justify-center">
                <img src={illustration} alt="" aria-hidden="true" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_TONE[status]].join(' ')}>
                  {disabled ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-disabled)]">Stage {index}</span>
              <h4 className="truncate text-[13px] font-bold text-[var(--color-text)]">{title}</h4>
              <Badge variant={resolveStageCardVariant(status)}>{STATUS_TEXT[status]}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {!disabled && action}
              <button
                type="button"
                onClick={disabled ? undefined : onToggle}
                disabled={disabled}
                aria-expanded={expanded}
                title={disabled ? 'This stage is not available yet' : expanded ? 'Collapse' : 'Expand'}
                className={[
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
                  disabled ? 'cursor-not-allowed text-[var(--color-text-disabled)]' : 'cursor-pointer text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mt-3">
            {expanded && !disabled ? (
              children
            ) : (
              (summary || description) && (
                <p className="truncate text-xs text-[var(--color-text-muted)]">{summary || description}</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
