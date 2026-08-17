/**
 * useDirtyNavigation — shared guarded-navigation state machine.
 *
 * Extracted from LeadWorkspace.tsx's own inline pendingNav/requestNavigation/
 * handleGuardSave/handleGuardDiscard/handleGuardCancel (Customer Workspace
 * Phase 5, closing Lead Workspace's own Outstanding Item #4 — the Master
 * Plan's explicit instruction to extract this once both workspaces need it,
 * rather than maintain two copies of the same logic).
 *
 * This hook owns ONLY the navigation-guard state machine — it has no opinion
 * on what "dirty" means, how save works, or what discard does; those are
 * injected. The logic here is a mechanical, behavior-preserving lift of
 * Lead's existing code: same state shape, same function bodies, same
 * sequencing (guardSave clears pendingNav before navigating only if the save
 * succeeded; guardDiscard always navigates after resetting).
 *
 * Presentation (the confirmation modal's title/button wording) is
 * deliberately NOT part of this hook — Lead keeps its own existing
 * "Cancel/Discard/Save" modal unchanged, Customer Workspace uses its own
 * "Stay/Discard & Continue/Save & Continue" wording, per this phase's
 * explicit instruction not to rewrite Lead's UI for aesthetics. Each
 * consumer renders its own Modal using the state/handlers this hook returns.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export interface UseDirtyNavigationOptions {
  /** True when there are unsaved changes that would be lost by navigating away. */
  dirty: boolean;
  /** Runs the entity's existing save pipeline. Must resolve to true only on success. */
  onSave: () => Promise<boolean>;
  /** Resets per-entity UI state (mirrors RESET_WORKSPACE/per-customer reset). Called only after the operator explicitly chooses to discard. */
  onDiscard: () => void;
}

export interface UseDirtyNavigationResult {
  /** The navigation target awaiting confirmation, or null when no guard is showing. */
  pendingNav: string | null;
  /** Call from every exit path. Navigates immediately if clean; shows the guard if dirty. */
  requestNavigation: (target: string) => void;
  /** Guard modal "Save & Continue" — save first, then navigate only if the save succeeded. */
  guardSave: () => Promise<void>;
  /** Guard modal "Discard & Continue" — reset per-entity state, then navigate unconditionally. */
  guardDiscard: () => void;
  /** Guard modal "Stay"/"Cancel" — close the guard, stay on the current record, no navigation. */
  guardCancel: () => void;
  /** Raw setter, for "ambient" interceptors that already know they're dirty
   * (e.g. a global anchor-click or popstate listener that only attaches
   * while `dirty` is true) and just need to surface the guard for an
   * externally-observed target, bypassing requestNavigation's own dirty
   * check (which would be redundant there). */
  setPendingNav: (target: string | null) => void;
}

export function useDirtyNavigation({ dirty, onSave, onDiscard }: UseDirtyNavigationOptions): UseDirtyNavigationResult {
  const navigate = useNavigate();
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const requestNavigation = useCallback((target: string) => {
    if (dirty) {
      setPendingNav(target);
    } else {
      navigate(target);
    }
  }, [dirty, navigate]);

  const guardSave = useCallback(async () => {
    const target = pendingNav;
    const ok = await onSave();
    setPendingNav(null);
    if (target && ok) navigate(target);
  }, [pendingNav, onSave, navigate]);

  const guardDiscard = useCallback(() => {
    const target = pendingNav;
    setPendingNav(null);
    onDiscard();
    if (target) navigate(target);
  }, [pendingNav, onDiscard, navigate]);

  const guardCancel = useCallback(() => setPendingNav(null), []);

  return { pendingNav, requestNavigation, guardSave, guardDiscard, guardCancel, setPendingNav };
}
