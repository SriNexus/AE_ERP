/**
 * LeadWorkspacePersistence — Maps workspace reducer state into a lead's
 * Firestore delta. Reuses the EXISTING persistence services:
 *
 *   - LeadDomainService.update  (lead doc write + converted-customer projection)
 *   - logActivity               (audit trail)
 *
 * This is NOT a new save engine. It only translates the workspace UI state
 * into the fields the rest of the ERP already understands:
 *
 *   status       ← connectedStatus / notConnectedReason
 *   next_date    ← followupDate + followupTime
 *   notes        ← wsState.notes
 *   callsMade    ← wsState.callsMade
 *   activityLog  ← new timeline entries (deduped by entry id)
 */
import type { WorkspaceState } from './LeadWorkspaceEngine';
import { LeadDomainService } from '../../../../services/LeadDomainService';
import { logActivity } from '../../../../lib/workflow';

const CONNECTED_STATUS_TO_LEAD: Record<string, string> = {
  interested: 'Interested',
  qualified: 'Qualified',
  // NOTE: the ERP-wide lead status vocabulary (config/company LEAD_STATUSES,
  // Leads list filters, statusBadge) uses 'Follow-up' — keep the persisted
  // value aligned so the lead remains filterable after processing.
  'need-followup': 'Follow-up',
  converted: 'Converted',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
  'wrong-number': 'Wrong Number',
};

/**
 * Resolve the lead-level status the workspace outcome should persist.
 * Returns null when the workspace has no status-changing selection yet.
 */
export function statusFromWorkspace(ws: WorkspaceState): string | null {
  if (ws.connectedStatus) return CONNECTED_STATUS_TO_LEAD[ws.connectedStatus] || ws.connectedStatus;
  if (ws.notConnectedReason === 'invalid-number') return 'Lost';
  return null;
}

/**
 * Build the Firestore delta from the current workspace state.
 * Only includes fields that actually changed, so repeated saves are idempotent.
 */
export function buildWorkspaceLeadDelta(
  lead: any,
  ws: WorkspaceState,
  user: { id?: string; name?: string },
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};

  // Status
  const status = statusFromWorkspace(ws);
  if (status && status !== lead?.status) delta.status = status;

  // Follow-up (date + time combined into an ISO string)
  if (ws.followupDate) {
    const dt = new Date(`${ws.followupDate}T${ws.followupTime || '00:00'}:00`);
    if (!isNaN(dt.getTime())) delta.next_date = dt.toISOString();
  }

  // Notes
  if (ws.notes && ws.notes !== (lead?.notes || '')) delta.notes = ws.notes;

  // Call counter (only when it grew)
  if (ws.callsMade > Number(lead?.callsMade || 0)) delta.callsMade = ws.callsMade;

  // Activity log — append NEW timeline entries only (deduped by entry id)
  const existing = Array.isArray(lead?.activityLog) ? (lead.activityLog as any[]) : [];
  const existingIds = new Set(existing.map((l: any) => l?.id).filter(Boolean));
  const fresh = ws.timeline
    .filter((t) => t.type !== 'Creation' && t.type !== 'Reset')
    .filter((t) => !existingIds.has(t.id))
    .map((t) => ({
      id: t.id,
      type: t.type,
      desc: t.desc,
      date: new Date().toISOString(),
      userName: user?.name || 'System',
    }));
  if (fresh.length) delta.activityLog = [...existing, ...fresh];

  // Call attempts — structured, reporting-grade records. Append-only, same
  // pattern as activityLog above. Only ever populated by COMMIT_CALL_ATTEMPT,
  // which only fires from a successful Save — so anything present here was
  // genuinely confirmed by the operator, never a provisional selection.
  const existingAttempts = Array.isArray(lead?.callAttempts) ? (lead.callAttempts as any[]) : [];
  if (ws.callAttempts.length) delta.callAttempts = [...existingAttempts, ...ws.callAttempts];

  return delta;
}

/**
 * Persist the workspace state to the lead. Returns true when at least one
 * field was written. Reuses LeadDomainService.update (Firestore write +
 * converted-customer projection) and logActivity (audit trail).
 */
export async function persistLeadWorkspace(
  lead: any,
  ws: WorkspaceState,
  user: { id?: string; name?: string },
): Promise<boolean> {
  if (!lead?.id) return false;

  const delta = buildWorkspaceLeadDelta(lead, ws, user);
  if (Object.keys(delta).length === 0) return false;

  await LeadDomainService.update(lead.id, { ...delta, updatedBy: user?.id || 'system' });
  await logActivity('Leads', 'Lead Updated', lead.id, {
    entityName: lead.name || lead.phone || lead.id,
    actionLabel: 'Lead processed in workspace',
  });
  return true;
}
