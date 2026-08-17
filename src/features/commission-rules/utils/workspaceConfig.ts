/**
 * Commission Rules workspace configuration — tab definitions and quick actions
 *
 * Phase 2C — Commission Rules Workspace
 * Spec: 10 tabs (Overview + 9 universal), 20+ overview fields, 7 quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Commission Rule tab definitions (10 tabs total) ─────────
export const COMMISSION_RULE_TABS: TabDefinition[] = [
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

export interface CommissionRuleQuickActionHandlers {
  onEdit?: () => void;
  onDuplicate?: () => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onViewCommissions?: () => void;
  onExportRule?: () => void;
  onCreateTask?: () => void;
}

export function buildCommissionRuleQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean },
  isActive: boolean,
  handlers: CommissionRuleQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  if (permissions.canEdit) {
    actions.push({ id: 'edit-rule', label: 'Edit Rule', permission: 'edit', handler: handlers.onEdit ?? (() => {}), variant: 'primary' });

    // Status-dependent actions
    if (isActive) {
      actions.push({ id: 'deactivate-rule', label: 'Deactivate Rule', permission: 'edit', handler: handlers.onDeactivate ?? (() => {}), variant: 'danger' });
    } else {
      actions.push({ id: 'activate-rule', label: 'Activate Rule', permission: 'edit', handler: handlers.onActivate ?? (() => {}), variant: 'primary' });
    }

    actions.push({ id: 'duplicate-rule', label: 'Duplicate Rule', permission: 'edit', handler: handlers.onDuplicate ?? (() => {}), variant: 'secondary' });
  }

  if (permissions.canCreate) {
    actions.push({ id: 'view-commissions', label: 'View Commissions', permission: 'create', handler: handlers.onViewCommissions ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'export-rule', label: 'Export Rule', permission: 'create', handler: handlers.onExportRule ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  return actions;
}
