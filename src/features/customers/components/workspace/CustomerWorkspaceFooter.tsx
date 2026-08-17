/**
 * CustomerWorkspaceFooter — Previous/Next + Save/Save & Next (Phase 5).
 * Visual language matches LeadWorkspace.tsx's own footer (compact, sticky,
 * 3-zone layout).
 *
 * Premium UX Redesign mission: the center zone used to show a segmented
 * progress bar filled by `completedCustomerIds.length / total` — a
 * per-session "customers visited" counter, not real progress (this exact
 * counter is documented elsewhere in this codebase as unreliable —
 * undercounts on a plain Save-then-Next). A meter that never means what it
 * looks like it means is worse than no meter, so it's gone; "Customer N of
 * Total" — already truthful — is what's left, unchanged.
 *
 * Second refinement pass: the earlier "always visible, disabled when clean"
 * Save/Save & Next behavior is itself what created the "is this a view page
 * or an edit page?" ambiguity — a Save button sitting there permanently,
 * even when nothing on the page is editable, reads as mode confusion no
 * matter how clearly it's disabled. Save/Save & Next now render only while
 * `isEditing` is true (the same flag the Left Panel's Edit/Cancel Editing
 * toggle controls, lifted to CustomerWorkspace.tsx) — in view mode the
 * footer is just Previous/Next/position; the moment the operator opens the
 * Left Panel's editor, Save controls appear right where the rest of the
 * editing session already lives, and disappear again on Cancel Editing.
 *
 * Purely presentational — every button here calls a prop, no Firestore
 * access, no engine dispatch of its own. CustomerWorkspace.tsx owns the
 * actual Previous/Next/Save/Save & Next handlers (guarded navigation,
 * conflict detection, persistence) and passes them down.
 */
import { ChevronLeft, ChevronRight, Save, Loader2, Pencil } from 'lucide-react';

interface Props {
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  currentPosition: number;
  total: number;
  isEditing: boolean;
  hasUnsaved: boolean;
  saving: boolean;
  onSave: () => void;
  onSaveAndNext: () => void;
}

// Sizing/padding/shadow/hover-lift matches LeadWorkspace.tsx's own
// FooterActionButton exactly (left panel/tabs/footer UI standardization
// mission) — Customer's own always-visible-but-disabled Save/Save & Next
// behavior (vs. Lead's hide-when-clean) is unchanged; only the button's
// visual dimensions/treatment now match.
function FooterButton({ icon, label, onClick, disabled, loading, tone = 'default' }: {
  icon?: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; loading?: boolean; tone?: 'default' | 'primary';
}) {
  const toneClass = tone === 'primary'
    ? 'border-transparent bg-[var(--color-primary)] text-white shadow-[var(--color-primary-muted)] hover:bg-[var(--color-primary-hover)] hover:shadow-md'
    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold shadow-sm transition-all',
        'hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none',
        toneClass,
      ].join(' ')}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export default function CustomerWorkspaceFooter({
  onPrevious, onNext, hasPrevious, hasNext, currentPosition, total,
  isEditing, hasUnsaved, saving, onSave, onSaveAndNext,
}: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-4 py-1.5">
      {/* LEFT: Previous / Next */}
      <div className="flex items-center gap-2">
        <FooterButton icon={<ChevronLeft className="h-4 w-4" />} label="Previous" onClick={onPrevious} disabled={!hasPrevious} />
        <FooterButton icon={<ChevronRight className="h-4 w-4" />} label="Next" onClick={onNext} disabled={!hasNext} />
      </div>

      {/* CENTER: truthful record navigator — no invented progress meter */}
      <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
        <span>
          Customer <span className="font-semibold text-[var(--color-text)]">{currentPosition}</span> of {total}
        </span>
        {isEditing && (
          <span className="flex items-center gap-1 text-[var(--color-primary-text)]">
            <Pencil className="h-3 w-3" />
            Editing customer details
          </span>
        )}
        {hasUnsaved && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
      </div>

      {/* RIGHT: Save / Save & Next — only present during an active edit
          session (isEditing), not permanently visible-but-disabled. Scoped
          explicitly to customer detail edits: embedded actions (Create
          Quotation/Order/etc.) already save immediately via their own
          buttons and toasts — this Save never touches those. */}
      {isEditing && (
        <div className="flex items-center gap-2">
          <FooterButton icon={<Save className="h-4 w-4" />} label="Save" onClick={onSave} disabled={!hasUnsaved || saving} loading={saving} />
          <FooterButton icon={<ChevronRight className="h-4 w-4" />} label="Save & Next" onClick={onSaveAndNext} disabled={saving || !hasNext} loading={saving} tone="primary" />
        </div>
      )}
    </div>
  );
}
