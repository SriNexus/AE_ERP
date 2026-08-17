/**
 * Partners workspace configuration — tab definitions and quick actions
 *
 * Phase 2B — Partners Workspace
 * Spec: 11 tabs (Overview + 9 universal + 1 module: commissions)
 *       25+ overview fields, 7+ quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Partner tab definitions (11 tabs total) ──────────────
export const PARTNER_TABS: TabDefinition[] = [
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
  // Module-specific tab
  { id: 'partner-commissions',    label: 'Commissions',           always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface PartnerQuickActionHandlers {
  onEdit?: () => void;
  onViewLeads?: () => void;
  onViewSettlements?: () => void;
  onViewCommissions?: () => void;
  onApprove?: () => void;
  onSuspend?: () => void;
  onReactivate?: () => void;
  onCreateTask?: () => void;
}

export function buildPartnerQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  status: string,
  handlers: PartnerQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-partner', label: 'Edit Partner', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });

    // Status-dependent actions
    if (status === 'pending_approval') {
      actions.push({ id: 'approve-partner', label: 'Approve Partner', permission: 'edit', handler: handlers.onApprove ?? (() => {}), variant: 'primary' });
    } else if (status === 'active') {
      actions.push({ id: 'suspend-partner', label: 'Suspend Partner', permission: 'edit', handler: handlers.onSuspend ?? (() => {}), variant: 'danger' });
    } else if (status === 'suspended') {
      actions.push({ id: 'activate-partner', label: 'Activate Partner', permission: 'edit', handler: handlers.onReactivate ?? (() => {}), variant: 'primary' });
    }
  }

  if (permissions.canCreate) {
    actions.push({ id: 'view-leads', label: 'View Leads', permission: 'create', handler: handlers.onViewLeads ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'view-commissions', label: 'View Commissions', permission: 'create', handler: handlers.onViewCommissions ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'view-settlements', label: 'View Settlements', permission: 'create', handler: handlers.onViewSettlements ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
