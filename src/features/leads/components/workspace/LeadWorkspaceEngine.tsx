/**
 * LeadWorkspaceContext — Centralized workspace session state.
 * Uses useReducer to synchronize ALL UI elements when the user takes any action.
 *
 * State: outcome machine, timeline, calls, workspace status, follow-up fields.
 * Actions: SET_OUTCOME, ADD_TIMELINE, SET_FOLLOWUP_DATE, RESET, etc.
 *
 * No Firestore, no persistence, no APIs — pure UI state synchronization.
 *
 * Phase 1 — Business boundary enforced.
 * Removed: proposalNumber, proposalDate, expectedClosure, estimatedValue,
 * SET_PROPOSAL_NUMBER/DATE, SET_EXPECTED_CLOSURE, SET_ESTIMATED_VALUE.
 * These are sales-pipeline concepts that belong to Customer Workspace.
 */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ConnectedStatus, NotConnectedReason } from './LeadWorkspaceDefs';

// ── Timeline Entry ─────────────────────────────────────────────────────────
export interface TimelineEntry {
  id: string;
  time: string;
  type: string;
  desc: string;
}

// ── Call Attempt — one structured, committed call record ───────────────────
// This is the reporting-grade record of a single call attempt. It is only
// ever created by COMMIT_CALL_ATTEMPT, which only fires from a successful
// Save — never from selecting an outcome/status/reason in the UI. The shape
// is deliberately flat and typed so future reports (Calls Made, Connected %,
// Conversion %, Attempts-before-Conversion, Telecaller Performance) can be
// built directly off this array without any schema migration.
export interface CallAttempt {
  id: string;
  attemptNumber: number;
  outcome: 'connected' | 'not-connected';
  connectedStatus: ConnectedStatus | null;
  notConnectedReason: NotConnectedReason | null;
  followupDate: string | null;
  followupTime: string | null;
  operatorId: string;
  operatorName: string;
  timestamp: string;
  /** Reserved for future call-duration tracking (e.g. telephony integration). Not populated yet. */
  durationSeconds: number | null;
  notes: string | null;
}

// ── Workspace State ────────────────────────────────────────────────────────
export interface WorkspaceState {
  outcome: 'connected' | 'not-connected' | null;
  connectedStatus: ConnectedStatus | null;
  notConnectedReason: NotConnectedReason | null;

  followupDate: string;
  followupTime: string;
  priority: string;
  reminder: string;

  rejectReason: string;
  duplicateLeadId: string;
  assignUserId: string;
  notes: string;
  conversionType: 'b2b' | 'b2c' | null;

  timeline: TimelineEntry[];
  /** Call attempts committed this session (Save-confirmed only) — appended to the lead's persisted `callAttempts` array. */
  callAttempts: CallAttempt[];
  /** True once the current outcome selection has been committed via Save. False the moment a new/changed outcome is selected. Prevents double-counting the same attempt across repeated Saves. */
  outcomeCommitted: boolean;
  callsMade: number;
  lastAction: string;
  workspaceStatus: string;
  hasUnsaved: boolean;

  // ── Phase 7: Queue tracking ────────────────────────────
  completedLeadIds: string[];
  convertedToday: number;
  lostToday: number;
  completedToday: number;
  sessionStartTime: number;
}

// ── Actions ────────────────────────────────────────────────────────────────
export type WorkspaceAction =
  | { type: 'SET_OUTCOME'; payload: 'connected' | 'not-connected' | null }
  | { type: 'SET_CONNECTED_STATUS'; payload: ConnectedStatus | null }
  | { type: 'SET_NOT_CONNECTED_REASON'; payload: NotConnectedReason | null }
  | { type: 'SET_FOLLOWUP_DATE'; payload: string }
  | { type: 'SET_FOLLOWUP_TIME'; payload: string }
  | { type: 'SET_PRIORITY'; payload: string }
  | { type: 'SET_REMINDER'; payload: string }
  | { type: 'SET_NOTES'; payload: string }
  | { type: 'SET_REJECT_REASON'; payload: string }
  | { type: 'SET_DUPLICATE_LEAD_ID'; payload: string }
  | { type: 'SET_ASSIGN_USER_ID'; payload: string }
  | { type: 'SET_CONVERSION_TYPE'; payload: 'b2b' | 'b2c' | null }
  | { type: 'ADD_TIMELINE'; payload: TimelineEntry }
  | { type: 'COMMIT_CALL_ATTEMPT'; payload: { operatorId: string; operatorName: string; previousAttemptCount: number } }
  | { type: 'SET_LAST_ACTION'; payload: string }
  | { type: 'RESET_OUTCOME' }
  | { type: 'INIT'; payload?: Partial<WorkspaceState> }
  | { type: 'COMPLETE_LEAD'; payload: { leadId: string; outcome: 'converted' | 'lost' | 'rejected' | 'duplicate' | 'wrong-number' } }
  | { type: 'MARK_CLEAN' }
  | { type: 'RESET_WORKSPACE' }
  | { type: 'RESET_QUEUE_SESSION' };

// ── Status display names ──────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  interested: 'Interested', qualified: 'Qualified', 'need-followup': 'Need Follow-up',
  converted: 'Converted', rejected: 'Rejected', duplicate: 'Duplicate',
  'wrong-number': 'Wrong Number',
};

const REASON_LABELS: Record<string, string> = {
  busy: 'Busy', 'switched-off': 'Switched Off', 'no-answer': 'No Answer',
  'not-reachable': 'Not Reachable', 'call-rejected': 'Call Rejected',
  'invalid-number': 'Invalid Number',
};

// ── Get current time string ────────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ── Reducer ────────────────────────────────────────────────────────────────
const DEFAULT_STATUS = 'Ready';

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'INIT':
      return { ...initialWorkspaceState, ...action.payload, timeline: [{ id: uid(), time: now(), type: 'Creation', desc: 'Lead opened' }], workspaceStatus: DEFAULT_STATUS };

    // NOTE: SET_OUTCOME / SET_CONNECTED_STATUS / SET_NOT_CONNECTED_REASON are
    // pure UI-state selectors. They mark the workspace dirty (hasUnsaved) and
    // reset `outcomeCommitted` to false, but they deliberately do NOT touch
    // `timeline` or `callsMade` — nothing is recorded as having happened
    // until COMMIT_CALL_ATTEMPT runs, which only fires from a successful Save.
    case 'SET_OUTCOME': {
      const outcome = action.payload;
      return {
        ...state,
        outcome,
        connectedStatus: outcome !== 'connected' ? null : state.connectedStatus,
        notConnectedReason: outcome !== 'not-connected' ? null : state.notConnectedReason,
        lastAction: outcome ? `Call outcome selected: ${outcome}` : 'Cleared',
        outcomeCommitted: false,
        hasUnsaved: true,
      };
    }

    case 'SET_CONNECTED_STATUS': {
      const s = action.payload;
      const label = s ? STATUS_LABELS[s] || s : '';
      return {
        ...state,
        connectedStatus: s,
        lastAction: s ? `Status selected: ${label}` : state.lastAction,
        workspaceStatus: s === 'converted' ? 'Converted' : s ? 'Ready To Save' : state.workspaceStatus,
        outcomeCommitted: false,
        hasUnsaved: true,
      };
    }

    case 'SET_NOT_CONNECTED_REASON': {
      const r = action.payload;
      const label = r ? REASON_LABELS[r] || r : '';
      return {
        ...state,
        notConnectedReason: r,
        lastAction: r ? `Reason selected: ${label}` : state.lastAction,
        workspaceStatus: r === 'invalid-number' ? 'Lost' : r ? 'Follow-up Scheduled' : state.workspaceStatus,
        outcomeCommitted: false,
        hasUnsaved: true,
      };
    }

    // COMMIT_CALL_ATTEMPT — the ONLY place a call attempt becomes real. Fires
    // once per outcome selection, from a successful Save (never from clicking
    // Add Call Log or any outcome/status/reason button). Builds one structured
    // CallAttempt record plus the matching human-readable timeline entry, and
    // is the only place callsMade increments.
    case 'COMMIT_CALL_ATTEMPT': {
      if (!state.outcome || state.outcomeCommitted) return state;
      const { operatorId, operatorName, previousAttemptCount } = action.payload;
      const attempt: CallAttempt = {
        id: uid(),
        attemptNumber: previousAttemptCount + state.callAttempts.length + 1,
        outcome: state.outcome,
        connectedStatus: state.outcome === 'connected' ? state.connectedStatus : null,
        notConnectedReason: state.outcome === 'not-connected' ? state.notConnectedReason : null,
        followupDate: state.followupDate || null,
        followupTime: state.followupTime || null,
        operatorId,
        operatorName,
        timestamp: new Date().toISOString(),
        durationSeconds: null,
        notes: state.notes || null,
      };
      const desc = attempt.outcome === 'connected'
        ? `Connected — ${attempt.connectedStatus ? STATUS_LABELS[attempt.connectedStatus] || attempt.connectedStatus : 'no status'}`
        : `Not Connected — ${attempt.notConnectedReason ? REASON_LABELS[attempt.notConnectedReason] || attempt.notConnectedReason : 'no reason'}`;
      return {
        ...state,
        callAttempts: [...state.callAttempts, attempt],
        timeline: [...state.timeline, { id: attempt.id, time: now(), type: 'Call Attempt', desc }],
        callsMade: state.callsMade + 1,
        outcomeCommitted: true,
      };
    }

    case 'SET_FOLLOWUP_DATE':
      return { ...state, followupDate: action.payload, hasUnsaved: true };

    case 'SET_FOLLOWUP_TIME':
      return { ...state, followupTime: action.payload, hasUnsaved: true };

    case 'SET_PRIORITY':
      return { ...state, priority: action.payload, hasUnsaved: true };

    case 'SET_REMINDER':
      return { ...state, reminder: action.payload, hasUnsaved: true };

    case 'SET_NOTES':
      return { ...state, notes: action.payload, hasUnsaved: true };

    case 'SET_REJECT_REASON':
      return { ...state, rejectReason: action.payload, hasUnsaved: true };

    case 'SET_DUPLICATE_LEAD_ID':
      return { ...state, duplicateLeadId: action.payload, hasUnsaved: true };

    case 'SET_ASSIGN_USER_ID':
      return { ...state, assignUserId: action.payload, hasUnsaved: true };

    case 'SET_CONVERSION_TYPE':
      return { ...state, conversionType: action.payload, hasUnsaved: true };

    case 'ADD_TIMELINE':
      return { ...state, timeline: [...state.timeline, action.payload], hasUnsaved: true };

    case 'SET_LAST_ACTION':
      return { ...state, lastAction: action.payload };

    case 'COMPLETE_LEAD': {
      const { leadId, outcome } = action.payload;
      const addToCompleted = !state.completedLeadIds.includes(leadId);
      return {
        ...state,
        completedLeadIds: addToCompleted ? [...state.completedLeadIds, leadId] : state.completedLeadIds,
        convertedToday: outcome === 'converted' ? state.convertedToday + 1 : state.convertedToday,
        lostToday: (outcome === 'lost' || outcome === 'rejected' || outcome === 'duplicate' || outcome === 'wrong-number') ? state.lostToday + 1 : state.lostToday,
        completedToday: addToCompleted ? state.completedToday + 1 : state.completedToday,
        workspaceStatus: outcome === 'converted' ? 'Converted' : 'Lost',
      };
    }

    case 'RESET_OUTCOME':
      // Reset ONLY the call-outcome machine. Preserve every other per-lead
      // field (notes, follow-up, transfer, reject/duplicate details) so the
      // operator never loses typed work — and keep hasUnsaved untouched so
      // any remaining edits stay dirty until explicitly saved or discarded.
      // No timeline entry here — resetting an uncommitted selection is not
      // an event worth recording; nothing was ever committed in the first place.
      return {
        ...state,
        outcome: null,
        connectedStatus: null,
        notConnectedReason: null,
        workspaceStatus: DEFAULT_STATUS,
        outcomeCommitted: true,
      };

    case 'MARK_CLEAN':
      // After a successful save the workspace has no unsaved changes.
      return { ...state, hasUnsaved: false, lastAction: 'Saved' };

    case 'RESET_WORKSPACE':
      // Per-lead isolation: wipe every lead-owned field when opening a new
      // lead, but PRESERVE the session queue counters (completedLeadIds,
      // convertedToday, lostToday, completedToday, sessionStartTime) so the
      // operator's daily queue progress is never lost between leads.
      return {
        ...initialWorkspaceState,
        timeline: [{ id: uid(), time: now(), type: 'Creation', desc: 'Lead opened' }],
        workspaceStatus: DEFAULT_STATUS,
        completedLeadIds: state.completedLeadIds,
        convertedToday: state.convertedToday,
        lostToday: state.lostToday,
        completedToday: state.completedToday,
        sessionStartTime: state.sessionStartTime,
      };

    case 'RESET_QUEUE_SESSION':
      // "Refresh Queue" — unlike RESET_WORKSPACE (per-lead isolation), this
      // deliberately clears the session queue counters themselves, starting
      // a fresh processing session. Used only from the Queue Completed screen.
      return {
        ...state,
        completedLeadIds: [],
        convertedToday: 0,
        lostToday: 0,
        completedToday: 0,
        sessionStartTime: Date.now(),
      };

    default:
      return state;
  }
}

const initialWorkspaceState: WorkspaceState = {
  outcome: null,
  connectedStatus: null,
  notConnectedReason: null,
  followupDate: '',
  followupTime: '',
  priority: 'medium',
  reminder: '15-minutes',
  rejectReason: '',
  duplicateLeadId: '',
  assignUserId: '',
  notes: '',
  conversionType: null,
  timeline: [],
  callAttempts: [],
  outcomeCommitted: true,
  callsMade: 0,
  lastAction: '',
  workspaceStatus: DEFAULT_STATUS,
  hasUnsaved: false,
  completedLeadIds: [],
  convertedToday: 0,
  lostToday: 0,
  completedToday: 0,
  sessionStartTime: Date.now(),
};

// ── Context ────────────────────────────────────────────────────────────────
// NOTE: Persistence intentionally does NOT live here. The workspace save
// lifecycle (persistLeadWorkspace → LeadDomainService.update + logActivity)
// is orchestrated by WorkspaceContent.handleSave, which dispatches MARK_CLEAN
// after a successful write. The context only synchronizes UI state.
interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
}

const WorkspaceCtx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used within LeadWorkspaceProvider');
  return ctx;
}

export function LeadWorkspaceProvider({ children, initial }: { children: ReactNode; initial?: Partial<WorkspaceState> }) {
  const [state, dispatch] = useReducer(workspaceReducer, { ...initialWorkspaceState, ...initial, timeline: initial?.timeline || [{ id: uid(), time: now(), type: 'Creation', desc: 'Lead opened' }] });

  return (
    <WorkspaceCtx.Provider value={{ state, dispatch }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
