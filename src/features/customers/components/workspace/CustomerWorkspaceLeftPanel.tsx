/**
 * CustomerWorkspaceLeftPanel — Customer Workspace Left Panel
 * (Left Panel/Tabs/Documents/Footer UI standardization mission).
 *
 * Permanent — always Customer Information, regardless of the active center
 * tab, mirroring Lead Workspace's own Left Panel exactly. The per-tab
 * mode-switching this panel used to do (`resolveLeftPanelMode` —
 * Tasks/Notes/Activity/History/Linked Records/Commercial summaries swapped
 * in per active tab) is retired: those were Left-Panel-only summaries of
 * content the center tabs already show in full via their own Universal*Tab
 * components — removing them does not touch any center tab's existing
 * content or logic.
 *
 * Document System + Panel Standardization mission: Documents moved out of
 * this panel into its own workspace-level "Documents" tab (rendered in the
 * spacious Center Panel — see CustomerWorkspace.tsx's moduleTabContent) —
 * this Left Panel was too cramped for a proper document-management
 * experience. Same CustomerWorkspaceDocumentsSection component, same data,
 * just a different mount point; no document functionality was removed.
 *
 * Title row + Edit affordance visual treatment (icon-only edit button,
 * "Cancel Editing" pill when editing) matches Lead's own left-panel header
 * row. Customer's actual editing/save behavior is unchanged: this toggle
 * only shows/hides CustomerWorkspaceEditor (the existing Tier A staged-draft
 * form); Save/Save & Next still live exclusively in the Footer.
 *
 * Premium UX Redesign mission, second refinement pass: `isEditing` moved
 * from this component's own local state up to CustomerWorkspace.tsx (a
 * controlled prop now, not a `useState` here) so the Footer can know
 * whether an edit session is active and show its Save controls only then —
 * resolving the "is this a view page or an edit page?" ambiguity by tying
 * the two toggles (Left Panel's Edit button, Footer's Save controls) to one
 * shared flag instead of leaving them visually independent.
 *
 * Final Premium UX Refinement Pass — Cancel Editing bug fix: `handleToggleEdit`
 * used to call `onCancelEdit?.()` AND `onToggleEdit()` unconditionally on
 * every click. React batches both state updates from the same click handler,
 * so on Cancel the parent's `setIsEditingCustomer(false)` (from onCancelEdit)
 * was immediately followed, in the same batch, by `setIsEditingCustomer(v =>
 * !v)` (from onToggleEdit) — which flips the *just-set* `false` back to
 * `true`, silently re-entering edit mode. The button looked like it did
 * nothing (or worse, stayed "active"). Fixed by branching: Cancel calls only
 * onCancelEdit (which already sets isEditing false on its own); opening the
 * editor calls only onToggleEdit. Never both on the same click.
 */
import { Edit2, X } from 'lucide-react';
import CustomerContextPanel from './leftPanel/CustomerContextPanel';
import CustomerWorkspaceEditor from './CustomerWorkspaceEditor';
import type { CustomerDraft, CustomerDraftField } from './CustomerWorkspacePersistence';

interface Props {
  customer: any;
  /** Deferred-commit draft editing (Tier A). `canEdit` gates whether the Edit
   * toggle appears at all (permission-checked by the caller, not re-derived
   * here). */
  draft?: CustomerDraft;
  onFieldChange?: (field: CustomerDraftField, value: string) => void;
  canEdit?: boolean;
  /** Controlled by CustomerWorkspace.tsx so the Footer can react to the same
   * flag — see the file comment above. */
  isEditing: boolean;
  onToggleEdit: () => void;
  /** "Cancel Editing" must actually discard the staged draft (cwDispatch
   * RESET_WORKSPACE at the call site), not just collapse this panel's local
   * view back to read-only — without this a user who edits a field then
   * clicks "Cancel Editing" would still have hasUnsaved=true and the edit
   * would be silently persisted by a later Save. */
  onCancelEdit?: () => void;
}

export default function CustomerWorkspaceLeftPanel({ customer, draft, onFieldChange, canEdit = false, isEditing, onToggleEdit, onCancelEdit }: Props) {
  function handleToggleEdit() {
    if (isEditing) {
      onCancelEdit?.();
    } else {
      onToggleEdit();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Customer Information</h3>
        {canEdit && onFieldChange && (
          isEditing ? (
            <button
              onClick={handleToggleEdit}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <X className="h-3 w-3" /> Cancel Editing
            </button>
          ) : (
            <button
              onClick={handleToggleEdit}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors"
              title="Edit customer"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )
        )}
      </div>

      {isEditing && onFieldChange ? (
        <CustomerWorkspaceEditor customer={customer} draft={draft || {}} onFieldChange={onFieldChange} canEdit={canEdit} />
      ) : (
        <CustomerContextPanel customer={customer} />
      )}
    </div>
  );
}
