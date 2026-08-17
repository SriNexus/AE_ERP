/**
 * Shared workspace types — extracted to break circular dependency.
 * Both CallOutcomePanel and LeadWorkspaceContext import from here.
 *
 * Phase 1 — Business boundary enforced.
 * Only telecaller workflow statuses: Interested, Need Follow-up, Qualified,
 * Converted, Rejected, Duplicate, Wrong Number.
 * Sales-pipeline statuses (Proposal Sent, Negotiation) removed — belong to Customer Workspace.
 */
export type OutcomeType = 'connected' | 'not-connected' | null;
export type ConnectedStatus =
  | 'interested' | 'qualified' | 'need-followup'
  | 'converted' | 'rejected' | 'duplicate' | 'wrong-number';
export type NotConnectedReason =
  | 'busy' | 'switched-off' | 'no-answer' | 'not-reachable' | 'call-rejected' | 'invalid-number';
