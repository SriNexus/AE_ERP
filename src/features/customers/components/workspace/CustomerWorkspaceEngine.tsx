/**
 * CustomerWorkspaceEngine — Customer Workspace's deferred-commit state
 * (Phase 5). Context + `useReducer`, shaped after LeadWorkspaceEngine.tsx's
 * architecture — same reasoning (one place guaranteeing `hasUnsaved`
 * transitions consistently, same per-entity/per-session state split — see
 * the Phase 5 report §4) — but NOT a literal port. Lead's reducer also owns
 * a call-outcome state machine, timeline, and queue-completion classifier
 * that have no Customer equivalent; this engine owns exactly the two-tier
 * save model's Tier A (deferred Customer-field draft) plus the session
 * queue counters, nothing else.
 *
 * Deliberately does NOT own `activeWorkflow` (which Center/Right workflow
 * view is active) — that remains useCustomerCenterWorkflow.ts (Phase 4),
 * untouched. The two states are conceptually separate (Tier A deferred
 * field edits vs. Tier B immediate-write embedded workflows) and Phase 4's
 * hook already works; merging it into this reducer would be an
 * unnecessary, unrequired rewrite (see Phase 5 report §4 for the explicit
 * reasoning against merging).
 *
 * Named `useCustomerWorkspaceState` (not `useWorkspace`) to avoid colliding
 * with the pre-existing `useWorkspace` from components/shared (Phase 1's
 * unrelated tab-state hook, already imported by CustomerWorkspace.tsx).
 */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { CustomerDraft, CustomerDraftField } from './CustomerWorkspacePersistence';

export interface CustomerWorkspaceState {
  // ── Per-customer (reset on every customer change) ──────
  draft: CustomerDraft;
  hasUnsaved: boolean;
  saving: boolean;
  conflictPending: boolean;

  // ── Per-session (survives customer changes) ─────────────
  completedCustomerIds: string[];
  sessionStartTime: number;
}

export type CustomerWorkspaceAction =
  | { type: 'SET_DRAFT_FIELD'; payload: { field: CustomerDraftField; value: string } }
  | { type: 'SET_SAVING'; payload: boolean }
  | { type: 'SET_CONFLICT_PENDING'; payload: boolean }
  | { type: 'MARK_CLEAN' }
  | { type: 'COMPLETE_CUSTOMER'; payload: { customerId: string } }
  | { type: 'RESET_WORKSPACE' };

export function customerWorkspaceReducer(state: CustomerWorkspaceState, action: CustomerWorkspaceAction): CustomerWorkspaceState {
  switch (action.type) {
    case 'SET_DRAFT_FIELD':
      return {
        ...state,
        draft: { ...state.draft, [action.payload.field]: action.payload.value },
        hasUnsaved: true,
      };

    case 'SET_SAVING':
      return { ...state, saving: action.payload };

    case 'SET_CONFLICT_PENDING':
      return { ...state, conflictPending: action.payload };

    case 'MARK_CLEAN':
      // After a successful save the draft has been fully persisted — clear
      // it (not just the flag) so a later field re-render doesn't briefly
      // show stale staged values.
      return { ...state, draft: {}, hasUnsaved: false };

    case 'COMPLETE_CUSTOMER': {
      const { customerId } = action.payload;
      if (state.completedCustomerIds.includes(customerId)) return state;
      return { ...state, completedCustomerIds: [...state.completedCustomerIds, customerId] };
    }

    case 'RESET_WORKSPACE':
      // Per-customer isolation: wipe every per-customer field, but preserve
      // the session queue counters — same classification rule as Lead's
      // own RESET_WORKSPACE.
      return {
        ...initialCustomerWorkspaceState,
        completedCustomerIds: state.completedCustomerIds,
        sessionStartTime: state.sessionStartTime,
      };

    default:
      return state;
  }
}

const initialCustomerWorkspaceState: CustomerWorkspaceState = {
  draft: {},
  hasUnsaved: false,
  saving: false,
  conflictPending: false,
  completedCustomerIds: [],
  sessionStartTime: Date.now(),
};

interface CustomerWorkspaceContextValue {
  state: CustomerWorkspaceState;
  dispatch: Dispatch<CustomerWorkspaceAction>;
}

const CustomerWorkspaceCtx = createContext<CustomerWorkspaceContextValue | null>(null);

export function useCustomerWorkspaceState() {
  const ctx = useContext(CustomerWorkspaceCtx);
  if (!ctx) throw new Error('useCustomerWorkspaceState must be used within CustomerWorkspaceEngineProvider');
  return ctx;
}

export function CustomerWorkspaceEngineProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(customerWorkspaceReducer, initialCustomerWorkspaceState);
  return (
    <CustomerWorkspaceCtx.Provider value={{ state, dispatch }}>
      {children}
    </CustomerWorkspaceCtx.Provider>
  );
}
