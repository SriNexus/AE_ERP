/**
 * ProjectStageCard — the universal shell every one of the 12 "Work on This
 * Project" lifecycle cards renders through.
 *
 * Desktop layout (matching Customer Workspace card pattern):
 *   CONNECTOR RAIL | [ HEADER 100% | CONTENT 70% INFO | 30% IMAGE ]*
 *
 * The header occupies 100% of the card width — it is NOT inside the 70/30
 * split. Below the header, the content area has:
 *   LEFT  ~70%  — stage-specific information (summary fields or description)
 *   RIGHT ~30%  — illustration (hidden on mobile)
 *
 * The chevron/arrow is in the top-right corner of the full-width header.
 *
 * States: upcoming (disabled), current (highlighted), completed, attention, blocked.
 * Accordion: one expanded at a time, toggle via chevron.
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

/** A single key-value field shown in the compact summary grid below the
 *  card header. Only rendered when the card is collapsed and no children
 *  are visible. Empty/undefined values are silently dropped. */
export interface SummaryField {
  label: string;
  value: ReactNode;
}

interface Props {
  index: number;
  title: string;
  description?: string;
  summary?: ReactNode;
  /** Structured summary fields shown in a compact 2-col grid below the
   *  header when the card is collapsed. Rendered instead of `summary`
   *  when present and non-empty. */
  summaryFields?: SummaryField[];
  status: StageCardStatus;
  icon: LucideIcon;
  illustration?: string;
  action?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  last?: boolean;
  children?: ReactNode;
}

export default function ProjectStageCard({
  index, title, description, summary, summaryFields, status, icon: Icon,
  illustration, action, expanded, onToggle, last, children,
}: Props) {
  const disabled = status === 'upcoming';

  /** Compact 2-column grid of structured summary fields. */
  const visibleFields = (summaryFields || []).filter(
    (f) => f.value != null && f.value !== '' && f.value !== '—' && f.value !== '-',
  );

  return (
    <div className="flex gap-3">
      {/* Connector rail — state-tinted dot + line for the 12-stage lifecycle. */}
      <div className="flex shrink-0 flex-col items-center">
        <span className={['mt-[18px] h-2.5 w-2.5 shrink-0 rounded-full transition-colors', NODE_TONE[status]].join(' ')} />
        {!last && <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" />}
      </div>

      {/* ── CARD — border wraps everything including the full-width header ── */}
      <div
        className={[
          'mb-1 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-l-[3px] bg-[var(--color-surface)] shadow-sm transition-all duration-200',
          status === 'current' ? 'ring-1 ring-[var(--color-primary)]' : '',
          ACCENT_TONE[status],
          'border-[var(--color-border)]',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {/* ═══ HEADER — 100% CARD WIDTH ═══════════════════════════════════
            The entire header row is clickable — clicking anywhere on the
            header toggles the stage expand/collapse. The chevron is a visual
            affordance, not the only click target. */}
        <button
          type="button"
          onClick={disabled ? undefined : onToggle}
          disabled={disabled}
          aria-expanded={expanded}
          title={disabled ? 'This stage is not available yet' : expanded ? 'Collapse' : 'Expand'}
          className={[
            'flex w-full items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset',
            disabled
              ? 'cursor-not-allowed'
              : 'cursor-pointer hover:bg-[var(--color-bg-sunken)]',
          ].join(' ')}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-disabled)]">
              Stage {index}
            </span>
            <h4 className="truncate text-[13px] font-bold text-[var(--color-text)]">
              {title}
            </h4>
            <Badge variant={resolveStageCardVariant(status)}>
              {STATUS_TEXT[status]}
            </Badge>
          </div>

          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {/* Action button (e.g. Schedule Survey) — click does not toggle */}
            {!disabled && action}
            {/* Chevron — visual affordance */}
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-[var(--color-text-muted)]">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </div>
        </button>

        {/* ═══ CONTENT — 70% INFO | 30% IMAGE ═════════════════════════════
            Below the full-width header. On desktop: flex row with ~70%
            information on the left and ~30% illustration on the right.
            On mobile: information only (illustration hidden). */}
        <div className="flex flex-col sm:flex-row sm:items-stretch">
          {/* ── INFORMATION ~70% ── */}
          <div className="min-w-0 flex-1 px-4 py-3">
            {expanded && !disabled ? (
              children
            ) : (
              /* Collapsed state: structured fields OR description text */
              visibleFields.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {visibleFields.map((f) => (
                    <div key={f.label} className="min-w-0">
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-disabled)]">
                        {f.label}
                      </dt>
                      <dd className="mt-0.5 break-words text-[11.5px] font-medium leading-tight text-[var(--color-text-secondary)]">
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                (summary || description) && (
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {summary || description}
                  </p>
                )
              )
            )}
          </div>

          {/* ── ILLUSTRATION ~30% on desktop, hidden on mobile ──
              Sits below the header, on the RIGHT side. Smaller image
              with minimal padding, positioned toward top-right. */}
          {!expanded && (
            <div className="hidden shrink-0 self-stretch sm:flex sm:w-[28%] sm:items-start sm:justify-end sm:p-2">
              {illustration && !disabled ? (
                <img
                  src={illustration}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="max-h-[90px] w-full object-contain opacity-50 select-none"
                />
              ) : (
                <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', ICON_TONE[status]].join(' ')}>
                  {disabled ? <Lock className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
