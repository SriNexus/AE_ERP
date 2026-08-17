/**
 * Cases workspace configuration — tab definitions and quick actions
 *
 * Phase 3D — Cases Workspace
 * Spec: 11 tabs (Overview + Timeline + 9 universal), 30+ overview fields, 8+ quick actions
 */

import type { TabDefinition, QuickActionDef } from '../../../components/shared';

// ── Case tab definitions (11 tabs total) ───────────────────
export const CASE_TABS: TabDefinition[] = [
  // Overview is ALWAYS module-specific
  { id: 'overview',              label: 'Overview',             always: true },
  // Timeline is module-specific (Case lifecycle visualization)
  { id: 'timeline',              label: 'Timeline',             always: false },
  // Universal tabs
  { id: 'activity',              label: 'Activity',             always: false },
  { id: 'notes',                 label: 'Notes',                always: false },
  { id: 'documents',             label: 'Documents',            always: false },
  { id: 'history',               label: 'History',              always: false },
  { id: 'tasks',                 label: 'Tasks',                always: false },
  { id: 'permissions',           label: 'Permissions',          always: false },
  { id: 'linked_records',        label: 'Linked Records',       always: false },
  { id: 'attachments',           label: 'Attachments',          always: false },
  { id: 'communication',         label: 'Communication',        always: false },
];

// ── Quick Actions factory ───────────────────────────────────

export interface CaseQuickActionHandlers {
  onValidate?: () => void;
  onViewLead?: () => void;
  onViewCustomer?: () => void;
  onViewProject?: () => void;
  onViewTimeline?: () => void;
  onExportCase?: () => void;
  onCreateTask?: () => void;
  onGenerateHealthReport?: () => void;
  onRunRepair?: () => void;
}

export function buildCaseQuickActions(
  permissions: { canEdit: boolean; canCreate: boolean; canApprove?: boolean },
  handlers: CaseQuickActionHandlers,
): QuickActionDef[] {
  const actions: QuickActionDef[] = [];

  // Always visible — navigation actions
  actions.push({ id: 'view-lead', label: 'Open Lead', permission: 'view', handler: handlers.onViewLead ?? (() => {}), variant: 'secondary' });
  actions.push({ id: 'view-customer', label: 'Open Customer', permission: 'view', handler: handlers.onViewCustomer ?? (() => {}), variant: 'secondary' });
  actions.push({ id: 'view-project', label: 'Open Project', permission: 'view', handler: handlers.onViewProject ?? (() => {}), variant: 'secondary' });

  // Edit & validation actions
  if (permissions.canEdit) {
    actions.push({ id: 'validate-case', label: 'Validate Case', permission: 'edit', handler: handlers.onValidate ?? (() => {}), variant: 'primary' });
    actions.push({ id: 'generate-health-report', label: 'Health Report', permission: 'edit', handler: handlers.onGenerateHealthReport ?? (() => {}), variant: 'secondary' });
    actions.push({ id: 'export-case', label: 'Export Case', permission: 'edit', handler: handlers.onExportCase ?? (() => {}), variant: 'secondary' });
  }

  // Create actions
  if (permissions.canCreate) {
    actions.push({ id: 'create-task', label: 'Create Task', permission: 'create', handler: handlers.onCreateTask ?? (() => {}), variant: 'secondary' });
  }

  // Admin-only repair
  if (permissions.canApprove) {
    actions.push({ id: 'run-repair', label: 'Run Repair', permission: 'approve', handler: handlers.onRunRepair ?? (() => {}), variant: 'danger' });
  }

  return actions;
}
