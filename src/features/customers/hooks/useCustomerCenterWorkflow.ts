/**
 * useCustomerCenterWorkflow — the Customer Workspace Center Panel's
 * "which create-workflow is active" state (Phase 2, lifted in Phase 4).
 *
 * Originally local `useState` inside CustomerCenterPanel.tsx (Phase 2).
 * Phase 4 requires the Right Panel's Quick Actions to "set/trigger the
 * existing Customer Center Panel workflow state" rather than build a
 * competing system — which means two sibling components (CustomerCenterPanel
 * and CustomerWorkspaceRightPanel) now need to read and drive the same
 * state. Lifting it into a shared hook, called once in CustomerWorkspace.tsx
 * and passed down to both, is the standard React answer to that — this is
 * plain `useState`, not a reducer/engine: no dirty-state tracking, no
 * conflict detection, no save orchestration. Those remain explicitly
 * Phase 5 scope. The state shape and every handler's logic is unchanged
 * from Phase 2 — only its location moved.
 */
import { useState } from 'react';
import { usePermissions } from '../../../lib/permissions';
import { checkFirstTimeBilling } from '../services/firstTimeBilling';

export type CenterView = 'snapshot' | 'create-quotation' | 'create-order' | 'create-loan-application' | 'create-project';

export interface CustomerCenterWorkflow {
  view: CenterView;
  firstTimeSuggestion: boolean;
  orderCheckLoading: boolean;
  goToQuotation: () => void;
  /** First-time-billing-aware order trigger (Phase 2 behavior, unchanged) —
   * checks checkFirstTimeBilling() before deciding whether to show the
   * suggestion banner or go straight to the order form. */
  goToOrder: () => Promise<void>;
  goToLoanApplication: () => void;
  goToProject: () => void;
  backToSnapshot: () => void;
  confirmFirstTimeQuotation: () => void;
  confirmDirectOrder: () => void;
  /** Full reset to the default snapshot state — used when the workspace
   * switches to a different customer (Phase 5), so no previous customer's
   * in-progress create-workflow selection leaks into the next one. Distinct
   * from `backToSnapshot` (a user-initiated "Cancel" on the current form)
   * only in intent/call-site, not behavior — both clear the same state. */
  reset: () => void;
}

export function useCustomerCenterWorkflow(customer: any): CustomerCenterWorkflow {
  const perms = usePermissions();
  const [view, setView] = useState<CenterView>('snapshot');
  const [orderCheckLoading, setOrderCheckLoading] = useState(false);
  const [firstTimeSuggestion, setFirstTimeSuggestion] = useState(false);

  async function goToOrder() {
    if (!perms.canCreate('quotations')) { setView('create-order'); return; }
    setOrderCheckLoading(true);
    const result = await checkFirstTimeBilling(customer.id);
    setOrderCheckLoading(false);
    if (!result.checkFailed && result.isFirstTime) {
      setFirstTimeSuggestion(true);
    } else {
      setView('create-order');
    }
  }

  function backToSnapshot() {
    setView('snapshot');
    setFirstTimeSuggestion(false);
  }

  function reset() {
    setView('snapshot');
    setFirstTimeSuggestion(false);
    setOrderCheckLoading(false);
  }

  return {
    view,
    firstTimeSuggestion,
    orderCheckLoading,
    goToQuotation: () => setView('create-quotation'),
    goToOrder,
    goToLoanApplication: () => setView('create-loan-application'),
    goToProject: () => setView('create-project'),
    backToSnapshot,
    confirmFirstTimeQuotation: () => { setFirstTimeSuggestion(false); setView('create-quotation'); },
    confirmDirectOrder: () => { setFirstTimeSuggestion(false); setView('create-order'); },
    reset,
  };
}
