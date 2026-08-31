/**
 * WorkflowCard — shared responsive card for "Work on This Customer" workflow
 * stages. Used by both B2B pipeline and B2C workflow cards.
 *
 * Layout:
 *   HEADER  (title + status badge + create/action button)
 *   ───────
 *   BODY    (~70% information | ~30% illustration)
 *
 * The 70/30 split is consistent on both desktop and mobile. The illustration
 * sits in a dedicated visual zone on the right, never competing with the
 * information. Customer name is NOT shown here — it is already in the
 * workspace header.
 */
import { ArrowRight, Plus, Loader2 } from 'lucide-react';
import RecordFacts, { type RecordFact } from './RecordFacts';

export interface WorkflowCardAction {
  label: string;
  onClick: () => void;
  active: boolean;
  loading?: boolean;
}

interface Props {
  title: string;
  illustration: string;
  badge: React.ReactNode;
  /** Shown when no record exists yet (actionable state). */
  summary?: React.ReactNode;
  /** Record field grid. Rendered in the done/blocked states. */
  facts?: RecordFact[];
  /** Primary create/record action — always rendered in header. */
  action: WorkflowCardAction;
  /** "View Latest" / "Open Record" action — shown in body when record exists. */
  viewAction?: WorkflowCardAction;
  /** Called when the facts area is clicked (done state). Falls back to viewAction. */
  onOpenRecord?: () => void;
}

function ActionButton({ action }: { action: WorkflowCardAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={!action.active || action.loading}
      title={action.active ? undefined : 'Not available yet'}
      className={[
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        action.active
          ? 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-muted)]'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]',
      ].join(' ')}
    >
      {action.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
      {action.loading ? 'Working…' : action.label}
    </button>
  );
}

export default function WorkflowCard({
  title, illustration, badge, summary, facts, action, viewAction, onOpenRecord,
}: Props) {
  const clickable = !!(onOpenRecord || viewAction);
  const handleClick = onOpenRecord || viewAction?.onClick;

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-[var(--color-border-strong)] focus-within:ring-1 focus-within:ring-[var(--color-primary-muted)]">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-[13px] font-bold text-[var(--color-text)]">{title}</h4>
          {badge}
        </div>
        <ActionButton action={action} />
      </div>

      {/* ── BODY — full-width info on mobile; ~70/30 on desktop ── */}
      <div className="flex flex-col sm:flex-row sm:items-stretch sm:min-h-[100px]">
        {/* INFORMATION — ~70% */}
        <div className="min-w-0 flex-1 p-3 sm:p-4">
          {summary && !facts?.length && (
            <p className="text-xs leading-snug text-[var(--color-text-secondary)]">{summary}</p>
          )}

          {facts && facts.length > 0 && clickable && (
            <button
              type="button"
              onClick={handleClick}
              className="group flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--color-bg-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
            >
              <div className="min-w-0 flex-1">
                <RecordFacts facts={facts} />
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-primary-text)]" />
            </button>
          )}

          {facts && facts.length > 0 && !clickable && (
            <RecordFacts facts={facts} />
          )}
        </div>

        {/* ILLUSTRATION — ~30% on desktop, completely removed on mobile.
            Image fills the available area with minimal padding, positioned
            toward the top-right to sit close to the header/Create area. */}
        <div className="hidden shrink-0 items-start justify-end self-stretch sm:flex sm:w-[30%] sm:p-2">
          <img
            src={illustration}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-full max-h-[120px] w-full object-contain select-none opacity-60"
          />
        </div>
      </div>
    </div>
  );
}
