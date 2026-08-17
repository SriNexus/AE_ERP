/**
 * Commission Approvals workspace configuration — tab definitions and quick actions
 *
 * Phase 2D — Commission Approvals Workspace
 * Spec: 10 tabs (Overview + 9 universal), 20+ overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Commission Approval tab definitions (10 tabs total) ──────
export const COMMISSION_APPROVAL_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',               label: 'Overview',              always: true },
  // Universal tabs (9)
  { id: 'activity',               label: 'Activity',              always: false },
  { id: 'notes',                  label: 'Notes',                 always: false },
  { id: 'documents',              label: 'Documents',             always: false },
  { id: 'history',                label: 'History',               always: false },
  { id: 'tasks',                  label: 'Tasks',                 always: false },
  { id: 'permissions',            label: 'Permissions',           always: false },
  { id: 'linked_records',         label: 'Linked Records',        always: false },
  { id: 'attachments',            label: 'Attachments',           always: false },
  { id: 'communication',          label: 'Communication',         always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface CommissionApprovalQuickActionHandlers {
  onApprove?: () => void;
  onReject?: () => void;
  onViewPartner?: () => void;
  onViewRule?: () => void;
  onViewRecord?: () => void;
  onExportRecord?: () => void;
  onCreateTask?: () => void;
}

export function buildCommissionApprovalQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  status: string,
  handlers: CommissionApprovalQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  // Approval/Rejection only for pending records
  if (permissions.canEdit && status === 'pending') {
    actions.push({ id: 'approve-commission', label: 'Approve', permission: 'edit', handler: handlers.onApprove ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'reject-commission', label: 'Reject', permission: 'edit', handler: handlers.onReject ?? (() => {}), variant: 'danger' });
  }

  if (permissions.canCreate) {
    actions.push({ id: 'view-partner', label: 'View Partner', permission: 'create', handler: handlers.onViewPartner ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'view-rule', label: 'View Commission Rule', permission: 'create', handler: handlers.onViewRule ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'view-record', label: 'View Record Details', permission: 'create', handler: handlers.onViewRecord ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'export-record', label: 'Export Record', permission: 'create', handler: handlers.onExportRecord ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
